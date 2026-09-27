// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/pons/PonsMarketAdapter.sol";

/// @dev Minimal mock bonding curve that returns graduation status.
contract MockBondingCurve {
    mapping(address => bool) public graduated;

    function setGraduated(address asset, bool status) external {
        graduated[asset] = status;
    }
}

contract PonsMarketAdapterTest is Test {
    PonsMarketAdapter adapter;
    MockBondingCurve bondingCurve;
    address owner = address(this);
    address updater = address(0xBEEF);
    address asset1 = address(0x1001);
    address asset2 = address(0x1002);
    address asset3 = address(0x1003);

    uint256 constant MIN_LIQUIDITY = 50_000e18;
    uint256 constant MIN_VOLUME = 10_000e18;
    uint256 constant MIN_MARKET_CAP = 100_000e18;

    function setUp() public {
        bondingCurve = new MockBondingCurve();
        adapter = new PonsMarketAdapter(
            address(bondingCurve),
            MIN_LIQUIDITY,
            MIN_VOLUME,
            MIN_MARKET_CAP,
            owner
        );
        adapter.setUpdater(updater, true);
    }

    // ── Graduation ──────────────────────────────────────────────────────

    function test_isGraduated_fromBondingCurve() public {
        bondingCurve.setGraduated(asset1, true);
        assertTrue(adapter.isGraduated(asset1));
        assertFalse(adapter.isGraduated(asset2));
    }

    function test_isGraduated_manualOverride() public {
        assertFalse(adapter.isGraduated(asset1));
        adapter.setManualGraduated(asset1, true);
        assertTrue(adapter.isGraduated(asset1));
    }

    function test_isGraduated_manualTakesPriorityOverBondingCurve() public {
        // Even without bonding curve returning true, manual should work.
        adapter.setManualGraduated(asset1, true);
        assertTrue(adapter.isGraduated(asset1));
    }

    function test_isGraduated_noBondingCurve() public {
        PonsMarketAdapter noBc = new PonsMarketAdapter(
            address(0), MIN_LIQUIDITY, MIN_VOLUME, MIN_MARKET_CAP, owner
        );
        assertFalse(noBc.isGraduated(asset1));
        noBc.setManualGraduated(asset1, true);
        assertTrue(noBc.isGraduated(asset1));
    }

    // ── Eligibility ─────────────────────────────────────────────────────

    function test_isEligible_meetsAllThresholds() public {
        bondingCurve.setGraduated(asset1, true);
        vm.prank(updater);
        adapter.updateMetadata(asset1, MIN_LIQUIDITY, MIN_MARKET_CAP, MIN_VOLUME);
        assertTrue(adapter.isEligible(asset1));
    }

    function test_isEligible_belowLiquidity() public {
        bondingCurve.setGraduated(asset1, true);
        vm.prank(updater);
        adapter.updateMetadata(asset1, MIN_LIQUIDITY - 1, MIN_MARKET_CAP, MIN_VOLUME);
        assertFalse(adapter.isEligible(asset1));
    }

    function test_isEligible_belowVolume() public {
        bondingCurve.setGraduated(asset1, true);
        vm.prank(updater);
        adapter.updateMetadata(asset1, MIN_LIQUIDITY, MIN_MARKET_CAP, MIN_VOLUME - 1);
        assertFalse(adapter.isEligible(asset1));
    }

    function test_isEligible_belowMarketCap() public {
        bondingCurve.setGraduated(asset1, true);
        vm.prank(updater);
        adapter.updateMetadata(asset1, MIN_LIQUIDITY, MIN_MARKET_CAP - 1, MIN_VOLUME);
        assertFalse(adapter.isEligible(asset1));
    }

    function test_isEligible_notGraduated() public {
        vm.prank(updater);
        adapter.updateMetadata(asset1, MIN_LIQUIDITY, MIN_MARKET_CAP, MIN_VOLUME);
        assertFalse(adapter.isEligible(asset1));
    }

    function test_isEligible_manualBlock() public {
        bondingCurve.setGraduated(asset1, true);
        vm.prank(updater);
        adapter.updateMetadata(asset1, MIN_LIQUIDITY, MIN_MARKET_CAP, MIN_VOLUME);
        assertTrue(adapter.isEligible(asset1));

        adapter.setManualBlock(asset1, true);
        assertFalse(adapter.isEligible(asset1));
    }

    function test_isEligible_manualEligibleBypassesThresholds() public {
        bondingCurve.setGraduated(asset1, true);
        // Metadata below thresholds
        vm.prank(updater);
        adapter.updateMetadata(asset1, 0, 0, 0);
        assertFalse(adapter.isEligible(asset1));

        adapter.setManualEligible(asset1, true);
        assertTrue(adapter.isEligible(asset1));
    }

    function test_isEligible_manualBlockOverridesManualEligible() public {
        bondingCurve.setGraduated(asset1, true);
        adapter.setManualEligible(asset1, true);
        assertTrue(adapter.isEligible(asset1));

        adapter.setManualBlock(asset1, true);
        assertFalse(adapter.isEligible(asset1));
    }

    // ── Metadata ────────────────────────────────────────────────────────

    function test_updateMetadata_storesCorrectly() public {
        vm.prank(updater);
        adapter.updateMetadata(asset1, 100e18, 200e18, 50e18);

        (uint256 liq, uint256 mcap, uint256 vol, bool grad) = adapter.getMarketMetadata(asset1);
        assertEq(liq, 100e18);
        assertEq(mcap, 200e18);
        assertEq(vol, 50e18);
        assertFalse(grad);
    }

    function test_updateMetadata_onlyUpdaterOrOwner() public {
        address rando = address(0xDEAD);
        vm.prank(rando);
        vm.expectRevert("Adapter: Not an updater");
        adapter.updateMetadata(asset1, 100e18, 200e18, 50e18);
    }

    function test_updateMetadata_ownerCanUpdate() public {
        adapter.updateMetadata(asset1, 100e18, 200e18, 50e18);
        (uint256 liq,,,) = adapter.getMarketMetadata(asset1);
        assertEq(liq, 100e18);
    }

    function test_updateMetadata_zeroAddressRejected() public {
        vm.prank(updater);
        vm.expectRevert("Adapter: Zero address");
        adapter.updateMetadata(address(0), 100e18, 200e18, 50e18);
    }

    // ── Batch Update ────────────────────────────────────────────────────

    function test_batchUpdateMetadata() public {
        address[] memory assets = new address[](2);
        assets[0] = asset1;
        assets[1] = asset2;

        uint256[] memory liqs = new uint256[](2);
        liqs[0] = 100e18;
        liqs[1] = 200e18;

        uint256[] memory mcaps = new uint256[](2);
        mcaps[0] = 300e18;
        mcaps[1] = 400e18;

        uint256[] memory vols = new uint256[](2);
        vols[0] = 50e18;
        vols[1] = 60e18;

        vm.prank(updater);
        adapter.batchUpdateMetadata(assets, liqs, mcaps, vols);

        (uint256 l1,,,) = adapter.getMarketMetadata(asset1);
        (uint256 l2,,,) = adapter.getMarketMetadata(asset2);
        assertEq(l1, 100e18);
        assertEq(l2, 200e18);
    }

    function test_batchUpdateMetadata_mismatchedArrays() public {
        address[] memory assets = new address[](2);
        assets[0] = asset1;
        assets[1] = asset2;

        uint256[] memory short = new uint256[](1);
        short[0] = 100e18;

        uint256[] memory liqs = new uint256[](2);
        liqs[0] = 100e18;
        liqs[1] = 200e18;

        vm.prank(updater);
        vm.expectRevert("Adapter: Array length mismatch");
        adapter.batchUpdateMetadata(assets, short, liqs, liqs);
    }

    // ── Enumeration ─────────────────────────────────────────────────────

    function test_getEligibleAssets() public {
        bondingCurve.setGraduated(asset1, true);
        bondingCurve.setGraduated(asset2, true);
        bondingCurve.setGraduated(asset3, true);

        address[] memory assets = new address[](3);
        assets[0] = asset1;
        assets[1] = asset2;
        assets[2] = asset3;

        uint256[] memory liq = new uint256[](3);
        liq[0] = MIN_LIQUIDITY;
        liq[1] = MIN_LIQUIDITY;
        liq[2] = MIN_LIQUIDITY - 1; // below threshold

        uint256[] memory mcap = new uint256[](3);
        mcap[0] = MIN_MARKET_CAP;
        mcap[1] = MIN_MARKET_CAP;
        mcap[2] = MIN_MARKET_CAP;

        uint256[] memory vol = new uint256[](3);
        vol[0] = MIN_VOLUME;
        vol[1] = MIN_VOLUME;
        vol[2] = MIN_VOLUME;

        vm.prank(updater);
        adapter.batchUpdateMetadata(assets, liq, mcap, vol);

        address[] memory eligible = adapter.getEligibleAssets();
        assertEq(eligible.length, 2);
    }

    function test_getGraduatedAssets() public {
        bondingCurve.setGraduated(asset1, true);
        adapter.setManualGraduated(asset2, true);

        vm.prank(updater);
        adapter.updateMetadata(asset1, 0, 0, 0);

        address[] memory grads = adapter.getGraduatedAssets();
        assertEq(grads.length, 2);
    }

    function test_getKnownAssetCount() public {
        assertEq(adapter.getKnownAssetCount(), 0);
        vm.prank(updater);
        adapter.updateMetadata(asset1, 0, 0, 0);
        assertEq(adapter.getKnownAssetCount(), 1);
    }

    // ── Admin ───────────────────────────────────────────────────────────

    function test_setThresholds() public {
        adapter.setThresholds(1e18, 2e18, 3e18);
        assertEq(adapter.minLiquidity(), 1e18);
        assertEq(adapter.minVolume(), 2e18);
        assertEq(adapter.minMarketCap(), 3e18);
    }

    function test_setUpdater() public {
        address newUpdater = address(0xCAFE);
        adapter.setUpdater(newUpdater, true);
        assertTrue(adapter.isUpdater(newUpdater));

        adapter.setUpdater(newUpdater, false);
        assertFalse(adapter.isUpdater(newUpdater));
    }

    function test_setPonsBondingCurve() public {
        address newBc = address(0xFACE);
        adapter.setPonsBondingCurve(newBc);
        assertEq(adapter.ponsBondingCurve(), newBc);
    }

    function test_setManualGraduated_zeroAddressRejected() public {
        vm.expectRevert("Adapter: Zero address");
        adapter.setManualGraduated(address(0), true);
    }
}
