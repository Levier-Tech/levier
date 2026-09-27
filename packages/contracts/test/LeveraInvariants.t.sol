// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/tokens/TestnetERC20.sol";
import "../src/oracle/CompositeSanityOracle.sol";
import "../src/registry/LeveraMarketRegistry.sol";
import "../src/core/LeveraPair.sol";
import "../src/vaults/LeveraVault.sol";

/**
 * @title LeveraInvariantsTest
 * @notice Mathematical invariant and fuzz verification suite for LeveraVault and LeveraPair.
 * Verifies solvency, 4626 share conversion bounds, and liquidation mathematical invariants.
 */
contract LeveraInvariantsTest is Test {
    address admin = address(0xAD);
    address alice = address(0xA1);
    address bob = address(0xB1);
    address liquidator = address(0xCA);

    TestnetERC20 usdg;
    TestnetERC20 nvda;
    CompositeSanityOracle oracle;
    LeveraMarketRegistry registry;
    LeveraVault vault;
    LeveraPair pair;

    bytes32 marketId;

    function setUp() public {
        vm.startPrank(admin);

        usdg = new TestnetERC20("Global Dollar", "USDG", 18, 100_000_000e18, admin);
        nvda = new TestnetERC20("NVIDIA Token", "NVDA", 18, 1_000_000e18, admin);

        oracle = new CompositeSanityOracle(admin);
        oracle.setPrice(address(usdg), 1e18);   // $1.00
        oracle.setPrice(address(nvda), 250e18); // $250.00

        registry = new LeveraMarketRegistry(admin);

        // Vault for USDG
        vault = new LeveraVault(
            IERC20(address(usdg)),
            "Levera USDG Vault",
            "lvUSDG",
            "levera-usdg-vault-fuzz",
            "Conservative",
            admin
        );

        vault.setDepositsPaused(false);
        // Pair: NVDA as Collateral ($250), USDG as Debt ($1)
        marketId = keccak256(abi.encodePacked("nvda-usdg-fuzz", address(nvda), address(usdg)));
        pair = new LeveraPair(
            marketId,
            address(nvda),
            address(usdg),
            address(oracle),
            address(registry),
            admin
        );

        registry.addMarket(
            "nvda-usdg-fuzz",
            address(nvda),
            address(usdg),
            address(pair),
            address(oracle),
            LeveraMarketRegistry.RiskTier.TierA,
            7500, // 75% Max LTV
            8500, // 85% Liquidation LTV
            20000, // 200% Max Leverage
            10_000_000e18, // Supply Cap
            10_000_000e18  // Borrow Cap
        );

        // Seed pair with liquidity
        usdg.transfer(address(pair), 5_000_000e18);

        // Seed users
        nvda.transfer(alice, 100_000e18);
        nvda.transfer(bob, 100_000e18);
        usdg.transfer(alice, 1_000_000e18);
        usdg.transfer(bob, 1_000_000e18);
        usdg.transfer(liquidator, 1_000_000e18);

        vm.stopPrank();
    }

    // ==========================================
    // 1. VAULT FUZZ & INVARIANT TESTS
    // ==========================================

    /**
     * @notice Invariant: Vault assets must always match or exceed total underlying deposited minus withdrawn.
     * Share redemption should never yield more than the proportional share of totalAssets.
     */
    function testFuzz_VaultDepositWithdrawSolvency(uint256 depositAlice, uint256 depositBob, uint256 withdrawBps) public {
        // Bound deposits between 10 USDG and 1,000,000 USDG
        depositAlice = bound(depositAlice, 10e18, 1_000_000e18);
        depositBob = bound(depositBob, 10e18, 1_000_000e18);
        withdrawBps = bound(withdrawBps, 1, 10_000); // 0.01% to 100%

        // Alice deposits
        vm.startPrank(alice);
        usdg.approve(address(vault), depositAlice);
        uint256 sharesAlice = vault.deposit(depositAlice, alice);
        vm.stopPrank();

        // Bob deposits
        vm.startPrank(bob);
        usdg.approve(address(vault), depositBob);
        uint256 sharesBob = vault.deposit(depositBob, bob);
        vm.stopPrank();

        // Solvency Invariant: totalAssets == depositAlice + depositBob
        assertEq(vault.totalAssets(), depositAlice + depositBob, "Vault totalAssets must equal sum of deposits");
        assertEq(vault.totalSupply(), sharesAlice + sharesBob, "Vault totalSupply must equal sum of shares");

        // Alice withdraws a fraction
        uint256 aliceSharesToRedeem = (sharesAlice * withdrawBps) / 10_000;
        if (aliceSharesToRedeem > 0) {
            vm.prank(alice);
            uint256 assetsReceived = vault.redeem(aliceSharesToRedeem, alice, alice);

            // Asset invariant: assets received must not exceed the expected share value
            assertLe(assetsReceived, depositAlice + 1, "Redemption cannot exceed deposit value");
            // Solvency invariant: vault assets must remain consistent
            assertEq(vault.totalAssets(), (depositAlice + depositBob) - assetsReceived, "Remaining assets must be exact");
        }
    }

    // ==========================================
    // 2. PAIR SOLVENCY & LTV BOUNDARY FUZZ TESTS
    // ==========================================

    /**
     * @notice Invariant: Pair accounting (totalSupplyCollateral & totalBorrowedDebt)
     * must strictly equal the aggregate of individual user positions.
     */
    function testFuzz_PairAccountingInvariants(uint256 colA, uint256 colB, uint256 borrowA) public {
        // Bound collateral between 1 NVDA ($250) and 1,000 NVDA ($250,000)
        colA = bound(colA, 1e18, 1_000e18);
        colB = bound(colB, 1e18, 1_000e18);

        // Alice deposits collateral
        vm.startPrank(alice);
        nvda.approve(address(pair), colA);
        pair.depositCollateral(colA);

        // Alice borrows within 75% LTV
        // Collateral USD = colA * 250
        uint256 maxBorrowAllowed = (colA * 250e18 * 7500) / (1e18 * 10_000);
        borrowA = bound(borrowA, 1e18, maxBorrowAllowed);
        pair.borrow(borrowA);
        vm.stopPrank();

        // Bob deposits collateral
        vm.startPrank(bob);
        nvda.approve(address(pair), colB);
        pair.depositCollateral(colB);
        vm.stopPrank();

        // Invariant checks:
        assertEq(pair.totalSupplyCollateral(), colA + colB, "Pair total collateral invariant");
        assertEq(pair.totalBorrowedDebt(), borrowA, "Pair total debt invariant");

        (uint256 aliceCol, uint256 aliceDebt,,) = pair.getPosition(alice);
        (uint256 bobCol, uint256 bobDebt,,) = pair.getPosition(bob);

        assertEq(aliceCol, colA, "Alice collateral matches");
        assertEq(aliceDebt, borrowA, "Alice debt matches");
        assertEq(bobCol, colB, "Bob collateral matches");
        assertEq(bobDebt, 0, "Bob debt matches");
    }

    /**
     * @notice Invariant: A position is liquidatable IF AND ONLY IF debtValueUsd > liquidationDebtThresholdUsd.
     * When healthFactor >= 10000 (1.00), position CANNOT be liquidated.
     */
    function testFuzz_LiquidationThresholdInvariant(uint256 collateralNvda, uint256 newNvdaPrice) public {
        // 10 NVDA ($2,500 initial collateral)
        collateralNvda = bound(collateralNvda, 10e18, 500e18);
        
        vm.startPrank(alice);
        nvda.approve(address(pair), collateralNvda);
        pair.depositCollateral(collateralNvda);

        // Borrow at exactly 70% LTV (below 75% max LTV)
        // Initial NVDA price = $250
        uint256 initialColValueUsd = (collateralNvda * 250e18) / 1e18;
        uint256 debtToBorrow = (initialColValueUsd * 7000) / 10_000;
        pair.borrow(debtToBorrow);
        vm.stopPrank();

        // Fuzz new NVDA price between $50 and $500 (using forcePrice to test beyond the 15% per-update circuit breaker)
        newNvdaPrice = bound(newNvdaPrice, 50e18, 500e18);
        vm.prank(admin);
        oracle.forcePrice(address(nvda), newNvdaPrice);

        // Evaluate updated math
        uint256 updatedColValueUsd = (collateralNvda * newNvdaPrice) / 1e18;
        uint256 liquidationDebtThresholdUsd = (updatedColValueUsd * 8500) / 10_000; // 85% Liquidation LTV

        bool expectedLiquidatable = debtToBorrow > liquidationDebtThresholdUsd;
        bool actualLiquidatable = pair.isLiquidatable(alice);

        // Invariant: isLiquidatable is strictly equivalent to mathematical inequality
        assertEq(actualLiquidatable, expectedLiquidatable, "isLiquidatable must strictly match formula");

        (,,, uint256 hf) = pair.getPosition(alice);
        if (!actualLiquidatable) {
            // If not liquidatable, health factor MUST be >= 10,000 (1.00)
            assertGe(hf, 10_000, "Healthy position must have health factor >= 1.00");
        } else {
            // If liquidatable, health factor MUST be < 10,000 (1.00)
            assertLt(hf, 10_000, "Liquidatable position must have health factor < 1.00");

            // Execute liquidation and assert invariant: debt reduces, collateral reduces
            vm.startPrank(liquidator);
            usdg.approve(address(pair), debtToBorrow);
            uint256 colBefore = pair.totalSupplyCollateral();
            uint256 debtBefore = pair.totalBorrowedDebt();

            pair.liquidate(alice, debtToBorrow / 2);

            assertLt(pair.totalBorrowedDebt(), debtBefore, "Debt must decrease upon liquidation");
            assertLt(pair.totalSupplyCollateral(), colBefore, "Collateral must decrease upon liquidation");
            vm.stopPrank();
        }
    }

    /**
     * @notice Invariant: Withdrawals that push LTV above maxLtvBps (75%) must strictly revert.
     */
    function testFuzz_WithdrawExcessCollateralReverts(uint256 excessWithdrawBps) public {
        excessWithdrawBps = bound(excessWithdrawBps, 1, 5_000); // 0.01% to 50% excess

        vm.startPrank(alice);
        nvda.approve(address(pair), 10e18); // 10 NVDA = $2,500
        pair.depositCollateral(10e18);

        // Borrow max allowed at 75% LTV: $2,500 * 75% = 1,875 USDG
        pair.borrow(1875e18);

        // Any withdrawal should breach Max LTV and revert
        uint256 withdrawAmt = (10e18 * excessWithdrawBps) / 10_000;
        if (withdrawAmt == 0) withdrawAmt = 1;

        vm.expectRevert("Pair: Withdrawal breaches Max LTV limit");
        pair.withdrawCollateral(withdrawAmt);
        vm.stopPrank();
    }
}
