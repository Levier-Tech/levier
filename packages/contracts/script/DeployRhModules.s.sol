// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {LevierMarketRegistry} from "../src/registry/LevierMarketRegistry.sol";
import {LeverageRouter} from "../src/routers/LeverageRouter.sol";
import {ShortRouter} from "../src/routers/ShortRouter.sol";
import {LevierVault, IERC20} from "../src/vaults/LevierVault.sol";
import {AutoProtectModule} from "../src/modules/AutoProtectModule.sol";
import "../src/libraries/LevierProxies.sol";

/// @notice Simulate the development modules against existing RH-testnet infrastructure.
/// @dev Does not create replacement assets, seed liquidity, publish prices, or authorize incomplete routers.
///      Live broadcasting is handled by the receipt-journalled rh-live.mjs entrypoint.
contract DeployRhModules is Script {
    function validateEnvironment(string memory mode, uint256 chain, bool trading, bool lending) public view {
        require(keccak256(bytes(mode)) == keccak256("TESTNET") && block.chainid == 46630 && chain == block.chainid,
            "Modules: RH testnet only");
        require(!trading && !lending, "Modules: Disable application execution");
    }

    function run() external {
        validateEnvironment(vm.envString("NETWORK_MODE"), vm.envUint("CHAIN_ID"),
            vm.envBool("TRADING_ENABLED"), vm.envBool("LENDING_ENABLED"));
        uint256 key = vm.envUint("PRIVATE_KEY");
        address admin = vm.envAddress("DEPLOYER_ADDRESS");
        require(vm.addr(key) == admin, "Modules: Signer mismatch");
        string memory json = vm.envString("RH_MODULES_CONFIG_JSON");
        address registry = vm.parseJsonAddress(json, ".registry");
        address router = vm.parseJsonAddress(json, ".lendingRouter");
        address debt = vm.parseJsonAddress(json, ".debt");
        require(registry.code.length > 0 && registry.codehash == vm.parseJsonBytes32(json, ".registryCodeHash"),
            "Modules: Registry identity mismatch");
        require(router.code.length > 0 && router.codehash == vm.parseJsonBytes32(json, ".lendingRouterCodeHash"),
            "Modules: Router identity mismatch");
        require(LevierMarketRegistry(registry).owner() == admin
            && LevierMarketRegistry(registry).isAuthorizedRouter(router), "Modules: Base configuration mismatch");
        require(debt.code.length > 0 && debt.codehash == vm.parseJsonBytes32(json, ".debtCodeHash")
            && debt == vm.envAddress("USDG_ISSUER_TESTNET_ADDRESS"), "Modules: Debt identity mismatch");
        require(IERC20Metadata(debt).decimals() == 6
            && keccak256(bytes(IERC20Metadata(debt).symbol())) == keccak256("USDG"), "Modules: Wrong debt units");

        string memory name = vm.parseJsonString(json, ".vaultName");
        string memory symbol = vm.parseJsonString(json, ".vaultSymbol");
        string memory slug = vm.parseJsonString(json, ".vaultSlug");
        string memory tier = vm.parseJsonString(json, ".vaultRiskTier");
        require(bytes(name).length > 0 && bytes(symbol).length > 0 && bytes(slug).length > 0 && bytes(tier).length > 0,
            "Modules: Missing vault metadata");
        vm.startBroadcast(key);
        LeverageRouter longRouter = LevierProxies.leverageRouter(admin);
        ShortRouter shortRouter = LevierProxies.shortRouter(admin);
        AutoProtectModule protect = LevierProxies.autoProtect(admin);
        LevierVault vault = LevierProxies.vault(IERC20(debt), name, symbol, slug, tier, admin);
        vm.stopBroadcast();

        require(longRouter.isPaused() && shortRouter.isPaused() && protect.isPaused(), "Modules: Execution open");
        require(vault.depositsPaused() && vault.maxDeposit(admin) == 0 && vault.maxMint(admin) == 0,
            "Modules: Vault deposits open");
        require(vault.totalAssets() == 0 && vault.totalSupply() == 0 && vault.getAllocationsCount() == 0,
            "Modules: Unexpected vault funds or allocation");
        require(!LevierMarketRegistry(registry).isAuthorizedRouter(address(longRouter))
            && !LevierMarketRegistry(registry).isAuthorizedRouter(address(shortRouter)), "Modules: Router authorized");
    }
}
