// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Brawlers} from "./Brawlers.sol";

/**
 * @title MintDrop
 * @notice Single-shot initial-mint controller for BASEic Brawlers. Sells up
 *         to MAX_MINT brawlers at a dev-settable ETH / USDT / USDC price
 *         and airdrops BRAWL tokens to each buyer.
 *
 * @dev Wiring at deploy time:
 *        1. Deploy Brawlers, Duel, Graveyard.
 *        2. Deploy BRAWL ERC-20 (100,000 minted to deployer EOA).
 *        3. Deploy MintDrop with references to Brawlers, BRAWL, USDT, USDC.
 *        4. Brawlers.setMintDrop(mintDrop), grants exclusive mint rights.
 *        5. BRAWL.transfer(mintDrop, 25_000e18), fund the airdrop budget.
 *
 *      Flow (public user):
 *        mintWithETH:  send msg.value == ethPrice, get brawler + airdrop.
 *        mintWithUSDT: approve(mintDrop, usdtPrice) first, then call.
 *        mintWithUSDC: approve(mintDrop, usdcPrice) first, then call.
 *        Proceeds go to `treasury`.
 *
 *      Caps: MAX_MINT = 2000 hard-coded. Matches the Brawlers MAX_SUPPLY so
 *      the last mint either contract allows is the same event.
 */
contract MintDrop is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────

    uint256 public constant MAX_MINT = 2000;
    /// @notice Upper bound on batch-mint count per tx. Caps gas + revert
    ///         blast-radius; larger batches hit block gas limits on some
    ///         chains and slow indexers.
    uint256 public constant MAX_BATCH = 20;

    // ─── Immutable refs ──────────────────────────────────────────────

    Brawlers public immutable brawlers;
    IERC20 public immutable brawl;
    IERC20 public immutable usdt;
    IERC20 public immutable usdc;

    // ─── Tiered pricing ──────────────────────────────────────────────

    /// @notice Price tier for the layered mint. Each tier covers mint numbers
    ///         (totalSold + 1) through `upToSold` inclusive. Tiers MUST be
    ///         sorted ascending by `upToSold` so `priceForMint` short-circuits
    ///         on the first matching entry. The final tier should set
    ///         `upToSold = MAX_MINT` to cover all paid mints.
    struct PriceTier {
        uint16 upToSold;
        uint128 ethPrice;   // wei
        uint128 usdcPrice;  // 6dp
        uint128 usdtPrice;  // 6dp
    }
    PriceTier[] private _priceTiers;

    // ─── Admin-settable state ────────────────────────────────────────

    /// @notice Flat fallback price in wei. Only used if no tiers configured.
    uint256 public ethPrice;
    /// @notice Flat fallback price in USDT's smallest unit (6 decimals).
    uint256 public usdtPrice;
    /// @notice Flat fallback price in USDC's smallest unit (6 decimals).
    uint256 public usdcPrice;
    /// @notice BRAWL airdropped per mint (zero on mainnet by design, see
    ///         FOUNDER_AIRDROP for the bonus on the first 100 mints).
    uint256 public airdropPerMint;
    /// @notice Bonus BRAWL airdropped to the FIRST `FOUNDER_AIRDROP_CAP`
    ///         minters in addition to airdropPerMint (default-zero).
    ///         Default = enough for ~2 fights on launch-day pricing.
    uint256 public founderAirdropAmount;
    /// @notice Number of "founder" mints that get the founder airdrop +
    ///         visible Founder badge in UI (token ids 1..FOUNDER_AIRDROP_CAP).
    uint256 public constant FOUNDER_AIRDROP_CAP = 100;
    /// @notice Smaller subset of "first founders" that get an additional
    ///         super-rare cosmetic. UI renders a gold "FOUNDER 50" badge
    ///         on token ids 1..FOUNDER_50_CAP. No on-chain action, UI-only.
    uint256 public constant FOUNDER_50_CAP = 50;
    /// @notice Receives the dev-share portion of mint proceeds (ETH/USDT/USDC).
    address public treasury;
    /// @notice Receives the LP-share portion of mint proceeds. Dev manually
    ///         deploys these funds to the BRAWL/ETH LP pair (off-chain) to
    ///         deepen liquidity as the mint progresses. Splits cleanly so
    ///         minters can see "X went to dev, Y went to LP fund" on-chain.
    address public lpTreasury;
    /// @notice % (in basis points) of each mint that goes to lpTreasury.
    ///         Default 3333 (33.33%), matches "$10 of $30" split.
    ///         Range 0..10000. Dev can tune via setLpShare().
    uint256 public lpShareBps;
    /// @notice BRAWL sent to lpTreasury alongside the per-mint ETH share.
    ///         Pre-fund MintDrop with enough BRAWL to cover this; once it
    ///         runs out, lp pairing silently stops (mints still succeed).
    ///         Tune via setLpBrawlPerMint() as price drifts.
    uint256 public lpBrawlPerMint;
    /// @notice Count of brawlers sold by this contract (paid mints + bonus).
    uint256 public totalSold;
    /// @notice Count of bonus brawlers minted (bulk discount + lottery).
    ///         Tracked for UI / dashboard reporting.
    uint256 public totalBonusMinted;

    // ─── Events ──────────────────────────────────────────────────────

    event BrawlerSold(
        address indexed buyer,
        uint256 indexed tokenId,
        uint8 paymentType, // 0 = ETH, 1 = USDT, 2 = USDC
        uint256 amountPaid,
        uint256 airdropped
    );
    event PricesChanged(uint256 newEthPrice, uint256 newUsdtPrice, uint256 newUsdcPrice);
    event PriceTiersSet(uint256 tierCount);
    event AirdropChanged(uint256 newAirdropPerMint);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event LpTreasuryChanged(address indexed oldLpTreasury, address indexed newLpTreasury);
    event LpShareChanged(uint256 newLpShareBps);
    event LpBrawlPerMintChanged(uint256 newAmount);
    event LpBrawlSent(address indexed lpTreasury, uint256 amount);
    event FounderAirdropChanged(uint256 newFounderAirdropAmount);
    event FounderAirdropped(address indexed buyer, uint256 indexed tokenId, uint256 amount);
    event BonusMinted(address indexed buyer, uint256 indexed tokenId, string reason);

    // ─── Errors ──────────────────────────────────────────────────────

    error SupplyExhausted();
    error IncorrectETH(uint256 expected, uint256 received);
    error EthTransferFailed();
    error LpTransferFailed();
    error ZeroAddress();
    error ZeroPrice();
    error InvalidCount(uint256 count);
    error InvalidShare(uint256 bps);
    error InvalidTiers();

    // ─── Constructor ─────────────────────────────────────────────────

    struct DeployParams {
        address initialOwner;
        address brawlersAddr;
        address brawlAddr;
        address usdtAddr;
        address usdcAddr;
        address devTreasury;
        address lpTreasury;
        uint256 ethPrice;
        uint256 usdtPrice;
        uint256 usdcPrice;
        uint256 airdropPerMint;
        uint256 founderAirdropAmount;
        uint256 lpShareBps;
        uint256 lpBrawlPerMint;
    }

    constructor(DeployParams memory p) Ownable(p.initialOwner) {
        if (p.brawlersAddr == address(0)) revert ZeroAddress();
        if (p.brawlAddr == address(0)) revert ZeroAddress();
        if (p.usdtAddr == address(0)) revert ZeroAddress();
        if (p.usdcAddr == address(0)) revert ZeroAddress();
        if (p.devTreasury == address(0)) revert ZeroAddress();
        if (p.lpTreasury == address(0)) revert ZeroAddress();
        if (p.lpShareBps > 10000) revert InvalidShare(p.lpShareBps);
        brawlers = Brawlers(p.brawlersAddr);
        brawl = IERC20(p.brawlAddr);
        usdt = IERC20(p.usdtAddr);
        usdc = IERC20(p.usdcAddr);
        treasury = p.devTreasury;
        lpTreasury = p.lpTreasury;
        ethPrice = p.ethPrice;
        usdtPrice = p.usdtPrice;
        usdcPrice = p.usdcPrice;
        airdropPerMint = p.airdropPerMint;
        founderAirdropAmount = p.founderAirdropAmount;
        lpShareBps = p.lpShareBps;
        lpBrawlPerMint = p.lpBrawlPerMint;
    }

    // ─── Admin ───────────────────────────────────────────────────────

    function setPrices(uint256 _ethPrice, uint256 _usdtPrice, uint256 _usdcPrice)
        external
        onlyOwner
    {
        ethPrice = _ethPrice;
        usdtPrice = _usdtPrice;
        usdcPrice = _usdcPrice;
        emit PricesChanged(_ethPrice, _usdtPrice, _usdcPrice);
    }

    /**
     * @notice Replace the layered price table. Tiers MUST be sorted ascending
     *         by `upToSold`. The final tier's `upToSold` should normally be
     *         `MAX_MINT` so every paid mint maps to a tier; mints beyond the
     *         last `upToSold` fall back to flat `ethPrice/usdtPrice/usdcPrice`.
     * @param tiers New tier table. Pass an empty array to disable tiered pricing.
     */
    function setPriceTiers(PriceTier[] calldata tiers) external onlyOwner {
        // Validate ascending order.
        for (uint256 i = 1; i < tiers.length; i++) {
            if (tiers[i].upToSold <= tiers[i - 1].upToSold) revert InvalidTiers();
        }
        delete _priceTiers;
        for (uint256 i = 0; i < tiers.length; i++) {
            _priceTiers.push(tiers[i]);
        }
        emit PriceTiersSet(tiers.length);
    }

    /// @notice Number of configured price tiers.
    function priceTierCount() external view returns (uint256) {
        return _priceTiers.length;
    }

    /// @notice Read a single tier by index (revert on out-of-range).
    function priceTierAt(uint256 i) external view returns (PriceTier memory) {
        return _priceTiers[i];
    }

    /**
     * @notice Lookup the per-unit price for the Nth mint (1-indexed).
     *         Falls back to the flat `ethPrice/usdtPrice/usdcPrice` if no
     *         tier covers `mintNumber`.
     */
    function priceForMint(uint256 mintNumber)
        public
        view
        returns (uint256 eth, uint256 usdc, uint256 usdt)
    {
        uint256 n = _priceTiers.length;
        for (uint256 i = 0; i < n; i++) {
            if (mintNumber <= _priceTiers[i].upToSold) {
                return (
                    _priceTiers[i].ethPrice,
                    _priceTiers[i].usdcPrice,
                    _priceTiers[i].usdtPrice
                );
            }
        }
        return (ethPrice, usdcPrice, usdtPrice);
    }

    /**
     * @notice Sum of per-unit prices for `count` consecutive mints starting
     *         at the next-to-be-minted slot. Used by frontends to display
     *         the total cost of a batch that may straddle tiers.
     */
    function batchCost(uint256 count)
        external
        view
        returns (uint256 ethTotal, uint256 usdcTotal, uint256 usdtTotal)
    {
        uint256 start = totalSold + 1;
        for (uint256 i = 0; i < count; i++) {
            (uint256 e, uint256 c, uint256 t) = priceForMint(start + i);
            ethTotal += e;
            usdcTotal += c;
            usdtTotal += t;
        }
    }

    function setAirdropPerMint(uint256 _airdrop) external onlyOwner {
        airdropPerMint = _airdrop;
        emit AirdropChanged(_airdrop);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        emit TreasuryChanged(treasury, _treasury);
        treasury = _treasury;
    }

    function setLpTreasury(address _lpTreasury) external onlyOwner {
        if (_lpTreasury == address(0)) revert ZeroAddress();
        emit LpTreasuryChanged(lpTreasury, _lpTreasury);
        lpTreasury = _lpTreasury;
    }

    /// @notice Set the % (basis points, 0..10000) of mint proceeds routed
    ///         to lpTreasury. Default 3333 (33.33%) → matches "$10 of $30"
    ///         split. Setting 0 sends all proceeds to dev `treasury`.
    function setLpShare(uint256 _lpShareBps) external onlyOwner {
        if (_lpShareBps > 10000) revert InvalidShare(_lpShareBps);
        lpShareBps = _lpShareBps;
        emit LpShareChanged(_lpShareBps);
    }

    /// @notice Adjust the founder airdrop amount (BRAWL wei) given to the
    ///         first FOUNDER_AIRDROP_CAP minters. Set 0 to disable.
    function setFounderAirdrop(uint256 _founderAirdropAmount) external onlyOwner {
        founderAirdropAmount = _founderAirdropAmount;
        emit FounderAirdropChanged(_founderAirdropAmount);
    }

    /// @notice Set the BRAWL amount sent to lpTreasury per mint, paired with
    ///         the lpShareBps slice of ETH. Tune as price drifts so the LP
    ///         add stays balanced. 0 disables BRAWL pairing entirely.
    function setLpBrawlPerMint(uint256 _amount) external onlyOwner {
        lpBrawlPerMint = _amount;
        emit LpBrawlPerMintChanged(_amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Withdraw any BRAWL remaining in this contract (e.g. after
     *         campaign ends). Fail-safe, nobody expects a leftover balance,
     *         but in case airdrop was misconfigured mid-flight.
     */
    function withdrawBRAWL(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        brawl.safeTransfer(to, amount);
    }

    // ─── Public mint ─────────────────────────────────────────────────

    function mintWithETH(address to)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 tokenId)
    {
        if (totalSold >= MAX_MINT) revert SupplyExhausted();
        if (to == address(0)) revert ZeroAddress();
        (uint256 eth,,) = priceForMint(totalSold + 1);
        if (msg.value != eth) revert IncorrectETH(eth, msg.value);

        unchecked {
            totalSold++;
        }

        if (msg.value > 0) _routeETH(msg.value);
        _pairBrawlForLp(1);
        tokenId = brawlers.mint(to);
        uint256 airdropped = _maybeAirdrop(to, tokenId);

        emit BrawlerSold(to, tokenId, 0, msg.value, airdropped);

        // Lottery roll, 1-in-2000 free bonus brawler
        if (_lotteryHit(to, tokenId)) {
            _grantBonusMints(to, 1, "lottery");
        }
    }

    function mintWithUSDT(address to)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 tokenId)
    {
        if (totalSold >= MAX_MINT) revert SupplyExhausted();
        if (to == address(0)) revert ZeroAddress();
        (,, uint256 usdtP) = priceForMint(totalSold + 1);

        unchecked {
            totalSold++;
        }

        if (usdtP > 0) _routeERC20(usdt, msg.sender, usdtP);
        _pairBrawlForLp(1);
        tokenId = brawlers.mint(to);
        uint256 airdropped = _maybeAirdrop(to, tokenId);

        emit BrawlerSold(to, tokenId, 1, usdtP, airdropped);

        if (_lotteryHit(to, tokenId)) {
            _grantBonusMints(to, 1, "lottery");
        }
    }

    function mintWithUSDC(address to)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 tokenId)
    {
        if (totalSold >= MAX_MINT) revert SupplyExhausted();
        if (to == address(0)) revert ZeroAddress();
        (, uint256 usdcP,) = priceForMint(totalSold + 1);

        unchecked {
            totalSold++;
        }

        if (usdcP > 0) _routeERC20(usdc, msg.sender, usdcP);
        _pairBrawlForLp(1);
        tokenId = brawlers.mint(to);
        uint256 airdropped = _maybeAirdrop(to, tokenId);

        emit BrawlerSold(to, tokenId, 2, usdcP, airdropped);

        if (_lotteryHit(to, tokenId)) {
            _grantBonusMints(to, 1, "lottery");
        }
    }

    // ─── Batch mint (N in one tx, one wallet signature) ──────────────

    /**
     * @notice Mint `count` brawlers to `to` in a single transaction, paying
     *         `count × ethPrice` in native gas. One wallet prompt, one tx.
     *         Capped at MAX_BATCH per call.
     * @param to Recipient of the NFTs + airdrop.
     * @param count How many to mint (1..MAX_BATCH).
     * @return tokenIds The newly minted token IDs, in order.
     */
    function mintMultipleWithETH(address to, uint256 count)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256[] memory tokenIds)
    {
        if (count == 0 || count > MAX_BATCH) revert InvalidCount(count);
        if (totalSold + count > MAX_MINT) revert SupplyExhausted();
        if (to == address(0)) revert ZeroAddress();

        // Sum per-unit prices across the tiers this batch straddles.
        uint256 startMint = totalSold + 1;
        uint256[] memory perUnit = new uint256[](count);
        uint256 totalPrice = 0;
        for (uint256 i = 0; i < count; i++) {
            (uint256 e,,) = priceForMint(startMint + i);
            perUnit[i] = e;
            totalPrice += e;
        }
        if (msg.value != totalPrice) revert IncorrectETH(totalPrice, msg.value);

        unchecked {
            totalSold += count;
        }
        uint256 bonus = _bulkBonus(count);

        if (msg.value > 0) _routeETH(msg.value);
        _pairBrawlForLp(count);

        tokenIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            tokenIds[i] = brawlers.mint(to);
            uint256 airdropped = _maybeAirdrop(to, tokenIds[i]);
            emit BrawlerSold(to, tokenIds[i], 0, perUnit[i], airdropped);
        }

        if (bonus > 0) {
            _grantBonusMints(to, bonus, "bulk-discount");
        }
    }

    /**
     * @notice Mint `count` brawlers to `to` in a single tx, paying
     *         `count × usdtPrice` via one `safeTransferFrom`. Requires prior
     *         USDT approval for the total amount.
     */
    function mintMultipleWithUSDT(address to, uint256 count)
        external
        whenNotPaused
        nonReentrant
        returns (uint256[] memory tokenIds)
    {
        if (count == 0 || count > MAX_BATCH) revert InvalidCount(count);
        if (totalSold + count > MAX_MINT) revert SupplyExhausted();
        if (to == address(0)) revert ZeroAddress();

        uint256 startMint = totalSold + 1;
        uint256[] memory perUnit = new uint256[](count);
        uint256 totalPrice = 0;
        for (uint256 i = 0; i < count; i++) {
            (,, uint256 t) = priceForMint(startMint + i);
            perUnit[i] = t;
            totalPrice += t;
        }

        unchecked {
            totalSold += count;
        }
        uint256 bonus = _bulkBonus(count);

        if (totalPrice > 0) _routeERC20(usdt, msg.sender, totalPrice);
        _pairBrawlForLp(count);

        tokenIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            tokenIds[i] = brawlers.mint(to);
            uint256 airdropped = _maybeAirdrop(to, tokenIds[i]);
            emit BrawlerSold(to, tokenIds[i], 1, perUnit[i], airdropped);
        }

        if (bonus > 0) {
            _grantBonusMints(to, bonus, "bulk-discount");
        }
    }

    /**
     * @notice Mint `count` brawlers to `to` in a single tx, paying
     *         `count × usdcPrice` via one `safeTransferFrom`. Requires prior
     *         USDC approval for the total amount.
     */
    function mintMultipleWithUSDC(address to, uint256 count)
        external
        whenNotPaused
        nonReentrant
        returns (uint256[] memory tokenIds)
    {
        if (count == 0 || count > MAX_BATCH) revert InvalidCount(count);
        if (totalSold + count > MAX_MINT) revert SupplyExhausted();
        if (to == address(0)) revert ZeroAddress();

        uint256 startMint = totalSold + 1;
        uint256[] memory perUnit = new uint256[](count);
        uint256 totalPrice = 0;
        for (uint256 i = 0; i < count; i++) {
            (, uint256 c,) = priceForMint(startMint + i);
            perUnit[i] = c;
            totalPrice += c;
        }

        unchecked {
            totalSold += count;
        }
        uint256 bonus = _bulkBonus(count);

        if (totalPrice > 0) _routeERC20(usdc, msg.sender, totalPrice);
        _pairBrawlForLp(count);

        tokenIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            tokenIds[i] = brawlers.mint(to);
            uint256 airdropped = _maybeAirdrop(to, tokenIds[i]);
            emit BrawlerSold(to, tokenIds[i], 2, perUnit[i], airdropped);
        }

        if (bonus > 0) {
            _grantBonusMints(to, bonus, "bulk-discount");
        }
    }

    /**
     * @dev ERC-20 equivalent of `_routeETH`, pulls `amount` from `from`
     *      and splits between dev `treasury` and `lpTreasury` per
     *      `lpShareBps`. Both transfers happen via SafeERC20.
     */
    function _routeERC20(IERC20 token, address from, uint256 amount) private {
        uint256 lpShare = (amount * lpShareBps) / 10000;
        uint256 devShare = amount - lpShare;
        if (devShare > 0) {
            token.safeTransferFrom(from, treasury, devShare);
        }
        if (lpShare > 0) {
            token.safeTransferFrom(from, lpTreasury, lpShare);
        }
    }

    /**
     * @dev Send `lpBrawlPerMint × times` BRAWL from this contract's reserve
     *      to lpTreasury, pairing the ETH/USDT/USDC LP-side payments with
     *      matching BRAWL. Silently sends less if the reserve is short.
     */
    function _pairBrawlForLp(uint256 times) private {
        if (lpBrawlPerMint == 0 || times == 0) return;
        uint256 want = lpBrawlPerMint * times;
        uint256 reserve = brawl.balanceOf(address(this));
        if (reserve < want) want = reserve;
        if (want == 0) return;
        brawl.safeTransfer(lpTreasury, want);
        emit LpBrawlSent(lpTreasury, want);
    }

    /**
     * @dev Bulk-mint discount table, buyer pays for `count` and gets
     *      `count + bonus` brawlers.
     *        20+  -> 7 free
     *        10+  -> 3 free
     *        5+   -> 1 free
     *        else -> 0
     */
    function _bulkBonus(uint256 count) private pure returns (uint256) {
        if (count >= 20) return 7;
        if (count >= 10) return 3;
        if (count >= 5) return 1;
        return 0;
    }

    /**
     * @dev Lottery roll, 1-in-2000 chance of an extra free mint per paid
     *      mint. Uses (prevrandao, buyer, tokenId, timestamp). Not
     *      cryptographically secure but unmanipulable for "did I get lucky".
     */
    function _lotteryHit(address buyer, uint256 tokenId) private view returns (bool) {
        uint256 r = uint256(
            keccak256(abi.encodePacked(block.prevrandao, buyer, tokenId, block.timestamp))
        );
        return (r % 2000) == 0;
    }

    /**
     * @dev Mint up to `cap` bonus brawlers to `to` and tag the reason on-
     *      chain. Caps to remaining MAX_MINT slots so we never overshoot.
     *      Returns the number actually minted.
     */
    function _grantBonusMints(address to, uint256 wanted, string memory reason)
        private
        returns (uint256 granted)
    {
        if (wanted == 0) return 0;
        uint256 remaining = MAX_MINT - totalSold;
        if (remaining == 0) return 0;
        granted = wanted > remaining ? remaining : wanted;
        unchecked {
            totalSold += granted;
            totalBonusMinted += granted;
        }
        for (uint256 i = 0; i < granted; i++) {
            uint256 id = brawlers.mint(to);
            uint256 airdropped = _maybeAirdrop(to, id);
            emit BrawlerSold(to, id, 0, 0, airdropped);
            emit BonusMinted(to, id, reason);
        }
    }

    /**
     * @dev Transfer airdropPerMint + (founder bonus, if applicable) to `to`
     *      from this contract's BRAWL balance. Shortfalls quietly airdrop
     *      less rather than reverting, a late mint shouldn't fail because
     *      airdrop budget is exhausted.
     *
     *      Founder bonus is paid to mints where the resulting tokenId falls
     *      in 1..FOUNDER_AIRDROP_CAP. Tracked via the brawler's own
     *      tokenId rather than mint order so it's deterministic + auditable.
     */
    function _maybeAirdrop(address to, uint256 tokenId) private returns (uint256 airdropped) {
        uint256 base = airdropPerMint;
        uint256 founder = (tokenId <= FOUNDER_AIRDROP_CAP) ? founderAirdropAmount : 0;
        uint256 want = base + founder;
        if (want == 0) return 0;
        uint256 bal = brawl.balanceOf(address(this));
        airdropped = want > bal ? bal : want;
        if (airdropped > 0) {
            brawl.safeTransfer(to, airdropped);
        }
        if (founder > 0 && airdropped > 0) {
            // Stamp the founder airdrop event so indexers can render the
            // FOUNDER badge + airdrop tally on-chain without re-deriving
            // from the (tokenId <= cap) rule.
            emit FounderAirdropped(to, tokenId, airdropped);
        }
    }

    /**
     * @dev Split incoming ETH between dev `treasury` (1 - lpShareBps) and
     *      `lpTreasury` (lpShareBps). Both are forwarded immediately so
     *      this contract never holds ETH between mints. If either send
     *      fails, the whole mint reverts.
     */
    function _routeETH(uint256 amount) private {
        uint256 lpShare = (amount * lpShareBps) / 10000;
        uint256 devShare = amount - lpShare;
        if (devShare > 0) {
            (bool ok,) = treasury.call{value: devShare}("");
            if (!ok) revert EthTransferFailed();
        }
        if (lpShare > 0) {
            (bool ok,) = lpTreasury.call{value: lpShare}("");
            if (!ok) revert LpTransferFailed();
        }
    }
}
