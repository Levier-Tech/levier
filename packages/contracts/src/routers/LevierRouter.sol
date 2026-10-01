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
 * @title LevierRouter
 * @notice Unified user interaction contract for isolated lending pairs.
 * @dev Simplifies single-transaction supply, borrow, repay, and withdraw flows.
 */
/// @dev Deployed behind an ERC1967 UUPS proxy. The owner can only upgrade; it has no lending powers.
contract LevierRouter is Initializable, ReentrancyGuardTransient, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Only the owner can move this proxy to a new implementation.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
    }

    /**
     * @notice Supplies collateral and borrows debt token in a single atomic transaction.
     */
    function depositAndBorrow(address pairAddress, uint256 collateralAmount, uint256 borrowAmount)
        external
        nonReentrant
    {
        LevierPair pair = LevierPair(pairAddress);

        if (collateralAmount > 0) {
            IERC20(pair.collateralToken()).safeTransferFrom(msg.sender, address(this), collateralAmount);
            IERC20(pair.collateralToken()).forceApprove(pairAddress, collateralAmount);
            pair.depositCollateralFor(msg.sender, collateralAmount);
        }

        if (borrowAmount > 0) {
            pair.borrowFor(msg.sender, borrowAmount, msg.sender);
        }
    }

    /**
     * @notice Repays debt and withdraws collateral in a single atomic transaction.
     */
    function repayAndWithdraw(address pairAddress, uint256 repayAmount, uint256 withdrawAmount) external nonReentrant {
        LevierPair pair = LevierPair(pairAddress);

        if (repayAmount > 0) {
            (, uint256 debt) = pair.accounts(msg.sender);
            uint256 payment = repayAmount > debt ? debt : repayAmount;
            if (payment > 0) {
                IERC20(pair.debtToken()).safeTransferFrom(msg.sender, address(this), payment);
                IERC20(pair.debtToken()).forceApprove(pairAddress, payment);
                pair.repayFor(msg.sender, payment);
            }
        }

        if (withdrawAmount > 0) {
            pair.withdrawCollateralFor(msg.sender, withdrawAmount, msg.sender);
        }
    }
}
