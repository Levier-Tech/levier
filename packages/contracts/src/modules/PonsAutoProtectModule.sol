// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../trading/IPositionManager.sol";
import "../pons/IPonsRiskEngine.sol";

/**
 * @title PonsAutoProtectModule
 * @notice Keeper-funded collateral injection for synthetic Pons positions.
 */
contract PonsAutoProtectModule is Ownable {
    using SafeERC20 for IERC20;

    bool public isPaused = true;
    event PauseUpdated(bool paused);

    IPositionManager public immutable positionManager;
    IPonsRiskEngine public immutable riskEngine;
    IERC20 public immutable baseCollateral;

    struct Config {
        bool isEnabled;
        uint256 triggerHealthFactor; // e.g. 11000 for 1.10x
        uint256 targetHealthFactor;  // e.g. 15000 for 1.50x
        uint256 maxCollateralInjection; 
    }

    // account => asset => isLong => Config
    mapping(address => mapping(address => mapping(bool => Config))) public userConfigs;

    // Authorized Keepers
    mapping(address => bool) public isKeeper;

    event ConfigUpdated(
        address indexed account, address indexed asset, bool isLong, bool isEnabled, uint256 triggerHF, uint256 targetHF
    );
    event KeeperUpdated(address indexed keeper, bool status);
    event AutoProtectExecuted(address indexed account, address indexed asset, bool isLong, uint256 injectedAmount, address indexed keeper);

    modifier onlyKeeper() {
        require(isKeeper[msg.sender] || msg.sender == owner(), "AutoProtect: Caller is not an authorized keeper");
        _;
    }

    constructor(address _positionManager, address _riskEngine, address _baseCollateral, address _initialOwner) Ownable(_initialOwner) {
        require(_positionManager != address(0), "AutoProtect: Zero PM");
        require(_riskEngine != address(0), "AutoProtect: Zero RiskEngine");
        require(_baseCollateral != address(0), "AutoProtect: Zero collateral");

        positionManager = IPositionManager(_positionManager);
        riskEngine = IPonsRiskEngine(_riskEngine);
        baseCollateral = IERC20(_baseCollateral);
        isKeeper[_initialOwner] = true;
    }

    function setPaused(bool paused) external onlyOwner {
        isPaused = paused;
        emit PauseUpdated(paused);
    }

    function setKeeper(address keeper, bool status) external onlyOwner {
        isKeeper[keeper] = status;
        emit KeeperUpdated(keeper, status);
    }

    /**
     * @notice Users configure their automated risk safeguard parameters.
     */
    function setConfig(
        address asset,
        bool isLong,
        bool isEnabled,
        uint256 triggerHealthFactor,
        uint256 targetHealthFactor,
        uint256 maxCollateralInjection
    ) external {
        require(asset != address(0), "AutoProtect: Invalid asset");
        require(targetHealthFactor > triggerHealthFactor, "AutoProtect: Target HF must be higher than trigger HF");
        require(triggerHealthFactor >= 10000, "AutoProtect: Trigger HF must be >= liquidation (10000)");

        if (isEnabled) require(maxCollateralInjection > 0, "AutoProtect: Zero injection limit");

        userConfigs[msg.sender][asset][isLong] = Config({
            isEnabled: isEnabled,
            triggerHealthFactor: triggerHealthFactor,
            targetHealthFactor: targetHealthFactor,
            maxCollateralInjection: maxCollateralInjection
        });

        emit ConfigUpdated(msg.sender, asset, isLong, isEnabled, triggerHealthFactor, targetHealthFactor);
    }

    /**
     * @notice Keeper injects collateral when user's position HF drops below trigger.
     */
    function executeAutoProtect(
        address account,
        address asset,
        bool isLong,
        uint256 injectAmount
    ) external onlyKeeper {
        require(!isPaused, "AutoProtect: Paused");
        
        Config memory cfg = userConfigs[account][asset][isLong];
        require(cfg.isEnabled, "AutoProtect: Safeguard not enabled for user");

        IPositionManager.Position memory pos = positionManager.getPosition(account, asset, isLong);
        require(pos.sizeAsset > 0, "AutoProtect: No active position");

        uint256 currentHF = riskEngine.getHealthFactor(
            asset,
            isLong,
            pos.sizeAsset,
            pos.collateralAmount,
            pos.entryPrice
        );
        require(currentHF <= cfg.triggerHealthFactor, "AutoProtect: Position is healthy enough");

        uint256 amountToInject = injectAmount > cfg.maxCollateralInjection ? cfg.maxCollateralInjection : injectAmount;
        require(amountToInject > 0, "AutoProtect: Zero injection");

        // The keeper must fund this injection. Transfer from keeper to this contract.
        baseCollateral.safeTransferFrom(msg.sender, address(this), amountToInject);
        
        // Approve PM to spend it
        baseCollateral.forceApprove(address(positionManager), amountToInject);
        
        // Inject collateral on behalf of user
        positionManager.addCollateralFor(account, asset, isLong, amountToInject);

        // Optional: Check if we exceeded target by too much to prevent keeper from draining themselves unnecessarily.
        // We leave optimization of exact amounts to the off-chain keeper logic.

        emit AutoProtectExecuted(account, asset, isLong, amountToInject, msg.sender);
    }
}
