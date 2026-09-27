// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/tokens/TestnetERC20.sol";
import "../src/oracle/CompositeSanityOracle.sol";
import "../src/registry/LeveraMarketRegistry.sol";
import "../src/core/LeveraPair.sol";
import "../src/vaults/LeveraVault.sol";
import "../src/routers/LeveraRouter.sol";
import "../src/routers/LeverageRouter.sol";
import "../src/modules/AutoProtectModule.sol";

contract LeveraCoreTest is Test {
    address admin = address(0xAD);
    address alice = address(0xA1);
    address bob = address(0xB2);
    address keeper = address(0xCAFE);

    TestnetERC20 nvda;
    TestnetERC20 usdg;
    CompositeSanityOracle oracle;
    LeveraMarketRegistry registry;
    LeveraPair pair;
    LeveraVault vault;
    LeveraRouter router;
    LeverageRouter leverageRouter;
    AutoProtectModule autoProtect;

    bytes32 marketId;

    function setUp() public {
        vm.startPrank(admin);

        // 1. Deploy Tokens
        nvda = new TestnetERC20("NVIDIA Token", "NVDA", 18, 1_000_000e18, admin);
        usdg = new TestnetERC20("Global Dollar", "USDG", 18, 10_000_000e18, admin);

        // 2. Deploy Oracle ($250.00 NVDA, $1.00 USDG)
        oracle = new CompositeSanityOracle(admin);
        oracle.setPrice(address(nvda), 250e18);
        oracle.setPrice(address(usdg), 1e18);

        // 3. Deploy Registry
        registry = new LeveraMarketRegistry(admin);

        // 4. Deploy Dummy Pair Address for pre-calculation
        marketId = keccak256(abi.encodePacked("nvda-usdg-testnet", address(nvda), address(usdg)));

        // 5. Deploy Pair
        pair = new LeveraPair(marketId, address(nvda), address(usdg), address(oracle), address(registry), admin);

        // Register Market in Registry
        registry.addMarket(
            "nvda-usdg-testnet",
            address(nvda),
            address(usdg),
            address(pair),
            address(oracle),
            LeveraMarketRegistry.RiskTier.TierA,
            6000, // 60% Max LTV
            7000, // 70% Liquidation LTV
            25000, // 2.5x Max Leverage
            1_000_000e18,
            500_000e18
        );

        // 6. Deploy Vault
        vault = new LeveraVault(
            IERC20(address(usdg)),
            "Levera USDG Yield Vault",
            "lvUSDG",
            "levera-usdg-vault-testnet",
            "Conservative",
            admin
        );

        // 7. Deploy Routers
        router = new LeveraRouter();
        leverageRouter = new LeverageRouter(admin);
        vault.setDepositsPaused(false);
        leverageRouter.setPaused(false);
        autoProtect = new AutoProtectModule(admin);
        autoProtect.setPaused(false);
        autoProtect.setKeeper(keeper, true);

        // Provide liquidity to Pair
        usdg.transfer(address(pair), 100_000e18);

        // Fund Alice
        nvda.transfer(alice, 100e18); // 100 NVDA = $25,000
        usdg.transfer(alice, 10_000e18);

        // Fund Bob (liquidator)
        usdg.transfer(bob, 50_000e18);

        vm.stopPrank();
    }

    function testOraclePrices() public view {
        uint256 nvdaPrice = oracle.getPrice(address(nvda));
        assertEq(nvdaPrice, 250e18, "NVDA price should be 250 USD");

        uint256 usdgPrice = oracle.getPrice(address(usdg));
        assertEq(usdgPrice, 1e18, "USDG price should be 1 USD");
    }

    function testSupplyAndBorrowWithinLimit() public {
        vm.startPrank(alice);

        // Alice deposits 10 NVDA ($2,500 collateral)
        nvda.approve(address(pair), 10e18);
        pair.depositCollateral(10e18);

        (uint256 col, uint256 debt, uint256 colValUsd, uint256 hf) = pair.getPosition(alice);
        assertEq(col, 10e18);
        assertEq(debt, 0);
        assertEq(colValUsd, 2500e18);
        assertEq(hf, 999_0000);

        // Max LTV is 60% of $2,500 = $1,500. Alice borrows 1,000 USDG (40% LTV, safe)
        pair.borrow(1000e18);

        (, debt,, hf) = pair.getPosition(alice);
        assertEq(debt, 1000e18);
        // Health factor: (Liquidation threshold $1,750 / debt $1,000) * 10,000 = 17500 (1.75)
        assertEq(hf, 17500);

        vm.stopPrank();
    }

    function testBorrowExceedingMaxLtvReverts() public {
        vm.startPrank(alice);

        // Alice deposits 10 NVDA ($2,500 collateral)
        nvda.approve(address(pair), 10e18);
        pair.depositCollateral(10e18);

        // Max borrow is $1,500 (60% LTV). Attempting to borrow $1,600 must revert.
        vm.expectRevert("Pair: Borrow exceeds Max LTV limit");
        pair.borrow(1600e18);

        vm.stopPrank();
    }

    function testLiquidationWhenPriceDrops() public {
        vm.startPrank(alice);
        // Alice deposits 10 NVDA ($2,500 collateral) and borrows $1,500 USDG (60% LTV)
        nvda.approve(address(pair), 10e18);
        pair.depositCollateral(10e18);
        pair.borrow(1500e18);
        vm.stopPrank();

        // Admin updates NVDA price down to $200.00 (Collateral is now $2,000)
        // At $2,000 collateral, 70% liquidation threshold = $1,400. Debt is $1,500 -> Liquidatable!
        vm.prank(admin);
        oracle.forcePrice(address(nvda), 200e18);

        assertTrue(pair.isLiquidatable(alice), "Alice should now be liquidatable");

        // Bob liquidates Alice's position
        vm.startPrank(bob);
        usdg.approve(address(pair), 1500e18);
        pair.liquidate(alice, 1500e18);
        vm.stopPrank();

        (, uint256 debtRemaining,,) = pair.getPosition(alice);
        assertEq(debtRemaining, 0, "All debt should be liquidated");
    }

    function testAutoProtectModule() public {
        vm.startPrank(alice);
        // Alice deposits 10 NVDA ($2,500 collateral) and borrows $1,300 USDG (52% LTV)
        nvda.approve(address(pair), 10e18);
        pair.depositCollateral(10e18);
        pair.borrow(1300e18);

        // Alice configures AutoProtect: Trigger at 55% LTV, target 40%, max 500 USDG deleverage
        autoProtect.setConfig(address(pair), true, 5500, 4000, 500e18);
        vm.stopPrank();

        // NVDA drops to $230 ($2,300 collateral). Current LTV = $1300 / $2300 = 56.5% (> 55% trigger)
        vm.prank(admin);
        oracle.forcePrice(address(nvda), 230e18);

        // Fund keeper with USDG to execute deleverage
        vm.prank(admin);
        usdg.transfer(keeper, 500e18);

        // Keeper executes deleverage
        vm.startPrank(keeper);
        usdg.approve(address(autoProtect), 500e18);
        autoProtect.executeAutoProtect(address(pair), alice, 500e18);
        vm.stopPrank();

        (, uint256 debtRemaining,,) = pair.getPosition(alice);
        assertEq(debtRemaining, 920e18, "Debt must stop at target 40% of $2300 collateral");
        assertEq(usdg.balanceOf(keeper), 120e18, "Keeper spends only the $380 needed to reach target");
    }
}
