// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IPonsMarketAdapter
 * @notice Interface for querying Pons graduated asset eligibility and metadata.
 */
interface IPonsMarketAdapter {
    /// @notice Returns true if the asset has graduated from the Pons bonding curve.
    function isGraduated(address asset) external view returns (bool);

    /// @notice Returns true if the asset is eligible for leverage trading on Levier.
    function isEligible(address asset) external view returns (bool);

    /// @notice Returns market metadata for a Pons asset.
    function getMarketMetadata(address asset)
        external
        view
        returns (
            uint256 liquidity,
            uint256 marketCap,
            uint256 volume,
            bool graduated
        );
}
