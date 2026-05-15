// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Brawlers} from "./Brawlers.sol";
import {Duel} from "./Duel.sol";

/**
 * @title Graveyard
 * @notice Manages dead-brawler revival.
 *
 * @custom:website  https://baseicbrawlers.com
 * @custom:docs     https://docs.baseicbrawlers.com
 * @custom:github   https://github.com/baseicbrawlers/baseic-brawlers
 * @custom:telegram https://t.me/baseicbrawlers
 * @custom:twitter  https://x.com/BASEicBrawlers
 * @custom:discord  https://discord.gg/RjvBEA5CVd
 *
 *  Website:  https://baseicbrawlers.com
 *  Docs:     https://docs.baseicbrawlers.com
 *  GitHub:   https://github.com/baseicbrawlers/baseic-brawlers
 *  Telegram: https://t.me/baseicbrawlers
 *  X:        https://x.com/BASEicBrawlers
 *  Discord:  https://discord.gg/RjvBEA5CVd
 *
 * @dev Only the Brawler's owner can revive it. Resurrection pays a fee
 *      (default 0.01 ETH, configurable by owner) to the treasury address.
 *      Dead brawlers have their loss streak reset to 0 on resurrection.
 *
 *      The Graveyard contract is authorized on Brawlers.setGraveyardContract()
 *      and calls Brawlers.resurrect() after fee payment.
 */
contract Graveyard is Ownable, Pausable, ReentrancyGuard {
    // ─── Storage ─────────────────────────────────────────────────────

    Brawlers public immutable brawlers;
    Duel public immutable duel;

    /// @notice Base cost for common brawlers at 0 wins. Per-brawler cost
    ///         scales by rarity + wins, see `costFor(tokenId)`.
    uint256 public resurrectionCost;

    /// @notice Tier multipliers scaled by 10. Applied in `costFor` as
    ///         `cost = base × mult / 10 × (10 + wins) / 10`. Index 0..5 maps
    ///         to Common..King. Default set in constructor to the 2026-04-24
    ///         curve: [10, 15, 25, 40, 70, 150] (i.e. 1×/1.5×/2.5×/4×/7×/15×).
    uint256[6] public tierMults;

    /// @notice Address that receives resurrection fees.
    address public treasury;

    // ─── Events ──────────────────────────────────────────────────────

    event Resurrected(uint256 indexed tokenId, address indexed by, uint256 paid);
    event ResurrectionCostChanged(uint256 oldCost, uint256 newCost);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event TierMultsChanged(uint256[6] newMults);

    // ─── Errors ──────────────────────────────────────────────────────

    error NotOwner();
    error NotDead();
    error InsufficientPayment(uint256 required, uint256 sent);
    error TreasuryTransferFailed();
    error RefundFailed();
    error ZeroTreasury();
    error CostTooHigh(uint256 requested, uint256 cap);
    error TierMultTooHigh(uint8 index, uint256 requested, uint256 cap);

    // ─── Constructor ─────────────────────────────────────────────────

    constructor(
        address initialOwner,
        address _brawlers,
        address _duel,
        address _treasury,
        uint256 _resurrectionCost
    ) Ownable(initialOwner) {
        require(_brawlers != address(0), "Graveyard: zero brawlers");
        require(_duel != address(0), "Graveyard: zero duel");
        if (_treasury == address(0)) revert ZeroTreasury();
        brawlers = Brawlers(_brawlers);
        duel = Duel(_duel);
        treasury = _treasury;
        resurrectionCost = _resurrectionCost;
        // Default curve per 2026-04-24 spec: min $100 at Common+0wins; scales
        // up by rarity and by wins. Values are multipliers × 10 (so 15 → 1.5×).
        tierMults = [uint256(10), 15, 25, 40, 70, 150];
        // Default per-revive cap: $500 at $4k ETH = 0.125 ETH. Owner can
        // adjust via setResurrectionCap; resurrect-cost-keeper bot mirrors
        // it to USD as ETH price drifts. Set to 0 to disable the cap (then
        // only MAX_RESURRECTION_COST × highest-mult × wins-mult bounds apply).
        resurrectionCap = 0.125 ether;
    }

    // ─── Admin ───────────────────────────────────────────────────────

    /// @notice Hard cap on the base resurrection cost. Stops a compromised
    ///         owner key from setting costs the math overflows on, or pricing
    ///         out every revive forever. ~1 ETH at $4k ETH is $4000, more
    ///         than 100x the launch base.
    uint256 public constant MAX_RESURRECTION_COST = 1 ether;

    /// @notice Hard cap on each tier multiplier (scaled by 10, so 1000 means
    ///         100x). Stops a compromised owner from making revives unaffordable
    ///         or overflowing the cost formula.
    uint256 public constant MAX_TIER_MULT = 1_000;

    /// @notice Max total a single resurrect can charge, in ETH wei. Applied
    ///         AFTER the tier + wins formula. Stops a 10-win king from being
    ///         priced out at $3000+ when the dev wants to keep the worst-case
    ///         single revive at $500 (= 0.125 ETH @ $4k ETH). Adjustable via
    ///         setResurrectionCap. Set 0 to disable the cap and fall back to
    ///         the original tier×wins formula.
    uint256 public resurrectionCap;

    event ResurrectionCapChanged(uint256 oldCap, uint256 newCap);

    /// @notice Update the per-revive USD cap (in ETH wei). Capped at
    ///         MAX_RESURRECTION_COST so a compromised owner can't disable
    ///         the safety ceiling. Owner-only.
    function setResurrectionCap(uint256 newCap) external onlyOwner {
        if (newCap > MAX_RESURRECTION_COST) revert CostTooHigh(newCap, MAX_RESURRECTION_COST);
        emit ResurrectionCapChanged(resurrectionCap, newCap);
        resurrectionCap = newCap;
    }

    function setResurrectionCost(uint256 newCost) external onlyOwner {
        if (newCost > MAX_RESURRECTION_COST) revert CostTooHigh(newCost, MAX_RESURRECTION_COST);
        emit ResurrectionCostChanged(resurrectionCost, newCost);
        resurrectionCost = newCost;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroTreasury();
        emit TreasuryChanged(treasury, newTreasury);
        treasury = newTreasury;
    }

    /**
     * @notice Update the per-tier multipliers. Values are scaled by 10 (e.g.
     *         15 means 1.5x multiplier). Array order is [common, uncommon,
     *         rare, legendary, epic, king]. Each entry is capped at
     *         MAX_TIER_MULT.
     */
    function setTierMults(uint256[6] calldata newMults) external onlyOwner {
        for (uint8 i = 0; i < 6; i++) {
            if (newMults[i] > MAX_TIER_MULT) {
                revert TierMultTooHigh(i, newMults[i], MAX_TIER_MULT);
            }
        }
        tierMults = newMults;
        emit TierMultsChanged(newMults);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Views ───────────────────────────────────────────────────────

    /**
     * @notice Per-brawler resurrection cost. Formula:
     *
     *           cost = resurrectionCost × tierMult / 10 × (10 + wins) / 10
     *
     *         Where `tierMult` is the brawler's rarity tier multiplier
     *         (scaled by 10, e.g. 15 means 1.5×) and `wins` is its total
     *         wins on-chain. Each win adds +10% on top of the tier cost.
     *
     *         Default tierMults: [10, 15, 25, 40, 70, 150] → with a base of
     *         $100:
     *           - Common @ 0 wins: $100
     *           - Common @ 10 wins: $200
     *           - Epic @ 0 wins: $700
     *           - Epic @ 10 wins: $1400
     *           - King @ 0 wins: $1500
     */
    /// @notice Token IDs 1..FOUNDER_FREE_RESURRECT_CAP get one free
    ///         resurrection ever. Subsequent revives charge the normal
    ///         `costFor(tokenId)`. Tracked via `hasUsedFreeResurrect`.
    uint256 public constant FOUNDER_FREE_RESURRECT_CAP = 100;

    /// @notice True after a founder brawler has used its one-time free
    ///         resurrection. Once flipped, future resurrects pay full price.
    mapping(uint256 => bool) public hasUsedFreeResurrect;

    function costFor(uint256 tokenId) public view returns (uint256) {
        // Founder freebie, first resurrect ever for tokenId 1..100 is free.
        // House brawlers (deploy-time keeper fighters) are excluded from the
        // freebie even if their tokenId sits in the founder range.
        if (
            tokenId <= FOUNDER_FREE_RESURRECT_CAP &&
            !hasUsedFreeResurrect[tokenId] &&
            !brawlers.isHouseBrawler(tokenId)
        ) {
            return 0;
        }
        uint8 tier = brawlers.rarityOf(tokenId);
        uint256 mult = tierMults[tier];
        uint32 wins = brawlers.getBrawler(tokenId).wins;
        // cost = base × mult × (10 + wins) / 100
        uint256 raw = (resurrectionCost * mult * (10 + wins)) / 100;
        // Apply per-revive cap if set. Caps the worst-case (king with many
        // wins) at the dev-set ceiling ($500 default = 0.125 ETH @ $4k).
        uint256 cap = resurrectionCap;
        if (cap > 0 && raw > cap) return cap;
        return raw;
    }

    // ─── External: resurrect ─────────────────────────────────────────

    /**
     * @notice Revive a dead brawler. Caller must own it and pay
     *         `costFor(tokenId)`, scaled by rarity (free for first
     *         resurrect of token IDs 1..100).
     * @param tokenId The dead brawler.
     */
    function resurrect(uint256 tokenId) external payable whenNotPaused nonReentrant {
        if (brawlers.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (brawlers.isAlive(tokenId)) revert NotDead();

        uint256 required = costFor(tokenId);
        if (msg.value < required) {
            revert InsufficientPayment(required, msg.value);
        }

        // Mark founder's free-revive used BEFORE forwarding funds so the
        // second revive pays normally even if the first was free. Mirrors the
        // exclusion in `costFor` so the flag is only stamped when the freebie
        // actually applies.
        if (
            tokenId <= FOUNDER_FREE_RESURRECT_CAP &&
            !hasUsedFreeResurrect[tokenId] &&
            !brawlers.isHouseBrawler(tokenId)
        ) {
            hasUsedFreeResurrect[tokenId] = true;
        }

        // Reset consecutive-loss counter so revived brawler isn't one loss from death.
        duel.resetStreak(tokenId);

        // Forward exactly `required` to treasury (matches Marketplace.buy
        // refund symmetry, prevents fat-finger overpay losses). The leftover,
        // if any, comes back to the caller. `required` may be 0 for a founder
        // free revive, in which case we just refund whatever was sent.
        if (required > 0) {
            (bool ok,) = treasury.call{value: required}("");
            if (!ok) revert TreasuryTransferFailed();
        }
        uint256 refund = msg.value - required;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }

        brawlers.resurrect(tokenId);
        emit Resurrected(tokenId, msg.sender, required);
    }

    // ─── Fallback: reject direct sends ───────────────────────────────

    receive() external payable {
        revert("Graveyard: use resurrect()");
    }

    fallback() external payable {
        revert("Graveyard: invalid call");
    }
}
