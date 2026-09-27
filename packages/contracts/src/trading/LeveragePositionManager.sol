// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../oracle/IPonsOracleRouter.sol";
import "../pons/IPonsRiskEngine.sol";
import "./IPositionManager.sol";

/**
 * @title LeveragePositionManager
 * @notice Manages leveraged long/short positions for Pons-graduated assets.
 * @dev Integrates with PonsRiskEngine to enforce max leverage and liquidation limits.
 */
contract LeveragePositionManager is IPositionManager, Ownable {
    using SafeERC20 for IERC20;

    IPonsRiskEngine public immutable riskEngine;
    IPonsOracleRouter public immutable oracleRouter;
    address public immutable baseCollateral; // e.g., USDG

    uint256 public liquidationFeeBps = 500; // 5% fee to the liquidator
    address public treasury; // Protocol treasury for seized equity

    // account => asset => isLong => Position
    mapping(address => mapping(address => mapping(bool => Position))) public positions;

    event PositionOpened(
        address indexed account,
        address indexed asset,
        bool isLong,
        uint256 sizeAsset,
        uint256 collateralAmount,
        uint256 entryPrice
    );
    event PositionClosed(
        address indexed account,
        address indexed asset,
        bool isLong,
        uint256 pnl,
        bool isProfit
    );
    event PositionLiquidated(
        address indexed account,
        address indexed asset,
        bool isLong,
        address indexed liquidator,
        uint256 rewardAmount,
        uint256 seizedAmount
    );
    event CollateralAdded(address indexed account, address indexed asset, bool isLong, uint256 amount);
    event CollateralRemoved(address indexed account, address indexed asset, bool isLong, uint256 amount);

    constructor(
        address _riskEngine,
        address _oracleRouter,
        address _baseCollateral,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_riskEngine != address(0), "LPM: Zero risk engine");
        require(_oracleRouter != address(0), "LPM: Zero oracle router");
        require(_baseCollateral != address(0), "LPM: Zero base collateral");
        
        riskEngine = IPonsRiskEngine(_riskEngine);
        oracleRouter = IPonsOracleRouter(_oracleRouter);
        baseCollateral = _baseCollateral;
        treasury = _initialOwner;
    }

    function setLiquidationFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= 5000, "LPM: Fee too high");
        liquidationFeeBps = feeBps;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "LPM: Zero treasury address");
        treasury = _treasury;
    }

    /**
     * @inheritdoc IPositionManager
     */
    function openPosition(
        address asset,
        bool isLong,
        uint256 collateralAmount,
        uint256 sizeAsset
    ) external override {
        require(collateralAmount > 0, "LPM: Zero collateral");
        require(sizeAsset > 0, "LPM: Zero size");

        Position storage pos = positions[msg.sender][asset][isLong];
        require(pos.sizeAsset == 0, "LPM: Position already exists, use increasePosition");

        // Transfer collateral from user
        IERC20(baseCollateral).safeTransferFrom(msg.sender, address(this), collateralAmount);

        // Get current mark price
        uint256 currentPrice = oracleRouter.getMarkPrice(asset);

        uint256 sizeValueUsd = (sizeAsset * currentPrice) / 1e18; // assuming asset is 18 decimals
        require(sizeValueUsd > collateralAmount, "LPM: Leverage must be > 1x");

        // Check health factor before allowing
        bool isHealthy = riskEngine.isPositionHealthy(
            asset,
            isLong,
            sizeAsset,
            collateralAmount,
            currentPrice
        );
        require(isHealthy, "LPM: Position would be unhealthy");

        // Store position
        positions[msg.sender][asset][isLong] = Position({
            account: msg.sender,
            asset: asset,
            isLong: isLong,
            sizeAsset: sizeAsset,
            collateralAmount: collateralAmount,
            debtAmount: 0, // Unused in synthetic CFD model
            entryPrice: currentPrice,
            lastUpdateTime: block.timestamp
        });

        emit PositionOpened(msg.sender, asset, isLong, sizeAsset, collateralAmount, currentPrice);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function closePosition(address asset, bool isLong) external override {
        Position storage pos = positions[msg.sender][asset][isLong];
        require(pos.sizeAsset > 0, "LPM: No active position");

        uint256 currentPrice = oracleRouter.getMarkPrice(asset);
        
        uint256 currentValue = (pos.sizeAsset * currentPrice) / 1e18;
        uint256 entryValue = (pos.sizeAsset * pos.entryPrice) / 1e18;
        
        bool isProfit;
        uint256 pnl;

        if (isLong) {
            isProfit = currentValue >= entryValue;
            pnl = isProfit ? (currentValue - entryValue) : (entryValue - currentValue);
        } else {
            isProfit = entryValue >= currentValue;
            pnl = isProfit ? (entryValue - currentValue) : (currentValue - entryValue);
        }
        
        uint256 payout = pos.collateralAmount;
        if (isProfit) {
            payout += pnl;
        } else {
            if (pnl >= pos.collateralAmount) {
                payout = 0; // REKT
            } else {
                payout -= pnl;
            }
        }

        // Clear position
        delete positions[msg.sender][asset][isLong];

        // Send payout
        if (payout > 0) {
            IERC20(baseCollateral).safeTransfer(msg.sender, payout);
        }

        emit PositionClosed(msg.sender, asset, isLong, pnl, isProfit);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function liquidatePosition(address account, address asset, bool isLong) external override {
        Position storage pos = positions[account][asset][isLong];
        require(pos.sizeAsset > 0, "LPM: No active position");

        uint256 currentPrice = oracleRouter.getMarkPrice(asset);

        bool isHealthy = riskEngine.isPositionHealthy(
            asset,
            isLong,
            pos.sizeAsset,
            pos.collateralAmount,
            pos.entryPrice
        );
        require(!isHealthy, "LPM: Position is healthy");

        uint256 currentValue = (pos.sizeAsset * currentPrice) / 1e18;
        uint256 entryValue = (pos.sizeAsset * pos.entryPrice) / 1e18;

        uint256 equity = pos.collateralAmount;

        if (isLong) {
            if (currentValue >= entryValue) {
                equity += (currentValue - entryValue);
            } else {
                uint256 loss = entryValue - currentValue;
                if (loss >= equity) equity = 0;
                else equity -= loss;
            }
        } else {
            if (entryValue >= currentValue) {
                equity += (entryValue - currentValue);
            } else {
                uint256 loss = currentValue - entryValue;
                if (loss >= equity) equity = 0;
                else equity -= loss;
            }
        }

        uint256 rewardAmount = 0;
        uint256 seizedAmount = 0;

        if (equity > 0) {
            rewardAmount = (equity * liquidationFeeBps) / 10000;
            seizedAmount = equity - rewardAmount;
        }

        // Clear position
        delete positions[account][asset][isLong];

        // Distribute remaining equity
        if (rewardAmount > 0) {
            IERC20(baseCollateral).safeTransfer(msg.sender, rewardAmount);
        }
        if (seizedAmount > 0) {
            IERC20(baseCollateral).safeTransfer(treasury, seizedAmount);
        }

        emit PositionLiquidated(account, asset, isLong, msg.sender, rewardAmount, seizedAmount);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function addCollateral(address asset, bool isLong, uint256 amount) external override {
        _addCollateralFor(msg.sender, asset, isLong, amount);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function addCollateralFor(address account, address asset, bool isLong, uint256 amount) external override {
        _addCollateralFor(account, asset, isLong, amount);
    }

    function _addCollateralFor(address account, address asset, bool isLong, uint256 amount) internal {
        Position storage pos = positions[account][asset][isLong];
        require(pos.sizeAsset > 0, "LPM: No active position");
        require(amount > 0, "LPM: Zero amount");

        IERC20(baseCollateral).safeTransferFrom(msg.sender, address(this), amount);
        pos.collateralAmount += amount;
        pos.lastUpdateTime = block.timestamp;

        emit CollateralAdded(account, asset, isLong, amount);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function removeCollateral(address asset, bool isLong, uint256 amount) external override {
        Position storage pos = positions[msg.sender][asset][isLong];
        require(pos.sizeAsset > 0, "LPM: No active position");
        require(amount > 0, "LPM: Zero amount");
        require(pos.collateralAmount > amount, "LPM: Cannot remove all collateral");

        // Temporarily decrease to check health
        pos.collateralAmount -= amount;

        bool isHealthy = riskEngine.isPositionHealthy(
            asset,
            isLong,
            pos.sizeAsset,
            pos.collateralAmount,
            pos.entryPrice
        );
        require(isHealthy, "LPM: Cannot remove, position would be unhealthy");

        pos.lastUpdateTime = block.timestamp;
        IERC20(baseCollateral).safeTransfer(msg.sender, amount);

        emit CollateralRemoved(msg.sender, asset, isLong, amount);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getPosition(address account, address asset, bool isLong)
        external
        view
        override
        returns (Position memory)
    {
        return positions[account][asset][isLong];
    }
}
