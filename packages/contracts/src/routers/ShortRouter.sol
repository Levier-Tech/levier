// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../core/LeveraPair.sol";

/**
 * @title ShortRouter
 * @notice Deposit/borrow foundation for a later stock-borrow-and-sell flow.
 * @dev Selling borrowed tokens and buying back to close are not implemented; deploy paused.
 */
contract ShortRouter is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    bool public isPaused = true;

    event PauseUpdated(bool paused);

    event ShortPositionOpened(
        address indexed user, address indexed pair, uint256 collateralSupplied, uint256 stockBorrowed
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setPaused(bool _paused) external onlyOwner {
        isPaused = _paused;
        emit PauseUpdated(_paused);
    }

    function openShortPosition(address pairAddress, uint256 stableCollateral, uint256 stockBorrowAmount)
        external
        nonReentrant
    {
        require(!isPaused, "ShortRouter: Paused");
        require(pairAddress != address(0), "ShortRouter: Invalid pair");
        require(stableCollateral > 0, "ShortRouter: Zero collateral");

        LeveraPair pair = LeveraPair(pairAddress);

        IERC20 collateral = IERC20(pair.collateralToken());
        collateral.safeTransferFrom(msg.sender, address(this), stableCollateral);
        collateral.forceApprove(pairAddress, stableCollateral);
        pair.depositCollateralFor(msg.sender, stableCollateral);

        if (stockBorrowAmount > 0) {
            pair.borrowFor(msg.sender, stockBorrowAmount, msg.sender);
        }

        emit ShortPositionOpened(msg.sender, pairAddress, stableCollateral, stockBorrowAmount);
    }
}
