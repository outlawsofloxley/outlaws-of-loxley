/**
 * Contract ABIs.
 *
 * Hand-written to match the Solidity contracts in `contracts/`. We only include
 * the functions and events the CLI actually uses, anything else would be dead
 * weight.
 *
 * If a contract's interface changes, update the ABI here AND the Solidity
 * source, then re-deploy. There is no auto-sync.
 */

/** Brawlers ERC-721, see contracts/Brawlers.sol */
export const BRAWLERS_ABI = [
  // --- Reads ---
  'function masterSeed() view returns (uint256)',
  'function nextTokenId() view returns (uint32)',
  'function STARTING_ELO() view returns (uint32)',
  'function MIN_ELO() view returns (uint32)',
  'function weaponCount() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function isAlive(uint256 tokenId) view returns (bool)',
  'function getBrawler(uint256 tokenId) view returns (tuple(uint8 strength, uint8 dexterity, uint8 constitution, uint8 intelligence, uint8 wisdom, uint8 charisma, uint8 weaponId, uint16 level, uint32 xp, uint32 elo, uint16 wins, uint16 losses, uint16 ties, bool isDead, string name))',
  'function getBrawlerWeapon(uint256 tokenId) view returns (tuple(string name, uint8 damageMin, uint8 damageMax, uint8 speed, uint8 weaponType, uint8 weight))',
  'function getWeapon(uint8 weaponId) view returns (tuple(string name, uint8 damageMin, uint8 damageMax, uint8 speed, uint8 weaponType, uint8 weight))',
  'function getStats(uint256 tokenId) view returns (tuple(uint8 strength, uint8 dexterity, uint8 constitution, uint8 intelligence, uint8 wisdom, uint8 charisma))',
  'function duelContract() view returns (address)',
  'function graveyardContract() view returns (address)',
  'function owner() view returns (address)',
  'function paused() view returns (bool)',

  // --- Writes ---
  'function mint(address to) returns (uint256 tokenId)',
  'function rename(uint256 tokenId, string calldata newName)',

  // --- Events (Phase 5 decodes these) ---
  'event BrawlerMinted(uint256 indexed tokenId, address indexed owner, string name)',
  'event BrawlerRenamed(uint256 indexed tokenId, string oldName, string newName)',
  'event BrawlerStatsUpdated(uint256 indexed tokenId, uint32 newElo, uint16 newWins, uint16 newLosses, uint16 newTies, bool isDead)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
] as const;

/** Duel, see contracts/Duel.sol */
export const DUEL_ABI = [
  // --- Reads ---
  'function brawlers() view returns (address)',
  'function trustedSigner() view returns (address)',
  'function CONSECUTIVE_LOSSES_TO_DIE() view returns (uint8)',
  'function consecutiveLosses(uint256 tokenId) view returns (uint8)',
  'function usedNonces(uint256 nonce) view returns (bool)',
  'function hashDuelResult(tuple(uint256 tokenA, uint256 tokenB, uint32 winnerId, uint16 rounds, uint256 seed, uint32 newEloA, uint32 newEloB, uint256 nonce, uint256 expiry) result) view returns (bytes32)',
  'function paused() view returns (bool)',

  // --- Writes ---
  'function submitDuel(tuple(uint256 tokenA, uint256 tokenB, uint32 winnerId, uint16 rounds, uint256 seed, uint32 newEloA, uint32 newEloB, uint256 nonce, uint256 expiry) result, bytes calldata signature)',

  // --- Events ---
  'event DuelCompleted(uint256 indexed tokenA, uint256 indexed tokenB, uint32 winnerId, uint16 rounds, uint256 seed, uint256 nonce, uint32 newEloA, uint32 newEloB)',
  'event BrawlerDied(uint256 indexed tokenId)',
  'event StreakReset(uint256 indexed tokenId)',
] as const;

/** Graveyard, see contracts/Graveyard.sol */
export const GRAVEYARD_ABI = [
  // --- Reads ---
  'function brawlers() view returns (address)',
  'function duel() view returns (address)',
  'function treasury() view returns (address)',
  'function resurrectionCost() view returns (uint256)',
  'function paused() view returns (bool)',

  // --- Writes ---
  'function resurrect(uint256 tokenId) payable',

  // --- Events ---
  'event Resurrected(uint256 indexed tokenId, address indexed by, uint256 paid)',
] as const;
