// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDexTwapOracle {
    /**
     * @notice Fetch the Time-Weighted Average Price (TWAP) for a given asset.
     * @param asset The address of the asset to price.
     * @param window The time window in seconds for the TWAP calculation.
     * @return twapPrice The calculated TWAP scaled by 1e18.
     */
    function getTwapPrice(address asset, uint32 window) external view returns (uint256 twapPrice);
}
