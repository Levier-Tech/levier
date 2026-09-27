// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./PonsMarketAdapter.sol";

/**
 * @title PonsLeverageRegistry
 * @notice Registers Pons-graduated assets that are approved for leverage
 *         trading and stores per-asset risk configuration.
 * @dev    Works alongside PonsMarketAdapter. Only assets that pass the
 *         adapter's eligibility check AND are registered here with an
 *         enabled risk config can be used for leverage in later phases.
 */
contract PonsLeverageRegistry is Ownable {

    // ─── Types ──────────────────────────────────────────────────────────

    struct PonsRiskConfig {
        uint256 maxLeverage;             // basis points, 10000 = 1×, 50000 = 5×
        uint256 maintenanceMarginBps;    // e.g. 500 = 5%
        uint256 liquidationThresholdBps; // e.g. 200 = 2%
        uint256 maxPositionSize;         // maximum position in USD (18 decimals)
        bool enabled;
    }

    // ─── State ──────────────────────────────────────────────────────────

    PonsMarketAdapter public immutable adapter;

    mapping(address => PonsRiskConfig) public riskConfigs;
    address[] public registeredAssets;
    mapping(address => bool) internal _isRegistered;

    // ─── Events ─────────────────────────────────────────────────────────

    event AssetRegistered(address indexed asset, uint256 maxLeverage, bool enabled);
    event RiskConfigUpdated(address indexed asset, uint256 maxLeverage, uint256 maintenanceMarginBps, uint256 liquidationThresholdBps, uint256 maxPositionSize, bool enabled);
    event AssetRemoved(address indexed asset);

    // ─── Constructor ────────────────────────────────────────────────────

    constructor(address _adapter, address _initialOwner) Ownable(_initialOwner) {
        require(_adapter != address(0), "Registry: Zero adapter address");
        adapter = PonsMarketAdapter(_adapter);
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    /**
     * @notice Register a new Pons asset with its leverage risk parameters.
     */
    function registerAsset(address asset, PonsRiskConfig calldata config) external onlyOwner {
        require(asset != address(0), "Registry: Zero address");
        require(config.maxLeverage >= 10_000, "Registry: Leverage must be >= 1x");
        require(config.maintenanceMarginBps > 0 && config.maintenanceMarginBps <= 5000, "Registry: Invalid maintenance margin");
        require(config.liquidationThresholdBps > 0 && config.liquidationThresholdBps < config.maintenanceMarginBps, "Registry: Liq. threshold must be < maintenance margin");

        riskConfigs[asset] = config;

        if (!_isRegistered[asset]) {
            registeredAssets.push(asset);
            _isRegistered[asset] = true;
        }

        emit AssetRegistered(asset, config.maxLeverage, config.enabled);
    }

    /**
     * @notice Update risk configuration for an already-registered asset.
     */
    function updateRiskConfig(address asset, PonsRiskConfig calldata config) external onlyOwner {
        require(_isRegistered[asset], "Registry: Asset not registered");
        require(config.maxLeverage >= 10_000, "Registry: Leverage must be >= 1x");
        require(config.maintenanceMarginBps > 0 && config.maintenanceMarginBps <= 5000, "Registry: Invalid maintenance margin");
        require(config.liquidationThresholdBps > 0 && config.liquidationThresholdBps < config.maintenanceMarginBps, "Registry: Liq. threshold must be < maintenance margin");

        riskConfigs[asset] = config;

        emit RiskConfigUpdated(
            asset,
            config.maxLeverage,
            config.maintenanceMarginBps,
            config.liquidationThresholdBps,
            config.maxPositionSize,
            config.enabled
        );
    }

    /**
     * @notice Remove an asset from the registry (disable leverage, keep in array for history).
     */
    function removeAsset(address asset) external onlyOwner {
        require(_isRegistered[asset], "Registry: Asset not registered");
        riskConfigs[asset].enabled = false;
        emit AssetRemoved(asset);
    }

    // ─── View ───────────────────────────────────────────────────────────

    /**
     * @notice Returns true only when the asset is adapter-eligible AND has an
     *         enabled risk config in this registry.
     */
    function isLeverageEnabled(address asset) external view returns (bool) {
        if (!_isRegistered[asset]) return false;
        if (!riskConfigs[asset].enabled) return false;
        return adapter.isEligible(asset);
    }

    /**
     * @notice Return all registered assets whose leverage is currently enabled
     *         AND that pass adapter eligibility.
     */
    function getEligibleAssets() external view returns (address[] memory) {
        uint256 total = registeredAssets.length;
        address[] memory temp = new address[](total);
        uint256 count = 0;

        for (uint256 i = 0; i < total; i++) {
            address a = registeredAssets[i];
            if (riskConfigs[a].enabled && adapter.isEligible(a)) {
                temp[count] = a;
                count++;
            }
        }

        address[] memory result = new address[](count);
        for (uint256 j = 0; j < count; j++) {
            result[j] = temp[j];
        }
        return result;
    }

    function getRegisteredAssetCount() external view returns (uint256) {
        return registeredAssets.length;
    }

    function getRiskConfig(address asset) external view returns (PonsRiskConfig memory) {
        require(_isRegistered[asset], "Registry: Asset not registered");
        return riskConfigs[asset];
    }
}
