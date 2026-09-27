// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RhTestnetReferenceOracle} from "../src/oracle/RhTestnetReferenceOracle.sol";
import {RhShortReferenceOracle} from "../src/trading/RhShortReferenceOracle.sol";
import {MarginRouter} from "../src/trading/MarginRouter.sol";
import {LeveraPair} from "../src/core/LeveraPair.sol";
import {LeveraMarketRegistry} from "../src/registry/LeveraMarketRegistry.sol";

interface IExpansionFactory {
    function getPair(address, address) external view returns (address);
    function createPair(address, address) external returns (address);
}

interface IFaucetMetadata {
    function uid() external view returns (bytes32);
    function uiMultiplier() external view returns (uint256);
}

/// @notice Dry-run transaction construction against actual testnet state and source observations.
/// @dev The wrapper passes public sender addresses, never keys, and never enables --broadcast.
///      No mint, balance override, fabricated price, timestamp override or application gate change.
contract PrepareRhExpansion is Script {
    string private input;
    address private owner;
    address private publisher;
    address private stable;
    LeveraMarketRegistry private registry;
    IExpansionFactory private factory;

    function u(string memory path) private view returns (uint256) {
        return vm.parseJsonUint(input, path);
    }

    function a(string memory path) private view returns (address) {
        return vm.parseJsonAddress(input, path);
    }

    function b(string memory path) private view returns (bytes32) {
        return vm.parseJsonBytes32(input, path);
    }

    function s(string memory path) private view returns (string memory) {
        return vm.parseJsonString(input, path);
    }

    function run() external {
        input = vm.envString("RH_EXPANSION_DRAFT_JSON");
        require(
            block.chainid == 46630 && u(".chainId") == block.chainid && u(".version") == 1, "Expansion: Testnet only"
        );
        require(keccak256(bytes(s(".mode"))) == keccak256("PREPARATION_ONLY"), "Expansion: Preparation only");
        owner = a(".owner");
        publisher = a(".publisher");
        stable = a(".stable");
        registry = LeveraMarketRegistry(a(".registry"));
        factory = IExpansionFactory(a(".factory"));
        require(
            address(registry).codehash == b(".registryCodeHash") && registry.owner() == owner,
            "Expansion: Registry identity"
        );
        require(
            address(factory).codehash == b(".factoryCodeHash") && stable.codehash == b(".stableCodeHash"),
            "Expansion: Infrastructure identity"
        );
        require(IERC20Metadata(stable).decimals() == 6, "Expansion: Stable decimals");
        require(owner != publisher && owner != address(0) && publisher != address(0), "Expansion: Signers");
        uint256 count = u(".marketCount");
        require(count == 4, "Expansion: Four pending markets required");
        for (uint256 i; i < count; i++) {
            market(string.concat(".markets[", vm.toString(i), "]"));
        }
    }

    function market(string memory p) private {
        address stock = a(string.concat(p, ".stock"));
        require(
            stock.codehash == b(string.concat(p, ".stockCodeHash")) && IERC20Metadata(stock).decimals() == 18,
            "Expansion: Stock identity"
        );
        require(
            IFaucetMetadata(stock).uid() == b(string.concat(p, ".uid"))
                && IFaucetMetadata(stock).uiMultiplier() == u(string.concat(p, ".multiplier18")),
            "Expansion: Stock metadata"
        );
        bytes32 binding = b(string.concat(p, ".bindingHash"));
        string memory longSlug = s(string.concat(p, ".longSlug"));
        string memory shortSlug = s(string.concat(p, ".shortSlug"));
        bytes32 longId = keccak256(abi.encodePacked(longSlug, stock, stable));
        bytes32 shortId = keccak256(abi.encodePacked(shortSlug, stable, stock));
        vm.startBroadcast(owner);
        RhTestnetReferenceOracle source = new RhTestnetReferenceOracle(
            publisher,
            binding,
            RhTestnetReferenceOracle.Policy(
                stock,
                u(string.concat(p, ".binding.stockMaxAgeSeconds")),
                u(string.concat(p, ".binding.stockMin18")),
                u(string.concat(p, ".binding.stockMax18"))
            ),
            RhTestnetReferenceOracle.Policy(
                stable,
                u(string.concat(p, ".binding.debtMaxAgeSeconds")),
                u(string.concat(p, ".binding.debtMin18")),
                u(string.concat(p, ".binding.debtMax18"))
            ),
            u(string.concat(p, ".binding.maxDeviationBps"))
        );
        LeveraPair longPair = new LeveraPair(longId, stock, stable, address(source), address(registry), owner);
        RhShortReferenceOracle reverse = new RhShortReferenceOracle(
            address(source), binding, stock, stable, u(string.concat(p, ".binding.maxSpreadBps"))
        );
        LeveraPair shortPair = new LeveraPair(shortId, stable, stock, address(reverse), address(registry), owner);
        registerPair(longSlug, longPair, string.concat(p, ".longRisk"));
        registerPair(shortSlug, shortPair, string.concat(p, ".shortRisk"));
        require(factory.getPair(stock, stable) == address(0), "Expansion: Pool already exists; reconcile");
        address pool = factory.createPair(stock, stable);
        require(pool.codehash == b(".poolCodeHash"), "Expansion: Pool code");
        MarginRouter router = new MarginRouter(stock, stable, address(longPair), address(shortPair), pool, owner);
        require(router.isPaused(), "Expansion: Initial router open");
        uint256 seedStock = u(string.concat(p, ".seedStockRaw"));
        uint256 seedStable = u(string.concat(p, ".seedStableRaw"));
        require(seedStock <= u(string.concat(p, ".proposedMaxSeedStockRaw")), "Expansion: Seed budget");
        uint256 deadline = block.timestamp + u(".deadlineSeconds");
        require(IERC20Metadata(stock).approve(address(router), seedStock), "Expansion: Stock approval");
        require(IERC20Metadata(stable).approve(address(router), seedStable), "Expansion: Stable approval");
        router.seedLiquidity(seedStock, seedStable, u(string.concat(p, ".minLiquidityRaw")), deadline);
        require(
            IERC20Metadata(stable).transfer(address(longPair), u(string.concat(p, ".longLiquidityRaw"))),
            "Expansion: Long funding"
        );
        require(
            IERC20Metadata(stock).transfer(address(shortPair), u(string.concat(p, ".shortLiquidityRaw"))),
            "Expansion: Short funding"
        );
        registry.setAuthorizedRouter(address(router), true);
        vm.stopBroadcast();
        vm.startBroadcast(publisher);
        source.publish(
            u(string.concat(p, ".reference.collateralPrice18")),
            u(string.concat(p, ".reference.collateralTimestamp")),
            u(string.concat(p, ".reference.debtPrice18")),
            u(string.concat(p, ".reference.debtTimestamp")),
            b(string.concat(p, ".evidenceHash"))
        );
        vm.stopBroadcast();
        vm.startBroadcast(owner);
        registry.setMarketStatus(longId, LeveraMarketRegistry.MarketStatus.NORMAL);
        registry.setMarketStatus(shortId, LeveraMarketRegistry.MarketStatus.NORMAL);
        router.setPaused(false);
        directLending(longPair, p);
        roundTrip(router, longPair, false, p);
        roundTrip(router, shortPair, true, p);
        router.setPaused(true);
        registry.setMarketStatus(longId, LeveraMarketRegistry.MarketStatus.PAUSED);
        registry.setMarketStatus(shortId, LeveraMarketRegistry.MarketStatus.PAUSED);
        vm.stopBroadcast();
        require(
            router.isPaused() && registry.getMarket(longId).status == LeveraMarketRegistry.MarketStatus.PAUSED
                && registry.getMarket(shortId).status == LeveraMarketRegistry.MarketStatus.PAUSED,
            "Expansion: Final state must be closed"
        );
        (uint256 stockReserve, uint256 stableReserve) = router.reserves();
        require(stockReserve > 0 && stableReserve > 0, "Expansion: Missing reserves");
        require(
            IERC20Metadata(stock).balanceOf(address(router)) == 0
                && IERC20Metadata(stable).balanceOf(address(router)) == 0,
            "Expansion: Router dust"
        );
        require(
            IERC20Metadata(stock).allowance(address(router), address(longPair)) == 0
                && IERC20Metadata(stable).allowance(address(router), address(shortPair)) == 0,
            "Expansion: Router allowance"
        );
    }

    function registerPair(string memory slug, LeveraPair pair, string memory risk) private {
        registry.addMarket(
            slug,
            address(pair.collateralToken()),
            address(pair.debtToken()),
            address(pair),
            address(pair.oracle()),
            LeveraMarketRegistry.RiskTier.Experimental,
            0,
            u(string.concat(risk, ".liquidationLtvBps")),
            u(string.concat(risk, ".maxLeverageBps")),
            u(string.concat(risk, ".supplyCapRaw")),
            u(string.concat(risk, ".borrowCapRaw"))
        );
        registry.setMarketStatus(pair.marketId(), LeveraMarketRegistry.MarketStatus.PAUSED);
        registry.updateRiskTier(
            pair.marketId(),
            LeveraMarketRegistry.RiskTier.Experimental,
            u(string.concat(risk, ".maxLtvBps")),
            u(string.concat(risk, ".liquidationLtvBps")),
            u(string.concat(risk, ".maxLeverageBps"))
        );
    }

    function directLending(LeveraPair pair, string memory p) private {
        uint256 collateral = u(string.concat(p, ".acceptanceCollateralRaw"));
        uint256 debt = u(".acceptanceDebtRaw");
        uint256 stockBefore = pair.collateralToken().balanceOf(owner);
        uint256 stableBefore = pair.debtToken().balanceOf(owner);
        require(pair.collateralToken().approve(address(pair), collateral), "Expansion: Collateral approval");
        pair.depositCollateral(collateral);
        pair.borrow(debt);
        require(pair.debtToken().approve(address(pair), debt), "Expansion: Repay approval");
        pair.repay(debt);
        pair.withdrawCollateral(collateral);
        require(
            pair.collateralToken().balanceOf(owner) == stockBefore && pair.debtToken().balanceOf(owner) == stableBefore,
            "Expansion: Lending balance mismatch"
        );
        (uint256 c, uint256 d) = pair.accounts(owner);
        require(c == 0 && d == 0, "Expansion: Lending debt remains");
    }

    function roundTrip(MarginRouter router, LeveraPair pair, bool isShort, string memory p) private {
        uint256 margin = u(".acceptanceMarginRaw");
        uint256 debt;
        if (isShort) {
            debt = Math.mulDiv(
                margin * 1e12,
                u(string.concat(p, ".reference.debtPrice18")) * u(".shortExposureBps"),
                u(string.concat(p, ".reference.collateralPrice18")) * 10000
            );
        } else {
            debt = margin * (u(".longLeverageBps") - 10000) / 10000;
        }
        uint256 output = router.quoteExactInput(isShort, isShort ? debt : margin + debt);
        uint256 collateral = isShort ? margin + output : output;
        uint256 minCollateral = collateral * (10000 - u(".slippageBps")) / 10000;
        uint256 deadline = block.timestamp + u(".deadlineSeconds");
        uint256 stockBefore = router.stock().balanceOf(owner);
        require(router.stable().approve(address(router), margin), "Expansion: Margin approval");
        pair.setOperator(address(router), true);
        router.open(isShort, margin, debt, minCollateral, deadline);
        (uint256 c, uint256 d) = pair.accounts(owner);
        require(c >= minCollateral && d == debt, "Expansion: Open mismatch");
        uint256 minOut = router.quoteClose(isShort, owner) * (10000 - u(".slippageBps")) / 10000;
        router.close(isShort, minOut, deadline);
        pair.setOperator(address(router), false);
        (c, d) = pair.accounts(owner);
        require(c == 0 && d == 0, "Expansion: Close mismatch");
        require(router.stock().balanceOf(owner) == stockBefore, "Expansion: User stock changed");
    }
}
