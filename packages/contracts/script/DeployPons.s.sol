// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/tokens/TestnetERC20.sol";
import "../src/oracle/CompositeSanityOracle.sol";
import "../src/oracle/PonsOracleRouter.sol";
import "../src/pons/PonsMarketAdapter.sol";
import "../src/pons/PonsLeverageRegistry.sol";
import "../src/pons/PonsRiskEngine.sol";
import "../src/trading/LeveragePositionManager.sol";
import "../src/modules/PonsAutoProtectModule.sol";

contract DeployPons is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=================================================");
        console.log("STARTING PONS LEVERAGE MODULE DEPLOYMENT");
        console.log("Deployer Address:", deployer);
        console.log("=================================================");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Testnet Tokens
        TestnetERC20 usdg = new TestnetERC20("Global Dollar", "USDG", 18, 50_000_000e18, deployer);
        TestnetERC20 pmeme = new TestnetERC20("Pons Meme Token", "PMEME", 18, 1_000_000e18, deployer);
        TestnetERC20 pgov = new TestnetERC20("Pons Governance", "PGOV", 18, 1_000_000e18, deployer);

        // 2. Deploy Base Oracle
        CompositeSanityOracle baseOracle = new CompositeSanityOracle(deployer);
        baseOracle.setPrice(address(usdg), 1e18); // $1.00
        baseOracle.setPrice(address(pmeme), 125e16); // $1.25
        baseOracle.setPrice(address(pgov), 310e16);  // $3.10

        // 3. Deploy PonsOracleRouter
        // Using address(0) for dexTwapOracle for now to disable TWAP checks in tests, or we can use a mock
        PonsOracleRouter oracleRouter = new PonsOracleRouter(address(baseOracle), address(0), deployer);
        
        // Configure Asset Oracles
        // PMEME: enable twap validation (if dex oracle was present), max deviation 5%
        oracleRouter.setAssetConfig(address(pmeme), 300, 500, false);
        oracleRouter.setAssetConfig(address(pgov), 300, 500, false);

        // 4. Deploy PonsMarketAdapter
        PonsMarketAdapter adapter = new PonsMarketAdapter(
            address(0), // No bonding curve for local testnet
            50_000e18,  // minLiquidity
            10_000e18,  // minVolume
            100_000e18, // minMarketCap
            deployer
        );

        // Manually mark assets as graduated and eligible
        adapter.setManualGraduated(address(pmeme), true);
        adapter.setManualEligible(address(pmeme), true);
        adapter.setManualGraduated(address(pgov), true);
        adapter.setManualEligible(address(pgov), true);

        // 5. Deploy PonsLeverageRegistry
        PonsLeverageRegistry registry = new PonsLeverageRegistry(address(adapter), deployer);

        // Register PMEME
        registry.registerAsset(
            address(pmeme),
            PonsLeverageRegistry.PonsRiskConfig({
                maxLeverage: 100_000, // 10x
                maintenanceMarginBps: 500, // 5%
                liquidationThresholdBps: 200, // 2%
                maxPositionSize: 100_000e18,
                enabled: true
            })
        );

        // Register PGOV
        registry.registerAsset(
            address(pgov),
            PonsLeverageRegistry.PonsRiskConfig({
                maxLeverage: 50_000, // 5x
                maintenanceMarginBps: 1000, // 10%
                liquidationThresholdBps: 500, // 5%
                maxPositionSize: 50_000e18,
                enabled: true
            })
        );

        // 6. Deploy PonsRiskEngine
        PonsRiskEngine riskEngine = new PonsRiskEngine(
            address(oracleRouter),
            address(registry),
            deployer
        );

        // 6. Deploy LeveragePositionManager
        LeveragePositionManager positionManager = new LeveragePositionManager(
            address(riskEngine),
            address(oracleRouter),
            address(usdg),
            deployer
        );

        // 7. Deploy PonsAutoProtectModule
        PonsAutoProtectModule autoProtect = new PonsAutoProtectModule(
            address(positionManager),
            address(riskEngine),
            address(usdg),
            deployer
        );
        autoProtect.setPaused(false);

        vm.stopBroadcast();

        // 7. Output Addresses to JSON for the frontend
        string memory finalJson = vm.serializeAddress("addresses", "USDG", address(usdg));
        finalJson = vm.serializeAddress("addresses", "PMEME", address(pmeme));
        finalJson = vm.serializeAddress("addresses", "PGOV", address(pgov));
        finalJson = vm.serializeAddress("addresses", "PonsLeverageRegistry", address(registry));
        finalJson = vm.serializeAddress("addresses", "PonsOracleRouter", address(oracleRouter));
        finalJson = vm.serializeAddress("addresses", "PonsRiskEngine", address(riskEngine));
        finalJson = vm.serializeAddress("addresses", "LeveragePositionManager", address(positionManager));
        finalJson = vm.serializeAddress("addresses", "PonsAutoProtectModule", address(autoProtect));

        vm.writeJson(finalJson, "deployments.json");

        console.log("DEPLOYMENT COMPLETED SUCCESSFULLY");
        console.log("USDG:", address(usdg));
        console.log("PMEME:", address(pmeme));
        console.log("PonsLeverageRegistry:", address(registry));
        console.log("LeveragePositionManager:", address(positionManager));
        console.log("PonsAutoProtectModule:", address(autoProtect));
    }
}
