// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../oracle/CompositeSanityOracle.sol";
import "../registry/LevierMarketRegistry.sol";

/**
 * @title LevierPair
 * @notice Isolated lending and leverage engine for a single collateral/debt token pair.
 */
contract LevierPair is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    bytes32 public immutable marketId;
    IERC20 public immutable collateralToken;
    IERC20 public immutable debtToken;
    CompositeSanityOracle public immutable oracle;
    LevierMarketRegistry public immutable registry;

    // User positions
    struct UserAccount {
        uint256 collateral;
        uint256 debt;
    }

    mapping(address => UserAccount) public accounts;
    mapping(address => mapping(address => bool)) public approvedOperators;
    uint256 public immutable collateralUnit;
    uint256 public immutable debtUnit;

    event OperatorApproval(address indexed user, address indexed operator, bool approved);

    uint256 public totalSupplyCollateral;
    uint256 public totalBorrowedDebt;

    // Liquidation bonus: 5% (500 bps)
    uint256 public liquidationBonusBps = 500;

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event DebtBorrowed(address indexed user, uint256 amount);
    event DebtRepaid(address indexed user, uint256 amount);
    event PositionLiquidated(
        address indexed user, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized
    );

    constructor(
        bytes32 _marketId,
        address _collateralToken,
        address _debtToken,
        address _oracle,
        address _registry,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_collateralToken.code.length > 0 && _debtToken.code.length > 0, "Pair: Invalid token contract");
        require(_collateralToken != _debtToken, "Pair: Identical tokens");
        require(_oracle.code.length > 0 && _registry.code.length > 0, "Pair: Invalid infrastructure");
        uint8 collateralDecimals = IERC20Metadata(_collateralToken).decimals();
        uint8 debtDecimals = IERC20Metadata(_debtToken).decimals();
        require(collateralDecimals <= 36 && debtDecimals <= 36, "Pair: Unsupported decimals");
        collateralUnit = 10 ** uint256(collateralDecimals);
        debtUnit = 10 ** uint256(debtDecimals);
        marketId = _marketId;
        collateralToken = IERC20(_collateralToken);
        debtToken = IERC20(_debtToken);
        oracle = CompositeSanityOracle(_oracle);
        registry = LevierMarketRegistry(_registry);
    }

    function setOperator(address operator, bool approved) external {
        require(operator != address(0), "Pair: Invalid operator");
        if (approved) require(registry.isAuthorizedRouter(operator), "Pair: Router not authorized");
        approvedOperators[msg.sender][operator] = approved;
        emit OperatorApproval(msg.sender, operator, approved);
    }

    function _requireOperator(address user) internal view {
        require(
            msg.sender == user || (registry.isAuthorizedRouter(msg.sender) && approvedOperators[user][msg.sender]),
            "Pair: Caller is not authorized for user"
        );
    }

    function _receiveExact(IERC20 token, uint256 amount) internal {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        require(token.balanceOf(address(this)) == beforeBalance + amount, "Pair: Unsupported token transfer");
    }

    function _collateralValue(uint256 amount, uint256 price) internal view returns (uint256) {
        return Math.mulDiv(amount, price, collateralUnit);
    }

    function debtValueUsd(uint256 amount) public view returns (uint256) {
        return Math.mulDiv(amount, oracle.getPrice(address(debtToken)), debtUnit, Math.Rounding.Ceil);
    }

    /**
     * @notice Supplies collateral to the pair.
     */
    function depositCollateral(uint256 amount) external nonReentrant {
        _depositCollateral(msg.sender, amount);
    }

    function depositCollateralFor(address recipient, uint256 amount) external nonReentrant {
        _depositCollateral(recipient, amount);
    }

    function _depositCollateral(address recipient, uint256 amount) internal {
        require(amount > 0, "Pair: Amount must be > 0");
        LevierMarketRegistry.MarketConfig memory m = registry.getMarket(marketId);
        require(m.status != LevierMarketRegistry.MarketStatus.PAUSED, "Pair: Market is paused");

        require(recipient != address(0), "Pair: Invalid recipient");
        _receiveExact(collateralToken, amount);
        accounts[recipient].collateral += amount;
        totalSupplyCollateral += amount;

        if (m.supplyCap > 0) {
            require(totalSupplyCollateral <= m.supplyCap, "Pair: Exceeds supply cap");
        }

        emit CollateralDeposited(recipient, amount);
    }

    /**
     * @notice Withdraws collateral from the pair ensuring remaining position stays healthy.
     */
    function withdrawCollateral(uint256 amount) external nonReentrant {
        _withdrawCollateral(msg.sender, amount, msg.sender);
    }

    function withdrawCollateralFor(address user, uint256 amount, address recipient) external nonReentrant {
        _requireOperator(user);
        _withdrawCollateral(user, amount, recipient);
    }

    function _withdrawCollateral(address user, uint256 amount, address recipient) internal {
        require(amount > 0, "Pair: Amount must be > 0");
        require(recipient != address(0), "Pair: Invalid recipient");
        UserAccount storage acc = accounts[user];
        require(acc.collateral >= amount, "Pair: Insufficient collateral balance");

        acc.collateral -= amount;
        totalSupplyCollateral -= amount;

        // If user has debt, verify new position does not exceed Max LTV
        if (acc.debt > 0) {
            require(_isHealthy(user), "Pair: Withdrawal breaches Max LTV limit");
        }

        collateralToken.safeTransfer(recipient, amount);
        emit CollateralWithdrawn(user, amount);
    }

    /**
     * @notice Borrows debt tokens against supplied collateral.
     */
    function borrow(uint256 amount) external nonReentrant {
        _borrow(msg.sender, amount, msg.sender);
    }

    /**
     * @notice Borrows debt tokens on behalf of a borrower (callable by borrower or authorized router).
     */
    function borrowFor(address borrower, uint256 amount, address recipient) external nonReentrant {
        _requireOperator(borrower);
        _borrow(borrower, amount, recipient);
    }

    function _borrow(address borrower, uint256 amount, address recipient) internal {
        require(amount > 0, "Pair: Amount must be > 0");
        require(recipient != address(0), "Pair: Invalid recipient");
        LevierMarketRegistry.MarketConfig memory m = registry.getMarket(marketId);
        require(m.status == LevierMarketRegistry.MarketStatus.NORMAL, "Pair: Market borrowing restricted");

        UserAccount storage acc = accounts[borrower];
        acc.debt += amount;
        totalBorrowedDebt += amount;

        if (m.borrowCap > 0) {
            require(totalBorrowedDebt <= m.borrowCap, "Pair: Exceeds borrow cap");
        }

        require(_isHealthy(borrower), "Pair: Borrow exceeds Max LTV limit");

        debtToken.safeTransfer(recipient, amount);
        emit DebtBorrowed(borrower, amount);
    }

    /**
     * @notice Repays outstanding debt.
     */
    function repay(uint256 amount) external nonReentrant {
        _repay(msg.sender, amount);
    }

    function repayFor(address borrower, uint256 amount) external nonReentrant {
        _repay(borrower, amount);
    }

    function _repay(address borrower, uint256 amount) internal {
        require(amount > 0, "Pair: Amount must be > 0");
        UserAccount storage acc = accounts[borrower];
        uint256 debtToRepay = amount > acc.debt ? acc.debt : amount;

        acc.debt -= debtToRepay;
        totalBorrowedDebt -= debtToRepay;

        _receiveExact(debtToken, debtToRepay);
        emit DebtRepaid(borrower, debtToRepay);
    }

    /**
     * @notice Liquidates an unhealthy position when LTV breaches liquidation threshold.
     */
    function liquidate(address borrower, uint256 maxDebtRepay) external nonReentrant {
        require(isLiquidatable(borrower), "Pair: Position is not liquidatable");

        UserAccount storage acc = accounts[borrower];
        uint256 debtToRepay = maxDebtRepay > acc.debt ? acc.debt : maxDebtRepay;
        require(debtToRepay > 0, "Pair: No debt to liquidate");

        uint256 collateralPrice = oracle.getPrice(address(collateralToken));
        uint256 debtPrice = oracle.getPrice(address(debtToken));

        // Limit payment to the collateral-backed amount; do not charge for collateral that cannot be seized.
        uint256 collateralValue = _collateralValue(acc.collateral, collateralPrice);
        uint256 repayValueCap = Math.mulDiv(collateralValue, 10_000, 10_000 + liquidationBonusBps);
        uint256 repayCap = Math.mulDiv(repayValueCap, debtUnit, debtPrice);
        if (debtToRepay > repayCap) debtToRepay = repayCap;
        require(debtToRepay > 0, "Pair: No collateral-backed debt to liquidate");
        uint256 debtRepaidValueUsd = Math.mulDiv(debtToRepay, debtPrice, debtUnit, Math.Rounding.Ceil);
        uint256 collateralValueToSeize =
            Math.mulDiv(debtRepaidValueUsd, 10_000 + liquidationBonusBps, 10_000, Math.Rounding.Ceil);
        uint256 collateralToSeize =
            Math.mulDiv(collateralValueToSeize, collateralUnit, collateralPrice, Math.Rounding.Ceil);
        if (collateralToSeize > acc.collateral) collateralToSeize = acc.collateral;

        acc.debt -= debtToRepay;
        acc.collateral -= collateralToSeize;
        totalBorrowedDebt -= debtToRepay;
        totalSupplyCollateral -= collateralToSeize;

        // Transfer funds: Liquidator pays debt, receives seized collateral
        _receiveExact(debtToken, debtToRepay);
        collateralToken.safeTransfer(msg.sender, collateralToSeize);

        emit PositionLiquidated(borrower, msg.sender, debtToRepay, collateralToSeize);
    }

    function _isHealthy(address user) internal view returns (bool) {
        UserAccount memory acc = accounts[user];
        if (acc.debt == 0) return true;
        if (acc.collateral == 0) return false;

        uint256 collateralPrice = oracle.getPrice(address(collateralToken));
        uint256 collateralValueUsd = _collateralValue(acc.collateral, collateralPrice);

        uint256 debtPrice = oracle.getPrice(address(debtToken));
        uint256 debtValueUsd = Math.mulDiv(acc.debt, debtPrice, debtUnit, Math.Rounding.Ceil);

        LevierMarketRegistry.MarketConfig memory m = registry.getMarket(marketId);
        uint256 maxBorrowAllowedUsd = Math.mulDiv(collateralValueUsd, m.maxLtvBps, 10_000);

        return debtValueUsd <= maxBorrowAllowedUsd;
    }

    function isLiquidatable(address user) public view returns (bool) {
        UserAccount memory acc = accounts[user];
        if (acc.debt == 0 || acc.collateral == 0) return false;

        uint256 collateralPrice = oracle.getPrice(address(collateralToken));
        uint256 collateralValueUsd = _collateralValue(acc.collateral, collateralPrice);

        uint256 debtPrice = oracle.getPrice(address(debtToken));
        uint256 debtValueUsd = Math.mulDiv(acc.debt, debtPrice, debtUnit, Math.Rounding.Ceil);

        LevierMarketRegistry.MarketConfig memory m = registry.getMarket(marketId);
        uint256 liquidationDebtThresholdUsd = Math.mulDiv(collateralValueUsd, m.liquidationLtvBps, 10_000);

        return debtValueUsd > liquidationDebtThresholdUsd;
    }

    function getPosition(address user)
        external
        view
        returns (uint256 collateralAmount, uint256 debtAmount, uint256 collateralValueUsd, uint256 healthFactorBps)
    {
        UserAccount memory acc = accounts[user];
        collateralAmount = acc.collateral;
        debtAmount = acc.debt;

        if (acc.collateral > 0) {
            uint256 price = oracle.getPrice(address(collateralToken));
            collateralValueUsd = _collateralValue(acc.collateral, price);
        }

        uint256 debtValueUsd = 0;
        if (acc.debt > 0) {
            uint256 debtPrice = oracle.getPrice(address(debtToken));
            debtValueUsd = Math.mulDiv(acc.debt, debtPrice, debtUnit, Math.Rounding.Ceil);
        }

        if (debtValueUsd == 0) {
            healthFactorBps = 999_0000; // Safe position (999.00)
        } else if (collateralValueUsd == 0) {
            healthFactorBps = 0;
        } else {
            LevierMarketRegistry.MarketConfig memory m = registry.getMarket(marketId);
            uint256 maxDebtUsd = Math.mulDiv(collateralValueUsd, m.liquidationLtvBps, 10_000);
            healthFactorBps = Math.mulDiv(maxDebtUsd, 10_000, debtValueUsd);
        }
    }
}
