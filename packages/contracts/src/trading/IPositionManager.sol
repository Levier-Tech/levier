// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPositionManager {
    struct Position {
        address account;
        address asset;           // The Pons asset being traded
        bool isLong;             // True for Long, False for Short
        uint256 sizeAsset;       // The size of the position in asset tokens
        uint256 collateralAmount;// The amount of collateral token backing the position
        uint256 debtAmount;      // The amount of debt token owed
        uint256 entryPrice;      // The mark price of the asset at the time of entry
        uint256 lastUpdateTime;
    }

    /**
     * @notice Open a new leveraged position.
     * @param asset The address of the Pons asset to trade.
     * @param isLong True for Long, False for Short (Shorts disabled in Phase 3).
     * @param collateralAmount The amount of collateral to deposit.
     * @param sizeAsset The size of the position to open in terms of the asset.
     */
    function openPosition(
        address asset,
        bool isLong,
        uint256 collateralAmount,
        uint256 sizeAsset
    ) external;

    /**
     * @notice Close a position fully.
     * @param asset The asset.
     * @param isLong True if the position is Long, False if Short.
     */
    function closePosition(address asset, bool isLong) external;

    /**
     * @notice Liquidates an unhealthy position fully.
     * @param account The address of the position owner.
     * @param asset The asset.
     * @param isLong True if the position is Long, False if Short.
     */
    function liquidatePosition(address account, address asset, bool isLong) external;

    /**
     * @notice Add more base collateral to a position.
     * @param asset The asset.
     * @param isLong True if the position is Long, False if Short.
     * @param amount The amount of USDG to add.
     */
    function addCollateral(address asset, bool isLong, uint256 amount) external;

    /**
     * @notice Add more base collateral to a position on behalf of someone else.
     * @param account The owner of the position.
     * @param asset The asset.
     * @param isLong True if the position is Long, False if Short.
     * @param amount The amount of USDG to add.
     */
    function addCollateralFor(address account, address asset, bool isLong, uint256 amount) external;

    /**
     * @notice Remove collateral from an existing position if health factor allows.
     * @param asset The address of the Pons asset.
     * @param isLong True for Long, False for Short.
     * @param amount The amount of collateral to remove.
     */
    function removeCollateral(address asset, bool isLong, uint256 amount) external;

    /**
     * @notice Get details of an active position.
     */
    function getPosition(address account, address asset, bool isLong)
        external
        view
        returns (Position memory);
}
