// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../core/LeveraPair.sol";

/**
 * @title LeverageRouter
 * @notice Deposit/borrow router prepared for later leveraged trading integration.
 * @dev Swaps, re-supply and closing are not implemented. Deploy paused until that integration is accepted.
 */
contract LeverageRouter is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    bool public isPaused = true;

    event PauseUpdated(bool paused);

    event LeveragedPositionOpened(
        address indexed user,
        address indexed pair,
        uint256 collateralSupplied,
        uint256 debtBorrowed,
        uint256 leverageBps
    );

    modifier whenNotPaused() {
        require(!isPaused, "LeverageRouter: Contract paused");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setPaused(bool _paused) external onlyOwner {
        isPaused = _paused;
        emit PauseUpdated(_paused);
    }

    /**
     * @notice Open an atomic leveraged long position.
     * @param pairAddress Target LeveraPair contract.
     * @param initialCollateral Initial capital provided by the user.
     * @param borrowAmount Amount of debt to borrow for leverage multiplication.
     * @param leverageBps Desired leverage in basis points (e.g. 20000 = 2.0x, 25000 = 2.5x).
     */
    function openLeveragedPosition(
        address pairAddress,
        uint256 initialCollateral,
        uint256 borrowAmount,
        uint256 leverageBps
    ) external nonReentrant whenNotPaused {
        require(pairAddress != address(0), "LeverageRouter: Invalid pair");
        require(initialCollateral > 0, "LeverageRouter: Zero initial collateral");
        require(leverageBps >= 10_000 && leverageBps <= 30_000, "LeverageRouter: Leverage out of bounds");

        LeveraPair pair = LeveraPair(pairAddress);

        // 1. Transfer initial collateral from user to pair
        IERC20 collateral = IERC20(pair.collateralToken());
        collateral.safeTransferFrom(msg.sender, address(this), initialCollateral);
        collateral.forceApprove(pairAddress, initialCollateral);
        pair.depositCollateralFor(msg.sender, initialCollateral);

        // 2. Execute borrow if leverage > 1x
        if (borrowAmount > 0) {
            pair.borrowFor(msg.sender, borrowAmount, msg.sender);
        }

        emit LeveragedPositionOpened(msg.sender, pairAddress, initialCollateral, borrowAmount, leverageBps);
    }
}
