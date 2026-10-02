// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title PonsLiquidityVault
/// @notice USDG liquidity that takes the other side of Pons leverage positions. Trader losses and
/// fees flow in; trader profits are paid out. The manager reserves each position's maximum payout,
/// and LPs can only withdraw what is not reserved.
/// @dev Share price is based on the vault balance; open positions' unrealized PnL is not marked.
/// @dev Deployed behind an ERC1967 UUPS proxy. Starts with deposits paused.
contract PonsLiquidityVault is Initializable, ERC4626Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    error NotManager();
    error InvalidConfiguration();
    error InsufficientFreeLiquidity();

    event ManagerSet(address indexed manager);
    event DepositsPauseUpdated(bool paused);
    event Reserved(uint256 amount, uint256 totalReserved);
    event Released(uint256 amount, uint256 totalReserved);
    event Paid(address indexed to, uint256 amount);

    address public manager;
    bool public depositsPaused;
    uint256 public reserved;

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Only the owner can move this proxy to a new implementation.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(IERC20 asset, string memory name, string memory symbol, address initialOwner)
        external
        initializer
    {
        __ERC20_init(name, symbol);
        __ERC4626_init(asset);
        __Ownable_init(initialOwner);
        depositsPaused = true;
    }

    /// @notice Sets the position manager once; a new manager needs an upgrade.
    function setManager(address manager_) external onlyOwner {
        if (manager != address(0) || manager_.code.length == 0) revert InvalidConfiguration();
        manager = manager_;
        emit ManagerSet(manager_);
    }

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPauseUpdated(paused);
    }

    /// @notice Assets not reserved for open positions.
    function freeAssets() public view returns (uint256) {
        uint256 total = totalAssets();
        return total > reserved ? total - reserved : 0;
    }

    function reserve(uint256 amount) external onlyManager {
        if (amount > freeAssets()) revert InsufficientFreeLiquidity();
        reserved += amount;
        emit Reserved(amount, reserved);
    }

    function release(uint256 amount) external onlyManager {
        reserved -= amount;
        emit Released(amount, reserved);
    }

    function pay(address to, uint256 amount) external onlyManager {
        IERC20(asset()).safeTransfer(to, amount);
        emit Paid(to, amount);
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        return depositsPaused ? 0 : super.maxDeposit(receiver);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return depositsPaused ? 0 : super.maxMint(receiver);
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 own = super.maxWithdraw(owner_);
        uint256 free = freeAssets();
        return own < free ? own : free;
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 own = super.maxRedeem(owner_);
        uint256 free = convertToShares(freeAssets());
        return own < free ? own : free;
    }

    /// @dev Virtual shares blunt the first-depositor inflation attack on a 6-decimal asset.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
