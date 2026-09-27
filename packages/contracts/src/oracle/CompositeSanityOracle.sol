// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CompositeSanityOracle
 * @notice Validates on-chain asset pricing feeds synchronized from real stock market data (e.g., Robinhood).
 * @dev Enforces staleness checks and deviation sanity boundaries.
 */
contract CompositeSanityOracle is Ownable {
    struct PriceData {
        uint256 price;       // Scaled by 1e18 (USD price)
        uint256 lastUpdated; // Timestamp of last valid update
    }

    // Mapping from asset token address => PriceData
    mapping(address => PriceData) public prices;

    // Authorized feeders (Price Oracle worker addresses)
    mapping(address => bool) public isFeeder;

    uint256 public maxStaleness = 3600; // 1 hour max staleness
    uint256 public maxDeviationBps = 1500; // Max 15% deviation per single update

    event PriceUpdated(address indexed asset, uint256 newPrice, uint256 timestamp);
    event FeederStatusChanged(address indexed feeder, bool status);
    event MaxStalenessUpdated(uint256 newStaleness);
    event MaxDeviationUpdated(uint256 newDeviationBps);

    modifier onlyAuthorized() {
        require(msg.sender == owner() || isFeeder[msg.sender], "Oracle: Caller not authorized feeder");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {
        isFeeder[initialOwner] = true;
    }

    function setFeeder(address feeder, bool status) external onlyOwner {
        isFeeder[feeder] = status;
        emit FeederStatusChanged(feeder, status);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        maxStaleness = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    function setMaxDeviationBps(uint256 _maxDeviationBps) external onlyOwner {
        maxDeviationBps = _maxDeviationBps;
        emit MaxDeviationUpdated(_maxDeviationBps);
    }

    /**
     * @notice Updates asset mark price.
     * @param asset Asset ERC-20 contract address.
     * @param newPrice Price scaled to 1e18 (e.g., $250.00 = 250e18).
     */
    function setPrice(address asset, uint256 newPrice) external onlyAuthorized {
        require(asset != address(0), "Oracle: Invalid asset address");
        require(newPrice > 0, "Oracle: Price must be greater than zero");

        uint256 currentPrice = prices[asset].price;
        if (currentPrice > 0) {
            uint256 diff = newPrice > currentPrice ? newPrice - currentPrice : currentPrice - newPrice;
            uint256 deviationBps = (diff * 10_000) / currentPrice;
            require(deviationBps <= maxDeviationBps, "Oracle: Price deviation exceeded boundary");
        }

        prices[asset] = PriceData({
            price: newPrice,
            lastUpdated: block.timestamp
        });

        emit PriceUpdated(asset, newPrice, block.timestamp);
    }

    /**
     * @notice Emergency force price update bypassing deviation check.
     */
    function forcePrice(address asset, uint256 newPrice) external onlyOwner {
        require(asset != address(0), "Oracle: Invalid asset address");
        require(newPrice > 0, "Oracle: Price must be greater than zero");

        prices[asset] = PriceData({
            price: newPrice,
            lastUpdated: block.timestamp
        });

        emit PriceUpdated(asset, newPrice, block.timestamp);
    }

    /**
     * @notice Retrieves verified mark price of an asset.
     */
    function getPrice(address asset) external view returns (uint256) {
        PriceData memory data = prices[asset];
        require(data.price > 0, "Oracle: Price not configured for asset");
        require(block.timestamp - data.lastUpdated <= maxStaleness, "Oracle: Price is stale");
        return data.price;
    }
}
