// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {LeverageRouter} from "../src/routers/LeverageRouter.sol";
import {ShortRouter} from "../src/routers/ShortRouter.sol";
import {AutoProtectModule} from "../src/modules/AutoProtectModule.sol";
import {LevierVault, IERC20} from "../src/vaults/LevierVault.sol";
import {TestnetERC20} from "../src/tokens/TestnetERC20.sol";
import {DeployRhModules} from "../script/DeployRhModules.s.sol";
import {DeployLevier} from "../script/DeployLevier.s.sol";
import "../src/libraries/LevierProxies.sol";

contract ModuleDeploymentSafetyTest is Test {
    LeverageRouter longRouter;
    ShortRouter shortRouter;
    AutoProtectModule protect;
    LevierVault vault;
    TestnetERC20 token;
    address user = address(123);
    function setUp() public {
        longRouter = LevierProxies.leverageRouter(address(this));
        shortRouter = LevierProxies.shortRouter(address(this));
        protect = LevierProxies.autoProtect(address(this));
        token = new TestnetERC20("Fixture USDG", "USDG", 6, 100e6, address(this));
        vault = LevierProxies.vault(IERC20(address(token)), "Fixture Vault", "fv", "fixture", "Experimental", address(this));
        token.transfer(user, 10e6);
    }
    function testRoutersStartPausedBeforeTouchingUserTokens() public {
        assertTrue(longRouter.isPaused()); assertTrue(shortRouter.isPaused());
        vm.expectRevert("LeverageRouter: Contract paused");longRouter.openLeveragedPosition(address(1),1,1,10000);
        vm.expectRevert("ShortRouter: Paused");shortRouter.openShortPosition(address(1),1,1);
    }
    function testAutoProtectStartsPausedEvenForOwner() public {
        assertTrue(protect.isPaused());
        vm.expectRevert("AutoProtect: Paused");protect.executeAutoProtect(address(1),user,1);
    }
    function testOnlyOwnerMayEnableModules() public {
        vm.startPrank(user);
        vm.expectRevert();longRouter.setPaused(false);
        vm.expectRevert();shortRouter.setPaused(false);
        vm.expectRevert();protect.setPaused(false);
        vm.expectRevert();vault.setDepositsPaused(false);
        vm.stopPrank();
    }
    function testVaultClosedDepositAndMintNeverPullAssets() public {
        assertEq(vault.maxDeposit(user),0); assertEq(vault.maxMint(user),0);
        vm.startPrank(user);token.approve(address(vault),10e6);
        vm.expectRevert();vault.deposit(1e6,user);
        vm.expectRevert();vault.mint(1e6,user);
        assertEq(token.balanceOf(user),10e6);assertEq(vault.totalAssets(),0);vm.stopPrank();
    }
    function testPauseDoesNotTrapWithdrawalsOrRedemptions() public {
        vault.setDepositsPaused(false);
        vm.startPrank(user);token.approve(address(vault),10e6);vault.deposit(10e6,user);vm.stopPrank();
        vault.setDepositsPaused(true);
        vm.startPrank(user);vault.withdraw(4e6,user,user);vault.redeem(vault.balanceOf(user),user,user);vm.stopPrank();
        assertEq(token.balanceOf(user),10e6);assertEq(vault.totalSupply(),0);
    }
    function testPublicTestnetCannotRunMockDeployment() public {
        DeployLevier legacy = new DeployLevier();vm.chainId(46630);
        vm.expectRevert("Legacy deployment: local fixtures only");legacy.run();
    }
    function testModulesRejectWrongNetworkAndEnabledApplications() public {
        DeployRhModules script = new DeployRhModules();vm.chainId(46630);
        script.validateEnvironment("TESTNET",46630,false,false);
        vm.expectRevert("Modules: RH testnet only");script.validateEnvironment("MAINNET",46630,false,false);
        vm.expectRevert("Modules: Disable application execution");script.validateEnvironment("TESTNET",46630,false,true);
        vm.expectRevert("Modules: Disable application execution");script.validateEnvironment("TESTNET",46630,true,false);
        vm.chainId(4663);vm.expectRevert("Modules: RH testnet only");script.validateEnvironment("TESTNET",4663,false,false);
    }
}
