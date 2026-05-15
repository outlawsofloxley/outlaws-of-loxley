/**
 * Contract ABIs for the frontend.
 *
 * Keep in sync with on-chain. Phase 7 added BRAWL ERC-20, MintDrop, and
 * gated-mint + fee-taking on Brawlers/Duel. The full set here covers every
 * read + write + event the UI needs for: browse, mint (via MintDrop),
 * detail (rarity, transfer, rename), duel (BRAWL approve + submit),
 * graveyard (resurrect).
 */
import { parseAbi } from 'viem';

export const BRAWLERS_ABI = parseAbi([
  // --- Reads ---
  'function masterSeed() view returns (uint256)',
  'function nextTokenId() view returns (uint32)',
  'function STARTING_ELO() view returns (uint32)',
  'function MIN_ELO() view returns (uint32)',
  'function MAX_SUPPLY() view returns (uint32)',
  'function weaponCount() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function isAlive(uint256 tokenId) view returns (bool)',
  'function getBrawler(uint256 tokenId) view returns (BrawlerView)',
  'function getBrawlerWeapon(uint256 tokenId) view returns (WeaponView)',
  'function getStats(uint256 tokenId) view returns (StatsView)',
  'function rarityOf(uint256 tokenId) view returns (uint8)',
  'function duelContract() view returns (address)',
  'function graveyardContract() view returns (address)',
  'function mintDropContract() view returns (address)',
  'function owner() view returns (address)',
  'function paused() view returns (bool)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function baseURI() view returns (string)',
  'function KING_TOKEN_ID() view returns (uint32)',
  'function kingMinted() view returns (bool)',
  'function computeResurrectionCost(uint256 tokenId, uint256 baseCost) view returns (uint256)',

  // --- Writes ---
  'function mint(address to) returns (uint256 tokenId)',
  'function mintKing(address to) returns (uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function approve(address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setBaseURI(string newBaseURI)',
  'function setMintDrop(address _mintDrop)',

  // --- Events ---
  'event BrawlerMinted(uint256 indexed tokenId, address indexed owner, string name)',
  'event KingMinted(address indexed owner, string name)',
  'event BrawlerStatsUpdated(uint256 indexed tokenId, uint32 newElo, uint16 newWins, uint16 newLosses, uint16 newTies, bool isDead)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event BaseURISet(string oldURI, string newURI)',
  'event MintDropContractSet(address indexed oldContract, address indexed newContract)',

  // --- Custom errors ---
  'error NotAuthorized()',
  'error BrawlerDoesNotExist(uint256 tokenId)',
  'error InvalidWeaponId(uint8 id)',
  'error WeightsMustSumTo100(uint256 actual)',
  'error NotMintDropOrOwner()',
  'error SupplyExhausted()',
  'error InvalidTokenId(uint256 tokenId)',
  'error InvalidTier(uint8 tier)',
  'error KingAlreadyMinted()',

  // --- Named structs ---
  'struct BrawlerView { uint8 strength; uint8 dexterity; uint8 constitution; uint8 intelligence; uint8 wisdom; uint8 charisma; uint8 weaponId; uint16 level; uint32 xp; uint32 elo; uint16 wins; uint16 losses; uint16 ties; bool isDead; string name; }',
  'struct WeaponView { string name; uint8 damageMin; uint8 damageMax; uint8 speed; uint8 weaponType; uint8 weight; }',
  'struct StatsView { uint8 strength; uint8 dexterity; uint8 constitution; uint8 intelligence; uint8 wisdom; uint8 charisma; }',
]);

export const DUEL_ABI = parseAbi([
  // --- Reads ---
  'function brawlers() view returns (address)',
  'function trustedSigner() view returns (address)',
  'function CONSECUTIVE_LOSSES_TO_DIE() view returns (uint8)',
  'function MAX_DEV_BPS() view returns (uint16)',
  'function consecutiveLosses(uint256 tokenId) view returns (uint8)',
  'function usedNonces(uint256 nonce) view returns (bool)',
  'function hashDuelResult(DuelResult result) view returns (bytes32)',
  'function domainSeparator() view returns (bytes32)',
  'function paused() view returns (bool)',
  'function brawlToken() view returns (address)',
  'function fightCost() view returns (uint256)',
  'function fighterCost(uint256 tokenId) view returns (uint256)',
  'function FOUNDER_FIGHT_DISCOUNT_CAP() view returns (uint256)',
  'function founderDiscountBps() view returns (uint256)',
  'function devShareBps() view returns (uint16)',
  'function devTreasury() view returns (address)',

  // --- Writes ---
  'function submitDuel(DuelResult result, bytes signature)',
  'function setFightEconomics(uint256 _fightCost, uint16 _devShareBps, address _devTreasury)',
  'function setFounderDiscountBps(uint256 newBps)',
  'function setBRAWLToken(address newToken)',

  // --- Events ---
  'event DuelCompleted(uint256 indexed tokenA, uint256 indexed tokenB, uint32 winnerId, uint16 rounds, uint256 seed, uint256 nonce, uint32 newEloA, uint32 newEloB)',
  'event BrawlerDied(uint256 indexed tokenId)',
  'event StreakReset(uint256 indexed tokenId)',
  'event BRAWLTokenChanged(address indexed oldToken, address indexed newToken)',
  'event FightEconomicsChanged(uint256 fightCost, uint16 devShareBps, address devTreasury)',
  'event FeesPaid(uint256 indexed tokenA, uint256 indexed tokenB, uint256 potToA, uint256 potToB, uint256 devCut)',

  // --- Errors ---
  'error InvalidSignature()',
  'error NonceAlreadyUsed()',
  'error Expired()',
  'error InvalidWinnerId()',
  'error BrawlerNotAlive(uint256 tokenId)',
  'error NotOwnerOfEither()',
  'error SelfFight()',
  'error DevShareTooHigh(uint16 requested)',
  'error ZeroDevTreasury()',

  'struct DuelResult { uint256 tokenA; uint256 tokenB; uint32 winnerId; uint16 rounds; uint256 seed; uint32 newEloA; uint32 newEloB; uint256 nonce; uint256 expiry; }',
]);

export const GRAVEYARD_ABI = parseAbi([
  'function brawlers() view returns (address)',
  'function duel() view returns (address)',
  'function treasury() view returns (address)',
  'function resurrectionCost() view returns (uint256)',
  'function resurrectionCap() view returns (uint256)',
  'function resurrectionCostUsdCents() view returns (uint256)',
  'function resurrectionCapUsdCents() view returns (uint256)',
  'function MAX_RESURRECTION_USD_CENTS() view returns (uint256)',
  'function costFor(uint256 tokenId) view returns (uint256)',
  'function hasUsedFreeResurrect(uint256 tokenId) view returns (bool)',
  'function FOUNDER_FREE_RESURRECT_CAP() view returns (uint256)',
  'function MAX_RESURRECTION_COST() view returns (uint256)',
  'function paused() view returns (bool)',

  'function setResurrectionCost(uint256 newCost)',
  'function setResurrectionCap(uint256 newCap)',
  'function setResurrectionCostUsdCents(uint256 newCents)',
  'function setResurrectionCapUsdCents(uint256 newCents)',
  'function resurrect(uint256 tokenId) payable',

  'event ResurrectionCostChanged(uint256 oldCost, uint256 newCost)',
  'event ResurrectionCapChanged(uint256 oldCap, uint256 newCap)',
  'event Resurrected(uint256 indexed tokenId, address indexed by, uint256 paid)',
]);

/**
 * BRAWL ERC-20. Same ABI is reused for USDT reads + approve flow, any
 * EIP-20 token surface works through it.
 */
export const BRAWL_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function FIXED_SUPPLY() view returns (uint256)',

  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',

  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
]);

/** USDT / generic ERC-20, same surface as BRAWL. Alias for clarity at call sites. */
export const ERC20_ABI = BRAWL_ABI;

export const MARKETPLACE_ABI = parseAbi([
  // --- Reads ---
  'function brawlers() view returns (address)',
  'function feeBps() view returns (uint16)',
  'function feeTreasury() view returns (address)',
  'function MAX_FEE_BPS() view returns (uint16)',
  'function paused() view returns (bool)',
  'function listingOf(uint256 tokenId) view returns (Listing)',
  'function isListed(uint256 tokenId) view returns (bool)',
  'function isApprovedForMarketplace(uint256 tokenId, address owner) view returns (bool)',
  'function owner() view returns (address)',

  // --- Writes ---
  'function list(uint256 tokenId, uint256 price)',
  'function updatePrice(uint256 tokenId, uint256 newPrice)',
  'function cancel(uint256 tokenId)',
  'function buy(uint256 tokenId) payable',
  'function sweep(uint256 tokenId)',
  'function setFee(uint16 _feeBps)',
  'function setFeeTreasury(address _feeTreasury)',

  // --- Events ---
  'event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)',
  'event Unlisted(uint256 indexed tokenId, address indexed seller)',
  'event PriceUpdated(uint256 indexed tokenId, uint256 oldPrice, uint256 newPrice)',
  'event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee)',
  'event FeeChanged(uint16 oldBps, uint16 newBps)',
  'event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury)',

  // --- Errors ---
  'error NotListed()',
  'error AlreadyListed()',
  'error NotSeller()',
  'error NotOwner()',
  'error NotApproved()',
  'error NotStale()',
  'error ZeroPrice()',
  'error ZeroAddress()',
  'error InsufficientPayment(uint256 expected, uint256 received)',
  'error TransferFailed()',
  'error FeeTooHigh(uint16 requested)',

  'struct Listing { address seller; uint256 price; uint64 listedAt; }',
]);

export const MINTDROP_ABI = parseAbi([
  // --- Reads ---
  'function brawlers() view returns (address)',
  'function brawl() view returns (address)',
  'function usdt() view returns (address)',
  'function usdc() view returns (address)',
  'function ethPrice() view returns (uint256)',
  'function usdtPrice() view returns (uint256)',
  'function usdcPrice() view returns (uint256)',
  'function airdropPerMint() view returns (uint256)',
  'function founderAirdropAmount() view returns (uint256)',
  'function treasury() view returns (address)',
  'function lpTreasury() view returns (address)',
  'function lpShareBps() view returns (uint256)',
  'function lpBrawlPerMint() view returns (uint256)',
  'function totalSold() view returns (uint256)',
  'function totalBonusMinted() view returns (uint256)',
  'function MAX_MINT() view returns (uint256)',
  'function MAX_BATCH() view returns (uint256)',
  'function FOUNDER_AIRDROP_CAP() view returns (uint256)',
  'function FOUNDER_50_CAP() view returns (uint256)',
  'function paused() view returns (bool)',
  // v5+ tier pricing reads (revert on v4, handle defensively in UI)
  'function priceTierCount() view returns (uint256)',
  'function priceTierAt(uint256 i) view returns ((uint16 upToSold, uint128 ethPrice, uint128 usdcPrice, uint128 usdtPrice))',
  'function priceForMint(uint256 mintNumber) view returns (uint256 eth, uint256 usdc, uint256 usdt)',
  'function batchCost(uint256 count) view returns (uint256 ethTotal, uint256 usdcTotal, uint256 usdtTotal)',

  // --- Writes ---
  'function mintWithETH(address to) payable returns (uint256 tokenId)',
  'function mintWithUSDT(address to) returns (uint256 tokenId)',
  'function mintWithUSDC(address to) returns (uint256 tokenId)',
  'function mintMultipleWithETH(address to, uint256 count) payable returns (uint256[] tokenIds)',
  'function mintMultipleWithUSDT(address to, uint256 count) returns (uint256[] tokenIds)',
  'function mintMultipleWithUSDC(address to, uint256 count) returns (uint256[] tokenIds)',
  'function setPrices(uint256 _ethPrice, uint256 _usdtPrice, uint256 _usdcPrice)',
  'function setPriceTiers((uint16 upToSold, uint128 ethPrice, uint128 usdcPrice, uint128 usdtPrice)[] tiers)',
  'function setAirdropPerMint(uint256 _airdrop)',
  'function setFounderAirdrop(uint256 _amount)',
  'function setLpShare(uint256 _bps)',
  'function setLpBrawlPerMint(uint256 _amount)',
  'function setTreasury(address _treasury)',
  'function setLpTreasury(address _lpTreasury)',
  'function withdrawBRAWL(address to, uint256 amount)',

  // --- Events ---
  'event BrawlerSold(address indexed buyer, uint256 indexed tokenId, uint8 paymentType, uint256 amountPaid, uint256 airdropped)',
  'event FounderAirdropped(address indexed buyer, uint256 indexed tokenId, uint256 amount)',
  'event BonusMinted(address indexed buyer, uint256 indexed tokenId, string reason)',
  'event LpBrawlSent(address indexed lpTreasury, uint256 amount)',
  'event LpBrawlPerMintChanged(uint256 newAmount)',
  'event LpTreasuryChanged(address indexed oldLpTreasury, address indexed newLpTreasury)',
  'event LpShareChanged(uint256 newLpShareBps)',
  'event FounderAirdropChanged(uint256 newFounderAirdropAmount)',
  'event PricesChanged(uint256 newEthPrice, uint256 newUsdtPrice, uint256 newUsdcPrice)',
  'event AirdropChanged(uint256 newAirdropPerMint)',
  'event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury)',

  // --- Errors ---
  'error SupplyExhausted()',
  'error IncorrectETH(uint256 expected, uint256 received)',
  'error EthTransferFailed()',
  'error ZeroAddress()',
  'error ZeroPrice()',
  'error InvalidCount(uint256 count)',
]);

/// DuelRouter — currency-aware fight wrapper. Players approve the router
/// for their brawlers + BRAWL, then call `fight(quote, quoteSig, duelResult,
/// duelSig)` with msg.value matching the ETH stakes.
export const DUEL_ROUTER_ABI = parseAbi([
  // --- Reads ---
  'function fightCostBrawl() view returns (uint256)',
  'function fightCostEth() view returns (uint256)',
  'function fightCostUsdCents() view returns (uint256)',
  'function MAX_FIGHT_COST_USD_CENTS() view returns (uint256)',
  'function setFightCostUsdCents(uint256 newCents)',
  'function devShareBps() view returns (uint16)',
  'function devTreasury() view returns (address)',
  'function founderDiscountBps() view returns (uint256)',
  'function trustedSigner() view returns (address)',
  'function fighterCostBrawl(uint256 tokenId) view returns (uint256)',
  'function fighterCostEth(uint256 tokenId) view returns (uint256)',
  'function usedNonces(uint256 nonce) view returns (bool)',
  'function FOUNDER_FIGHT_DISCOUNT_CAP() view returns (uint256)',
  // --- Writes ---
  'function fight((uint256 nonce,uint256 expiry,uint256 tokenA,uint256 tokenB,address ownerA,address ownerB,uint8 modeA,uint8 modeB,uint256 ethCostA,uint256 ethCostB,uint256 brawlCostA,uint256 brawlCostB,uint8 swapDir,uint256 swapAmountIn,uint256 swapMinOut,address payoutAAddr,uint8 payoutACurrency,uint256 payoutAAmount,address payoutBAddr,uint8 payoutBCurrency,uint256 payoutBAmount,uint256 devEthAmount,uint256 devBrawlAmount) quote, bytes quoteSig, (uint256 tokenA,uint256 tokenB,uint32 winnerId,uint16 rounds,uint256 seed,uint32 newEloA,uint32 newEloB,uint256 nonce,uint256 expiry) result, bytes duelSig) payable',
  // --- Events ---
  'event FightSettled(uint256 indexed tokenA, uint256 indexed tokenB, uint8 modeA, uint8 modeB, address indexed winnerAddr, uint256 payoutAAmount, uint256 payoutBAmount, uint256 devEthAmount, uint256 devBrawlAmount)',
]);

/// Aerodrome V2 pair (volatile pool) — minimal read surface for the
/// dashboard + the fight-quote builder. token0/token1 order is determined by
/// address sort, so always check which is BRAWL.
export const AERODROME_PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]);
