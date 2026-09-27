// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployRhLending} from "../script/DeployRhLending.s.sol";
import {TestnetERC20} from "../src/tokens/TestnetERC20.sol";
import {CompositeSanityOracle} from "../src/oracle/CompositeSanityOracle.sol";

contract LendingInputHarness is DeployRhLending {
    function validateNetwork(string memory mode, uint256 expectedChain, bool enabled) external view {
        validateEnvironment(mode, expectedChain, enabled);
    }
    function validateInput(string memory json) external view returns (address, address) {
        MarketInput memory input = readInput(json);
        return (input.collateral, input.debt);
    }
}

contract DeploymentGuardsTest is Test {
    LendingInputHarness script;
    TestnetERC20 stock;
    TestnetERC20 dollar;
    CompositeSanityOracle oracle;
    string input;

    function setUp() public {
        script = new LendingInputHarness();
        stock = new TestnetERC20("Stock fixture", "STOCK", 18, 100e18, address(this));
        dollar = new TestnetERC20("Dollar fixture", "USD", 6, 10000e6, address(this));
        oracle = new CompositeSanityOracle(address(this));
        oracle.setPrice(address(stock), 250e18);
        oracle.setPrice(address(dollar), 1e18);
        vm.serializeAddress("market", "collateralAddress", address(stock));
        vm.serializeAddress("market", "debtAddress", address(dollar));
        vm.serializeAddress("market", "oracleAddress", address(oracle));
        vm.serializeBytes32("market", "oracleRuntimeCodeHash", address(oracle).codehash);
        vm.serializeString("market", "collateralSymbol", "STOCK");
        vm.serializeString("market", "debtSymbol", "USD");
        vm.serializeUint("market", "collateralDecimals", 18);
        vm.serializeUint("market", "debtDecimals", 6);
        vm.serializeUint("market", "maxLtvBps", 6000);
        vm.serializeUint("market", "liquidationLtvBps", 7000);
        vm.serializeUint("market", "supplyCapRaw", 10000e18);
        vm.serializeUint("market", "borrowCapRaw", 10000e6);
        input = vm.serializeString("market", "slug", "stock-usd-testnet");
    }

    function testAcceptsMatchingTokenDecimalsAndOracleIdentity() public view {
        (address collateral, address debt) = script.validateInput(input);
        assertEq(collateral, address(stock));
        assertEq(debt, address(dollar));
    }

    function testRejectsMislabelledStock() public {
        string memory invalid = vm.serializeString("market", "collateralSymbol", "MSFT");
        vm.expectRevert("Deployment: Collateral symbol mismatch");
        script.validateInput(invalid);
    }

    function testRejectsWrongStablecoinDecimals() public {
        string memory invalid = vm.serializeUint("market", "debtDecimals", 18);
        vm.expectRevert("Deployment: Debt decimals mismatch");
        script.validateInput(invalid);
    }

    function testRejectsDifferentOracleRuntime() public {
        string memory invalid = vm.serializeBytes32("market", "oracleRuntimeCodeHash", bytes32(0));
        vm.expectRevert("Deployment: Oracle identity mismatch");
        script.validateInput(invalid);
    }

    function testRejectsStaleOracleBeforeBroadcast() public {
        vm.warp(block.timestamp + oracle.maxStaleness() + 1);
        vm.expectRevert("Oracle: Price is stale");
        script.validateInput(input);
    }

    function testRejectsMainnetModeBeforeReadingKey() public {
        vm.expectRevert("Deployment: TESTNET only");
        script.validateNetwork("MAINNET", 46630, false);
    }

    function testRejectsWrongChainBeforeReadingKey() public {
        vm.chainId(31337);
        vm.expectRevert("Deployment: Wrong chain");
        script.validateNetwork("TESTNET", 46630, false);
    }

    function testRejectsEnabledExecutionBeforeReadingKey() public {
        vm.chainId(46630);
        vm.expectRevert("Deployment: Disable application execution first");
        script.validateNetwork("TESTNET", 46630, true);
    }
}
