// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/utils/math/Math.sol";
interface IBoundReference {
    function collateral() external view returns(address);
    function debt() external view returns(address);
    function bindingHash() external view returns(bytes32);
    function getPrice(address) external view returns(uint256);
}
/// @notice Testnet-only conservative short valuation derived from a reviewed bid/ask spread bound.
/// @dev The upstream binding rejects quotes whose spread exceeds spreadBps. Its stock bid is bounded
/// upward for debt, and its USDG ask downward for collateral. Upstream freshness is mandatory.
contract RhShortReferenceOracle {
    IBoundReference public immutable referenceOracle;
    address public immutable stock;
    address public immutable stable;
    uint256 public immutable spreadBps;
    constructor(address reference_,bytes32 binding,address stock_,address stable_,uint256 spread_) {
        require(block.chainid==46630,"ShortOracle: Testnet only");
        require(reference_.code.length>0&&spread_>0&&spread_<=100,"ShortOracle: Invalid policy");
        IBoundReference source=IBoundReference(reference_);
        require(source.bindingHash()==binding&&binding!=bytes32(0)&&source.collateral()==stock_&&source.debt()==stable_,"ShortOracle: Binding mismatch");
        referenceOracle=source;stock=stock_;stable=stable_;spreadBps=spread_;
    }
    function getPrice(address asset) external view returns(uint256) {
        require(block.chainid==46630,"ShortOracle: Testnet only");
        require(asset==stock||asset==stable,"ShortOracle: Unknown asset");
        uint256 price=referenceOracle.getPrice(asset);
        return asset==stock?Math.mulDiv(price,10000+spreadBps,10000,Math.Rounding.Ceil):Math.mulDiv(price,10000,10000+spreadBps);
    }
}
