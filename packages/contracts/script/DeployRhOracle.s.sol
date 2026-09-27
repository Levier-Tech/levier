// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script} from "forge-std/Script.sol";
import {VerifiedFeedOracle, IPriceFeedV3} from "../src/oracle/VerifiedFeedOracle.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Prepares an immutable oracle using existing verified feeds; never creates test feeds.
contract DeployRhOracle is Script {
    function readFeed(string memory json, string memory prefix, string memory tokenMap)
        internal
        view
        returns (VerifiedFeedOracle.FeedInput memory f)
    {
        f.asset = vm.parseJsonAddress(json, string.concat(prefix, ".assetAddress"));
        f.feed = vm.parseJsonAddress(json, string.concat(prefix, ".feedAddress"));
        require(f.asset.code.length > 0 && f.feed.code.length > 0, "Oracle deployment: Missing contract");
        require(
            f.asset.codehash == vm.parseJsonBytes32(json, string.concat(prefix, ".assetRuntimeCodeHash")),
            "Oracle deployment: Asset code mismatch"
        );
        require(
            f.feed.codehash == vm.parseJsonBytes32(json, string.concat(prefix, ".feedRuntimeCodeHash")),
            "Oracle deployment: Feed code mismatch"
        );
        string memory symbol = vm.parseJsonString(json, string.concat(prefix, ".symbol"));
        require(
            keccak256(bytes(IERC20Metadata(f.asset).symbol())) == keccak256(bytes(symbol)),
            "Oracle deployment: Symbol mismatch"
        );
        require(
            f.asset == vm.parseJsonAddress(tokenMap, string.concat(".tokens.", symbol)),
            "Oracle deployment: Token map mismatch"
        );
        f.description = vm.parseJsonString(json, string.concat(prefix, ".description"));
        f.maxAge = vm.parseJsonUint(json, string.concat(prefix, ".maxAge"));
        f.minPrice18 = vm.parseJsonUint(json, string.concat(prefix, ".minPrice18"));
        f.maxPrice18 = vm.parseJsonUint(json, string.concat(prefix, ".maxPrice18"));
        f.checkTokenPause = vm.parseJsonBool(json, string.concat(prefix, ".checkTokenPause"));
    }

    function validateEnvironment(string memory mode, uint256 expectedChain, bool tradingEnabled) internal view {
        require(keccak256(bytes(mode)) == keccak256("TESTNET"), "Oracle deployment: TESTNET only");
        require(block.chainid == expectedChain && block.chainid == 46630, "Oracle deployment: Wrong chain");
        require(!tradingEnabled, "Oracle deployment: Disable execution first");
    }

    function run() external returns (VerifiedFeedOracle oracle) {
        validateEnvironment(vm.envString("NETWORK_MODE"), vm.envUint("CHAIN_ID"), vm.envBool("TRADING_ENABLED"));
        string memory json = vm.envString("RH_ORACLE_CONFIG_JSON");
        address sequencer = vm.parseJsonAddress(json, ".sequencer.address");
        require(
            sequencer.code.length > 0 && sequencer.codehash == vm.parseJsonBytes32(json, ".sequencer.runtimeCodeHash"),
            "Oracle deployment: Sequencer identity mismatch"
        );
        require(
            keccak256(bytes(IPriceFeedV3(sequencer).description()))
                == keccak256(bytes(vm.parseJsonString(json, ".sequencer.description"))),
            "Oracle deployment: Sequencer description mismatch"
        );
        uint256 grace = vm.parseJsonUint(json, ".sequencer.gracePeriod");
        VerifiedFeedOracle.FeedInput[] memory inputs = new VerifiedFeedOracle.FeedInput[](2);
        string memory tokenMap = vm.envString("PROTOCOL_ADDRESSES");
        inputs[0] = readFeed(json, ".collateral", tokenMap);
        inputs[1] = readFeed(json, ".debt", tokenMap);
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(vm.addr(key) == vm.envAddress("DEPLOYER_ADDRESS"), "Oracle deployment: Signer mismatch");
        vm.startBroadcast(key);
        oracle = new VerifiedFeedOracle(block.chainid, sequencer, grace, inputs);
        require(
            oracle.getPrice(inputs[0].asset) > 0 && oracle.getPrice(inputs[1].asset) > 0,
            "Oracle deployment: Unavailable prices"
        );
        vm.stopBroadcast();
    }
}
