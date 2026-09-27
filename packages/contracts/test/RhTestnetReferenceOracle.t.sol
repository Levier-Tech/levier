// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {RhTestnetReferenceOracle} from "../src/oracle/RhTestnetReferenceOracle.sol";

contract RhTestnetReferenceOracleTest is Test {
    RhTestnetReferenceOracle oracle;
    address stock = address(0x100);
    address debt = address(0x200);
    function setUp() public {
        vm.chainId(46630); vm.warp(10000); vm.etch(stock, hex"00"); vm.etch(debt, hex"00");
        oracle = create();
    }
    function create() internal returns (RhTestnetReferenceOracle) {
        return new RhTestnetReferenceOracle(address(this), keccak256("unit-test-binding"),
            RhTestnetReferenceOracle.Policy(stock, 90, 1e18, 1000e18),
            RhTestnetReferenceOracle.Policy(debt, 600, 0.9e18, 1.1e18), 500);
    }
    function publish() internal { oracle.publish(360e18, 9990, 1e18, 9950, keccak256("test-evidence")); }
    function testPublicationAndExpiry() public {
        publish(); assertEq(oracle.getPrice(stock), 360e18); assertEq(oracle.round(), 1);
        vm.warp(10081); vm.expectRevert("Reference: Expired price"); oracle.getPrice(stock);
        assertEq(oracle.getPrice(debt), 1e18);
    }
    function testNoEmptyOrUnknownPrice() public {
        vm.expectRevert("Reference: Expired price"); oracle.getPrice(stock);
        vm.expectRevert("Reference: Unknown asset"); oracle.getPrice(address(3));
    }
    function testNoOtherNetwork() public {
        vm.chainId(4663); vm.expectRevert("Reference: RH testnet only"); create();
        vm.expectRevert("Reference: RH testnet only"); oracle.getPrice(stock);
    }
    function testPublisherOnly() public {
        vm.prank(address(5)); vm.expectRevert("Reference: Publisher only on testnet"); publish();
    }
    function testReplayAndConflictingReportsRejected() public {
        publish(); vm.expectRevert("Reference: Replayed report"); publish();
        vm.expectRevert("Reference: Conflicting source"); oracle.publish(361e18,9990,1e18,9950,bytes32(uint256(1)));
        vm.expectRevert("Reference: Source regressed"); oracle.publish(360e18,9989,1e18,9950,bytes32(uint256(1)));
    }
    function testStaleFutureDeviationAndBoundsRejected() public {
        vm.expectRevert("Reference: Stale or future source"); oracle.publish(360e18, 9900,1e18,9950,bytes32(uint256(1)));
        vm.expectRevert("Reference: Stale or future source"); oracle.publish(360e18,10001,1e18,9950,bytes32(uint256(1)));
        publish(); vm.expectRevert("Reference: Deviation exceeded"); oracle.publish(400e18,9991,1e18,9950,bytes32(uint256(1)));
        vm.expectRevert("Reference: Price out of bounds"); oracle.publish(360e18,9991,2e18,9950,bytes32(uint256(1)));
    }
    function testUnchangedDebtDoesNotRenewItsAge() public {
        publish(); oracle.publish(361e18,9991,1e18,9950,bytes32(uint256(1)));
        (,uint256 timestamp) = oracle.observations(debt); assertEq(timestamp,9950);
    }
}
