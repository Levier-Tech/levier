// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/tokens/TestnetERC20.sol";
import "../src/oracle/CompositeSanityOracle.sol";
import "../src/registry/LevierMarketRegistry.sol";
import "../src/core/LevierPair.sol";
import "../src/vaults/LevierVault.sol";
import "../src/routers/LevierRouter.sol";
import "../src/routers/LeverageRouter.sol";
import "../src/routers/ShortRouter.sol";
import "../src/modules/AutoProtectModule.sol";

contract DeployLevier is Script {
    function run() external {
        require(block.chainid == 31337, "Legacy deployment: local fixtures only");
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=================================================");
        console.log("STARTING LEVIER PROTOCOL PHASE 3 DEPLOYMENT");
        console.log("Deployer Address:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("=================================================");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Testnet Tokens
        TestnetERC20 usdg = new TestnetERC20("Global Dollar", "USDG", 18, 50_000_000e18, deployer);
        TestnetERC20 nvda = new TestnetERC20("NVIDIA Token", "NVDA", 18, 1_000_000e18, deployer);
        TestnetERC20 aapl = new TestnetERC20("Apple Token", "AAPL", 18, 1_000_000e18, deployer);
        TestnetERC20 tsla = new TestnetERC20("Tesla Token", "TSLA", 18, 1_000_000e18, deployer);
        TestnetERC20 spy = new TestnetERC20("SPDR S&P 500 Token", "SPY", 18, 1_000_000e18, deployer);

        // 2. Deploy Oracle and configure initial mark prices
        CompositeSanityOracle oracle = new CompositeSanityOracle(deployer);
        oracle.setPrice(address(usdg), 1e18);
        oracle.setPrice(address(nvda), 250e18);
        oracle.setPrice(address(aapl), 23050e16); // $230.50
        oracle.setPrice(address(tsla), 21580e16); // $215.80
        oracle.setPrice(address(spy), 56020e16);  // $560.20

        // 3. Deploy Market Registry
        LevierMarketRegistry registry = new LevierMarketRegistry(deployer);

        // 4. Deploy Isolated Pairs
        bytes32 nvdaMarketId = keccak256(abi.encodePacked("nvda-usdg-testnet", address(nvda), address(usdg)));
        LevierPair pairNvda = new LevierPair(nvdaMarketId, address(nvda), address(usdg), address(oracle), address(registry), deployer);
        registry.addMarket("nvda-usdg-testnet", address(nvda), address(usdg), address(pairNvda), address(oracle), LevierMarketRegistry.RiskTier.TierA, 6000, 7000, 25000, 5_000_000e18, 3_000_000e18);

        bytes32 aaplMarketId = keccak256(abi.encodePacked("aapl-usdg-testnet", address(aapl), address(usdg)));
        LevierPair pairAapl = new LevierPair(aaplMarketId, address(aapl), address(usdg), address(oracle), address(registry), deployer);
        registry.addMarket("aapl-usdg-testnet", address(aapl), address(usdg), address(pairAapl), address(oracle), LevierMarketRegistry.RiskTier.TierA, 6000, 7000, 25000, 5_000_000e18, 3_000_000e18);

        bytes32 tslaMarketId = keccak256(abi.encodePacked("tsla-usdg-testnet", address(tsla), address(usdg)));
        LevierPair pairTsla = new LevierPair(tslaMarketId, address(tsla), address(usdg), address(oracle), address(registry), deployer);
        registry.addMarket("tsla-usdg-testnet", address(tsla), address(usdg), address(pairTsla), address(oracle), LevierMarketRegistry.RiskTier.TierB, 5000, 6000, 20000, 3_000_000e18, 1_500_000e18);

        bytes32 spyMarketId = keccak256(abi.encodePacked("spy-usdg-testnet", address(spy), address(usdg)));
        LevierPair pairSpy = new LevierPair(spyMarketId, address(spy), address(usdg), address(oracle), address(registry), deployer);
        registry.addMarket("spy-usdg-testnet", address(spy), address(usdg), address(pairSpy), address(oracle), LevierMarketRegistry.RiskTier.TierA, 7000, 8000, 25000, 10_000_000e18, 6_000_000e18);

        // 5. Deploy Yield Vault (ERC-4626)
        LevierVault vaultUsdg = new LevierVault(
            IERC20(address(usdg)),
            "Levier USDG Yield Vault",
            "lvUSDG",
            "levier-usdg-vault-testnet",
            "Conservative",
            deployer
        );

        // 6. Deploy Routers and Safety Modules
        LevierRouter router = new LevierRouter();
        LeverageRouter leverageRouter = new LeverageRouter(deployer);
        ShortRouter shortRouter = new ShortRouter(deployer);
        AutoProtectModule autoProtect = new AutoProtectModule(deployer);

        vm.stopBroadcast();

        console.log("DEPLOYMENT COMPLETED SUCCESSFULLY");
        console.log("USDG Token:", address(usdg));
        console.log("NVDA Token:", address(nvda));
        console.log("Composite Oracle:", address(oracle));
        console.log("Market Registry:", address(registry));
        console.log("NVDA Pair:", address(pairNvda));
        console.log("USDG Yield Vault:", address(vaultUsdg));
        console.log("Levier Router:", address(router));
        console.log("Leverage Router:", address(leverageRouter));
        console.log("AutoProtect Module:", address(autoProtect));
    }
}
