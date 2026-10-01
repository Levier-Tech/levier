// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {LevierPair} from "../src/core/LevierPair.sol";
import {LevierMarketRegistry} from "../src/registry/LevierMarketRegistry.sol";
import {LevierRouter} from "../src/routers/LevierRouter.sol";
import "../src/libraries/LevierProxies.sol";

interface IVerifiedPriceSource {
    function getPrice(address asset) external view returns (uint256);
}

/// @notice Deploy one collateral-lending market using existing, independently verified testnet tokens and oracle.
/// @dev No token minting, synthetic prices, swaps, yield, or implicit network/address defaults.
contract DeployRhLending is Script {
    struct MarketInput {
        address collateral;
        address debt;
        address oracle;
        uint256 maxLtv;
        uint256 liquidationLtv;
        uint256 supplyCap;
        uint256 borrowCap;
        string slug;
    }

    function readInput(string memory json) internal view returns (MarketInput memory m) {
        m.collateral = vm.parseJsonAddress(json, ".collateralAddress");
        m.debt = vm.parseJsonAddress(json, ".debtAddress");
        m.oracle = vm.parseJsonAddress(json, ".oracleAddress");
        m.maxLtv = vm.parseJsonUint(json, ".maxLtvBps");
        m.liquidationLtv = vm.parseJsonUint(json, ".liquidationLtvBps");
        m.supplyCap = vm.parseJsonUint(json, ".supplyCapRaw");
        m.borrowCap = vm.parseJsonUint(json, ".borrowCapRaw");
        m.slug = vm.parseJsonString(json, ".slug");
        require(
            m.collateral != m.debt && m.collateral.code.length > 0 && m.debt.code.length > 0,
            "Deployment: Invalid assets"
        );
        require(
            m.oracle.code.length > 0 && m.oracle.codehash == vm.parseJsonBytes32(json, ".oracleRuntimeCodeHash"),
            "Deployment: Oracle identity mismatch"
        );
        require(
            keccak256(bytes(IERC20Metadata(m.collateral).symbol()))
                == keccak256(bytes(vm.parseJsonString(json, ".collateralSymbol"))),
            "Deployment: Collateral symbol mismatch"
        );
        require(
            keccak256(bytes(IERC20Metadata(m.debt).symbol()))
                == keccak256(bytes(vm.parseJsonString(json, ".debtSymbol"))),
            "Deployment: Debt symbol mismatch"
        );
        require(
            IERC20Metadata(m.collateral).decimals() == vm.parseJsonUint(json, ".collateralDecimals"),
            "Deployment: Collateral decimals mismatch"
        );
        require(
            IERC20Metadata(m.debt).decimals() == vm.parseJsonUint(json, ".debtDecimals"),
            "Deployment: Debt decimals mismatch"
        );
        require(
            IVerifiedPriceSource(m.oracle).getPrice(m.collateral) > 0
                && IVerifiedPriceSource(m.oracle).getPrice(m.debt) > 0,
            "Deployment: Missing verified prices"
        );
        require(
            m.maxLtv > 0 && m.maxLtv < m.liquidationLtv && m.liquidationLtv < 10_000,
            "Deployment: Invalid risk parameters"
        );
        require(m.supplyCap > 0 && m.borrowCap > 0 && bytes(m.slug).length > 0, "Deployment: Missing market limits");
    }

    function validateEnvironment(string memory mode, uint256 expectedChain, bool tradingEnabled) internal view {
        require(keccak256(bytes(mode)) == keccak256("TESTNET"), "Deployment: TESTNET only");
        // Safety restriction on the release, not a fallback for missing CHAIN_ID.
        require(block.chainid == expectedChain && block.chainid == 46630, "Deployment: Wrong chain");
        require(!tradingEnabled, "Deployment: Disable application execution first");
    }

    function run() external {
        validateEnvironment(vm.envString("NETWORK_MODE"), vm.envUint("CHAIN_ID"), vm.envBool("TRADING_ENABLED"));
        uint256 key = vm.envUint("PRIVATE_KEY");
        address admin = vm.envAddress("DEPLOYER_ADDRESS");
        require(vm.addr(key) == admin, "Deployment: Signer mismatch");
        MarketInput memory m = readInput(vm.envString("RH_LENDING_MARKET_JSON"));
        bytes32 marketId = keccak256(abi.encodePacked(m.slug, m.collateral, m.debt));
        vm.startBroadcast(key);
        LevierMarketRegistry registry = LevierProxies.registry(admin);
        LevierPair pair = LevierProxies.pair(marketId, m.collateral, m.debt, m.oracle, address(registry), admin);
        LevierRouter router = LevierProxies.lendingRouter(admin);
        registry.addMarket(
            m.slug,
            m.collateral,
            m.debt,
            address(pair),
            m.oracle,
            LevierMarketRegistry.RiskTier.Experimental,
            m.maxLtv,
            m.liquidationLtv,
            10_000,
            m.supplyCap,
            m.borrowCap
        );
        registry.setAuthorizedRouter(address(router), true);
        // Remain paused until deployment identity, indexing and funding have been verified.
        registry.setMarketStatus(marketId, LevierMarketRegistry.MarketStatus.PAUSED);
        vm.stopBroadcast();
    }
}
