// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPonsOracleRouter {
    /**
     * @notice Fetch the validated mark price for an asset.
     * @param asset The address of the asset to price.
     * @return markPrice The validated price, scaled by 1e18.
     */
    function getMarkPrice(address asset) external view returns (uint256 markPrice);

    /**
     * @notice Get detailed diagnostic pricing information.
     * @param asset The address of the asset.
     * @return primaryPrice The price from the primary off-chain oracle.
     * @return twapPrice The on-chain time-weighted average price (TWAP).
     * @return deviationBps The deviation between primary and TWAP.
     * @return isSafe Boolean indicating if the deviation is within safe limits.
     */
    function getPriceDiagnostics(address asset) external view returns (
        uint256 primaryPrice,
        uint256 twapPrice,
        uint256 deviationBps,
        bool isSafe
    );
}
