// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Stats} from "./lib/Stats.sol";
import {Xorshift} from "./lib/Xorshift.sol";

// Phase 7a+ additions: rarity tiers, capped supply, MintDrop gate.
// Tier counts (must sum to MAX_SUPPLY):
//   310 Common, 125 Uncommon, 50 Rare, 10 Epic, 5 Legendary

/**
 * @title Brawlers
 * @notice ERC-721 with on-chain combat stats. Every brawler's full record
 *         (stats, weapon, ELO, wins/losses, status) lives on-chain.
 *
 * @custom:website  https://baseicbrawlers.com
 * @custom:telegram https://t.me/baseicbrawlers
 * @custom:twitter  https://x.com/BASEicBrawlers
 *
 *  Website:  https://baseicbrawlers.com
 *  Telegram: https://t.me/baseicbrawlers
 *  X:        https://x.com/BASEicBrawlers
 *
 * @dev Minting is deterministic from (masterSeed, tokenId). This means every
 *      brawler's traits are known in advance of mint, which is fine for this
 *      game because there's no rarity reveal mechanic, and it keeps the
 *      mint gas-cheap (no Chainlink VRF).
 *
 *      Duel updates and death status changes are handled by the Duel and
 *      Graveyard contracts respectively, both must be authorized via
 *      setDuelContract() / setGraveyardContract() before they can mutate state.
 *
 *      Starting ELO is 1000, starting level is 1, starting HP/AC are derived
 *      from stats by Stats.sol (imported here for use by Duel/Graveyard).
 */
contract Brawlers is ERC721, Ownable, Pausable {
    // ─── Constants ───────────────────────────────────────────────────

    /// @notice Starting ELO for every brawler.
    uint32 public constant STARTING_ELO = 1_000;
    /// @notice Absolute floor on ELO regardless of losses.
    uint32 public constant MIN_ELO = 100;
    /// @notice Hard cap on total supply (initial curated drop). Scaled
    ///         from 500 → 2000 for the BASEic Brawlers Base launch.
    uint32 public constant MAX_SUPPLY = 2000;
    /// @notice Token ID reserved for the one-of-one "King Brawler", 
    ///         admin-mintable once, not counted against MAX_SUPPLY.
    ///         Stats all-18, unique weapon (Kingsblade, weapon index 11),
    ///         rarity tier 5.
    uint32 public constant KING_TOKEN_ID = 2001;

    // Tier counts for the 2000 initial mint. Sum MUST equal MAX_SUPPLY.
    // 62% common / 25% uncommon / 10% rare / 2% legendary / 1% epic.
    uint32 private constant TIER_COMMON = 1240;
    uint32 private constant TIER_UNCOMMON = 500;
    uint32 private constant TIER_RARE = 200;
    uint32 private constant TIER_EPIC = 40;
    uint32 private constant TIER_LEGENDARY = 20;

    // ─── Types ───────────────────────────────────────────────────────

    /// @notice Full on-chain record for one brawler.
    struct Brawler {
        // Slot 1 (packed): 6 bytes stats + 1 byte weaponId + 2 bytes level
        //                  + 4 bytes XP + 4 bytes ELO + 2 bytes wins + 2 bytes losses
        //                  + 2 bytes ties + 1 byte status flags = 24 bytes
        uint8 strength;
        uint8 dexterity;
        uint8 constitution;
        uint8 intelligence;
        uint8 wisdom;
        uint8 charisma;
        uint8 weaponId; // Index into weapons[]
        uint16 level;
        uint32 xp;
        uint32 elo;
        uint16 wins;
        uint16 losses;
        uint16 ties;
        bool isDead;
        // Slot 2+
        string name;
    }

    /// @notice Weapon definition (11 weapons match TypeScript weapons.ts).
    struct Weapon {
        string name;
        uint8 damageMin;
        uint8 damageMax;
        uint8 speed;
        uint8 weaponType; // 0 = blade, 1 = blunt, 2 = ranged
        uint8 weight; // rarity weight; all weights sum to 100
    }

    // ─── Storage ─────────────────────────────────────────────────────

    /// @notice The master seed used to derive all brawler traits.
    uint256 public immutable masterSeed;
    /// @notice The "King Brawler" (dev) wallet. Mints landing on this
    ///         address are capped to common/uncommon, dev can never pull a
    ///         rare or better. Set once at construction (immutable). Set to
    ///         address(0) to disable the cap (e.g. local Anvil tests).
    address public immutable devWallet;
    /// @notice Bound on how far forward `_skipRareForDev` walks looking for
    ///         a common/uncommon slot. With ~87% of the drop being C/U,
    ///         50 is overkill; bounded so dev mint gas stays predictable.
    uint256 private constant DEV_RARITY_SCAN_LIMIT = 50;
    /// @notice Next token ID to mint. Starts at 1.
    uint32 public nextTokenId = 1;
    /// @notice Authorized contract allowed to update duel results.
    address public duelContract;
    /// @notice Authorized contract allowed to update graveyard status.
    address public graveyardContract;
    /// @notice Authorized MintDrop contract. Only this address (plus owner)
    ///         can call mint(). Set once post-deploy by setMintDrop().
    address public mintDropContract;

    /// @notice Per-token brawler record.
    mapping(uint256 => Brawler) internal _brawlers;

    /// @notice Weapon catalog. Index = weaponId. Immutable after construction.
    Weapon[] internal _weapons;

    /// @notice Pre-shuffled rarity tier for each tokenId. `_rarity[tokenId - 1]`
    ///         is the tier in 0..4. Shuffled deterministically in the
    ///         constructor using a SplitMix-seeded xorshift128+ from
    ///         `masterSeed ^ SHUFFLE_DOMAIN_TAG`.
    ///
    ///         Display-layer tier labels (with Epic > Legendary in the drop):
    ///           0 = Common
    ///           1 = Uncommon
    ///           2 = Rare
    ///           3 = Legendary (10 in the drop)
    ///           4 = Epic (5 in the drop, rarest normal tier)
    ///           5 = King (the 1-of-1 at KING_TOKEN_ID)
    bytes private _rarity;

    /// @notice Name pools for random first/last name rolls on mint. 50 × 50 =
    ///         2500 possible combinations. Populated in _initializeNames().
    string[50] private _firstNames;
    string[50] private _lastNames;

    /// @notice Flag for whether the 1-of-1 King token has been minted. Only
    ///         the contract owner can mint it, and only once.
    bool public kingMinted;

    /// @notice Base URI prefix for ERC-721 tokenURI(id). OZ's default
    ///         tokenURI returns `baseURI + tokenId.toString()`. Set this to
    ///         e.g. "https://brawlers.example/api/token/" so marketplaces
    ///         resolve tokenURI(1) to "https://brawlers.example/api/token/1".
    ///         Trailing slash matters; omit it and URLs get mashed together.
    string private _baseTokenURI;

    // ─── Events ──────────────────────────────────────────────────────

    event BrawlerMinted(uint256 indexed tokenId, address indexed owner, string name);
    event KingMinted(address indexed owner, string name);
    event BrawlerStatsUpdated(
        uint256 indexed tokenId,
        uint32 newElo,
        uint16 newWins,
        uint16 newLosses,
        uint16 newTies,
        bool isDead
    );
    event DuelContractSet(address indexed oldContract, address indexed newContract);
    event GraveyardContractSet(address indexed oldContract, address indexed newContract);
    event MintDropContractSet(address indexed oldContract, address indexed newContract);
    event BaseURISet(string oldURI, string newURI);

    // ─── Errors ──────────────────────────────────────────────────────

    error NotAuthorized();
    error BrawlerDoesNotExist(uint256 tokenId);
    error InvalidWeaponId(uint8 id);
    error WeightsMustSumTo100(uint256 actual);
    error NotMintDropOrOwner();
    error SupplyExhausted();
    error InvalidTokenId(uint256 tokenId);
    error InvalidTier(uint8 tier);
    error KingAlreadyMinted();
    error AlreadySet();
    error ZeroAddress();

    // ─── Modifiers ───────────────────────────────────────────────────

    modifier onlyDuelContract() {
        if (msg.sender != duelContract) revert NotAuthorized();
        _;
    }

    modifier onlyGraveyardContract() {
        if (msg.sender != graveyardContract) revert NotAuthorized();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────

    /**
     * @param initialOwner Address that will own the contract.
     * @param _masterSeed Seed used to derive all brawler traits (commit publicly before mint).
     * @param _devWallet Address that gets capped to common/uncommon at mint
     *                   time. Pass address(0) to disable the cap (testing).
     */
    constructor(address initialOwner, uint256 _masterSeed, address _devWallet)
        ERC721("Brawlers", "BRAWL")
        Ownable(initialOwner)
    {
        masterSeed = _masterSeed;
        devWallet = _devWallet;
        _initializeWeapons();
        _initializeRarity();
        _initializeNames();
    }

    // ─── External: admin ─────────────────────────────────────────────

    /// @notice Wire the Duel contract. One-time-set so a compromised owner
    ///         key can't repoint to a malicious Duel that flips every
    ///         brawler's wins/losses. Once set the address is frozen.
    function setDuelContract(address _duelContract) external onlyOwner {
        if (duelContract != address(0)) revert AlreadySet();
        if (_duelContract == address(0)) revert ZeroAddress();
        emit DuelContractSet(address(0), _duelContract);
        duelContract = _duelContract;
    }

    /// @notice Wire the Graveyard contract. One-time-set, see setDuelContract
    ///         for the reasoning.
    function setGraveyardContract(address _graveyardContract) external onlyOwner {
        if (graveyardContract != address(0)) revert AlreadySet();
        if (_graveyardContract == address(0)) revert ZeroAddress();
        emit GraveyardContractSet(address(0), _graveyardContract);
        graveyardContract = _graveyardContract;
    }

    /**
     * @notice Authorize a MintDrop contract to call mint(). One-time-set:
     *         once a MintDrop is wired the address is frozen, so a stolen
     *         owner key can't repoint to a malicious minter that drains the
     *         remaining supply. The initial sale goes through MintDrop's
     *         payment paths instead of anonymous free mints.
     */
    function setMintDrop(address _mintDrop) external onlyOwner {
        if (mintDropContract != address(0)) revert AlreadySet();
        if (_mintDrop == address(0)) revert ZeroAddress();
        emit MintDropContractSet(address(0), _mintDrop);
        mintDropContract = _mintDrop;
    }

    /**
     * @notice Set the ERC-721 base URI. Marketplaces and wallets call
     *         tokenURI(id) which returns `baseURI + id`.
     * @param newBaseURI The new prefix. Include a trailing slash.
     */
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        emit BaseURISet(_baseTokenURI, newBaseURI);
        _baseTokenURI = newBaseURI;
    }

    /// @notice Public getter for the base URI (convenience, _baseURI is internal).
    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── External: minting ───────────────────────────────────────────

    /**
     * @notice Mint a single brawler to `to`. Stats and weapon are deterministic
     *         from (masterSeed, tokenId); rarity tier is deterministic from
     *         the shuffled `_rarity` table.
     *
     * @dev Only callable by the authorized MintDrop contract or the contract
     *      owner (owner path exists for dev/test workflows). MAX_SUPPLY is
     *      enforced, the 501st mint attempt reverts with SupplyExhausted.
     *
     * @param to Recipient address.
     * @return tokenId The newly minted token ID.
     */
    function mint(address to) external whenNotPaused returns (uint256 tokenId) {
        if (msg.sender != mintDropContract && msg.sender != owner()) {
            revert NotMintDropOrOwner();
        }
        if (nextTokenId > MAX_SUPPLY) revert SupplyExhausted();

        // Dev cap: any mint where `to == devWallet` is shifted to the next
        // common-or-uncommon slot. Walks forward in `_rarity[]` and swaps
        // the current rare+ slot with the next C/U slot, so the rare slot
        // gets passed forward to a future buyer. No-op if devWallet is 0.
        if (devWallet != address(0) && to == devWallet) {
            _skipRareForDev();
        }

        tokenId = nextTokenId;
        nextTokenId = uint32(tokenId + 1);

        Brawler storage b = _brawlers[tokenId];
        _rollBrawler(b, tokenId);

        _safeMint(to, tokenId);
        emit BrawlerMinted(tokenId, to, b.name);
    }

    /**
     * @dev Walk forward in `_rarity[]` from the current next-mint slot, find
     *      the next slot whose tier is <= 1 (Common or Uncommon), and swap
     *      the two slots' rarities. The dev mint then resolves to a common
     *      or uncommon; the rare/legendary/epic slot stays in the drop and
     *      gets minted later by a non-dev buyer.
     *
     *      Bounded scan (DEV_RARITY_SCAN_LIMIT) so the worst-case mint gas
     *      is predictable. With ~87% of the drop being C/U, finding one
     *      within 50 slots is overwhelmingly likely.
     */
    function _skipRareForDev() private {
        uint256 idx = uint256(nextTokenId) - 1;
        if (idx >= MAX_SUPPLY) return;
        bytes1 currentTier = _rarity[idx];
        if (uint8(currentTier) <= 1) return; // already common/uncommon
        uint256 maxScan = idx + 1 + DEV_RARITY_SCAN_LIMIT;
        if (maxScan > MAX_SUPPLY) maxScan = MAX_SUPPLY;
        for (uint256 j = idx + 1; j < maxScan; j++) {
            bytes1 candidate = _rarity[j];
            if (uint8(candidate) <= 1) {
                _rarity[idx] = candidate;
                _rarity[j] = currentTier;
                return;
            }
        }
        // No C/U found within the scan window, dev gets whatever's at idx.
    }

    // ─── External: King mint (dev 1-of-1) ────────────────────────────

    /**
     * @notice Mint the one-of-one King at KING_TOKEN_ID (501). Stats are all
     *         maxed at 18 (bypasses the point-buy budget), weapon is the
     *         unique Kingsblade (index 11), starting ELO 2000, level 10.
     *         Rarity tier = 5. Only callable by the contract owner, once.
     */
    function mintKing(address to) external whenNotPaused onlyOwner returns (uint256) {
        if (kingMinted) revert KingAlreadyMinted();
        kingMinted = true;

        Brawler storage b = _brawlers[KING_TOKEN_ID];
        b.strength = 18;
        b.dexterity = 18;
        b.constitution = 18;
        b.intelligence = 18;
        b.wisdom = 18;
        b.charisma = 18;
        b.weaponId = 11; // Kingsblade
        b.level = 10;
        b.xp = 0;
        b.elo = 2000;
        b.wins = 0;
        b.losses = 0;
        b.ties = 0;
        b.isDead = false;
        b.name = "The King";

        _safeMint(to, KING_TOKEN_ID);
        emit BrawlerMinted(KING_TOKEN_ID, to, b.name);
        emit KingMinted(to, b.name);
        return KING_TOKEN_ID;
    }

    // ─── External: mutations by Duel contract ────────────────────────

    /**
     * @notice Apply a duel's state updates to two brawlers. Only callable by
     *         the authorized Duel contract.
     * @dev The Duel contract has already verified the signature and outcome.
     *      This function just writes to storage.
     * @param aId Brawler A token ID.
     * @param bId Brawler B token ID.
     * @param newEloA New ELO for A.
     * @param newEloB New ELO for B.
     * @param winnerId 0 for tie, else aId or bId.
     * @param aDied True if A should be marked dead.
     * @param bDied True if B should be marked dead.
     */
    function applyDuelResult(
        uint256 aId,
        uint256 bId,
        uint32 newEloA,
        uint32 newEloB,
        uint32 winnerId,
        bool aDied,
        bool bDied
    ) external onlyDuelContract {
        Brawler storage a = _brawlers[aId];
        Brawler storage b = _brawlers[bId];

        if (winnerId == aId) {
            a.wins++;
            b.losses++;
        } else if (winnerId == bId) {
            b.wins++;
            a.losses++;
        } else {
            a.ties++;
            b.ties++;
        }

        a.elo = newEloA < MIN_ELO ? MIN_ELO : newEloA;
        b.elo = newEloB < MIN_ELO ? MIN_ELO : newEloB;

        if (aDied) a.isDead = true;
        if (bDied) b.isDead = true;

        emit BrawlerStatsUpdated(aId, a.elo, a.wins, a.losses, a.ties, a.isDead);
        emit BrawlerStatsUpdated(bId, b.elo, b.wins, b.losses, b.ties, b.isDead);
    }

    // ─── External: mutations by Graveyard contract ───────────────────

    /// @notice Clear the isDead flag on a brawler. Only callable by Graveyard.
    function resurrect(uint256 tokenId) external onlyGraveyardContract {
        Brawler storage b = _brawlers[tokenId];
        b.isDead = false;
        emit BrawlerStatsUpdated(tokenId, b.elo, b.wins, b.losses, b.ties, false);
    }

    // ─── External: views ─────────────────────────────────────────────

    function getBrawler(uint256 tokenId) external view returns (Brawler memory) {
        if (_ownerOf(tokenId) == address(0)) revert BrawlerDoesNotExist(tokenId);
        return _brawlers[tokenId];
    }

    function getStats(uint256 tokenId) external view returns (Stats.StatBlock memory) {
        if (_ownerOf(tokenId) == address(0)) revert BrawlerDoesNotExist(tokenId);
        Brawler storage b = _brawlers[tokenId];
        return Stats.StatBlock({
            strength: b.strength,
            dexterity: b.dexterity,
            constitution: b.constitution,
            intelligence: b.intelligence,
            wisdom: b.wisdom,
            charisma: b.charisma
        });
    }

    function getWeapon(uint8 weaponId) external view returns (Weapon memory) {
        if (weaponId >= _weapons.length) revert InvalidWeaponId(weaponId);
        return _weapons[weaponId];
    }

    function getBrawlerWeapon(uint256 tokenId) external view returns (Weapon memory) {
        if (_ownerOf(tokenId) == address(0)) revert BrawlerDoesNotExist(tokenId);
        return _weapons[_brawlers[tokenId].weaponId];
    }

    function weaponCount() external view returns (uint256) {
        return _weapons.length;
    }

    /**
     * @notice Rarity tier for a tokenId. Returns:
     *           0 = Common
     *           1 = Uncommon
     *           2 = Rare
     *           3 = Legendary (10 in the curated drop)
     *           4 = Epic      (5  in the curated drop, the rarest normal tier)
     *           5 = King      (only KING_TOKEN_ID / 501)
     *
     *         Determined at deploy time by the shuffled distribution;
     *         independent of whether the token has been minted yet.
     */
    function rarityOf(uint256 tokenId) public view returns (uint8) {
        if (tokenId == KING_TOKEN_ID) return 5;
        if (tokenId < 1 || tokenId > MAX_SUPPLY) revert InvalidTokenId(tokenId);
        return uint8(_rarity[tokenId - 1]);
    }

    /**
     * @notice Rarity-scaled resurrection cost: base × rarityMultiplier.
     *         Multipliers (curve A): [1, 3, 10, 30, 100, 500] for tiers 0..5.
     *         Graveyard reads this to charge the right amount per brawler.
     *         The base cost is provided by Graveyard's own state; this view
     *         just returns the multiplier-scaled value given a tokenId.
     *
     * @param tokenId A brawler that exists (1..MAX_SUPPLY or KING_TOKEN_ID).
     * @param baseCost The graveyard's base cost (in wei).
     * @return cost baseCost × rarity multiplier.
     */
    function computeResurrectionCost(uint256 tokenId, uint256 baseCost)
        external
        view
        returns (uint256 cost)
    {
        uint8 tier = rarityOf(tokenId);
        // mults[tier]
        uint256 mult;
        if (tier == 0) mult = 1;
        else if (tier == 1) mult = 3;
        else if (tier == 2) mult = 10;
        else if (tier == 3) mult = 30;
        else if (tier == 4) mult = 100;
        else if (tier == 5) mult = 500;
        else revert InvalidTier(tier);
        return baseCost * mult;
    }

    function isAlive(uint256 tokenId) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) revert BrawlerDoesNotExist(tokenId);
        return !_brawlers[tokenId].isDead;
    }

    // ─── Internal: roll a brawler from seed ──────────────────────────

    /**
     * @dev Derive sub-seeds for stats and weapon independently so that
     *      changing one doesn't shift the other. Weapon pick is now
     *      constrained to the tokenId's pre-shuffled rarity tier.
     */
    function _rollBrawler(Brawler storage b, uint256 tokenId) private {
        uint256 statsSeed = masterSeed ^ (tokenId * 0xbf58476d1ce4e5b9);
        uint256 weaponSeed = masterSeed ^ (tokenId * 0x94d049bb133111eb);
        uint256 nameSeed = masterSeed ^ (tokenId * 0x9e3779b97f4a7c15);

        // Stats via point-buy
        Stats.StatBlock memory s = _rollStats(statsSeed);
        b.strength = s.strength;
        b.dexterity = s.dexterity;
        b.constitution = s.constitution;
        b.intelligence = s.intelligence;
        b.wisdom = s.wisdom;
        b.charisma = s.charisma;

        // Weapon via weighted pick within the tokenId's rarity tier.
        uint8 tier = uint8(_rarity[tokenId - 1]);
        b.weaponId = _rollWeaponInTier(weaponSeed, tier);

        // Name (simple on-chain placeholder; full name rolling lives in TS).
        b.name = _rollName(nameSeed, tokenId);

        // Initial combat fields
        b.level = 1;
        b.xp = 0;
        b.elo = STARTING_ELO;
        b.wins = 0;
        b.losses = 0;
        b.ties = 0;
        b.isDead = false;
    }

    function _rollStats(uint256 seed) private pure returns (Stats.StatBlock memory s) {
        Xorshift.State memory rng = Xorshift.create(seed);
        s.strength = Stats.STAT_MIN;
        s.dexterity = Stats.STAT_MIN;
        s.constitution = Stats.STAT_MIN;
        s.intelligence = Stats.STAT_MIN;
        s.wisdom = Stats.STAT_MIN;
        s.charisma = Stats.STAT_MIN;

        uint256 remaining = Stats.POINT_BUY_TOTAL;
        uint256 maxIterations = Stats.POINT_BUY_TOTAL * 20;

        for (uint256 iter = 0; iter < maxIterations && remaining > 0; iter++) {
            uint8 pickIdx = uint8(uint256(Xorshift.nextInt(rng, 0, 5)));
            uint8 current = _getStatByIndex(s, pickIdx);
            if (current >= Stats.STAT_MAX_AT_CREATION) continue;
            uint8 nextValue = current + 1;
            uint256 incrementCost = Stats.pointBuyCost(nextValue) - Stats.pointBuyCost(current);
            if (incrementCost > remaining) {
                // Check if ANY stat is affordable; if not, break.
                bool canAny = false;
                for (uint8 k = 0; k < 6; k++) {
                    uint8 v = _getStatByIndex(s, k);
                    if (v >= Stats.STAT_MAX_AT_CREATION) continue;
                    uint256 kCost = Stats.pointBuyCost(v + 1) - Stats.pointBuyCost(v);
                    if (kCost <= remaining) {
                        canAny = true;
                        break;
                    }
                }
                if (!canAny) break;
                continue;
            }
            _setStatByIndex(s, pickIdx, nextValue);
            remaining -= incrementCost;
        }
        require(Stats.validate(s), "Brawlers: rollStats produced invalid stats");
    }

    /**
     * @dev Pick a weapon constrained to a rarity tier. Weights within a tier
     *      are the weapon weights from weapons.ts (same units as the old
     *      flat distribution, just summed per-tier now).
     */
    function _rollWeaponInTier(uint256 seed, uint8 tier) private view returns (uint8) {
        Xorshift.State memory rng = Xorshift.create(seed);
        (uint8 start, uint8 count) = _tierWeaponRange(tier);
        uint256[] memory weights = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            weights[i] = _weapons[start + i].weight;
        }
        return start + uint8(Xorshift.weightedPick(rng, weights));
    }

    /**
     * @dev (startIndex, count) of the weapon catalog slice for each tier.
     *      Hard-coded to match the weapons.ts ordering. If you reorder
     *      weapons.ts or _initializeWeapons, update this.
     *
     *      0 = Common    (indexes 0-2: Knife, Baseball Bat, Crowbar)
     *      1 = Uncommon  (indexes 3-4: Machete, Pistol)
     *      2 = Rare      (indexes 5-6: Shotgun, Sledgehammer)
     *      3 = Epic      (indexes 7-8: Flaming Sword, Electric Axe)
     *      4 = Legendary (indexes 9-10: Bazooka, Rail Gun)
     */
    function _tierWeaponRange(uint8 tier) private pure returns (uint8 start, uint8 count) {
        if (tier == 0) return (0, 3); // Common: Knife, Baseball Bat, Crowbar
        if (tier == 1) return (3, 2); // Uncommon: Machete, Pistol
        if (tier == 2) return (5, 2); // Rare: Shotgun, Sledgehammer
        if (tier == 3) return (7, 2); // Legendary (was Epic): Flaming Sword, Electric Axe
        if (tier == 4) return (9, 2); // Epic (was Legendary, rarest drop): Bazooka, Rail Gun
        if (tier == 5) return (11, 1); // King: Kingsblade (only accessible via mintKing)
        revert InvalidTier(tier);
    }

    /**
     * @dev Roll a random name from the first/last pools (50 × 50 = 2500 combos).
     *      Deterministic from (masterSeed, tokenId). Names are immutable after
     *      mint, no rename function exists.
     */
    function _rollName(uint256 seed, uint256 /*tokenId*/) private view returns (string memory) {
        Xorshift.State memory rng = Xorshift.create(seed);
        uint8 firstIdx = uint8(uint256(Xorshift.nextInt(rng, 0, 49)));
        uint8 lastIdx = uint8(uint256(Xorshift.nextInt(rng, 0, 49)));
        return string.concat(_firstNames[firstIdx], " ", _lastNames[lastIdx]);
    }

    /// @dev Standard uint-to-string.
    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    // ─── Internal: stat block index helpers ──────────────────────────

    function _getStatByIndex(Stats.StatBlock memory s, uint8 idx) private pure returns (uint8) {
        if (idx == 0) return s.strength;
        if (idx == 1) return s.dexterity;
        if (idx == 2) return s.constitution;
        if (idx == 3) return s.intelligence;
        if (idx == 4) return s.wisdom;
        if (idx == 5) return s.charisma;
        revert("Brawlers: invalid stat index");
    }

    function _setStatByIndex(Stats.StatBlock memory s, uint8 idx, uint8 value) private pure {
        if (idx == 0) s.strength = value;
        else if (idx == 1) s.dexterity = value;
        else if (idx == 2) s.constitution = value;
        else if (idx == 3) s.intelligence = value;
        else if (idx == 4) s.wisdom = value;
        else if (idx == 5) s.charisma = value;
        else revert("Brawlers: invalid stat index");
    }

    // ─── Internal: weapon catalog initialization ─────────────────────

    /**
     * @dev Populate the weapon catalog with the 11 canonical weapons.
     *      Order and weights match src/core/weapons.ts exactly.
     */
    function _initializeWeapons() private {
        // 0 = blade, 1 = blunt, 2 = ranged
        _addWeapon("Knife", 6, 11, 9, 0, 18);
        _addWeapon("Baseball Bat", 8, 13, 6, 1, 17);
        _addWeapon("Crowbar", 8, 13, 5, 1, 15);
        _addWeapon("Machete", 10, 15, 6, 0, 12);
        _addWeapon("Pistol", 11, 16, 7, 2, 11);
        _addWeapon("Shotgun", 14, 22, 4, 2, 9);
        _addWeapon("Sledgehammer", 14, 24, 3, 1, 7);
        _addWeapon("Flaming Sword", 15, 22, 6, 0, 5);
        _addWeapon("Electric Axe", 16, 24, 5, 0, 3);
        _addWeapon("Bazooka", 22, 35, 2, 2, 2);
        _addWeapon("Rail Gun", 25, 40, 6, 2, 1);
        // King-tier only, weight is 0 because it's not in the weighted pool.
        // Accessed only via tier 5 mapping in _tierWeaponRange.
        _addWeapon("Kingsblade", 50, 100, 10, 0, 0);

        // Validate sum of the NORMAL-drop weapons (indexes 0..10) = 100.
        // Kingsblade (index 11) is excluded because weight=0 and it isn't in
        // the weighted pool for any regular tier.
        uint256 total = 0;
        for (uint256 i = 0; i < 11; i++) {
            total += _weapons[i].weight;
        }
        if (total != 100) revert WeightsMustSumTo100(total);
    }

    /**
     * @dev Populate the 50-first × 50-last name pools. ~100 SSTOREs at
     *      construction; one-time cost. Pools are private so nobody scrapes
     *      them (they're deterministic from masterSeed + tokenId anyway).
     */
    function _initializeNames() private {
        string[50] memory firsts = [
            "Knox","Hank","Quade","Enzo","Axel","Luna","Zara","Hatch","Rook","Marco",
            "Rex","Jade","Kane","Mira","Bolt","Vince","Ivy","Drake","Nova","Cash",
            "Jinx","Riggs","Fang","Stone","Crash","Ursa","Gunner","Vera","Gia","Phoenix",
            "Talon","Vex","Roscoe","Mace","Kilo","Thorn","Grim","Ash","Raze","Hex",
            "Beck","Tank","Tycho","Diesel","Ransom","Vulcan","Harlan","Bruno","Reaver","Blaze"
        ];
        string[50] memory lasts = [
            "Smasher","Blackheart","Wrecker","Stormbreaker","Grimes","Snake","Ravenclaw","Vance","Butcher","Deathrow",
            "Harlow","Ives","Kane","Marrow","Nash","Warlow","Cross","Emberly","Locke","Slayer",
            "Wolf","Nightshade","Zorn","Crusher","the Bull","the Wolf","the Snake","Ryker","Vale","Stoker",
            "Steel","Hammer","Razor","Kade","Pike","Kross","Vane","Blackout","Hollow","Crowe",
            "Redmane","Silvio","Ghoul","Rain","Sterling","Revenant","Murder","Brimstone","Thorn","Fury"
        ];
        for (uint256 i = 0; i < 50; i++) {
            _firstNames[i] = firsts[i];
            _lastNames[i] = lasts[i];
        }
    }

    function _addWeapon(
        string memory name,
        uint8 damageMin,
        uint8 damageMax,
        uint8 speed,
        uint8 weaponType,
        uint8 weight
    ) private {
        _weapons.push(
            Weapon({
                name: name,
                damageMin: damageMin,
                damageMax: damageMax,
                speed: speed,
                weaponType: weaponType,
                weight: weight
            })
        );
    }

    /**
     * @dev Fill `_rarity` with the sorted tier distribution, then Fisher-Yates
     *      shuffle it using a masterSeed-derived PRNG. Runs once in the
     *      constructor; the result is permanent.
     *
     *      Cost: ~500 loop iterations of in-memory swaps + one SSTORE per
     *      32-byte chunk of packed `bytes` storage (~16 SSTOREs for the
     *      data + 1 for length). Constructor-time only.
     */
    function _initializeRarity() private {
        bytes memory r = new bytes(MAX_SUPPLY);
        uint256 cursor = 0;
        for (uint256 i = 0; i < TIER_COMMON; i++) {
            r[cursor++] = bytes1(uint8(0));
        }
        for (uint256 i = 0; i < TIER_UNCOMMON; i++) {
            r[cursor++] = bytes1(uint8(1));
        }
        for (uint256 i = 0; i < TIER_RARE; i++) {
            r[cursor++] = bytes1(uint8(2));
        }
        for (uint256 i = 0; i < TIER_EPIC; i++) {
            r[cursor++] = bytes1(uint8(3));
        }
        for (uint256 i = 0; i < TIER_LEGENDARY; i++) {
            r[cursor++] = bytes1(uint8(4));
        }
        // Safety: distribution must exactly fill the array.
        require(cursor == MAX_SUPPLY, "Brawlers: rarity dist mismatch");

        // Domain-separated shuffle seed. Using a tag distinct from the stats /
        // weapon / name seeds so rarity is decorrelated from them.
        uint256 shuffleSeed = masterSeed ^ uint256(0x5348554646); // "SHUFF"
        Xorshift.State memory rng = Xorshift.create(shuffleSeed);
        for (uint256 i = MAX_SUPPLY - 1; i > 0; i--) {
            uint256 j = uint256(Xorshift.nextInt(rng, 0, int256(i)));
            bytes1 tmp = r[i];
            r[i] = r[j];
            r[j] = tmp;
        }
        _rarity = r;
    }

    // ─── Internal: OZ ERC-721 hooks ──────────────────────────────────

    /**
     * @dev Block transfers while paused. OZ 5.x uses `_update` as the hook
     *      for all transfer/mint/burn paths.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        whenNotPaused
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    /**
     * @dev Override OZ's default (empty-string) _baseURI so tokenURI(id)
     *      returns `baseURI + id` for marketplace integration. OZ 5.x's
     *      ERC721.tokenURI(id) already handles the concatenation.
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
