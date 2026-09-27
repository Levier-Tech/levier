// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {DeployRhOracle} from "../script/DeployRhOracle.s.sol";
import {VerifiedFeedOracle} from "../src/oracle/VerifiedFeedOracle.sol";
import {FeedFixture} from "./VerifiedFeedOracle.t.sol";
import {TestnetERC20} from "../src/tokens/TestnetERC20.sol";

contract OracleInputHarness is DeployRhOracle {
    function validateNetwork(string memory mode, uint256 expectedChain, bool enabled) external view {
        validateEnvironment(mode, expectedChain, enabled);
    }

    function validate(string memory json, string memory tokenMap)
        external
        view
        returns (VerifiedFeedOracle.FeedInput memory)
    {
        return readFeed(json, ".collateral", tokenMap);
    }
}

contract OracleDeploymentGuardsTest is Test {
    OracleInputHarness script;
    TestnetERC20 stock;
    FeedFixture feed;
    string input;
    string tokenMap;

    function setUp() public {
        script = new OracleInputHarness();
        stock = new TestnetERC20("Stock fixture", "STOCK", 18, 1e18, address(this));
        feed = new FeedFixture(8, "STOCK / USD", 250e8, 1, 1);
        tokenMap = string.concat('{"tokens":{"STOCK":"', vm.toString(address(stock)), '"}}');
        vm.serializeAddress("feed", "assetAddress", address(stock));
        vm.serializeBytes32("feed", "assetRuntimeCodeHash", address(stock).codehash);
        vm.serializeAddress("feed", "feedAddress", address(feed));
        vm.serializeBytes32("feed", "feedRuntimeCodeHash", address(feed).codehash);
        vm.serializeString("feed", "symbol", "STOCK");
        vm.serializeString("feed", "description", "STOCK / USD");
        vm.serializeUint("feed", "maxAge", 120);
        vm.serializeUint("feed", "minPrice18", 1e18);
        vm.serializeUint("feed", "maxPrice18", 10000e18);
        string memory json = vm.serializeBool("feed", "checkTokenPause", false);
        input = string.concat('{"collateral":', json, "}");
    }

    function testAcceptsExactFeedAndTokenIdentity() public view {
        VerifiedFeedOracle.FeedInput memory value = script.validate(input, tokenMap);
        assertEq(value.asset, address(stock));
        assertEq(value.feed, address(feed));
    }

    function testRejectsDifferentFeedRuntime() public {
        string memory json = vm.serializeBytes32("feed", "feedRuntimeCodeHash", bytes32(0));
        vm.expectRevert("Oracle deployment: Feed code mismatch");
        script.validate(string.concat('{"collateral":', json, "}"), tokenMap);
    }

    function testRejectsDifferentAssetRuntime() public {
        string memory json = vm.serializeBytes32("feed", "assetRuntimeCodeHash", bytes32(0));
        vm.expectRevert("Oracle deployment: Asset code mismatch");
        script.validate(string.concat('{"collateral":', json, "}"), tokenMap);
    }

    function testRejectsTokenMapDriftEvenWhenSymbolMatches() public {
        tokenMap = string.concat('{"tokens":{"STOCK":"', vm.toString(address(feed)), '"}}');
        vm.expectRevert("Oracle deployment: Token map mismatch");
        script.validate(input, tokenMap);
    }

    function testRejectsMainnetConfiguration() public {
        vm.expectRevert("Oracle deployment: TESTNET only");
        script.validateNetwork("MAINNET", 46630, false);
    }

    function testRejectsWrongChainConfiguration() public {
        vm.chainId(31337);
        vm.expectRevert("Oracle deployment: Wrong chain");
        script.validateNetwork("TESTNET", 46630, false);
    }

    function testRejectsTradingEnabledConfiguration() public {
        vm.chainId(46630);
        vm.expectRevert("Oracle deployment: Disable execution first");
        script.validateNetwork("TESTNET", 46630, true);
    }
}
