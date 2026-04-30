// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BRAWL
 * @notice The $BRAWL utility token — stake to duel, earn by winning.
 *         Fair-launch hardened with anti-sniper / anti-bot / max-wallet
 *         limits during the first window after trading is enabled.
 *
 * @custom:website  https://baseicbrawlers.com
 * @custom:telegram https://t.me/baseicbrawlers
 * @custom:twitter  https://x.com/BASEicBrawlers
 *
 *  Website:  https://baseicbrawlers.com
 *  Telegram: https://t.me/baseicbrawlers
 *  X:        https://x.com/BASEicBrawlers
 *
 * @dev Fixed supply, no mint after construction. Fixed-supply minted to the
 *      initial holder; ownership held by `initialOwner` for limit-management
 *      only (cannot mint, cannot pause transfers globally — owner can only
 *      flip launch flags + manage the whitelist/blacklist).
 *
 *      Anti-sniping arsenal:
 *        1. `tradingEnabled` defaults false — no DEX trading until owner
 *           calls enableTrading(). Whitelisted addresses (LP router, game
 *           contracts) can move tokens for setup.
 *        2. Anti-bot: in the first ANTI_BOT_BLOCKS after trading enables,
 *           any non-whitelisted contract that receives tokens is auto-
 *           blacklisted and the tx reverts. Catches sniper bots that try
 *           to atomic-buy in block 0 of the LP.
 *        3. `maxWallet` / `maxTx` caps during the launch limit window.
 *           Owner can lift via liftLimits() once the launch settles.
 *        4. Manual blacklist for known bad actors.
 *
 *      Whitelisted by default (set in constructor): the initial holder
 *      and the contract owner. After deploy, owner whitelists the
 *      Aerodrome / Uniswap LP router, the LP pair, MintDrop, Duel,
 *      Marketplace, and the Graveyard.
 */
contract BRAWL is ERC20, Ownable {
    /// @notice Fixed supply. 100,000 tokens with 18 decimals.
    uint256 public constant FIXED_SUPPLY = 100_000 * 10 ** 18;

    /// @notice First N blocks after trading is enabled, contract receivers
    ///         are auto-blacklisted as suspected sniper bots. Tight default
    ///         (1 block) so legitimate aggregator txs in block 2+ aren't
    ///         caught by accident.
    uint256 public constant ANTI_BOT_BLOCKS = 1;

    /// @notice Trading-enabled flag. Defaults false. Once flipped to true,
    ///         cannot be flipped back (one-way switch).
    bool public tradingEnabled;

    /// @notice Block number trading was enabled at. Drives the anti-bot window.
    uint256 public launchBlock;

    /// @notice Per-tx cap during the limit window. Default 0.5% of supply
    ///         (500 BRAWL). Configurable by owner before lift.
    uint256 public maxTx;

    /// @notice Per-wallet cap during the limit window. Default 1% of supply
    ///         (1,000 BRAWL). Configurable by owner before lift.
    uint256 public maxWallet;

    /// @notice True while max-tx and max-wallet caps are enforced. Set false
    ///         via liftLimits() once the launch is past the volatile window.
    bool public limitsActive;

    /// @notice Addresses exempted from all transfer restrictions. Default
    ///         exempt: initial holder, contract owner. Owner adds the LP
    ///         router, LP pair, and game contracts after deploy.
    mapping(address => bool) public whitelisted;

    /// @notice Blocked addresses (sniper bots auto-added during anti-bot
    ///         window; manual additions allowed by owner).
    mapping(address => bool) public blacklisted;

    event TradingEnabled(uint256 atBlock);
    event LimitsLifted();
    event WhitelistedSet(address indexed addr, bool status);
    event Blacklisted(address indexed addr, string reason);
    event Unblacklisted(address indexed addr);
    event LimitsChanged(uint256 newMaxTx, uint256 newMaxWallet);

    error ZeroInitialHolder();
    error TradingNotEnabled();
    error AlreadyEnabled();
    error MaxTxExceeded(uint256 amount, uint256 cap);
    error MaxWalletExceeded(uint256 newBalance, uint256 cap);
    error AddrBlacklisted(address addr);
    error SniperBlocked(address addr);

    constructor(address initialHolder, address initialOwner)
        ERC20("Brawl Token", "BRAWL")
        Ownable(initialOwner)
    {
        if (initialHolder == address(0)) revert ZeroInitialHolder();
        // initialOwner == 0 is rejected by OZ Ownable's constructor.

        _mint(initialHolder, FIXED_SUPPLY);

        // Conservative starting limits — owner can tune before enabling
        // trading. 1% wallet cap, 0.5% tx cap is the standard fair-launch
        // setting (limits big-bag accumulation in the first hours).
        maxWallet = FIXED_SUPPLY / 100; // 1,000 BRAWL
        maxTx = FIXED_SUPPLY / 200; // 500 BRAWL
        limitsActive = true;

        // Default whitelist — needed so initial setup transfers (seeding
        // LP, MintDrop airdrop pool, etc) work pre-launch.
        whitelisted[initialOwner] = true;
        whitelisted[initialHolder] = true;

        emit WhitelistedSet(initialOwner, true);
        if (initialHolder != initialOwner) {
            emit WhitelistedSet(initialHolder, true);
        }
    }

    // ─── Owner: launch + limit management ─────────────────────────────────

    /// @notice One-way switch to open trading. Records launch block to start
    ///         the anti-bot window.
    function enableTrading() external onlyOwner {
        if (tradingEnabled) revert AlreadyEnabled();
        tradingEnabled = true;
        launchBlock = block.number;
        emit TradingEnabled(block.number);
    }

    /// @notice Add or remove an address from the transfer-restriction whitelist.
    function setWhitelist(address addr, bool status) external onlyOwner {
        whitelisted[addr] = status;
        emit WhitelistedSet(addr, status);
    }

    /// @notice Bulk whitelist for game contract setup (LP router, pair, Duel,
    ///         MintDrop, Marketplace, etc).
    function setWhitelistBulk(address[] calldata addrs, bool status) external onlyOwner {
        for (uint256 i = 0; i < addrs.length; i++) {
            whitelisted[addrs[i]] = status;
            emit WhitelistedSet(addrs[i], status);
        }
    }

    /// @notice Tune the per-tx / per-wallet caps. Both denominated in BRAWL wei.
    function setLimits(uint256 newMaxTx, uint256 newMaxWallet) external onlyOwner {
        maxTx = newMaxTx;
        maxWallet = newMaxWallet;
        emit LimitsChanged(newMaxTx, newMaxWallet);
    }

    /// @notice Lift all transfer limits permanently. Use after launch settles.
    function liftLimits() external onlyOwner {
        limitsActive = false;
        emit LimitsLifted();
    }

    /// @notice Manually blacklist a confirmed bot/scammer address.
    function blacklist(address addr, string calldata reason) external onlyOwner {
        blacklisted[addr] = true;
        emit Blacklisted(addr, reason);
    }

    /// @notice Reverse a blacklist (e.g. caught a false positive).
    function unblacklist(address addr) external onlyOwner {
        blacklisted[addr] = false;
        emit Unblacklisted(addr);
    }

    // ─── Internal: transfer hook ──────────────────────────────────────────

    /// @dev OZ ERC-20 calls _update for every transfer/mint/burn. We layer
    ///      blacklist + trading-enabled + anti-bot + limits on top.
    function _update(address from, address to, uint256 value) internal override {
        // Mint or burn — skip restrictions.
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }

        // Hard blacklist (always enforced, both sides).
        if (blacklisted[from]) revert AddrBlacklisted(from);
        if (blacklisted[to]) revert AddrBlacklisted(to);

        bool fromWl = whitelisted[from];
        bool toWl = whitelisted[to];

        // Trading paused — only whitelisted setup transfers allowed.
        if (!tradingEnabled && !fromWl && !toWl) {
            revert TradingNotEnabled();
        }

        // Anti-bot window — auto-blacklist contract receivers in the first
        // ANTI_BOT_BLOCKS after trading enabled. Catches sniper bots that
        // atomic-call the LP pair in block 0.
        //
        // Note: EOA receivers always pass; only contract addresses (where
        // `to.code.length > 0`) are caught. Whitelisted contracts (game
        // contracts, LP router, LP pair) bypass this.
        if (
            tradingEnabled
                && block.number <= launchBlock + ANTI_BOT_BLOCKS
                && !fromWl
                && !toWl
                && to.code.length > 0
        ) {
            blacklisted[to] = true;
            emit Blacklisted(to, "anti-bot");
            revert SniperBlocked(to);
        }

        // Launch-window limits — caps per-tx and per-wallet to slow whale
        // accumulation in the first hours/days after launch.
        if (limitsActive && !fromWl && !toWl) {
            if (value > maxTx) revert MaxTxExceeded(value, maxTx);
            uint256 newBalance = balanceOf(to) + value;
            if (newBalance > maxWallet) revert MaxWalletExceeded(newBalance, maxWallet);
        }

        super._update(from, to, value);
    }
}
