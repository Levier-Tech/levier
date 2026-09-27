// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/tokens/TestnetERC20.sol";
import "../src/core/LeveraPair.sol";
import "../src/routers/LeveraRouter.sol";
import "../src/modules/AutoProtectModule.sol";

contract LendingLifecycleTest is Test {
    address alice = makeAddr("alice");
    address attacker = makeAddr("attacker");
    TestnetERC20 stock;
    TestnetERC20 dollar;
    CompositeSanityOracle oracle;
    LeveraMarketRegistry registry;
    LeveraPair pair;
    LeveraRouter router;
    bytes32 marketId;

    function setUp() public {
        stock = new TestnetERC20("Stock fixture", "STOCK", 18, 10000e18, address(this));
        dollar = new TestnetERC20("Dollar fixture", "USD", 6, 1000000e6, address(this));
        oracle = new CompositeSanityOracle(address(this));
        oracle.setPrice(address(stock), 250e18);
        oracle.setPrice(address(dollar), 1e18);
        registry = new LeveraMarketRegistry(address(this));
        marketId = keccak256(abi.encodePacked("stock-usd", address(stock), address(dollar)));
        pair = new LeveraPair(
            marketId, address(stock), address(dollar), address(oracle), address(registry), address(this)
        );
        registry.addMarket(
            "stock-usd",
            address(stock),
            address(dollar),
            address(pair),
            address(oracle),
            LeveraMarketRegistry.RiskTier.TierA,
            6000,
            7000,
            25000,
            10000e18,
            100000e6
        );
        router = new LeveraRouter();
        registry.setAuthorizedRouter(address(router), true);
        stock.transfer(alice, 100e18);
        dollar.transfer(address(pair), 100000e6);
        dollar.transfer(alice, 1000e6);
        vm.startPrank(alice);
        stock.approve(address(router), type(uint256).max);
        dollar.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function open() internal {
        vm.startPrank(alice);
        pair.setOperator(address(router), true);
        router.depositAndBorrow(address(pair), 10e18, 1000e6);
        vm.stopPrank();
    }

    function testMixedDecimalsFullRouterLifecycleAndNoTrappedOverpayment() public {
        open();
        (uint256 collateral, uint256 debt, uint256 value, uint256 health) = pair.getPosition(alice);
        assertEq(collateral, 10e18);
        assertEq(debt, 1000e6);
        assertEq(value, 2500e18);
        assertEq(health, 17500);
        (uint256 routerCollateral, uint256 routerDebt) = pair.accounts(address(router));
        assertEq(routerCollateral, 0);
        assertEq(routerDebt, 0);
        uint256 beforeBalance = dollar.balanceOf(alice);
        vm.prank(alice);
        router.repayAndWithdraw(address(pair), 1500e6, 10e18);
        (collateral, debt) = pair.accounts(alice);
        assertEq(collateral, 0);
        assertEq(debt, 0);
        assertEq(beforeBalance - dollar.balanceOf(alice), 1000e6);
        assertEq(stock.balanceOf(alice), 100e18);
        assertEq(dollar.balanceOf(address(router)), 0);
        assertEq(stock.balanceOf(address(router)), 0);
        assertEq(pair.totalBorrowedDebt(), 0);
        assertEq(pair.totalSupplyCollateral(), 0);
    }

    function testRegistryApprovalDoesNotReplaceUserConsent() public {
        vm.prank(alice);
        vm.expectRevert("Pair: Caller is not authorized for user");
        router.depositAndBorrow(address(pair), 10e18, 1000e6);
        assertEq(stock.balanceOf(alice), 100e18);
        assertEq(pair.totalSupplyCollateral(), 0);
    }

    function testAttackerCannotBorrowOrWithdrawOtherUserPosition() public {
        open();
        vm.startPrank(attacker);
        vm.expectRevert("Pair: Caller is not authorized for user");
        pair.borrowFor(alice, 1e6, attacker);
        vm.expectRevert("Pair: Caller is not authorized for user");
        pair.withdrawCollateralFor(alice, 1e18, attacker);
        vm.stopPrank();
    }

    function testUserCanRevokeOperatorAndStillRepayDirectly() public {
        open();
        vm.startPrank(alice);
        pair.setOperator(address(router), false);
        vm.expectRevert("Pair: Caller is not authorized for user");
        router.repayAndWithdraw(address(pair), 1000e6, 10e18);
        (, uint256 debt) = pair.accounts(alice);
        assertEq(debt, 1000e6);
        dollar.approve(address(pair), 1000e6);
        pair.repay(1000e6);
        pair.withdrawCollateral(10e18);
        vm.stopPrank();
    }

    function testRegistryRevocationOverridesUserApproval() public {
        open();
        registry.setAuthorizedRouter(address(router), false);
        vm.prank(alice);
        vm.expectRevert("Pair: Caller is not authorized for user");
        router.depositAndBorrow(address(pair), 0, 1e6);
    }

    function testReduceOnlyBlocksBorrowButAllowsExit() public {
        open();
        registry.setMarketStatus(marketId, LeveraMarketRegistry.MarketStatus.REDUCE_ONLY);
        vm.startPrank(alice);
        vm.expectRevert("Pair: Market borrowing restricted");
        pair.borrow(1e6);
        router.repayAndWithdraw(address(pair), 1000e6, 10e18);
        vm.stopPrank();
    }

    function testStaleOracleBlocksDebtButDoesNotTrapDebtFreeExit() public {
        open();
        vm.warp(block.timestamp + oracle.maxStaleness() + 1);
        vm.startPrank(alice);
        vm.expectRevert("Oracle: Price is stale");
        pair.borrow(1e6);
        router.repayAndWithdraw(address(pair), 1000e6, 10e18);
        vm.stopPrank();
    }

    function testMixedDecimalsLiquidationCapsRepaymentToAvailableCollateral() public {
        open();
        oracle.forcePrice(address(stock), 50e18);
        assertTrue(pair.isLiquidatable(alice));
        dollar.approve(address(pair), 1000e6);
        uint256 beforeBalance = dollar.balanceOf(address(this));
        pair.liquidate(alice, 1000e6);
        (uint256 collateral, uint256 debt) = pair.accounts(alice);
        uint256 payment = beforeBalance - dollar.balanceOf(address(this));
        assertEq(payment, 476190476); // $500 collateral / 1.05 bonus, rounded down to six decimals.
        assertEq(debt, 1000e6 - payment);
        assertLt(collateral, 1e12);
        assertEq(pair.totalBorrowedDebt(), debt);
    }

    function testSixDecimalCollateralAndEighteenDecimalDebt() public {
        bytes32 reverseId = keccak256(abi.encodePacked("usd-stock", address(dollar), address(stock)));
        LeveraPair reverse = new LeveraPair(
            reverseId, address(dollar), address(stock), address(oracle), address(registry), address(this)
        );
        registry.addMarket(
            "usd-stock",
            address(dollar),
            address(stock),
            address(reverse),
            address(oracle),
            LeveraMarketRegistry.RiskTier.TierA,
            6000,
            7000,
            20000,
            100000e6,
            1000e18
        );
        stock.transfer(address(reverse), 100e18);
        vm.startPrank(alice);
        dollar.approve(address(reverse), 1000e6);
        reverse.depositCollateral(1000e6);
        reverse.borrow(2e18);
        (,, uint256 value, uint256 health) = reverse.getPosition(alice);
        assertEq(value, 1000e18);
        assertEq(health, 14000);
        vm.expectRevert("Pair: Borrow exceeds Max LTV limit");
        reverse.borrow(1e18);
        vm.stopPrank();
    }

    function testAutoProtectUsesDebtValueAndStopsAtTarget() public {
        open();
        AutoProtectModule module = new AutoProtectModule(address(this));
        module.setPaused(false);
        vm.prank(alice);
        module.setConfig(address(pair), true, 3900, 2000, 1000e6);
        dollar.approve(address(module), 1000e6);
        module.executeAutoProtect(address(pair), alice, 1000e6);
        (, uint256 debt) = pair.accounts(alice);
        assertEq(debt, 500e6);
    }

    function testRiskUpdateCannotSetThresholdAboveOneHundredPercent() public {
        vm.expectRevert("Registry: Liquidation LTV cannot exceed 100%");
        registry.updateRiskTier(marketId, LeveraMarketRegistry.RiskTier.TierA, 6000, 10001, 25000);
    }

    function testPairCannotBeRegisteredUnderWrongIdentity() public {
        vm.expectRevert("Registry: Pair identity mismatch");
        registry.addMarket(
            "wrong-slug",
            address(stock),
            address(dollar),
            address(pair),
            address(oracle),
            LeveraMarketRegistry.RiskTier.TierA,
            6000,
            7000,
            25000,
            100e18,
            100e6
        );
    }
}
