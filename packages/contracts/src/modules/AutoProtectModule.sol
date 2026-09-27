// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../core/LeveraPair.sol";

/**
 * @title AutoProtectModule
 * @notice Keeper-funded repayment foundation; collateral-swap deleveraging is not implemented.
 */
contract AutoProtectModule is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bool public isPaused = true;
    event PauseUpdated(bool paused);

    function setPaused(bool paused) external onlyOwner {
        isPaused = paused;
        emit PauseUpdated(paused);
    }

    struct Config {
        bool isEnabled;
        uint256 triggerLtvBps; // e.g. 5500 for 55%
        uint256 targetLtvBps; // e.g. 4000 for 40%
        uint256 maxDeleverage; // Maximum amount of debt to repay in single action
    }

    // user => pairAddress => Config
    mapping(address => mapping(address => Config)) public userConfigs;

    // Authorized Keepers
    mapping(address => bool) public isKeeper;

    event ConfigUpdated(
        address indexed user, address indexed pair, bool isEnabled, uint256 triggerLtv, uint256 targetLtv
    );
    event KeeperUpdated(address indexed keeper, bool status);
    event AutoProtectExecuted(address indexed user, address indexed pair, uint256 debtRepaid, address indexed keeper);

    modifier onlyKeeper() {
        require(isKeeper[msg.sender] || msg.sender == owner(), "AutoProtect: Caller is not an authorized keeper");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {
        isKeeper[initialOwner] = true;
    }

    function setKeeper(address keeper, bool status) external onlyOwner {
        isKeeper[keeper] = status;
        emit KeeperUpdated(keeper, status);
    }

    /**
     * @notice Users configure their automated risk safeguard parameters.
     */
    function setConfig(address pair, bool isEnabled, uint256 triggerLtvBps, uint256 targetLtvBps, uint256 maxDeleverage)
        external
    {
        require(pair != address(0), "AutoProtect: Invalid pair");
        require(targetLtvBps < triggerLtvBps, "AutoProtect: Target LTV must be lower than trigger LTV");
        require(triggerLtvBps <= 10_000, "AutoProtect: Invalid trigger");
        if (isEnabled) require(maxDeleverage > 0, "AutoProtect: Zero repayment limit");

        userConfigs[msg.sender][pair] = Config({
            isEnabled: isEnabled, triggerLtvBps: triggerLtvBps, targetLtvBps: targetLtvBps, maxDeleverage: maxDeleverage
        });

        emit ConfigUpdated(msg.sender, pair, isEnabled, triggerLtvBps, targetLtvBps);
    }

    /**
     * @notice Keeper executes deleverage when user's position LTV breaches triggerLtv.
     */
    function executeAutoProtect(address pairAddress, address borrower, uint256 repayAmount)
        external
        onlyKeeper
        nonReentrant
    {
        require(!isPaused, "AutoProtect: Paused");
        Config memory cfg = userConfigs[borrower][pairAddress];
        require(cfg.isEnabled, "AutoProtect: Safeguard not enabled for user");

        LeveraPair pair = LeveraPair(pairAddress);
        (, uint256 debtAmount, uint256 collateralValueUsd,) = pair.getPosition(borrower);

        require(collateralValueUsd > 0 && debtAmount > 0, "AutoProtect: No active leveraged position");

        uint256 currentLtvBps = Math.mulDiv(pair.debtValueUsd(debtAmount), 10_000, collateralValueUsd);
        require(currentLtvBps >= cfg.triggerLtvBps, "AutoProtect: Current LTV below trigger threshold");

        uint256 amountToRepay = repayAmount > cfg.maxDeleverage ? cfg.maxDeleverage : repayAmount;
        if (amountToRepay > debtAmount) {
            amountToRepay = debtAmount;
        }

        uint256 targetDebtValue = Math.mulDiv(collateralValueUsd, cfg.targetLtvBps, 10_000);
        uint256 targetDebtAmount =
            Math.mulDiv(targetDebtValue, pair.debtUnit(), pair.oracle().getPrice(address(pair.debtToken())));
        uint256 needed = debtAmount > targetDebtAmount ? debtAmount - targetDebtAmount : 0;
        if (amountToRepay > needed) amountToRepay = needed;
        require(amountToRepay > 0, "AutoProtect: No repayment required");

        // Keeper-funded repayment; swap-based deleveraging is a separate, not-yet-enabled flow.
        IERC20(pair.debtToken()).safeTransferFrom(msg.sender, address(this), amountToRepay);
        IERC20(pair.debtToken()).forceApprove(pairAddress, amountToRepay);
        pair.repayFor(borrower, amountToRepay);

        emit AutoProtectExecuted(borrower, pairAddress, amountToRepay, msg.sender);
    }
}
