// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title LevierMarketRegistry
 * @notice Central registry for isolated credit & leverage pairs.
 * @dev Stores market risk tiers (Tier A, Tier B, Tier C, Experimental) and economic bounds.
 */
interface IRegisteredPair {
    function marketId() external view returns (bytes32);
    function collateralToken() external view returns (address);
    function debtToken() external view returns (address);
    function oracle() external view returns (address);
    function registry() external view returns (address);
}

/// @dev Deployed behind an ERC1967 UUPS proxy; the proxy address is the stable registry address.
contract LevierMarketRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    enum RiskTier {
        TierA,
        TierB,
        TierC,
        Experimental
    }
    enum MarketStatus {
        NORMAL,
        REDUCE_ONLY,
        PAUSED
    }

    struct MarketConfig {
        bytes32 marketId;
        string slug;
        address collateralToken;
        address debtToken;
        address pairAddress;
        address oracle;
        RiskTier riskTier;
        MarketStatus status;
        uint256 maxLtvBps; // e.g., 6000 for 60%
        uint256 liquidationLtvBps; // e.g., 7000 for 70%
        uint256 maxLeverageBps; // e.g., 25000 for 2.5x (basis 10000 = 1x)
        uint256 supplyCap;
        uint256 borrowCap;
    }

    // Mapping from marketId => MarketConfig
    mapping(bytes32 => MarketConfig) public markets;
    bytes32[] public allMarketIds;

    // Authorized protocol execution routers (LeverageRouter, ShortRouter)
    mapping(address => bool) public isAuthorizedRouter;

    event MarketAdded(bytes32 indexed marketId, string slug, address pairAddress, RiskTier riskTier);
    event MarketStatusUpdated(bytes32 indexed marketId, MarketStatus newStatus);
    event MarketRiskTierUpdated(
        bytes32 indexed marketId, RiskTier newTier, uint256 maxLtvBps, uint256 liquidationLtvBps, uint256 maxLeverageBps
    );
    event MarketCapsUpdated(bytes32 indexed marketId, uint256 supplyCap, uint256 borrowCap);
    event RouterAuthorized(address indexed router, bool status);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Only the owner can move this proxy to a new implementation.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
    }

    function setAuthorizedRouter(address router, bool status) external onlyOwner {
        require(router != address(0), "Registry: Invalid router address");
        if (status) require(router.code.length > 0, "Registry: Router must be a contract");
        isAuthorizedRouter[router] = status;
        emit RouterAuthorized(router, status);
    }

    /**
     * @notice Register a new isolated lending pair.
     */
    function addMarket(
        string memory slug,
        address collateralToken,
        address debtToken,
        address pairAddress,
        address oracle,
        RiskTier riskTier,
        uint256 maxLtvBps,
        uint256 liquidationLtvBps,
        uint256 maxLeverageBps,
        uint256 supplyCap,
        uint256 borrowCap
    ) external onlyOwner returns (bytes32 marketId) {
        require(collateralToken != address(0), "Registry: Invalid collateral token");
        require(debtToken != address(0), "Registry: Invalid debt token");
        require(pairAddress != address(0), "Registry: Invalid pair address");
        require(maxLtvBps < liquidationLtvBps, "Registry: Max LTV must be lower than Liquidation LTV");
        require(liquidationLtvBps <= 10_000, "Registry: Liquidation LTV cannot exceed 100%");
        require(maxLeverageBps >= 10_000, "Registry: Invalid leverage");

        marketId = keccak256(abi.encodePacked(slug, collateralToken, debtToken));
        require(markets[marketId].pairAddress == address(0), "Registry: Market already exists");
        require(
            bytes(slug).length > 0 && pairAddress.code.length > 0 && oracle.code.length > 0,
            "Registry: Invalid market contracts"
        );
        IRegisteredPair pair = IRegisteredPair(pairAddress);
        require(
            pair.marketId() == marketId && pair.collateralToken() == collateralToken && pair.debtToken() == debtToken
                && pair.oracle() == oracle && pair.registry() == address(this),
            "Registry: Pair identity mismatch"
        );

        markets[marketId] = MarketConfig({
            marketId: marketId,
            slug: slug,
            collateralToken: collateralToken,
            debtToken: debtToken,
            pairAddress: pairAddress,
            oracle: oracle,
            riskTier: riskTier,
            status: MarketStatus.NORMAL,
            maxLtvBps: maxLtvBps,
            liquidationLtvBps: liquidationLtvBps,
            maxLeverageBps: maxLeverageBps,
            supplyCap: supplyCap,
            borrowCap: borrowCap
        });

        allMarketIds.push(marketId);
        emit MarketAdded(marketId, slug, pairAddress, riskTier);
    }

    function setMarketStatus(bytes32 marketId, MarketStatus newStatus) external onlyOwner {
        require(markets[marketId].pairAddress != address(0), "Registry: Market does not exist");
        markets[marketId].status = newStatus;
        emit MarketStatusUpdated(marketId, newStatus);
    }

    function updateRiskTier(
        bytes32 marketId,
        RiskTier newTier,
        uint256 maxLtvBps,
        uint256 liquidationLtvBps,
        uint256 maxLeverageBps
    ) external onlyOwner {
        require(markets[marketId].pairAddress != address(0), "Registry: Market does not exist");
        require(maxLtvBps < liquidationLtvBps, "Registry: Max LTV must be lower than Liquidation LTV");
        require(liquidationLtvBps <= 10_000, "Registry: Liquidation LTV cannot exceed 100%");
        require(maxLeverageBps >= 10_000, "Registry: Invalid leverage");

        MarketConfig storage m = markets[marketId];
        m.riskTier = newTier;
        m.maxLtvBps = maxLtvBps;
        m.liquidationLtvBps = liquidationLtvBps;
        m.maxLeverageBps = maxLeverageBps;

        emit MarketRiskTierUpdated(marketId, newTier, maxLtvBps, liquidationLtvBps, maxLeverageBps);
    }

    function updateCaps(bytes32 marketId, uint256 supplyCap, uint256 borrowCap) external onlyOwner {
        require(markets[marketId].pairAddress != address(0), "Registry: Market does not exist");
        markets[marketId].supplyCap = supplyCap;
        markets[marketId].borrowCap = borrowCap;
        emit MarketCapsUpdated(marketId, supplyCap, borrowCap);
    }

    function getMarket(bytes32 marketId) external view returns (MarketConfig memory) {
        require(markets[marketId].pairAddress != address(0), "Registry: Market does not exist");
        return markets[marketId];
    }

    function getMarketCount() external view returns (uint256) {
        return allMarketIds.length;
    }
}
