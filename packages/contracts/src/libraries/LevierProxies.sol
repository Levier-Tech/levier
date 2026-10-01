// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LevierMarketRegistry} from "../registry/LevierMarketRegistry.sol";
import {LevierPair} from "../core/LevierPair.sol";
import {LevierRouter} from "../routers/LevierRouter.sol";
import {LeverageRouter} from "../routers/LeverageRouter.sol";
import {ShortRouter} from "../routers/ShortRouter.sol";
import {AutoProtectModule} from "../modules/AutoProtectModule.sol";
import {LevierVault} from "../vaults/LevierVault.sol";
import {VerifiedFeedOracle} from "../oracle/VerifiedFeedOracle.sol";
import {MarginRouter} from "../trading/MarginRouter.sol";

/// @title LevierProxies
/// @notice Deploys each Levier contract as an implementation plus an ERC1967 UUPS proxy that is
/// initialized in the same transaction, so no proxy is ever left uninitialized.
/// @dev The `*At` variants take an existing implementation, letting several proxies share one.
library LevierProxies {
    function _proxy(address implementation, bytes memory init) private returns (address) {
        return address(new ERC1967Proxy(implementation, init));
    }

    function registry(address owner) internal returns (LevierMarketRegistry) {
        return LevierMarketRegistry(
            _proxy(address(new LevierMarketRegistry()), abi.encodeCall(LevierMarketRegistry.initialize, (owner)))
        );
    }

    function lendingRouter(address owner) internal returns (LevierRouter) {
        return LevierRouter(_proxy(address(new LevierRouter()), abi.encodeCall(LevierRouter.initialize, (owner))));
    }

    function leverageRouter(address owner) internal returns (LeverageRouter) {
        return LeverageRouter(_proxy(address(new LeverageRouter()), abi.encodeCall(LeverageRouter.initialize, (owner))));
    }

    function shortRouter(address owner) internal returns (ShortRouter) {
        return ShortRouter(_proxy(address(new ShortRouter()), abi.encodeCall(ShortRouter.initialize, (owner))));
    }

    function autoProtect(address owner) internal returns (AutoProtectModule) {
        return AutoProtectModule(
            _proxy(address(new AutoProtectModule()), abi.encodeCall(AutoProtectModule.initialize, (owner)))
        );
    }

    function vault(
        IERC20 asset,
        string memory name,
        string memory symbol,
        string memory slug,
        string memory riskTier,
        address owner
    ) internal returns (LevierVault) {
        return LevierVault(
            _proxy(
                address(new LevierVault()),
                abi.encodeCall(LevierVault.initialize, (asset, name, symbol, slug, riskTier, owner))
            )
        );
    }

    function oracle(
        address owner,
        uint256 expectedChainId,
        address sequencer,
        uint256 gracePeriod,
        VerifiedFeedOracle.FeedInput[] memory inputs
    ) internal returns (VerifiedFeedOracle) {
        return oracleAt(address(new VerifiedFeedOracle()), owner, expectedChainId, sequencer, gracePeriod, inputs);
    }

    function oracleAt(
        address implementation,
        address owner,
        uint256 expectedChainId,
        address sequencer,
        uint256 gracePeriod,
        VerifiedFeedOracle.FeedInput[] memory inputs
    ) internal returns (VerifiedFeedOracle) {
        return VerifiedFeedOracle(
            _proxy(
                implementation,
                abi.encodeCall(VerifiedFeedOracle.initialize, (owner, expectedChainId, sequencer, gracePeriod, inputs))
            )
        );
    }

    function pair(
        bytes32 marketId,
        address collateral,
        address debt,
        address priceOracle,
        address marketRegistry,
        address owner
    ) internal returns (LevierPair) {
        return pairAt(address(new LevierPair()), marketId, collateral, debt, priceOracle, marketRegistry, owner);
    }

    function pairAt(
        address implementation,
        bytes32 marketId,
        address collateral,
        address debt,
        address priceOracle,
        address marketRegistry,
        address owner
    ) internal returns (LevierPair) {
        return LevierPair(
            _proxy(
                implementation,
                abi.encodeCall(
                    LevierPair.initialize, (marketId, collateral, debt, priceOracle, marketRegistry, owner)
                )
            )
        );
    }

    function marginRouter(
        address stock,
        address stable,
        address longPair,
        address shortPair,
        address pool,
        address owner
    ) internal returns (MarginRouter) {
        return MarginRouter(
            _proxy(
                address(new MarginRouter()),
                abi.encodeCall(MarginRouter.initialize, (stock, stable, longPair, shortPair, pool, owner))
            )
        );
    }
}
