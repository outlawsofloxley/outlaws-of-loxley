// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @dev Minimal Brawlers fragment we need beyond ERC-721. Lets us guard
///      `list()` against listing dead brawlers without dragging in the
///      whole Brawlers contract type.
interface IBrawlersDeadRead {
    function isDead(uint256 tokenId) external view returns (bool);
}

/**
 * @title Brawlers Marketplace
 * @notice Peer-to-peer marketplace for Brawler NFTs. Sellers list at a price
 *         in native currency (tBNB on BSC Testnet, BNB on BSC mainnet, ETH on
 *         Base). Buyers pay the listed price; the contract forwards proceeds
 *         minus a configurable fee (default 5%) to the dev treasury.
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
 *         Approval-based, no escrow: the seller retains custody of their NFT
 *         and simply grants this contract approval to transfer on a sale.
 *         This means:
 *           - The seller can keep using their brawler (e.g. list while
 *             dueling, though fighting can't kill them off a listing).
 *           - If the seller transfers or re-approves elsewhere, the next
 *             buy call detects the stale state and auto-cancels the listing
 *             while refunding the buyer. No locked NFTs, no stuck funds.
 *           - If the seller revokes approval, same deal.
 *
 *         BRAWL token is NOT accepted here, it's reserved for duel stakes
 *         and external DEX trading. Per-chain native currency only.
 */
contract Marketplace is Ownable, ReentrancyGuard, Pausable, IERC721Receiver {
    IERC721 public immutable brawlers;

    /// @notice Protocol fee in basis points (500 = 5%).
    uint16 public feeBps;
    /// @notice Hard cap on feeBps. Prevents accidental or malicious fee-to-100%.
    uint16 public constant MAX_FEE_BPS = 1000; // 10%
    /// @notice Where protocol fees are forwarded on each sale.
    address public feeTreasury;

    struct Listing {
        address seller;
        uint256 price; // in wei, native currency
        uint64 listedAt;
    }

    /// @notice tokenId → active listing. seller == address(0) means not listed.
    mapping(uint256 => Listing) private _listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Unlisted(uint256 indexed tokenId, address indexed seller);
    event PriceUpdated(uint256 indexed tokenId, uint256 oldPrice, uint256 newPrice);
    event Sold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 fee
    );
    event FeeChanged(uint16 oldBps, uint16 newBps);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);

    error NotListed();
    error AlreadyListed();
    error NotSeller();
    error NotOwner();
    error NotApproved();
    error NotStale();
    error ZeroPrice();
    error ZeroAddress();
    error InsufficientPayment(uint256 expected, uint256 received);
    error TransferFailed();
    error FeeTooHigh(uint16 requested);
    /// @notice Dead brawlers can't be listed. Resurrect first, then list.
    error BrawlerIsDead(uint256 tokenId);

    constructor(
        address _brawlers,
        address _feeTreasury,
        uint16 _feeBps,
        address initialOwner
    ) Ownable(initialOwner) {
        // Note: zero `initialOwner` is caught by Ownable's own OwnableInvalidOwner
        // revert during its constructor, which runs before this body.
        if (_brawlers == address(0) || _feeTreasury == address(0)) {
            revert ZeroAddress();
        }
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh(_feeBps);
        brawlers = IERC721(_brawlers);
        feeTreasury = _feeTreasury;
        feeBps = _feeBps;
    }

    // ─── Views ────────────────────────────────────────────────────────

    function listingOf(uint256 tokenId) external view returns (Listing memory) {
        return _listings[tokenId];
    }

    function isListed(uint256 tokenId) external view returns (bool) {
        return _listings[tokenId].seller != address(0);
    }

    function isApprovedForMarketplace(uint256 tokenId, address owner_) public view returns (bool) {
        return brawlers.getApproved(tokenId) == address(this)
            || brawlers.isApprovedForAll(owner_, address(this));
    }

    // ─── Seller actions ───────────────────────────────────────────────

    /**
     * @notice List a brawler for sale at `price` wei of native currency.
     *         Caller must own the brawler AND have already approved the
     *         marketplace to transfer it (either per-token via `approve` or
     *         blanket via `setApprovalForAll`).
     */
    function list(uint256 tokenId, uint256 price) external whenNotPaused {
        if (price == 0) revert ZeroPrice();
        if (brawlers.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (!isApprovedForMarketplace(tokenId, msg.sender)) revert NotApproved();
        if (_listings[tokenId].seller != address(0)) revert AlreadyListed();
        // v11: dead brawlers can't be listed. Buyers shouldn't have to
        // discover post-purchase that they bought a corpse.
        if (IBrawlersDeadRead(address(brawlers)).isDead(tokenId)) {
            revert BrawlerIsDead(tokenId);
        }

        _listings[tokenId] = Listing({
            seller: msg.sender,
            price: price,
            listedAt: uint64(block.timestamp)
        });
        emit Listed(tokenId, msg.sender, price);
    }

    /**
     * @notice Change the price of an existing listing.
     */
    function updatePrice(uint256 tokenId, uint256 newPrice) external whenNotPaused {
        if (newPrice == 0) revert ZeroPrice();
        Listing storage l = _listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();

        uint256 oldPrice = l.price;
        l.price = newPrice;
        emit PriceUpdated(tokenId, oldPrice, newPrice);
    }

    /**
     * @notice Cancel an existing listing. No-op if not listed or not seller.
     *         Not gated by whenNotPaused, sellers should always be able to
     *         exit even if the marketplace is frozen for an emergency.
     */
    function cancel(uint256 tokenId) external {
        Listing memory l = _listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();
        delete _listings[tokenId];
        emit Unlisted(tokenId, msg.sender);
    }

    // ─── Buy ──────────────────────────────────────────────────────────

    /**
     * @notice Purchase a listed brawler by paying exactly (or more, with
     *         refund) its listed price in native currency. The marketplace
     *         takes its cut, forwards the rest to the seller, and transfers
     *         the NFT. Reverts cleanly if ownership or approval has gone
     *         stale since the listing was created (seller moved the NFT or
     *         revoked approval). In that case the listing is deleted and
     *         the buyer's funds are refunded in full.
     */
    function buy(uint256 tokenId) external payable nonReentrant whenNotPaused {
        Listing memory l = _listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.value < l.price) revert InsufficientPayment(l.price, msg.value);

        // Check for stale state. Reverting is safe, the EVM returns
        // `msg.value` to the caller automatically on revert. The stale
        // listing remains in storage until someone calls `sweep`.
        address currentOwner = brawlers.ownerOf(tokenId);
        if (currentOwner != l.seller) revert NotOwner();
        if (!isApprovedForMarketplace(tokenId, l.seller)) revert NotApproved();

        // CEI: clear storage BEFORE external calls.
        delete _listings[tokenId];

        uint256 fee = (l.price * feeBps) / 10_000;
        uint256 sellerProceeds = l.price - fee;
        uint256 refund = msg.value - l.price;

        // Pay everyone first so by the time the buyer's onERC721Received
        // hook fires, every state change has settled. Removes the inconsistent
        // window where an external observer could see an empty listing AND
        // the NFT already owned by the buyer while funds are still in flight.
        if (sellerProceeds > 0) _safeTransfer(payable(l.seller), sellerProceeds);
        if (fee > 0) _safeTransfer(payable(feeTreasury), fee);
        if (refund > 0) _safeTransfer(payable(msg.sender), refund);

        // Then transfer the NFT. safeTransferFrom catches contract-to-contract
        // receiver issues (non-receivers revert via onERC721Received).
        brawlers.safeTransferFrom(l.seller, msg.sender, tokenId);

        emit Sold(tokenId, l.seller, msg.sender, l.price, fee);
    }

    /**
     * @notice Anyone can sweep a stale listing, one where the seller no
     *         longer owns the brawler, or has revoked the marketplace's
     *         approval to transfer it. Reverts if the listing is still
     *         valid (in which case only the seller can call `cancel`).
     *         Useful for keepers / the frontend to prune dead listings.
     */
    function sweep(uint256 tokenId) external {
        Listing memory l = _listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        address currentOwner = brawlers.ownerOf(tokenId);
        bool stillApproved = isApprovedForMarketplace(tokenId, l.seller);
        if (currentOwner == l.seller && stillApproved) revert NotStale();

        delete _listings[tokenId];
        emit Unlisted(tokenId, l.seller);
    }

    function _safeTransfer(address payable to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ─── Admin ────────────────────────────────────────────────────────

    function setFee(uint16 _feeBps) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh(_feeBps);
        uint16 oldFee = feeBps;
        feeBps = _feeBps;
        emit FeeChanged(oldFee, _feeBps);
    }

    function setFeeTreasury(address _feeTreasury) external onlyOwner {
        if (_feeTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = feeTreasury;
        feeTreasury = _feeTreasury;
        emit TreasuryChanged(oldTreasury, _feeTreasury);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── IERC721Receiver ──────────────────────────────────────────────
    //
    // Implemented so the buy-side `safeTransferFrom` never routes through
    // this contract (buyers are EOAs for now; future contract buyers would
    // need to implement their own receiver). Returning the magic value
    // makes us a valid receiver if one is ever needed.

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    // Reject direct native transfers, funds only accepted via `buy`.
    receive() external payable {
        revert TransferFailed();
    }
}
