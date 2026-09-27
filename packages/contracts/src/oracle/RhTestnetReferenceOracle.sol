// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Centralized real-reference publisher for faucet-token testing ONLY.
/// @dev This is not a Chainlink feed or an assertion of a faucet token's economic backing.
///      Source identity is an immutable hash of the reviewed offchain binding/policy.
contract RhTestnetReferenceOracle {
    struct Policy {
        address asset;
        uint256 maxAge;
        uint256 minPrice;
        uint256 maxPrice;
    }
    struct Observation {
        uint256 price;
        uint256 sourceTimestamp;
    }

    address public immutable publisher;
    address public immutable collateral;
    address public immutable debt;
    bytes32 public immutable bindingHash;
    uint256 public immutable collateralMaxAge;
    uint256 public immutable debtMaxAge;
    uint256 public immutable collateralMin;
    uint256 public immutable collateralMax;
    uint256 public immutable debtMin;
    uint256 public immutable debtMax;
    uint256 public immutable maxDeviationBps;
    uint256 public round;
    mapping(address => Observation) public observations;

    event ReferencePublished(uint256 indexed round, bytes32 indexed evidenceHash,
        uint256 collateralPrice, uint256 collateralTimestamp, uint256 debtPrice, uint256 debtTimestamp);

    constructor(address signer, bytes32 binding, Policy memory stock, Policy memory stable, uint256 deviationBps) {
        require(block.chainid == 46630, "Reference: RH testnet only");
        require(signer != address(0) && binding != bytes32(0), "Reference: Missing identity");
        require(stock.asset != stable.asset && stock.asset.code.length > 0 && stable.asset.code.length > 0,
            "Reference: Invalid assets");
        require(stock.maxAge > 0 && stable.maxAge > 0 && stock.maxAge <= 1 hours && stable.maxAge <= 1 hours,
            "Reference: Invalid age");
        require(stock.minPrice > 0 && stock.maxPrice > stock.minPrice && stable.minPrice > 0
            && stable.maxPrice > stable.minPrice, "Reference: Invalid bounds");
        require(deviationBps > 0 && deviationBps <= 1000, "Reference: Invalid deviation");
        publisher = signer;
        bindingHash = binding;
        collateral = stock.asset;
        debt = stable.asset;
        collateralMaxAge = stock.maxAge;
        debtMaxAge = stable.maxAge;
        collateralMin = stock.minPrice;
        collateralMax = stock.maxPrice;
        debtMin = stable.minPrice;
        debtMax = stable.maxPrice;
        maxDeviationBps = deviationBps;
    }

    function _validate(address asset, uint256 price, uint256 timestamp, uint256 age, uint256 minimum, uint256 maximum)
        private view
    {
        require(price >= minimum && price <= maximum, "Reference: Price out of bounds");
        require(timestamp > 0 && timestamp <= block.timestamp && block.timestamp - timestamp <= age,
            "Reference: Stale or future source");
        Observation memory old = observations[asset];
        require(timestamp >= old.sourceTimestamp, "Reference: Source regressed");
        if (old.price != 0) {
            require(timestamp > old.sourceTimestamp || price == old.price, "Reference: Conflicting source");
            uint256 delta = price > old.price ? price - old.price : old.price - price;
            // Divide before multiplying to keep arbitrary constructor bounds from overflowing.
            require(delta <= old.price / 10_000 * maxDeviationBps, "Reference: Deviation exceeded");
        }
    }

    function publish(uint256 stockPrice, uint256 stockTime, uint256 debtPrice, uint256 debtTime, bytes32 evidence)
        external
    {
        require(block.chainid == 46630 && msg.sender == publisher, "Reference: Publisher only on testnet");
        require(evidence != bytes32(0), "Reference: Missing evidence");
        _validate(collateral, stockPrice, stockTime, collateralMaxAge, collateralMin, collateralMax);
        _validate(debt, debtPrice, debtTime, debtMaxAge, debtMin, debtMax);
        require(stockTime > observations[collateral].sourceTimestamp || debtTime > observations[debt].sourceTimestamp,
            "Reference: Replayed report");
        observations[collateral] = Observation(stockPrice, stockTime);
        observations[debt] = Observation(debtPrice, debtTime);
        emit ReferencePublished(++round, evidence, stockPrice, stockTime, debtPrice, debtTime);
    }

    function getPrice(address asset) external view returns (uint256) {
        require(block.chainid == 46630, "Reference: RH testnet only");
        require(asset == collateral || asset == debt, "Reference: Unknown asset");
        Observation memory observation = observations[asset];
        uint256 maxAge = asset == collateral ? collateralMaxAge : debtMaxAge;
        require(observation.sourceTimestamp > 0 && observation.sourceTimestamp <= block.timestamp
            && block.timestamp - observation.sourceTimestamp <= maxAge, "Reference: Expired price");
        return observation.price;
    }
}
