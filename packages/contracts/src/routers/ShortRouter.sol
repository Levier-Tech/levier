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
 * @title ShortRouter
 * @notice Deposit/borrow foundation for a later stock-borrow-and-sell flow.
 * @dev Selling borrowed tokens and buying back to close are not implemented; deploy paused.
 */
/// @dev Deployed behind an ERC1967 UUPS proxy.
contract ShortRouter is Initializable, ReentrancyGuardTransient, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    bool public isPaused;

    event PauseUpdated(bool paused);

    event ShortPositionOpened(
        address indexed user, address indexed pair, uint256 collateralSupplied, uint256 stockBorrowed
    );

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

    function openShortPosition(address pairAddress, uint256 stableCollateral, uint256 stockBorrowAmount)
        external
        nonReentrant
    {
        require(!isPaused, "ShortRouter: Paused");
        require(pairAddress != address(0), "ShortRouter: Invalid pair");
        require(stableCollateral > 0, "ShortRouter: Zero collateral");

        LevierPair pair = LevierPair(pairAddress);

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
