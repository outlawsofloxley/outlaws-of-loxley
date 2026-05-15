// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Duel} from "./Duel.sol";
import {Brawlers} from "./Brawlers.sol";

/// @dev Minimal Aerodrome V2 router surface. The Base mainnet router supports
///      both swap-with-fee-on-transfer variants; we use the standard ones
///      because BRAWL has no transfer fee.
interface IAerodromeRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }
    function swapExactETHForTokens(
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    function defaultFactory() external view returns (address);
    function weth() external view returns (address);
}

/**
 * @title DuelRouter
 * @notice Currency-aware fight wrapper around the audited Duel contract.
 *
 * @custom:website  https://baseicbrawlers.com
 * @custom:docs     https://docs.baseicbrawlers.com
 * @custom:github   https://github.com/baseicbrawlers/baseic-brawlers
 * @custom:telegram https://t.me/baseicbrawlers
 * @custom:twitter  https://x.com/BASEicBrawlers
 * @custom:discord  https://discord.gg/RjvBEA5CVd
 *
 *      Players can pay their $1 fight stake in BRAWL or ETH independently:
 *
 *        BRAWL vs BRAWL  → pot all BRAWL, dev gets BRAWL.
 *        ETH   vs ETH    → pot all ETH, dev gets ETH.
 *        ETH   vs BRAWL  → mixed pot. Loser's BRAWL is swapped to ETH (if
 *                          winner wants ETH) OR loser's ETH is partially
 *                          swapped to BRAWL (if winner wants BRAWL). Dev
 *                          always receives ETH whenever any ETH input is
 *                          present.
 *        Tie             → each player gets their stake back in their own
 *                          currency minus their pro-rata dev cut.
 *
 *      Sandwich resistance: every swap leg's minimum output is included
 *      in the EIP-712 FightQuote signed by the off-chain trustedSigner.
 *      If on-chain reality (Aerodrome reserves under attack) returns less,
 *      the tx reverts. Slippage cannot exceed the signer's tolerance.
 *
 *      Trust model:
 *        - Trusted signer is the same backend that already signs DuelResults
 *          for the Duel contract (see /api/run-duel).
 *        - Signer compromise: an attacker can grief by signing bad amounts;
 *          they cannot drain past the players' approved BRAWL or msg.value
 *          on a single fight.
 *        - Router compromise (owner key): owner can pause + drain to its
 *          own treasury via rescueFunds. Mitigation: keep owner on a cold
 *          multisig or a dev wallet with monitoring on rescueFunds events.
 *
 *      Architecture:
 *        1. Player approves Brawlers.setApprovalForAll(router, true) once.
 *        2. (BRAWL side) player approves BRAWL.approve(router, fightCost).
 *        3. Player calls router.fight(quote, quoteSig, duelResult, duelSig)
 *           with msg.value = quoted ETH costs.
 *        4. Router takes brawler custody, pulls BRAWL, calls Duel.submitDuel
 *           (router is the on-chain msg.sender for Duel; Duel.authorizedRouter
 *           gates this), executes at most one Aerodrome swap, distributes
 *           per the signed payout amounts, returns brawlers.
 *
 *      The Duel contract runs with `fightCost = 0` and `devShareBps = 0` in
 *      production — Duel becomes a pure ELO + death-streak recorder; all
 *      fight economics live here.
 */
contract DuelRouter is Ownable, Pausable, ReentrancyGuard, EIP712, IERC721Receiver {
    using SafeERC20 for IERC20;
    using Address for address payable;

    // ─── EIP-712 ─────────────────────────────────────────────────────

    string private constant EIP712_NAME = "BASEicBrawlersDuelRouter";
    string private constant EIP712_VERSION = "1";

    bytes32 private constant FIGHT_QUOTE_TYPEHASH = keccak256(
        "FightQuote(uint256 nonce,uint256 expiry,uint256 tokenA,uint256 tokenB,address ownerA,address ownerB,uint8 modeA,uint8 modeB,uint256 ethCostA,uint256 ethCostB,uint256 brawlCostA,uint256 brawlCostB,uint8 swapDir,uint256 swapAmountIn,uint256 swapMinOut,address payoutAAddr,uint8 payoutACurrency,uint256 payoutAAmount,address payoutBAddr,uint8 payoutBCurrency,uint256 payoutBAmount,uint256 devEthAmount,uint256 devBrawlAmount)"
    );

    // ─── Constants ───────────────────────────────────────────────────

    uint8 public constant MODE_BRAWL = 0;
    uint8 public constant MODE_ETH = 1;

    uint8 public constant SWAP_NONE = 0;
    uint8 public constant SWAP_ETH_TO_BRAWL = 1;
    uint8 public constant SWAP_BRAWL_TO_ETH = 2;

    /// @notice Founder token range — tokens 1..100 (non-house) get the discount.
    uint256 public constant FOUNDER_FIGHT_DISCOUNT_CAP = 100;

    /// @notice Hard cap on the dev cut. 2000 bps = 20%.
    uint16 public constant MAX_DEV_BPS = 2000;
    /// @notice Hard cap on the founder discount. 10000 bps = 100% (free fights).
    uint256 public constant MAX_FOUNDER_DISCOUNT_BPS = 10_000;
    /// @notice Hard cap on the stored BRAWL fight cost. 10,000 BRAWL = 10% of
    ///         the entire supply, well above any sane fight stake.
    uint256 public constant MAX_FIGHT_COST_BRAWL = 10_000 * 10 ** 18;
    /// @notice Hard cap on the stored ETH fight cost. 1 ETH ≈ $4000 at the
    ///         launch ETH price, so 0.5 ETH is a generous safety stop.
    uint256 public constant MAX_FIGHT_COST_ETH = 0.5 ether;

    // ─── Wired contracts (immutable) ────────────────────────────────

    Duel public immutable duel;
    Brawlers public immutable brawlers;
    IERC20 public immutable brawlToken;
    IAerodromeRouter public immutable aerodromeRouter;
    address public immutable weth;
    address public immutable aerodromeFactory;

    // ─── Mutable economics ──────────────────────────────────────────

    /// @notice Per-fighter stake in BRAWL wei. Pegged to ~$1 by the
    ///         fight-cost-keeper bot (mirrors the old Duel.fightCost role).
    uint256 public fightCostBrawl;

    /// @notice Per-fighter stake in ETH wei. Pegged to ~$1 by the
    ///         fight-cost-keeper bot using Chainlink ETH/USD.
    uint256 public fightCostEth;

    /// @notice Dev cut of the gross fight pot, in bps. 1000 = 10%.
    uint16 public devShareBps = 1000;

    /// @notice Founder fight discount in bps. 2500 = 25%.
    uint256 public founderDiscountBps = 2500;

    /// @notice Off-chain signer that produces FightQuotes.
    address public trustedSigner;

    /// @notice Treasury that receives the dev cut.
    address public devTreasury;

    /// @notice Replay protection for FightQuote.nonce.
    mapping(uint256 => bool) public usedNonces;

    // ─── Quote struct ───────────────────────────────────────────────

    /**
     * @notice Off-chain-computed fight quote with signed amount-min protections.
     * @dev Field ordering MUST match the FIGHT_QUOTE_TYPEHASH string above.
     */
    struct FightQuote {
        uint256 nonce;
        uint256 expiry;
        // Cross-link to the Duel result + ownership snapshot
        uint256 tokenA;
        uint256 tokenB;
        address ownerA;
        address ownerB;
        // Payment modes
        uint8 modeA;            // MODE_BRAWL or MODE_ETH
        uint8 modeB;
        // Stake amounts (one of {ethCostX, brawlCostX} must be zero per mode)
        uint256 ethCostA;
        uint256 ethCostB;
        uint256 brawlCostA;
        uint256 brawlCostB;
        // Swap leg (at most one per fight)
        uint8 swapDir;          // SWAP_NONE / SWAP_ETH_TO_BRAWL / SWAP_BRAWL_TO_ETH
        uint256 swapAmountIn;
        uint256 swapMinOut;
        // Final payouts
        address payoutAAddr;
        uint8 payoutACurrency;  // MODE_BRAWL or MODE_ETH
        uint256 payoutAAmount;
        address payoutBAddr;
        uint8 payoutBCurrency;
        uint256 payoutBAmount;
        uint256 devEthAmount;
        uint256 devBrawlAmount;
    }

    // ─── Events ──────────────────────────────────────────────────────

    event FightSettled(
        uint256 indexed tokenA,
        uint256 indexed tokenB,
        uint8 modeA,
        uint8 modeB,
        address indexed winnerAddr,
        uint256 payoutAAmount,
        uint256 payoutBAmount,
        uint256 devEthAmount,
        uint256 devBrawlAmount
    );
    event FightEconomicsChanged(uint256 fightCostBrawl, uint256 fightCostEth, uint16 devShareBps);
    event FounderDiscountChanged(uint256 newBps);
    event TrustedSignerChanged(address indexed oldSigner, address indexed newSigner);
    event DevTreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event RescuedERC20(address indexed token, address indexed to, uint256 amount);
    event RescuedETH(address indexed to, uint256 amount);

    // ─── Errors ──────────────────────────────────────────────────────

    error InvalidQuoteSignature();
    error QuoteExpired();
    error QuoteNonceUsed();
    error WrongTokens();
    error WrongOwner(uint256 tokenId);
    error InvalidMode(uint8 mode);
    error WrongMsgValue(uint256 expected, uint256 got);
    error StaleEthCost();
    error StaleBrawlCost();
    error InvalidSwapDir();
    error SwapAmountMismatch();
    error SlippageTooHigh(uint256 minOut, uint256 got);
    error InvalidCurrency(uint8 currency);
    error PayoutToZero();
    error DevTreasuryUnset();
    error SignerMustBeNonZero();
    error DevShareTooHigh(uint16 requested);
    error FounderDiscountTooHigh(uint256 requested);
    error FightCostBrawlTooHigh(uint256 requested);
    error FightCostEthTooHigh(uint256 requested);
    error SelfFight();
    error EthTransferFailed();

    // ─── Constructor ─────────────────────────────────────────────────

    constructor(
        address _owner,
        address _duel,
        address _brawlers,
        address _brawlToken,
        address _aerodromeRouter,
        address _trustedSigner,
        address _devTreasury,
        uint256 _fightCostBrawl,
        uint256 _fightCostEth
    ) Ownable(_owner) EIP712(EIP712_NAME, EIP712_VERSION) {
        require(_duel != address(0), "Router: zero duel");
        require(_brawlers != address(0), "Router: zero brawlers");
        require(_brawlToken != address(0), "Router: zero BRAWL");
        require(_aerodromeRouter != address(0), "Router: zero aerodrome");
        if (_trustedSigner == address(0)) revert SignerMustBeNonZero();
        if (_devTreasury == address(0)) revert DevTreasuryUnset();
        if (_fightCostBrawl > MAX_FIGHT_COST_BRAWL) revert FightCostBrawlTooHigh(_fightCostBrawl);
        if (_fightCostEth > MAX_FIGHT_COST_ETH) revert FightCostEthTooHigh(_fightCostEth);

        duel = Duel(_duel);
        brawlers = Brawlers(_brawlers);
        brawlToken = IERC20(_brawlToken);
        aerodromeRouter = IAerodromeRouter(_aerodromeRouter);
        weth = aerodromeRouter.weth();
        aerodromeFactory = aerodromeRouter.defaultFactory();
        trustedSigner = _trustedSigner;
        devTreasury = _devTreasury;
        fightCostBrawl = _fightCostBrawl;
        fightCostEth = _fightCostEth;
    }

    // ─── Admin ───────────────────────────────────────────────────────

    /// @notice Update the BRAWL + ETH fight costs and the dev cut atomically.
    ///         Called by the fight-cost-keeper bot every ~5 min to keep both
    ///         pegged to ~$1 worth. devShareBps left alone in those calls,
    ///         passed back unchanged from a separate read.
    function setFightEconomics(uint256 _fightCostBrawl, uint256 _fightCostEth, uint16 _devShareBps)
        external
        onlyOwner
    {
        if (_fightCostBrawl > MAX_FIGHT_COST_BRAWL) revert FightCostBrawlTooHigh(_fightCostBrawl);
        if (_fightCostEth > MAX_FIGHT_COST_ETH) revert FightCostEthTooHigh(_fightCostEth);
        if (_devShareBps > MAX_DEV_BPS) revert DevShareTooHigh(_devShareBps);
        fightCostBrawl = _fightCostBrawl;
        fightCostEth = _fightCostEth;
        devShareBps = _devShareBps;
        emit FightEconomicsChanged(_fightCostBrawl, _fightCostEth, _devShareBps);
    }

    function setFounderDiscountBps(uint256 newBps) external onlyOwner {
        if (newBps > MAX_FOUNDER_DISCOUNT_BPS) revert FounderDiscountTooHigh(newBps);
        founderDiscountBps = newBps;
        emit FounderDiscountChanged(newBps);
    }

    function setTrustedSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert SignerMustBeNonZero();
        emit TrustedSignerChanged(trustedSigner, newSigner);
        trustedSigner = newSigner;
    }

    function setDevTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert DevTreasuryUnset();
        emit DevTreasuryChanged(devTreasury, newTreasury);
        devTreasury = newTreasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Withdraw any stuck ERC-20 from the router. Only the owner can
    ///         call this. Used to recover swap-fee dust or recover funds in
    ///         the event of a stuck fight (e.g., a signed quote that wasn't
    ///         consumed before expiry).
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert PayoutToZero();
        IERC20(token).safeTransfer(to, amount);
        emit RescuedERC20(token, to, amount);
    }

    /// @notice Withdraw any stuck ETH from the router. Same constraints as
    ///         rescueERC20.
    function rescueETH(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert PayoutToZero();
        to.sendValue(amount);
        emit RescuedETH(to, amount);
    }

    // ─── Views ───────────────────────────────────────────────────────

    /// @notice Per-fighter BRAWL cost after founder discount.
    function fighterCostBrawl(uint256 tokenId) public view returns (uint256) {
        if (_isFounder(tokenId)) {
            return (fightCostBrawl * (10_000 - founderDiscountBps)) / 10_000;
        }
        return fightCostBrawl;
    }

    /// @notice Per-fighter ETH cost after founder discount.
    function fighterCostEth(uint256 tokenId) public view returns (uint256) {
        if (_isFounder(tokenId)) {
            return (fightCostEth * (10_000 - founderDiscountBps)) / 10_000;
        }
        return fightCostEth;
    }

    /// @notice EIP-712 digest exposed for off-chain verification.
    function hashQuote(FightQuote calldata q) external view returns (bytes32) {
        return _hashQuote(q);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ─── External: fight ─────────────────────────────────────────────

    /**
     * @notice Execute a quoted fight. Players send msg.value matching their
     *         ETH stake (if any) and must have pre-approved the router for
     *         their brawlers + (if applicable) BRAWL.
     *
     * @dev    Order of ops is critical for safety:
     *           1. Verify quote signature + freshness + ownership + msg.value
     *           2. Pull BRAWL stakes (no swap yet → no oracle interaction yet)
     *           3. Take brawler custody (router becomes Duel's msg.sender)
     *           4. Call Duel.submitDuel — the audited contract handles ELO +
     *              death streaks + listed-brawler / liveness checks; reverts
     *              flow if anything's off
     *           5. Return brawler custody to original owners (early, so any
     *              subsequent revert undoes both)
     *           6. Execute the (at most one) Aerodrome swap with signed min-out
     *           7. Distribute payouts to A, B, dev in their signed currencies
     *           8. Mark nonce consumed + emit event
     */
    function fight(
        FightQuote calldata quote,
        bytes calldata quoteSig,
        Duel.DuelResult calldata duelResult,
        bytes calldata duelSig
    ) external payable nonReentrant whenNotPaused {
        // 1. Quote validation
        _validateQuote(quote, quoteSig, duelResult);

        // 2. Per-token stake amounts must match contract-computed cost (founder
        //    discount applied). Stale economics → revert. This also ties the
        //    signed amounts to the on-chain pegged BRAWL + ETH costs.
        _assertCostsMatchPegged(quote);

        // 3. msg.value sanity
        uint256 expectedMsgValue =
            (quote.modeA == MODE_ETH ? quote.ethCostA : 0) +
            (quote.modeB == MODE_ETH ? quote.ethCostB : 0);
        if (msg.value != expectedMsgValue) revert WrongMsgValue(expectedMsgValue, msg.value);

        // 4. BRAWL stake pulls (BRAWL-mode players)
        if (quote.modeA == MODE_BRAWL && quote.brawlCostA > 0) {
            brawlToken.safeTransferFrom(quote.ownerA, address(this), quote.brawlCostA);
        }
        if (quote.modeB == MODE_BRAWL && quote.brawlCostB > 0) {
            brawlToken.safeTransferFrom(quote.ownerB, address(this), quote.brawlCostB);
        }

        // 5. Brawler custody snapshot (re-verify against quote.ownerX in case
        //    of a sneak transfer after quote signing). Duel does its own
        //    liveness + listed-brawler checks once we call submitDuel.
        if (brawlers.ownerOf(quote.tokenA) != quote.ownerA) revert WrongOwner(quote.tokenA);
        if (brawlers.ownerOf(quote.tokenB) != quote.ownerB) revert WrongOwner(quote.tokenB);
        brawlers.transferFrom(quote.ownerA, address(this), quote.tokenA);
        brawlers.transferFrom(quote.ownerB, address(this), quote.tokenB);

        // 6. Submit the duel (Duel's authorizedRouter = address(this); Duel's
        //    fightCost = 0 so it does NOT pull BRAWL from us). Duel still runs
        //    EIP-712 sig verification + liveness + listed-brawler + nonce.
        duel.submitDuel(duelResult, duelSig);

        // 7. Return brawlers to original owners. Done before payouts so a
        //    payout-side revert (insufficient balance, slippage) gets caught
        //    AFTER brawler returns are queued — full tx reverts, brawlers
        //    stay with original owners (atomic).
        brawlers.transferFrom(address(this), quote.ownerA, quote.tokenA);
        brawlers.transferFrom(address(this), quote.ownerB, quote.tokenB);

        // 8. Execute the at-most-one Aerodrome swap.
        _executeSwap(quote);

        // 9. Distribute payouts.
        _distribute(quote);

        // 10. Mark nonce consumed (CEI: state change after external calls
        //     guarded by reentrancyGuard).
        usedNonces[quote.nonce] = true;

        emit FightSettled(
            quote.tokenA,
            quote.tokenB,
            quote.modeA,
            quote.modeB,
            quote.payoutAAmount > 0 ? quote.payoutAAddr : quote.payoutBAddr,
            quote.payoutAAmount,
            quote.payoutBAmount,
            quote.devEthAmount,
            quote.devBrawlAmount
        );
    }

    // ─── Internal helpers ────────────────────────────────────────────

    function _validateQuote(
        FightQuote calldata quote,
        bytes calldata quoteSig,
        Duel.DuelResult calldata duelResult
    ) private view {
        if (block.timestamp > quote.expiry) revert QuoteExpired();
        if (usedNonces[quote.nonce]) revert QuoteNonceUsed();

        if (quote.tokenA == quote.tokenB) revert SelfFight();
        if (quote.tokenA != duelResult.tokenA || quote.tokenB != duelResult.tokenB) {
            revert WrongTokens();
        }

        if (quote.modeA != MODE_BRAWL && quote.modeA != MODE_ETH) revert InvalidMode(quote.modeA);
        if (quote.modeB != MODE_BRAWL && quote.modeB != MODE_ETH) revert InvalidMode(quote.modeB);
        if (quote.payoutACurrency != MODE_BRAWL && quote.payoutACurrency != MODE_ETH) {
            revert InvalidCurrency(quote.payoutACurrency);
        }
        if (quote.payoutBCurrency != MODE_BRAWL && quote.payoutBCurrency != MODE_ETH) {
            revert InvalidCurrency(quote.payoutBCurrency);
        }
        if (quote.swapDir > SWAP_BRAWL_TO_ETH) revert InvalidSwapDir();

        bytes32 digest = _hashQuote(quote);
        address recovered = ECDSA.recover(digest, quoteSig);
        if (recovered != trustedSigner) revert InvalidQuoteSignature();
    }

    function _assertCostsMatchPegged(FightQuote calldata quote) private view {
        // Mode-side cost must be 0 in the off-currency.
        if (quote.modeA == MODE_BRAWL) {
            if (quote.ethCostA != 0) revert StaleEthCost();
            if (quote.brawlCostA != fighterCostBrawl(quote.tokenA)) revert StaleBrawlCost();
        } else {
            if (quote.brawlCostA != 0) revert StaleBrawlCost();
            if (quote.ethCostA != fighterCostEth(quote.tokenA)) revert StaleEthCost();
        }
        if (quote.modeB == MODE_BRAWL) {
            if (quote.ethCostB != 0) revert StaleEthCost();
            if (quote.brawlCostB != fighterCostBrawl(quote.tokenB)) revert StaleBrawlCost();
        } else {
            if (quote.brawlCostB != 0) revert StaleBrawlCost();
            if (quote.ethCostB != fighterCostEth(quote.tokenB)) revert StaleEthCost();
        }
    }

    function _executeSwap(FightQuote calldata quote) private {
        if (quote.swapDir == SWAP_NONE) return;
        if (quote.swapAmountIn == 0) revert SwapAmountMismatch();

        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        uint256 deadline = block.timestamp + 60; // tight: we're in the same block

        if (quote.swapDir == SWAP_ETH_TO_BRAWL) {
            routes[0] = IAerodromeRouter.Route({
                from: weth,
                to: address(brawlToken),
                stable: false,
                factory: aerodromeFactory
            });
            uint256[] memory amounts = aerodromeRouter.swapExactETHForTokens{
                value: quote.swapAmountIn
            }(quote.swapMinOut, routes, address(this), deadline);
            uint256 brawlOut = amounts[amounts.length - 1];
            if (brawlOut < quote.swapMinOut) revert SlippageTooHigh(quote.swapMinOut, brawlOut);
        } else {
            // SWAP_BRAWL_TO_ETH
            routes[0] = IAerodromeRouter.Route({
                from: address(brawlToken),
                to: weth,
                stable: false,
                factory: aerodromeFactory
            });
            // Aerodrome's router pulls tokens via transferFrom; approve here.
            // Use forceApprove to handle non-zero-allowance gotchas safely.
            brawlToken.forceApprove(address(aerodromeRouter), quote.swapAmountIn);
            uint256[] memory amounts = aerodromeRouter.swapExactTokensForETH(
                quote.swapAmountIn, quote.swapMinOut, routes, address(this), deadline
            );
            uint256 ethOut = amounts[amounts.length - 1];
            if (ethOut < quote.swapMinOut) revert SlippageTooHigh(quote.swapMinOut, ethOut);
            // Defensive: zero out the allowance to avoid lingering grants.
            brawlToken.forceApprove(address(aerodromeRouter), 0);
        }
    }

    function _distribute(FightQuote calldata quote) private {
        // Pay A
        if (quote.payoutAAmount > 0) {
            if (quote.payoutAAddr == address(0)) revert PayoutToZero();
            _payout(quote.payoutAAddr, quote.payoutACurrency, quote.payoutAAmount);
        }
        // Pay B
        if (quote.payoutBAmount > 0) {
            if (quote.payoutBAddr == address(0)) revert PayoutToZero();
            _payout(quote.payoutBAddr, quote.payoutBCurrency, quote.payoutBAmount);
        }
        // Pay dev (one of devEthAmount / devBrawlAmount should be 0 per Darren's
        // currency rule: ETH if any ETH input, BRAWL only if BRAWL/BRAWL)
        if (quote.devEthAmount > 0) {
            _payout(devTreasury, MODE_ETH, quote.devEthAmount);
        }
        if (quote.devBrawlAmount > 0) {
            _payout(devTreasury, MODE_BRAWL, quote.devBrawlAmount);
        }
    }

    function _payout(address to, uint8 currency, uint256 amount) private {
        if (currency == MODE_ETH) {
            payable(to).sendValue(amount);
        } else {
            brawlToken.safeTransfer(to, amount);
        }
    }

    function _isFounder(uint256 tokenId) private view returns (bool) {
        return tokenId >= 1
            && tokenId <= FOUNDER_FIGHT_DISCOUNT_CAP
            && !brawlers.isHouseBrawler(tokenId);
    }

    function _hashQuote(FightQuote calldata q) private view returns (bytes32) {
        // EIP-712: the struct hash uses abi.encode of every field in the order
        // listed in FIGHT_QUOTE_TYPEHASH. Don't reorder.
        bytes32 structHash = keccak256(
            abi.encode(
                FIGHT_QUOTE_TYPEHASH,
                q.nonce,
                q.expiry,
                q.tokenA,
                q.tokenB,
                q.ownerA,
                q.ownerB,
                q.modeA,
                q.modeB,
                q.ethCostA,
                q.ethCostB,
                q.brawlCostA,
                q.brawlCostB,
                q.swapDir,
                q.swapAmountIn,
                q.swapMinOut,
                q.payoutAAddr,
                q.payoutACurrency,
                q.payoutAAmount,
                q.payoutBAddr,
                q.payoutBCurrency,
                q.payoutBAmount,
                q.devEthAmount,
                q.devBrawlAmount
            )
        );
        return _hashTypedDataV4(structHash);
    }

    // ─── IERC721Receiver ─────────────────────────────────────────────

    /// @notice Required because Duel uses `safeTransferFrom`-style transfers
    ///         in some paths and brawlers are transferred to us mid-fight.
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ─── Receive ─────────────────────────────────────────────────────

    /// @notice Required to receive ETH from Aerodrome's swap and from msg.value
    ///         (the latter goes through the payable `fight` entrypoint).
    receive() external payable {}
}
