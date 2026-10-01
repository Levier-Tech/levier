// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IPriceFeedV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IStockOracleStatus {
    function oraclePaused() external view returns (bool);
}

/// @notice Immutable per-token USD feed adapter. It cannot accept manually submitted prices.
/// @dev Feed identity/provenance must be verified before deployment. Equity feeds must already
/// include the token's corporate-action multiplier. REST underlying prices are not compatible inputs.
contract VerifiedFeedOracle {
    struct FeedInput {
        address asset;
        address feed;
        string description;
        uint256 maxAge;
        uint256 minPrice18;
        uint256 maxPrice18;
        bool checkTokenPause;
    }

    struct FeedConfig {
        IPriceFeedV3 feed;
        uint8 decimals;
        uint256 maxAge;
        uint256 minPrice18;
        uint256 maxPrice18;
        bool checkTokenPause;
    }

    error InvalidConfiguration();
    error UnknownAsset();
    error SequencerUnavailable();
    error InvalidRound();
    error StalePrice();
    error InvalidPrice();
    error TokenOraclePaused();

    IPriceFeedV3 public immutable sequencerFeed;
    uint256 public immutable sequencerGracePeriod;
    uint256 public immutable chainId;
    mapping(address => FeedConfig) public feeds;

    constructor(uint256 expectedChainId, address sequencer, uint256 gracePeriod, FeedInput[] memory inputs) {
        // A chain without a Chainlink sequencer uptime feed (Robinhood Chain mainnet) is configured
        // explicitly as sequencer == address(0) with gracePeriod == 0; partial configuration is rejected.
        bool withSequencer = sequencer != address(0);
        if (
            block.chainid != expectedChainId || inputs.length == 0
                || (withSequencer ? sequencer.code.length == 0 || gracePeriod == 0 : gracePeriod != 0)
        ) {
            revert InvalidConfiguration();
        }
        chainId = expectedChainId;
        sequencerFeed = IPriceFeedV3(sequencer);
        sequencerGracePeriod = gracePeriod;
        for (uint256 i; i < inputs.length; ++i) {
            FeedInput memory input = inputs[i];
            if (
                input.asset.code.length == 0 || input.feed.code.length == 0
                    || address(feeds[input.asset].feed) != address(0) || input.maxAge == 0 || input.minPrice18 == 0
                    || input.maxPrice18 <= input.minPrice18 || bytes(input.description).length == 0
            ) revert InvalidConfiguration();
            IPriceFeedV3 feed = IPriceFeedV3(input.feed);
            uint8 decimals = feed.decimals();
            if (decimals > 36 || keccak256(bytes(feed.description())) != keccak256(bytes(input.description))) {
                revert InvalidConfiguration();
            }
            feeds[input.asset] =
                FeedConfig(feed, decimals, input.maxAge, input.minPrice18, input.maxPrice18, input.checkTokenPause);
        }
    }

    function getPrice(address asset) external view returns (uint256) {
        if (block.chainid != chainId) revert InvalidConfiguration();
        FeedConfig memory config = feeds[asset];
        if (address(config.feed) == address(0)) revert UnknownAsset();
        if (address(sequencerFeed) != address(0)) {
            (uint80 seqRound, int256 status, uint256 startedAt, uint256 seqUpdated, uint80 seqAnswered) =
                sequencerFeed.latestRoundData();
            if (
                seqRound == 0 || seqAnswered < seqRound || status != 0 || startedAt == 0
                    || startedAt > block.timestamp || seqUpdated < startedAt || seqUpdated > block.timestamp
                    || block.timestamp - startedAt <= sequencerGracePeriod
            ) {
                revert SequencerUnavailable();
            }
        }
        if (config.checkTokenPause && IStockOracleStatus(asset).oraclePaused()) revert TokenOraclePaused();
        (uint80 roundId, int256 answer, uint256 priceStarted, uint256 updatedAt, uint80 answeredInRound) =
            config.feed.latestRoundData();
        if (
            roundId == 0 || answeredInRound < roundId || updatedAt == 0 || updatedAt > block.timestamp
                || priceStarted > updatedAt
        ) revert InvalidRound();
        if (block.timestamp - updatedAt > config.maxAge) revert StalePrice();
        if (answer <= 0 || config.feed.decimals() != config.decimals) revert InvalidPrice();
        uint256 price = Math.mulDiv(uint256(answer), 1e18, 10 ** uint256(config.decimals));
        if (price < config.minPrice18 || price > config.maxPrice18) revert InvalidPrice();
        return price;
    }
}
