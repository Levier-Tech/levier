// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestnetERC20
 * @notice Standard ERC20 token representing synthetic RWAs and stablecoins on Robinhood Testnet.
 * @dev Used for NVDA, AAPL, TSLA, SPY, and USDG.
 */
contract TestnetERC20 is ERC20, Ownable {
    uint8 private immutable _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 tokenDecimals,
        uint256 initialSupply,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {
        _decimals = tokenDecimals;
        if (initialSupply > 0) {
            _mint(initialOwner, initialSupply);
        }
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Mint tokens to target address. Restricted to owner or faucets.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Public faucet function for testnet testing.
     * @param amount Maximum 10,000 tokens per faucet call.
     */
    function faucet(uint256 amount) external {
        uint256 maxAmount = 10_000 * (10 ** _decimals);
        require(amount <= maxAmount, "Amount exceeds faucet limit");
        _mint(msg.sender, amount);
    }
}
