// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestnetERC20} from "../src/tokens/TestnetERC20.sol";
import {IPonsFactory} from "../src/ponsperp/IPonsFactory.sol";
import {PonsV4TwapOracle} from "../src/ponsperp/PonsV4TwapOracle.sol";
import {PonsLiquidityVault} from "../src/ponsperp/PonsLiquidityVault.sol";
import {PonsPerpManager} from "../src/ponsperp/PonsPerpManager.sol";

contract MockPoolManager {
    mapping(bytes32 => bytes32) public slots;

    function setSlot(bytes32 slot, bytes32 value) external {
        slots[slot] = value;
    }

    function extsload(bytes32 slot) external view returns (bytes32) {
        return slots[slot];
    }
}

contract MockPonsFactory {
    mapping(address => IPonsFactory.LaunchedToken) internal launches;

    function setLaunch(address token, uint8 phase) external {
        IPonsFactory.LaunchedToken storage l = launches[token];
        l.token = token;
        l.tickSpacing = 200;
        l.phase = phase;
        l.exists = true;
    }

    function getLaunchedToken(address token) external view returns (IPonsFactory.LaunchedToken memory) {
        return launches[token];
    }
}

contract MockUsdOracle {
    uint256 public price = 3_000e18;

    function getPrice(address) external view returns (uint256) {
        return price;
    }
}

contract MockHook {}

contract PonsV2 is PonsPerpManager {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract PonsPerpTest is Test {
    address owner = address(0xA11CE);
    address trader = address(0xB0B);
    address lp = address(0x1D);
    address keeper = address(0xCAFE);
    address weth = address(0xE7);

    TestnetERC20 usdg;
    TestnetERC20 levier;
    MockPoolManager pm;
    MockPonsFactory factory;
    MockUsdOracle ethUsd;
    address hook;
    PonsV4TwapOracle oracle;
    PonsLiquidityVault vault;
    PonsPerpManager manager;

    uint160 constant SQRT0 = uint160(1_000 << 96); // 1e6 tokens per ETH => $0.003 at $3000 ETH

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new TestnetERC20("Global Dollar", "USDG", 6, 0, address(this));
        levier = new TestnetERC20("Levier Markets", "LEVIER", 18, 0, address(this));
        pm = new MockPoolManager();
        factory = new MockPonsFactory();
        ethUsd = new MockUsdOracle();
        hook = address(new MockHook());
        factory.setLaunch(address(levier), 2);

        oracle = PonsV4TwapOracle(
            address(
                new ERC1967Proxy(
                    address(new PonsV4TwapOracle()),
                    abi.encodeCall(
                        PonsV4TwapOracle.initialize, (owner, address(pm), address(factory), hook, address(ethUsd), weth)
                    )
                )
            )
        );
        vault = PonsLiquidityVault(
            address(
                new ERC1967Proxy(
                    address(new PonsLiquidityVault()),
                    abi.encodeCall(PonsLiquidityVault.initialize, (IERC20(address(usdg)), "Levier Pons LP", "lpPONS", owner))
                )
            )
        );
        manager = PonsPerpManager(
            address(
                new ERC1967Proxy(
                    address(new PonsPerpManager()),
                    abi.encodeCall(
                        PonsPerpManager.initialize, (owner, address(usdg), address(oracle), address(vault), address(factory))
                    )
                )
            )
        );

        vm.startPrank(owner);
        oracle.listAsset(address(levier));
        vault.setManager(address(manager));
        vault.setDepositsPaused(false);
        manager.setMarket(address(levier), 20_000, 1_000, 20e6, 100e6);
        manager.setOpeningPaused(false);
        vm.stopPrank();

        setSqrt(SQRT0);
        warmTwap();

        usdg.mint(lp, 1_000e6);
        usdg.mint(trader, 1_000e6);
        vm.startPrank(lp);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(100e6, lp);
        vm.stopPrank();
        vm.prank(trader);
        usdg.approve(address(manager), type(uint256).max);
    }

    // ─── helpers ────────────────────────────────────────────────────────

    function poolId() internal view returns (bytes32) {
        return keccak256(abi.encode(address(0), address(levier), uint24(0), int24(200), hook));
    }

    function setSqrt(uint160 sqrtPriceX96) internal {
        pm.setSlot(keccak256(abi.encodePacked(poolId(), bytes32(uint256(6)))), bytes32(uint256(sqrtPriceX96)));
    }

    /// @dev Price multiplier m (bps) => sqrt divides by sqrt(m).
    function setPriceBps(uint256 bps) internal {
        setSqrt(uint160(uint256(SQRT0) * 1e6 / _sqrt(bps * 1e8)));
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function warmTwap() internal {
        for (uint256 i; i < 9; ++i) {
            oracle.poke(address(levier));
            vm.warp(vm.getBlockTimestamp() + 4 minutes);
        }
    }

    /// @dev Moves the pool and keeps poking until the TWAP converges, like a live market would.
    function moveAndSettle(uint256 bps) internal {
        uint256 steps = 12;
        for (uint256 i = 1; i <= steps; ++i) {
            setPriceBps(uint256(int256(10_000) + (int256(bps) - 10_000) * int256(i) / int256(steps)));
            oracle.poke(address(levier));
            vm.warp(vm.getBlockTimestamp() + 4 minutes);
        }
        for (uint256 i; i < 10; ++i) {
            oracle.poke(address(levier));
            vm.warp(vm.getBlockTimestamp() + 4 minutes);
        }
    }

    function open(bool isLong, uint256 collateral) internal returns (uint256 id) {
        vm.prank(trader);
        id = manager.openPosition(address(levier), isLong, collateral, 20_000);
    }

    // ─── oracle ─────────────────────────────────────────────────────────

    function testSpotPriceInUsd() public view {
        (uint256 spot, uint256 twap) = oracle.peek(address(levier));
        assertApproxEqRel(spot, 0.003e18, 1e12);
        assertApproxEqRel(twap, 0.003e18, 1e12);
    }

    function testTwapNotReadyUntilWindowCovered() public {
        PonsV4TwapOracle fresh = PonsV4TwapOracle(
            address(
                new ERC1967Proxy(
                    address(new PonsV4TwapOracle()),
                    abi.encodeCall(
                        PonsV4TwapOracle.initialize, (owner, address(pm), address(factory), hook, address(ethUsd), weth)
                    )
                )
            )
        );
        vm.prank(owner);
        fresh.listAsset(address(levier));
        fresh.poke(address(levier));
        vm.expectRevert(PonsV4TwapOracle.TwapNotReady.selector);
        fresh.update(address(levier));
    }

    function testUnknownPoolReverts() public {
        TestnetERC20 other = new TestnetERC20("X", "X", 18, 0, address(this));
        factory.setLaunch(address(other), 0);
        vm.prank(owner);
        oracle.listAsset(address(other));
        vm.expectRevert(PonsV4TwapOracle.PoolNotInitialized.selector);
        oracle.peek(address(other));
    }

    function testSpotSpikeIsRejectedAndClamped() public {
        setPriceBps(30_000); // 3x in one block
        vm.expectRevert();
        oracle.update(address(levier));
        // A poke records the spike, but only moves the stored price by maxMoveBps (10%).
        uint256 lastPriceBefore = _lastPrice();
        vm.warp(vm.getBlockTimestamp() + 1);
        oracle.poke(address(levier));
        assertEq(_lastPrice(), lastPriceBefore * 11_000 / 10_000);
    }

    function _lastPrice() internal view returns (uint256 p) {
        (, p,,,,) = oracle.assets(address(levier));
    }

    function testOnlyOwnerListsAndUpgrades() public {
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, trader));
        vm.prank(trader);
        oracle.listAsset(address(usdg));
        PonsV2 next = new PonsV2();
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, trader));
        vm.prank(trader);
        manager.upgradeToAndCall(address(next), "");
        vm.prank(owner);
        manager.upgradeToAndCall(address(next), "");
        assertEq(PonsV2(address(manager)).version(), 2);
        assertEq(manager.owner(), owner);
        assertEq(address(uint160(uint256(vm.load(address(manager), ERC1967Utils.IMPLEMENTATION_SLOT)))), address(next));
    }

    function testImplementationsCannotBeInitialized() public {
        PonsPerpManager impl = new PonsPerpManager();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(owner, address(usdg), address(oracle), address(vault), address(factory));
        PonsLiquidityVault vImpl = new PonsLiquidityVault();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vImpl.initialize(IERC20(address(usdg)), "a", "b", owner);
    }

    // ─── manager ────────────────────────────────────────────────────────

    function testStartsPaused() public {
        PonsPerpManager fresh = PonsPerpManager(
            address(
                new ERC1967Proxy(
                    address(new PonsPerpManager()),
                    abi.encodeCall(
                        PonsPerpManager.initialize, (owner, address(usdg), address(oracle), address(vault), address(factory))
                    )
                )
            )
        );
        assertTrue(fresh.openingPaused());
        vm.expectRevert(PonsPerpManager.OpeningPaused.selector);
        fresh.openPosition(address(levier), true, 1e6, 20_000);
    }

    function testOpenTakesFeeAndReserves() public {
        uint256 id = open(true, 10e6);
        (,,,, uint128 collateral, uint128 size, uint256 entry) = manager.positions(id);
        assertEq(collateral, 10e6 - 60_000); // 0.3% of 20e6 notional
        assertEq(size, (10e6 - 60_000) * 2);
        assertApproxEqRel(entry, 0.003e18, 1e12);
        assertEq(vault.reserved(), size);
        assertEq(usdg.balanceOf(address(vault)), 100e6 + 60_000);
        assertEq(manager.positionsOf(trader).length, 1);
    }

    function testNotGraduatedCannotOpen() public {
        factory.setLaunch(address(levier), 0);
        vm.expectRevert(PonsPerpManager.NotGraduated.selector);
        open(true, 1e6);
    }

    function testCapsEnforced() public {
        vm.prank(lp);
        vault.deposit(200e6, lp);
        vm.prank(trader);
        vm.expectRevert(PonsPerpManager.InvalidLeverage.selector);
        manager.openPosition(address(levier), true, 1e6, 20_001);

        vm.expectRevert(PonsPerpManager.PositionTooLarge.selector);
        open(true, 11e6); // ~22 notional > 20 cap

        for (uint256 i; i < 5; ++i) {
            open(i % 2 == 0, 10e6);
        }
        vm.expectRevert(PonsPerpManager.OpenInterestCap.selector);
        open(true, 1e6);
    }

    function testUtilizationCap() public {
        vm.prank(owner);
        manager.setMarket(address(levier), 20_000, 1_000, 20e6, 1_000e6);
        open(true, 10e6);
        open(true, 10e6);
        // reserved ~39.76 of ~100.12 assets; 50% cap => next ~19.88 would exceed 50.06
        vm.expectRevert(PonsPerpManager.UtilizationCap.selector);
        open(true, 10e6);
    }

    function testMinHoldTime() public {
        uint256 id = open(true, 10e6);
        vm.prank(trader);
        vm.expectRevert(PonsPerpManager.MinHoldTime.selector);
        manager.closePosition(id);
    }

    function testOnlyTraderCloses() public {
        uint256 id = open(true, 10e6);
        vm.warp(vm.getBlockTimestamp() + 6 minutes);
        vm.prank(keeper);
        vm.expectRevert(PonsPerpManager.NotTrader.selector);
        manager.closePosition(id);
    }

    function testLongProfitPaidByVault() public {
        uint256 id = open(true, 10e6);
        (,,,, uint128 collateral, uint128 size, uint256 entry) = manager.positions(id);
        moveAndSettle(11_000); // +10%
        uint256 before = usdg.balanceOf(trader);
        vm.prank(trader);
        manager.closePosition(id);
        uint256 received = usdg.balanceOf(trader) - before;
        assertGt(received, collateral);
        // ~ +20% on collateral at 2x, minus 0.3% close fee on notional.
        assertApproxEqRel(received, collateral + size / 10 - size * 30 / 10_000, 0.02e18);
        assertEq(vault.reserved(), 0);
        assertEq(manager.positionsOf(trader).length, 0);
        entry;
    }

    function testShortLossGoesToVault() public {
        uint256 id = open(false, 10e6);
        uint256 vaultBefore = usdg.balanceOf(address(vault));
        moveAndSettle(10_500); // +5% hurts a short
        vm.prank(trader);
        manager.closePosition(id);
        assertGt(usdg.balanceOf(address(vault)), vaultBefore);
        assertEq(usdg.balanceOf(address(manager)), 0);
    }

    function testProfitCappedAtSize() public {
        uint256 id = open(true, 10e6);
        (,,,, uint128 collateral, uint128 size,) = manager.positions(id);
        // Push the price up ~3x in clamped steps.
        for (uint256 i = 1; i <= 40; ++i) {
            setPriceBps(10_000 + 500 * i);
            oracle.poke(address(levier));
            vm.warp(vm.getBlockTimestamp() + 4 minutes);
        }
        for (uint256 i; i < 10; ++i) {
            oracle.poke(address(levier));
            vm.warp(vm.getBlockTimestamp() + 4 minutes);
        }
        uint256 before = usdg.balanceOf(trader);
        vm.prank(trader);
        manager.closePosition(id);
        assertEq(usdg.balanceOf(trader) - before, collateral + size - size * 30 / 10_000);
    }

    function testLiquidation() public {
        uint256 id = open(true, 10e6);
        vm.prank(keeper);
        vm.expectRevert(PonsPerpManager.NotLiquidatable.selector);
        manager.liquidatePosition(id);

        moveAndSettle(5_800); // -42% => equity ~16% of collateral, below 10% maintenance of 2x size (20%)
        uint256 vaultBefore = usdg.balanceOf(address(vault));
        vm.prank(keeper);
        manager.liquidatePosition(id);
        assertGt(usdg.balanceOf(keeper), 0);
        assertGt(usdg.balanceOf(address(vault)), vaultBefore);
        assertEq(usdg.balanceOf(address(manager)), 0);
        assertEq(vault.reserved(), 0);
    }

    function testLpCannotWithdrawReserved() public {
        open(true, 10e6);
        uint256 free = vault.freeAssets();
        uint256 max = vault.maxWithdraw(lp);
        assertLe(max, free);
        assertGe(max + 1, free); // share rounding
        vm.prank(lp);
        vm.expectRevert();
        vault.withdraw(free + 1, lp, lp);
        vm.prank(lp);
        vault.withdraw(max, lp, lp);
        assertGe(usdg.balanceOf(address(vault)), vault.reserved());
    }

    function testVaultDepositsStartPausedAndManagerSetOnce() public {
        PonsLiquidityVault fresh = PonsLiquidityVault(
            address(
                new ERC1967Proxy(
                    address(new PonsLiquidityVault()),
                    abi.encodeCall(PonsLiquidityVault.initialize, (IERC20(address(usdg)), "a", "b", owner))
                )
            )
        );
        assertEq(fresh.maxDeposit(lp), 0);
        vm.prank(owner);
        fresh.setManager(address(manager));
        vm.prank(owner);
        vm.expectRevert(PonsLiquidityVault.InvalidConfiguration.selector);
        fresh.setManager(address(oracle));
        vm.expectRevert(PonsLiquidityVault.NotManager.selector);
        fresh.pay(lp, 1);
    }

    function testClosingWorksWhileOpeningPaused() public {
        uint256 id = open(true, 10e6);
        vm.prank(owner);
        manager.setOpeningPaused(true);
        vm.warp(vm.getBlockTimestamp() + 6 minutes);
        vm.prank(trader);
        manager.closePosition(id);
    }

    function testMarketConfigBounds() public {
        vm.startPrank(owner);
        vm.expectRevert(PonsPerpManager.InvalidConfiguration.selector);
        manager.setMarket(address(levier), 50_001, 1_000, 20e6, 100e6);
        vm.expectRevert(PonsPerpManager.InvalidConfiguration.selector);
        manager.setMarket(address(levier), 20_000, 5_000, 20e6, 100e6); // maintenance >= 1/leverage
        vm.expectRevert(PonsPerpManager.InvalidConfiguration.selector);
        manager.setParams(101, 500, 0, 0, 5_000);
        vm.stopPrank();
    }
}
