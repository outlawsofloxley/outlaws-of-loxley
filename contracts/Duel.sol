// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Brawlers} from "./Brawlers.sol";

/**
 * @title Duel
 * @notice Accepts backend-signed duel results and applies them to Brawlers.
 *
 * @dev Key design: the backend computes EVERYTHING (winner, rounds, seed,
 *      new ELOs) and signs the full result. The contract performs only
 *      signature verification, replay prevention, liveness checks, and
 *      storage updates. No ELO math on-chain.
 *
 *      Why: ELO uses floating-point (10^((B-A)/400)) in TypeScript.
 *      Reimplementing that in Solidity would introduce rounding divergence
 *      between the TS CLI's predicted ELO and the on-chain actual ELO.
 *      By signing the TS-computed values, we guarantee CLI and chain agree.
 *
 *      Trust model: you control the backend, so signing your own math is
 *      fine. Seeds and outcomes are public so anyone can re-run the fight
 *      in TS and verify. If the backend signer were ever to cheat, it
 *      would be publicly detectable.
 *
 *      Death logic: 3 consecutive losses kill a brawler. Streak counter
 *      lives here (duel-specific state) rather than on Brawlers.
 */
contract Duel is Ownable, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────

    /// @notice Consecutive losses that kill a brawler.
    uint8 public constant CONSECUTIVE_LOSSES_TO_DIE = 3;
    /// @notice Max devShareBps value. 10000 = 100%. Capped at 20% to prevent
    ///         the owner from accidentally setting a confiscatory rate.
    uint16 public constant MAX_DEV_BPS = 2000;

    // ─── Types ───────────────────────────────────────────────────────

    /**
     * @notice Signed duel result.
     * @dev The backend signs the keccak of abi.encode(this struct), wrapped
     *      with the EIP-191 prefix ("\x19Ethereum Signed Message:\n32").
     */
    struct DuelResult {
        uint256 tokenA;
        uint256 tokenB;
        uint32 winnerId; // 0 for tie, or tokenA/tokenB as uint32
        uint16 rounds;
        uint256 seed;
        uint32 newEloA;
        uint32 newEloB;
        uint256 nonce;
        uint256 expiry;
    }

    // ─── Storage ─────────────────────────────────────────────────────

    Brawlers public immutable brawlers;
    address public trustedSigner;
    /// @notice The Graveyard contract (may reset streaks on resurrection).
    address public graveyardContract;

    /// @notice Consumed nonces (replay protection).
    mapping(uint256 => bool) public usedNonces;

    /// @notice Per-brawler consecutive loss counter (resets on win/tie/resurrect).
    mapping(uint256 => uint8) public consecutiveLosses;

    // ─── Fight economics (dev-settable) ──────────────────────────────

    /// @notice BRAWL ERC-20 token used for fight stakes. Zero address disables fees.
    IERC20 public brawlToken;
    /// @notice Stake per player per duel (in BRAWL's smallest unit, 10^18).
    uint256 public fightCost;
    /// @notice Dev share of total pot (bps). 1000 = 10%. Capped at MAX_DEV_BPS.
    uint16 public devShareBps;
    /// @notice Receives dev cut of every fight.
    address public devTreasury;

    // ─── Events ──────────────────────────────────────────────────────

    event DuelCompleted(
        uint256 indexed tokenA,
        uint256 indexed tokenB,
        uint32 winnerId,
        uint16 rounds,
        uint256 seed,
        uint256 nonce,
        uint32 newEloA,
        uint32 newEloB
    );
    event BrawlerDied(uint256 indexed tokenId);
    event TrustedSignerChanged(address indexed oldSigner, address indexed newSigner);
    event GraveyardContractSet(address indexed oldContract, address indexed newContract);
    event StreakReset(uint256 indexed tokenId);
    event BRAWLTokenChanged(address indexed oldToken, address indexed newToken);
    event FightEconomicsChanged(uint256 fightCost, uint16 devShareBps, address devTreasury);
    event FeesPaid(
        uint256 indexed tokenA,
        uint256 indexed tokenB,
        uint256 potToA,
        uint256 potToB,
        uint256 devCut
    );

    // ─── Errors ──────────────────────────────────────────────────────

    error InvalidSignature();
    error NonceAlreadyUsed();
    error Expired();
    error InvalidWinnerId();
    error BrawlerNotAlive(uint256 tokenId);
    error NotOwnerOfEither();
    error SelfFight();
    error SignerMustBeNonZero();
    error NotGraveyard();
    error DevShareTooHigh(uint16 requested);
    error ZeroDevTreasury();

    // ─── Constructor ─────────────────────────────────────────────────

    /**
     * @notice Deploy the Duel contract.
     * @param initialOwner Owner (admin of economics + signer + graveyard addresses).
     * @param _brawlers Brawlers NFT contract (immutable).
     * @param _trustedSigner Who signs DuelResults off-chain.
     * @param _brawlToken BRAWL ERC-20. Pass address(0) to disable fees (dev/test).
     * @param _devTreasury Recipient of dev cut. Required even if fees start zero.
     * @param _fightCost Initial stake per player (0 = no fees).
     * @param _devShareBps Dev share of pot in bps (0-2000 = 0-20%).
     */
    constructor(
        address initialOwner,
        address _brawlers,
        address _trustedSigner,
        address _brawlToken,
        address _devTreasury,
        uint256 _fightCost,
        uint16 _devShareBps
    ) Ownable(initialOwner) {
        require(_brawlers != address(0), "Duel: zero brawlers");
        if (_trustedSigner == address(0)) revert SignerMustBeNonZero();
        if (_devTreasury == address(0)) revert ZeroDevTreasury();
        if (_devShareBps > MAX_DEV_BPS) revert DevShareTooHigh(_devShareBps);
        brawlers = Brawlers(_brawlers);
        trustedSigner = _trustedSigner;
        brawlToken = IERC20(_brawlToken);
        devTreasury = _devTreasury;
        fightCost = _fightCost;
        devShareBps = _devShareBps;
    }

    // ─── Admin ───────────────────────────────────────────────────────

    function setTrustedSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert SignerMustBeNonZero();
        emit TrustedSignerChanged(trustedSigner, newSigner);
        trustedSigner = newSigner;
    }

    function setGraveyardContract(address _graveyard) external onlyOwner {
        emit GraveyardContractSet(graveyardContract, _graveyard);
        graveyardContract = _graveyard;
    }

    /**
     * @notice Change the BRAWL token address (e.g. swap to a v2). Setting
     *         address(0) disables fees entirely.
     */
    function setBRAWLToken(address newToken) external onlyOwner {
        emit BRAWLTokenChanged(address(brawlToken), newToken);
        brawlToken = IERC20(newToken);
    }

    /**
     * @notice Update the fight economics (stake + dev cut + treasury) atomically.
     * @param _fightCost New stake per player. 0 disables fees.
     * @param _devShareBps New dev share in bps. Capped at MAX_DEV_BPS.
     * @param _devTreasury New treasury address (non-zero).
     */
    function setFightEconomics(uint256 _fightCost, uint16 _devShareBps, address _devTreasury)
        external
        onlyOwner
    {
        if (_devShareBps > MAX_DEV_BPS) revert DevShareTooHigh(_devShareBps);
        if (_devTreasury == address(0)) revert ZeroDevTreasury();
        fightCost = _fightCost;
        devShareBps = _devShareBps;
        devTreasury = _devTreasury;
        emit FightEconomicsChanged(_fightCost, _devShareBps, _devTreasury);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Reset a brawler's consecutive-loss streak. Only callable by the
     *         authorized Graveyard contract (e.g. after a resurrection).
     */
    function resetStreak(uint256 tokenId) external {
        if (msg.sender != graveyardContract) revert NotGraveyard();
        consecutiveLosses[tokenId] = 0;
        emit StreakReset(tokenId);
    }

    // ─── External: submit signed duel ────────────────────────────────

    /**
     * @notice Submit a backend-signed duel result. Verifies the signature
     *         and applies the state updates.
     * @param result The duel result struct.
     * @param signature 65-byte ECDSA signature from the trusted signer.
     */
    function submitDuel(DuelResult calldata result, bytes calldata signature)
        external
        whenNotPaused
        nonReentrant
    {
        _validateAndAuthorize(result, signature);

        // Consume nonce before external calls (CEI).
        usedNonces[result.nonce] = true;

        // Capture owners once, ownerOf call is not free and we need both
        // addresses for fees and for deciding who to pay out.
        address ownerA = brawlers.ownerOf(result.tokenA);
        address ownerB = brawlers.ownerOf(result.tokenB);

        // Pull stakes in. If fightCost is 0 or brawlToken unset, skip, 
        // preserves pre-fee behavior for dev/test contracts. Founder
        // brawlers (tokenId 1..100) pay `founderDiscountBps` less per fight.
        _collectFees(result.tokenA, result.tokenB, ownerA, ownerB);

        (bool aDied, bool bDied) = _updateStreaksAndCheckDeaths(result);

        brawlers.applyDuelResult(
            result.tokenA,
            result.tokenB,
            result.newEloA,
            result.newEloB,
            result.winnerId,
            aDied,
            bDied
        );

        // Pay out from the contract's balance after ELO updates are settled.
        _distributePot(result, ownerA, ownerB);

        _emitDuelCompleted(result);
        if (aDied) emit BrawlerDied(result.tokenA);
        if (bDied) emit BrawlerDied(result.tokenB);
    }

    /// @notice Token ID upper bound for "Founder 100" fight discount. Brawlers
    ///         in 1..FOUNDER_FIGHT_DISCOUNT_CAP pay `founderDiscountBps` less
    ///         BRAWL per duel.
    uint256 public constant FOUNDER_FIGHT_DISCOUNT_CAP = 100;
    /// @notice Discount in basis points. Default 2500 (25%), tunable via
    ///         setFounderDiscountBps so D can dial it down/up if launch
    ///         pricing changes. Capped at 10000 (100% off = free fights).
    uint256 public founderDiscountBps = 2500;

    event FounderDiscountChanged(uint256 newBps);

    /// @notice Update the founder fight discount. Owner-only.
    /// @param newBps New discount in basis points (0..10000).
    function setFounderDiscountBps(uint256 newBps) external onlyOwner {
        require(newBps <= 10000, "Duel: discount > 100%");
        founderDiscountBps = newBps;
        emit FounderDiscountChanged(newBps);
    }

    /// @notice Per-fighter stake, full `fightCost` for non-founders, less
    ///         (per `founderDiscountBps`) for any brawler with tokenId in
    ///         1..FOUNDER_FIGHT_DISCOUNT_CAP.
    function fighterCost(uint256 tokenId) public view returns (uint256) {
        if (tokenId >= 1 && tokenId <= FOUNDER_FIGHT_DISCOUNT_CAP) {
            return (fightCost * (10000 - founderDiscountBps)) / 10000;
        }
        return fightCost;
    }

    /**
     * @dev Pull each fighter's stake from their owner. Founder brawlers pay
     *      the discounted rate. No-op when fees are disabled or token unset.
     */
    function _collectFees(uint256 idA, uint256 idB, address ownerA, address ownerB) private {
        if (fightCost == 0 || address(brawlToken) == address(0)) return;
        uint256 costA = fighterCost(idA);
        uint256 costB = fighterCost(idB);
        if (costA > 0) brawlToken.safeTransferFrom(ownerA, address(this), costA);
        if (costB > 0) brawlToken.safeTransferFrom(ownerB, address(this), costB);
    }

    /**
     * @dev Pay out the combined pot according to the winner and dev share.
     *      Pot may be asymmetric when one side is a founder; tie still
     *      splits the non-dev portion 50/50. No-op when fees are disabled.
     */
    function _distributePot(DuelResult calldata result, address ownerA, address ownerB) private {
        if (fightCost == 0 || address(brawlToken) == address(0)) return;

        // Pot factors in per-fighter discounts (founders pay
        // `founderDiscountBps` less).
        uint256 pot = fighterCost(result.tokenA) + fighterCost(result.tokenB);
        uint256 devCut = (pot * devShareBps) / 10000;
        uint256 winnerShare = pot - devCut;

        uint256 paidToA = 0;
        uint256 paidToB = 0;

        if (result.winnerId == uint32(result.tokenA)) {
            paidToA = winnerShare;
            brawlToken.safeTransfer(ownerA, winnerShare);
        } else if (result.winnerId == uint32(result.tokenB)) {
            paidToB = winnerShare;
            brawlToken.safeTransfer(ownerB, winnerShare);
        } else {
            // Tie: split winnerShare. First half to A, remainder to B (handles
            // odd-value floor by assigning rounding to B; zero-sum vs. pot).
            uint256 halfA = winnerShare / 2;
            uint256 halfB = winnerShare - halfA;
            paidToA = halfA;
            paidToB = halfB;
            if (halfA > 0) brawlToken.safeTransfer(ownerA, halfA);
            if (halfB > 0) brawlToken.safeTransfer(ownerB, halfB);
        }

        if (devCut > 0) {
            brawlToken.safeTransfer(devTreasury, devCut);
        }

        emit FeesPaid(result.tokenA, result.tokenB, paidToA, paidToB, devCut);
    }

    // ─── Internal helpers (split for stack depth) ────────────────────

    /**
     * @dev Runs structural validation, signature verification, liveness
     *      checks, and owner authorization. Reverts on any failure.
     *      Split out of submitDuel to reduce stack pressure.
     */
    function _validateAndAuthorize(DuelResult calldata result, bytes calldata signature)
        private
        view
    {
        if (result.tokenA == result.tokenB) revert SelfFight();
        if (
            result.winnerId != 0 && result.winnerId != uint32(result.tokenA)
                && result.winnerId != uint32(result.tokenB)
        ) {
            revert InvalidWinnerId();
        }
        if (block.timestamp > result.expiry) revert Expired();
        if (usedNonces[result.nonce]) revert NonceAlreadyUsed();

        // Signature verification (keep temporaries in this frame only)
        bytes32 messageHash = hashDuelResult(result);
        address recovered = messageHash.toEthSignedMessageHash().recover(signature);
        if (recovered != trustedSigner) revert InvalidSignature();

        // Liveness
        if (!brawlers.isAlive(result.tokenA)) revert BrawlerNotAlive(result.tokenA);
        if (!brawlers.isAlive(result.tokenB)) revert BrawlerNotAlive(result.tokenB);

        // Authorization: caller must own at least one side
        if (
            brawlers.ownerOf(result.tokenA) != msg.sender
                && brawlers.ownerOf(result.tokenB) != msg.sender
        ) {
            revert NotOwnerOfEither();
        }
    }

    /**
     * @dev Updates consecutive-loss counters and computes death flags.
     *      Win/tie resets the relevant streaks. Third consecutive loss
     *      marks a brawler as dead.
     */
    function _updateStreaksAndCheckDeaths(DuelResult calldata result)
        private
        returns (bool aDied, bool bDied)
    {
        if (result.winnerId == 0) {
            consecutiveLosses[result.tokenA] = 0;
            consecutiveLosses[result.tokenB] = 0;
        } else if (result.winnerId == uint32(result.tokenA)) {
            consecutiveLosses[result.tokenA] = 0;
            uint8 streakB = consecutiveLosses[result.tokenB] + 1;
            consecutiveLosses[result.tokenB] = streakB;
            if (streakB >= CONSECUTIVE_LOSSES_TO_DIE) bDied = true;
        } else {
            consecutiveLosses[result.tokenB] = 0;
            uint8 streakA = consecutiveLosses[result.tokenA] + 1;
            consecutiveLosses[result.tokenA] = streakA;
            if (streakA >= CONSECUTIVE_LOSSES_TO_DIE) aDied = true;
        }
    }

    /**
     * @dev Emit the DuelCompleted event. Split out so the event's eight
     *      arguments don't add to submitDuel's already-loaded stack.
     */
    function _emitDuelCompleted(DuelResult calldata result) private {
        emit DuelCompleted(
            result.tokenA,
            result.tokenB,
            result.winnerId,
            result.rounds,
            result.seed,
            result.nonce,
            result.newEloA,
            result.newEloB
        );
    }

    // ─── External: helper for off-chain signing ──────────────────────

    /**
     * @notice Compute the canonical hash of a DuelResult, as signed by backend.
     * @dev Off-chain workflow to produce signatures that verify here:
     *      1. Compute hash = keccak256(abi.encode(tokenA, tokenB, winnerId,
     *         rounds, seed, newEloA, newEloB, nonce, expiry)).
     *      2. Wrap: ethHash = keccak256("\x19Ethereum Signed Message:\n32" || hash).
     *      3. Sign ethHash with trustedSigner's private key.
     *      4. Submit (result, signature) to submitDuel.
     *
     *      ethers.js: signer.signMessage(ethers.getBytes(hash)) does step 2+3.
     */
    function hashDuelResult(DuelResult calldata r) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                r.tokenA,
                r.tokenB,
                r.winnerId,
                r.rounds,
                r.seed,
                r.newEloA,
                r.newEloB,
                r.nonce,
                r.expiry
            )
        );
    }
}
