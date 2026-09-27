// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/tokens/TestnetERC20.sol";
import "../src/oracle/CompositeSanityOracle.sol";
import "../src/registry/LeveraMarketRegistry.sol";
import "../src/core/LeveraPair.sol";
import "../src/routers/ShortRouter.sol";

contract ShortRouterTest is Test {
    address admin = address(0xAD);
    address alice = address(0xA1);

    TestnetERC20 nvda;
    TestnetERC20 usdg;
    CompositeSanityOracle oracle;
    LeveraMarketRegistry registry;
    LeveraPair shortPair;
    ShortRouter shortRouter;

    bytes32 marketId;

    function setUp() public {
        vm.startPrank(admin);

        nvda = new TestnetERC20("NVIDIA Token", "NVDA", 18, 1_000_000e18, admin);
        usdg = new TestnetERC20("Global Dollar", "USDG", 18, 10_000_000e18, admin);

        oracle = new CompositeSanityOracle(admin);
        oracle.setPrice(address(nvda), 250e18); // $250.00
        oracle.setPrice(address(usdg), 1e18); // $1.00

        registry = new LeveraMarketRegistry(admin);

        // For a Short Market: Collateral is USDG ($1), Debt is NVDA ($250)
        marketId = keccak256(abi.encodePacked("nvda-short-usdg", address(usdg), address(nvda)));

        shortPair = new LeveraPair(
            marketId,
            address(usdg), // collateralToken
            address(nvda), // debtToken
            address(oracle),
            address(registry),
            admin
        );

        registry.addMarket(
            "nvda-short-usdg",
            address(usdg),
            address(nvda),
            address(shortPair),
            address(oracle),
            LeveraMarketRegistry.RiskTier.TierA,
            6000,
            7000,
            20000,
            1_000_000e18,
            500_000e18
        );

        shortRouter = new ShortRouter(admin);
        shortRouter.setPaused(false);
        registry.setAuthorizedRouter(address(shortRouter), true);

        // Fund pair with NVDA to borrow
        nvda.transfer(address(shortPair), 10_000e18);

        // Fund Alice with USDG collateral
        usdg.transfer(alice, 10_000e18);
        vm.stopPrank();
        vm.prank(alice);
        shortPair.setOperator(address(shortRouter), true);
    }

    function testOpenShortPosition() public {
        vm.startPrank(alice);

        // Alice supplies $2,500 USDG collateral, borrows 4 NVDA ($1,000 value, 40% LTV)
        usdg.approve(address(shortRouter), 2500e18);
        shortRouter.openShortPosition(
            address(shortPair),
            2500e18, // 2,500 USDG
            4e18 // 4 NVDA
        );

        // Verify position
        (uint256 col, uint256 debt, uint256 colValUsd, uint256 hf) = shortPair.getPosition(alice);
        assertEq(col, 2500e18, "Collateral should be 2,500 USDG");
        assertEq(debt, 4e18, "Debt should be 4 NVDA");
        assertEq(colValUsd, 2500e18, "Collateral value should be $2,500");
        assertEq(hf, 17500, "Health factor should be 1.75");

        // Alice should have received the 4 borrowed NVDA
        assertEq(nvda.balanceOf(alice), 4e18, "Alice should receive 4 borrowed NVDA");
        vm.stopPrank();
    }

    function testPausedShortRouterReverts() public {
        vm.prank(admin);
        shortRouter.setPaused(true);

        vm.startPrank(alice);
        usdg.approve(address(shortRouter), 2500e18);

        vm.expectRevert("ShortRouter: Paused");
        shortRouter.openShortPosition(address(shortPair), 2500e18, 4e18);
        vm.stopPrank();
    }

    function testZeroCollateralShortReverts() public {
        vm.startPrank(alice);
        vm.expectRevert("ShortRouter: Zero collateral");
        shortRouter.openShortPosition(address(shortPair), 0, 4e18);
        vm.stopPrank();
    }
}
