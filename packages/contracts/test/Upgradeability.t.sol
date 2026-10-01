// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import "../src/libraries/LevierProxies.sol";

contract RegistryV2 is LevierMarketRegistry {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract RouterV2 is LeverageRouter {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract UpgradeabilityTest is Test {
    address owner = address(0xA11CE);
    address stranger = address(0xB0B);

    function implementationOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.IMPLEMENTATION_SLOT))));
    }

    function testImplementationsCannotBeInitialized() public {
        LevierMarketRegistry impl = new LevierMarketRegistry();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(owner);
        LevierPair pairImpl = new LevierPair();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        pairImpl.initialize(bytes32(uint256(1)), address(1), address(2), address(3), address(4), owner);
    }

    function testProxyInitializesOnceWithOwnerAndPausedState() public {
        LevierMarketRegistry registry = LevierProxies.registry(owner);
        assertEq(registry.owner(), owner);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        registry.initialize(stranger);

        LeverageRouter router = LevierProxies.leverageRouter(owner);
        assertTrue(router.isPaused());
        assertTrue(LevierProxies.shortRouter(owner).isPaused());
        AutoProtectModule module = LevierProxies.autoProtect(owner);
        assertTrue(module.isPaused());
        assertTrue(module.isKeeper(owner));
    }

    function testOnlyOwnerUpgradesAndAddressAndStateSurvive() public {
        LevierMarketRegistry registry = LevierProxies.registry(owner);
        vm.prank(owner);
        registry.setAuthorizedRouter(address(registry), true);
        address proxyAddress = address(registry);
        address before = implementationOf(proxyAddress);

        RegistryV2 next = new RegistryV2();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger));
        registry.upgradeToAndCall(address(next), "");

        vm.prank(owner);
        registry.upgradeToAndCall(address(next), "");
        assertEq(address(registry), proxyAddress);
        assertTrue(implementationOf(proxyAddress) != before);
        assertEq(RegistryV2(proxyAddress).version(), 2);
        assertEq(registry.owner(), owner);
        assertTrue(registry.isAuthorizedRouter(address(registry)));
    }

    function testUpgradeKeepsPausedFlag() public {
        LeverageRouter router = LevierProxies.leverageRouter(owner);
        vm.startPrank(owner);
        router.setPaused(false);
        router.upgradeToAndCall(address(new RouterV2()), "");
        vm.stopPrank();
        assertFalse(router.isPaused());
        assertEq(RouterV2(address(router)).version(), 2);
    }
}
