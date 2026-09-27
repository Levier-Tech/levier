// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LevierVault
 * @notice ERC-4626 custody foundation. Market allocation and yield accrual are not implemented.
 */
contract LevierVault is ERC4626, Ownable {
    bool public depositsPaused = true;
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

    constructor(
        IERC20 asset,
        string memory name,
        string memory symbol,
        string memory _vaultSlug,
        string memory _riskTier,
        address initialOwner
    ) ERC4626(asset) ERC20(name, symbol) Ownable(initialOwner) {
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
