// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../core/LevierPair.sol";

/**
 * @title LeverageRouter
 * @notice Deposit/borrow router prepared for later leveraged trading integration.
 * @dev Swaps, re-supply and closing are not implemented. Deploy paused until that integration is accepted.
 */
/// @dev Deployed behind an ERC1967 UUPS proxy.
contract LeverageRouter is Initializable, ReentrancyGuardTransient, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    bool public isPaused;

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Only the owner can move this proxy to a new implementation.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice Starts paused.
    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        isPaused = true;
    }

    function setPaused(bool _paused) external onlyOwner {
        isPaused = _paused;
        emit PauseUpdated(_paused);
    }

    /**
     * @notice Open an atomic leveraged long position.
     * @param pairAddress Target LevierPair contract.
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

        LevierPair pair = LevierPair(pairAddress);

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
