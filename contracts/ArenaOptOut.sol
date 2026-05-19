// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title ArenaOptOut
 * @notice Per-brawler "remove from the duel arena" flag. Pure on-chain state.
 *
 * @dev Why this exists: prior to this contract, "being in the arena" was
 *      computed by every frontend from `BRAWL.allowance(owner, router) >= fightCost`
 *      AND `BRAWL.balanceOf(owner) >= fightCost`. Both checks are per-owner,
 *      not per-brawler, so a wallet with multiple brawlers couldn't opt one
 *      individual brawler out without revoking allowance for all of them.
 *      This contract gives per-brawler opt-out that every frontend can read
 *      and respect. No funds custodied, no token transfers, no ownership,
 *      no upgrade path. Purely a set-membership store.
 *
 *      Owner-gated via the underlying Brawlers contract's `ownerOf`. If a
 *      brawler is transferred while opted out, the new owner inherits the
 *      flag (since the flag lives on the tokenId, not the address) and can
 *      flip it. This matches user expectations — buying an opted-out brawler
 *      means you actively re-opt it in.
 *
 *      Frontends should treat this as ADVISORY: the Duel/DuelRouter contracts
 *      do NOT consult this state. A bad actor with a custom client could
 *      still match against an opted-out brawler. The official frontend
 *      filters opted-out brawlers from the candidate pool so the canonical
 *      UI honours the flag globally.
 *
 * @custom:website https://baseicbrawlers.com
 * @custom:github  https://github.com/baseicbrawlers/baseic-brawlers
 */
contract ArenaOptOut {
    IERC721 public immutable brawlers;

    /// @notice True if the brawler is OUT of the arena. Default false = in arena.
    mapping(uint256 => bool) public optedOut;

    event ArenaOptOutSet(uint256 indexed tokenId, address indexed setter, bool optedOut);

    error ZeroAddress();
    error NotOwner(uint256 tokenId);
    error EmptyBatch();

    constructor(address brawlersAddress) {
        if (brawlersAddress == address(0)) revert ZeroAddress();
        brawlers = IERC721(brawlersAddress);
    }

    /// @notice Set the opt-out flag for one brawler. Caller must own it.
    function setOptOut(uint256 tokenId, bool flag) external {
        if (brawlers.ownerOf(tokenId) != msg.sender) revert NotOwner(tokenId);
        optedOut[tokenId] = flag;
        emit ArenaOptOutSet(tokenId, msg.sender, flag);
    }

    /// @notice Set the opt-out flag for many brawlers in one tx. Caller must
    ///         own every tokenId in the batch; reverts on the first one not
    ///         owned (no partial application).
    function setOptOutBatch(uint256[] calldata tokenIds, bool flag) external {
        uint256 n = tokenIds.length;
        if (n == 0) revert EmptyBatch();
        for (uint256 i = 0; i < n; ) {
            uint256 id = tokenIds[i];
            if (brawlers.ownerOf(id) != msg.sender) revert NotOwner(id);
            optedOut[id] = flag;
            emit ArenaOptOutSet(id, msg.sender, flag);
            unchecked { ++i; }
        }
    }

    /// @notice Batch view for frontends that need to check many brawlers
    ///         at once without N RPC round-trips. Returns flags in the same
    ///         order as the input tokenIds.
    function optedOutMany(uint256[] calldata tokenIds) external view returns (bool[] memory out) {
        uint256 n = tokenIds.length;
        out = new bool[](n);
        for (uint256 i = 0; i < n; ) {
            out[i] = optedOut[tokenIds[i]];
            unchecked { ++i; }
        }
    }
}
