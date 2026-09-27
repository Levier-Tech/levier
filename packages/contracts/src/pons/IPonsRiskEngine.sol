// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPonsRiskEngine {
    /**
     * @notice Determine if a given position configuration is healthy.
     * @param asset The address of the Pons graduated asset.
     * @param isLong True if the position is Long, False if Short.
     * @param sizeAsset The size of the position in the asset token (1e18).
     * @param collateralAmount The amount of base collateral token deposited (in USDG).
     * @param entryPrice The price of the asset at the time of entry (1e18).
     * @return isHealthy Boolean indicating if health factor is >= 1.
     */
    function isPositionHealthy(
        address asset,
        bool isLong,
        uint256 sizeAsset,
        uint256 collateralAmount,
        uint256 entryPrice
    ) external view returns (bool isHealthy);

    /**
     * @notice Get the precise numeric health factor for a position.
     * @param asset The address of the Pons graduated asset.
     * @param isLong True if the position is Long, False if Short.
     * @param sizeAsset The size of the position in the asset token (1e18).
     * @param collateralAmount The amount of base collateral token deposited (in USDG).
     * @param entryPrice The price of the asset at the time of entry (1e18).
     * @return healthFactorBps The health factor scaled in basis points (10000 = 1.0x).
     */
    function getHealthFactor(
        address asset,
        bool isLong,
        uint256 sizeAsset,
        uint256 collateralAmount,
        uint256 entryPrice
    ) external view returns (uint256 healthFactorBps);

    /**
     * @notice Calculate the asset mark price at which this position becomes liquidatable.
     * @param asset The address of the Pons graduated asset.
     * @param isLong True if the position is Long, False if Short.
     * @param sizeAsset The size of the position in the asset token (1e18).
     * @param collateralAmount The amount of base collateral token deposited (in USDG).
     * @param entryPrice The price of the asset at the time of entry (1e18).
     * @return liqPrice The mark price of the asset at which liquidation occurs (scaled by 1e18).
     */
    function getLiquidationPrice(
        address asset,
        bool isLong,
        uint256 sizeAsset,
        uint256 collateralAmount,
        uint256 entryPrice
    ) external view returns (uint256 liqPrice);
}
