// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read-only view of the Pons V2 launchpad factory on Robinhood Chain.
/// @dev `phase == 2` means the token graduated from its bonding curve into a Uniswap v4 pool.
interface IPonsFactory {
    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
}

/// @notice Minimal Uniswap v4 PoolManager surface used to read pool state.
interface IPoolManagerExtsload {
    function extsload(bytes32 slot) external view returns (bytes32);
}

/// @notice USD price source with 18 decimals (the deployed `VerifiedFeedOracle`).
interface IUsdPriceOracle {
    function getPrice(address asset) external view returns (uint256);
}
