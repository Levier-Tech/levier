// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title LevierVault
 * @notice ERC-4626 custody foundation. Market allocation and yield accrual are not implemented.
 */
/// @dev Deployed behind an ERC1967 UUPS proxy.
contract LevierVault is Initializable, ERC4626Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    bool public depositsPaused;
    event DepositsPauseUpdated(bool paused);

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPauseUpdated(paused);
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        return depositsPaused ? 0 : super.maxDeposit(receiver);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return depositsPaused ? 0 : super.maxMint(receiver);
    }

    string public vaultSlug;
    string public riskTier; // Conservative, Balanced, Aggressive

    struct MarketAllocation {
        address pairAddress;
        uint256 weightBps; // Allocation weight in basis points (10000 = 100%)
    }

    MarketAllocation[] public allocations;

    event AllocationUpdated(address indexed pair, uint256 weightBps);
    event AllocationsReset();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Only the owner can move this proxy to a new implementation.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice Starts with deposits paused.
    function initialize(
        IERC20 asset,
        string memory name,
        string memory symbol,
        string memory _vaultSlug,
        string memory _riskTier,
        address initialOwner
    ) external initializer {
        __ERC20_init(name, symbol);
        __ERC4626_init(asset);
        __Ownable_init(initialOwner);
        depositsPaused = true;
        vaultSlug = _vaultSlug;
        riskTier = _riskTier;
    }

    function setAllocations(address[] calldata pairs, uint256[] calldata weightsBps) external onlyOwner {
        require(pairs.length == weightsBps.length, "Vault: Arrays length mismatch");
        delete allocations;
        emit AllocationsReset();

        uint256 totalWeight = 0;
        for (uint256 i = 0; i < pairs.length; i++) {
            require(pairs[i] != address(0), "Vault: Invalid pair address");
            allocations.push(MarketAllocation({
                pairAddress: pairs[i],
                weightBps: weightsBps[i]
            }));
            totalWeight += weightsBps[i];
            emit AllocationUpdated(pairs[i], weightsBps[i]);
        }

        require(totalWeight <= 10_000, "Vault: Total weight cannot exceed 100%");
    }

    function getAllocationsCount() external view returns (uint256) {
        return allocations.length;
    }
}
