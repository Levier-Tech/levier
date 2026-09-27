// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/tokens/TestnetERC20.sol";
import "../src/oracle/CompositeSanityOracle.sol";
import "../src/registry/LevierMarketRegistry.sol";
import "../src/core/LevierPair.sol";
import "../src/routers/LeverageRouter.sol";

contract LeverageRouterTest is Test {
    address admin = address(0xAD);
    address alice = address(0xA1);

    TestnetERC20 nvda;
    TestnetERC20 usdg;
    CompositeSanityOracle oracle;
    LevierMarketRegistry registry;
    LevierPair pair;
    LeverageRouter leverageRouter;

    bytes32 marketId;

    function setUp() public {
        vm.startPrank(admin);

        nvda = new TestnetERC20("NVIDIA Token", "NVDA", 18, 1_000_000e18, admin);
        usdg = new TestnetERC20("Global Dollar", "USDG", 18, 10_000_000e18, admin);

        oracle = new CompositeSanityOracle(admin);
        oracle.setPrice(address(nvda), 250e18); // $250.00
        oracle.setPrice(address(usdg), 1e18); // $1.00

        registry = new LevierMarketRegistry(admin);
        marketId = keccak256(abi.encodePacked("nvda-usdg-testnet", address(nvda), address(usdg)));

        pair = new LevierPair(marketId, address(nvda), address(usdg), address(oracle), address(registry), admin);

        registry.addMarket(
            "nvda-usdg-testnet",
            address(nvda),
            address(usdg),
            address(pair),
            address(oracle),
            LevierMarketRegistry.RiskTier.TierA,
            6000,
            7000,
            25000,
            1_000_000e18,
            500_000e18
        );

        leverageRouter = new LeverageRouter(admin);
        leverageRouter.setPaused(false);

        // Authorize LeverageRouter in registry
        registry.setAuthorizedRouter(address(leverageRouter), true);

        // Fund pair with USDG liquidity for borrowing
        usdg.transfer(address(pair), 500_000e18);

        // Fund Alice
        nvda.transfer(alice, 100e18);
        vm.stopPrank();
        vm.prank(alice);
        pair.setOperator(address(leverageRouter), true);
    }

    function testOpenLeveragedPosition2x() public {
        vm.startPrank(alice);

        // Alice wants 2.0x Long: 10 NVDA initial collateral ($2,500), borrows $1,000 USDG
        nvda.approve(address(leverageRouter), 10e18);
        leverageRouter.openLeveragedPosition(
            address(pair),
            10e18, // initial collateral (10 NVDA)
            1000e18, // borrow amount (1,000 USDG)
            20000 // 2.0x leverage (in bps)
        );

        // Verify Alice's position on pair
        (uint256 col, uint256 debt, uint256 colValUsd, uint256 hf) = pair.getPosition(alice);
        assertEq(col, 10e18, "Collateral should be 10 NVDA");
        assertEq(debt, 1000e18, "Debt should be 1,000 USDG");
        assertEq(colValUsd, 2500e18, "Collateral value should be $2,500");
        assertEq(hf, 17500, "Health factor should be 1.75");

        // Verify Alice received the borrowed USDG
        assertEq(usdg.balanceOf(alice), 1000e18, "Alice should receive borrowed USDG");
        vm.stopPrank();
    }

    function testPausedRouterReverts() public {
        vm.prank(admin);
        leverageRouter.setPaused(true);

        vm.startPrank(alice);
        nvda.approve(address(leverageRouter), 10e18);

        vm.expectRevert("LeverageRouter: Contract paused");
        leverageRouter.openLeveragedPosition(address(pair), 10e18, 1000e18, 20000);
        vm.stopPrank();
    }

    function testZeroCollateralReverts() public {
        vm.startPrank(alice);
        vm.expectRevert("LeverageRouter: Zero initial collateral");
        leverageRouter.openLeveragedPosition(address(pair), 0, 1000e18, 20000);
        vm.stopPrank();
    }

    function testExcessiveLeverageReverts() public {
        vm.startPrank(alice);
        nvda.approve(address(leverageRouter), 10e18);

        // Attempt 3.5x leverage (> 3.0x max limit)
        vm.expectRevert("LeverageRouter: Leverage out of bounds");
        leverageRouter.openLeveragedPosition(address(pair), 10e18, 2500e18, 35000);
        vm.stopPrank();
    }
}
