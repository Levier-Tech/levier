// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/pons/PonsMarketAdapter.sol";
import "../src/pons/PonsLeverageRegistry.sol";

contract MockBondingCurveForRegistry {
    mapping(address => bool) public graduated;
    function setGraduated(address asset, bool status) external {
        graduated[asset] = status;
    }
}

contract PonsLeverageRegistryTest is Test {
    PonsMarketAdapter adapter;
    PonsLeverageRegistry registry;
    MockBondingCurveForRegistry bondingCurve;
    address owner = address(this);
    address updater = address(0xBEEF);
    address asset1 = address(0x1001);
    address asset2 = address(0x1002);

    uint256 constant MIN_LIQUIDITY = 50_000e18;
    uint256 constant MIN_VOLUME = 10_000e18;
    uint256 constant MIN_MARKET_CAP = 100_000e18;

    function setUp() public {
        bondingCurve = new MockBondingCurveForRegistry();
        adapter = new PonsMarketAdapter(
            address(bondingCurve), MIN_LIQUIDITY, MIN_VOLUME, MIN_MARKET_CAP, owner
        );
        adapter.setUpdater(updater, true);
        registry = new PonsLeverageRegistry(address(adapter), owner);
    }

    function _makeEligible(address asset) internal {
        bondingCurve.setGraduated(asset, true);
        vm.prank(updater);
        adapter.updateMetadata(asset, MIN_LIQUIDITY, MIN_MARKET_CAP, MIN_VOLUME);
    }

    function _defaultConfig() internal pure returns (PonsLeverageRegistry.PonsRiskConfig memory) {
        return PonsLeverageRegistry.PonsRiskConfig({
            maxLeverage: 30_000,         // 3x
            maintenanceMarginBps: 500,   // 5%
            liquidationThresholdBps: 200,// 2%
            maxPositionSize: 1_000_000e18,
            enabled: true
        });
    }

    // ── Registration ────────────────────────────────────────────────────

    function test_registerAsset() public {
        registry.registerAsset(asset1, _defaultConfig());
        assertEq(registry.getRegisteredAssetCount(), 1);
    }

    function test_registerAsset_zeroAddress() public {
        vm.expectRevert("Registry: Zero address");
        registry.registerAsset(address(0), _defaultConfig());
    }

    function test_registerAsset_invalidLeverage() public {
        PonsLeverageRegistry.PonsRiskConfig memory cfg = _defaultConfig();
        cfg.maxLeverage = 9_999; // below 1x
        vm.expectRevert("Registry: Leverage must be >= 1x");
        registry.registerAsset(asset1, cfg);
    }

    function test_registerAsset_invalidMaintenanceMargin() public {
        PonsLeverageRegistry.PonsRiskConfig memory cfg = _defaultConfig();
        cfg.maintenanceMarginBps = 0;
        vm.expectRevert("Registry: Invalid maintenance margin");
        registry.registerAsset(asset1, cfg);
    }

    function test_registerAsset_liqThresholdMustBeLessThanMaintenance() public {
        PonsLeverageRegistry.PonsRiskConfig memory cfg = _defaultConfig();
        cfg.liquidationThresholdBps = 500; // same as maintenance
        vm.expectRevert("Registry: Liq. threshold must be < maintenance margin");
        registry.registerAsset(asset1, cfg);
    }

    // ── isLeverageEnabled ───────────────────────────────────────────────

    function test_isLeverageEnabled_eligibleAndRegistered() public {
        _makeEligible(asset1);
        registry.registerAsset(asset1, _defaultConfig());
        assertTrue(registry.isLeverageEnabled(asset1));
    }

    function test_isLeverageEnabled_registeredButNotEligible() public {
        // Not graduated, so not eligible through adapter.
        registry.registerAsset(asset1, _defaultConfig());
        assertFalse(registry.isLeverageEnabled(asset1));
    }

    function test_isLeverageEnabled_eligibleButNotRegistered() public {
        _makeEligible(asset1);
        assertFalse(registry.isLeverageEnabled(asset1));
    }

    function test_isLeverageEnabled_disabled() public {
        _makeEligible(asset1);
        PonsLeverageRegistry.PonsRiskConfig memory cfg = _defaultConfig();
        cfg.enabled = false;
        registry.registerAsset(asset1, cfg);
        assertFalse(registry.isLeverageEnabled(asset1));
    }

    // ── Update / Remove ─────────────────────────────────────────────────

    function test_updateRiskConfig() public {
        registry.registerAsset(asset1, _defaultConfig());

        PonsLeverageRegistry.PonsRiskConfig memory newCfg = _defaultConfig();
        newCfg.maxLeverage = 50_000; // 5x
        registry.updateRiskConfig(asset1, newCfg);

        PonsLeverageRegistry.PonsRiskConfig memory stored = registry.getRiskConfig(asset1);
        assertEq(stored.maxLeverage, 50_000);
    }

    function test_updateRiskConfig_notRegistered() public {
        vm.expectRevert("Registry: Asset not registered");
        registry.updateRiskConfig(asset1, _defaultConfig());
    }

    function test_removeAsset() public {
        _makeEligible(asset1);
        registry.registerAsset(asset1, _defaultConfig());
        assertTrue(registry.isLeverageEnabled(asset1));

        registry.removeAsset(asset1);
        assertFalse(registry.isLeverageEnabled(asset1));
    }

    function test_removeAsset_notRegistered() public {
        vm.expectRevert("Registry: Asset not registered");
        registry.removeAsset(asset1);
    }

    // ── Enumeration ─────────────────────────────────────────────────────

    function test_getEligibleAssets() public {
        _makeEligible(asset1);
        _makeEligible(asset2);

        registry.registerAsset(asset1, _defaultConfig());
        PonsLeverageRegistry.PonsRiskConfig memory disabledCfg = _defaultConfig();
        disabledCfg.enabled = false;
        registry.registerAsset(asset2, disabledCfg);

        address[] memory eligible = registry.getEligibleAssets();
        assertEq(eligible.length, 1);
        assertEq(eligible[0], asset1);
    }

    function test_getRiskConfig_notRegistered() public {
        vm.expectRevert("Registry: Asset not registered");
        registry.getRiskConfig(asset1);
    }
}
