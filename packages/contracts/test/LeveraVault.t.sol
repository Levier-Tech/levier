// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/tokens/TestnetERC20.sol";
import "../src/vaults/LeveraVault.sol";

contract LeveraVaultTest is Test {
    address admin = address(0xAD);
    address alice = address(0xA1);
    address bob = address(0xB2);
    address mockPair1 = address(0x1111);
    address mockPair2 = address(0x2222);

    TestnetERC20 usdg;
    LeveraVault vault;

    function setUp() public {
        vm.startPrank(admin);
        usdg = new TestnetERC20("Global Dollar", "USDG", 18, 1_000_000e18, admin);
        vault = new LeveraVault(
            IERC20(address(usdg)),
            "Levera USDG Yield Vault",
            "lvUSDG",
            "levera-usdg-vault-testnet",
            "Conservative",
            admin
        );

        vault.setDepositsPaused(false);
        usdg.transfer(alice, 10_000e18);
        usdg.transfer(bob, 10_000e18);
        vm.stopPrank();
    }

    function testInitialState() public view {
        assertEq(address(vault.asset()), address(usdg));
        assertEq(vault.name(), "Levera USDG Yield Vault");
        assertEq(vault.symbol(), "lvUSDG");
        assertEq(vault.vaultSlug(), "levera-usdg-vault-testnet");
        assertEq(vault.riskTier(), "Conservative");
        assertEq(vault.totalAssets(), 0);
        assertEq(vault.totalSupply(), 0);
    }

    function testDepositAndMintShares() public {
        vm.startPrank(alice);
        usdg.approve(address(vault), 1000e18);
        uint256 shares = vault.deposit(1000e18, alice);

        assertEq(shares, 1000e18, "1:1 share minting initially");
        assertEq(vault.balanceOf(alice), 1000e18);
        assertEq(vault.totalAssets(), 1000e18);
        assertEq(usdg.balanceOf(address(vault)), 1000e18);
        vm.stopPrank();
    }

    function testWithdrawAndBurnShares() public {
        vm.startPrank(alice);
        usdg.approve(address(vault), 1000e18);
        vault.deposit(1000e18, alice);

        uint256 sharesBurned = vault.withdraw(400e18, alice, alice);
        assertEq(sharesBurned, 400e18);
        assertEq(vault.balanceOf(alice), 600e18);
        assertEq(vault.totalAssets(), 600e18);
        assertEq(usdg.balanceOf(alice), 9400e18);
        vm.stopPrank();
    }

    function testSetAllocations() public {
        vm.startPrank(admin);
        address[] memory pairs = new address[](2);
        pairs[0] = mockPair1;
        pairs[1] = mockPair2;

        uint256[] memory weights = new uint256[](2);
        weights[0] = 6000; // 60%
        weights[1] = 4000; // 40%

        vault.setAllocations(pairs, weights);
        assertEq(vault.getAllocationsCount(), 2);
        vm.stopPrank();
    }

    function testExceedingAllocationsReverts() public {
        vm.startPrank(admin);
        address[] memory pairs = new address[](2);
        pairs[0] = mockPair1;
        pairs[1] = mockPair2;

        uint256[] memory weights = new uint256[](2);
        weights[0] = 7000;
        weights[1] = 4000; // Total 110% > 100%

        vm.expectRevert("Vault: Total weight cannot exceed 100%");
        vault.setAllocations(pairs, weights);
        vm.stopPrank();
    }

    function testUnauthorizedSetAllocationsReverts() public {
        vm.startPrank(alice);
        address[] memory pairs = new address[](1);
        pairs[0] = mockPair1;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 5000;

        vm.expectRevert();
        vault.setAllocations(pairs, weights);
        vm.stopPrank();
    }
}
