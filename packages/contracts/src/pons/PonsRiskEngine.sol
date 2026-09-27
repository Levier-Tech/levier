// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../oracle/IPonsOracleRouter.sol";
import "./PonsLeverageRegistry.sol";
import "./IPonsRiskEngine.sol";

/**
 * @title PonsRiskEngine
 * @notice Centralized risk calculations for Pons leveraged positions.
 */
contract PonsRiskEngine is IPonsRiskEngine, Ownable {
    IPonsOracleRouter public immutable oracleRouter;
    PonsLeverageRegistry public immutable registry;

    constructor(
        address _oracleRouter,
        address _registry,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_oracleRouter != address(0), "RiskEngine: Zero oracle address");
        require(_registry != address(0), "RiskEngine: Zero registry address");
        oracleRouter = IPonsOracleRouter(_oracleRouter);
        registry = PonsLeverageRegistry(_registry);
    }

    function _getValueUsd(address token, uint256 amount) internal view returns (uint256) {
        uint256 price = oracleRouter.getMarkPrice(token);
        uint8 decimals = IERC20Metadata(token).decimals();
        return Math.mulDiv(amount, price, 10 ** decimals);
    }

    /**
     * @inheritdoc IPonsRiskEngine
     */
    function isPositionHealthy(
        address asset,
        bool isLong,
        uint256 sizeAsset,
        uint256 collateralAmount,
        uint256 entryPrice
    ) public view override returns (bool) {
        uint256 healthFactor = getHealthFactor(asset, isLong, sizeAsset, collateralAmount, entryPrice);
        return healthFactor >= 10000; // 10000 bps = 1.0
    }

    /**
     * @inheritdoc IPonsRiskEngine
     */
    function getHealthFactor(
        address asset,
        bool isLong,
        uint256 sizeAsset,
        uint256 collateralAmount,
        uint256 entryPrice
    ) public view override returns (uint256) {
        if (sizeAsset == 0) return type(uint256).max;
        if (collateralAmount == 0) return 0;

        PonsLeverageRegistry.PonsRiskConfig memory config = registry.getRiskConfig(asset);
        require(config.enabled, "RiskEngine: Asset not enabled for leverage");

        uint256 currentPrice = oracleRouter.getMarkPrice(asset);

        // Value of the size currently and at entry
        uint256 currentValueUsd = (sizeAsset * currentPrice) / 1e18;
        uint256 entryValueUsd = (sizeAsset * entryPrice) / 1e18;

        uint256 equity = collateralAmount;
        
        if (isLong) {
            if (currentValueUsd >= entryValueUsd) {
                equity += (currentValueUsd - entryValueUsd);
            } else {
                uint256 loss = entryValueUsd - currentValueUsd;
                if (loss >= equity) return 0; // liquidated completely
                equity -= loss;
            }
        } else {
            if (entryValueUsd >= currentValueUsd) {
                equity += (entryValueUsd - currentValueUsd);
            } else {
                uint256 loss = currentValueUsd - entryValueUsd;
                if (loss >= equity) return 0; // liquidated completely
                equity -= loss;
            }
        }

        // Required maintenance margin = Notional Value * maintenanceMarginBps / 10000
        // We use current Notional Value.
        uint256 maintMarginRequired = (currentValueUsd * config.maintenanceMarginBps) / 10000;

        if (maintMarginRequired == 0) return type(uint256).max;

        return (equity * 10000) / maintMarginRequired;
    }

    /**
     * @inheritdoc IPonsRiskEngine
     */
    function getLiquidationPrice(
        address asset,
        bool isLong,
        uint256 sizeAsset,
        uint256 collateralAmount,
        uint256 entryPrice
    ) external view override returns (uint256) {
        if (sizeAsset == 0) return 0;

        PonsLeverageRegistry.PonsRiskConfig memory config = registry.getRiskConfig(asset);
        
        uint256 entryValueUsd = (sizeAsset * entryPrice) / 1e18;
        
        // Liquidation occurs when Equity = Maintenance Margin
        // Equity = Collateral + PnL
        // MM = (sizeAsset * liqPrice / 1e18) * maintBps / 10000
        
        // For Long: PnL = (sizeAsset * liqPrice / 1e18) - entryValueUsd
        // Collateral + (sizeAsset * liqPrice / 1e18) - entryValueUsd = (sizeAsset * liqPrice / 1e18) * maintBps / 10000
        // Collateral - entryValueUsd = (sizeAsset * liqPrice / 1e18) * (maintBps / 10000 - 1)
        // (sizeAsset * liqPrice / 1e18) * (1 - maintBps/10000) = entryValueUsd - Collateral
        // liqPrice = (entryValueUsd - Collateral) * 1e18 / (sizeAsset * (1 - maintBps/10000))
        
        uint256 maintBps = config.maintenanceMarginBps;
        uint256 liqPrice;

        if (isLong) {
            if (entryValueUsd <= collateralAmount) return 0; // Cannot be liquidated
            uint256 numerator = (entryValueUsd - collateralAmount) * 1e18;
            uint256 denominator = (sizeAsset * (10000 - maintBps)) / 10000;
            if (denominator == 0) return 0;
            liqPrice = numerator / denominator;
        } else {
            // For Short: PnL = entryValueUsd - (sizeAsset * liqPrice / 1e18)
            // Collateral + entryValueUsd - (sizeAsset * liqPrice / 1e18) = (sizeAsset * liqPrice / 1e18) * maintBps / 10000
            // Collateral + entryValueUsd = (sizeAsset * liqPrice / 1e18) * (1 + maintBps/10000)
            // liqPrice = (Collateral + entryValueUsd) * 1e18 / (sizeAsset * (1 + maintBps/10000))
            uint256 numerator = (collateralAmount + entryValueUsd) * 1e18;
            uint256 denominator = (sizeAsset * (10000 + maintBps)) / 10000;
            if (denominator == 0) return type(uint256).max;
            liqPrice = numerator / denominator;
        }

        return liqPrice;
    }
}
