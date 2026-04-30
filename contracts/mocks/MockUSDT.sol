// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDT
 * @notice 6-decimal open-mint ERC-20 for local Anvil / testnet use. NOT for
 *         mainnet. Anyone can mint to any address, purely a dev convenience
 *         so the MintDrop's USDT code path can be exercised without needing
 *         a real USDT deployment.
 */
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint to any address, any amount. Open, by design, dev only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
