/**
 * POST /api/run-duel
 *
 * Server-side duel orchestration:
 *   1. Validate input (tokenA, tokenB distinct positive ints)
 *   2. Read both brawlers + weapons from chain
 *   3. Assemble local Brawler records
 *   4. Generate a 256-bit seed, run the TS combat sim
 *   5. Compute new ELOs
 *   6. Build the DuelResult struct (nonce + 1h expiry)
 *   7. Ask the Duel contract to hash it (view call, avoids abi-encoding bugs)
 *   8. Sign that hash with BRAWLERS_SIGNER_KEY (server-only env var)
 *   9. Return { result, signature, events, winnerId, rounds } to the client
 *
 * The client then submits (result, signature) to the Duel contract from the
 * player's wallet.
 *
 * bigint -> string serialization: JSON can't carry bigint natively, so every
 * 256-bit field in `result` is stringified. Client reconstructs BigInt() on
 * receipt before passing to writeContract.
 */
import { NextResponse } from 'next/server';
import { createPublicClient, defineChain, http, getAddress, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import { BRAWLERS_ABI, DUEL_ROUTER_ABI, AERODROME_PAIR_ABI } from '@/lib/abi';
import { validateEnv } from '@/lib/env';
import { simulateFight } from '@/sim/combat';
import { applyDuelResult, type Outcome } from '@/core/elo';
import { findWeapon } from '@/core/weapons';
import type { Brawler, CombatEvent, Weapon, WeaponType } from '@/core/types';

// Force Node runtime, we use node:crypto for the nonce. Edge would fail here.
export const runtime = 'nodejs';

// Tight expiry window: 10 minutes is enough for a wallet to confirm + broadcast
// + mine without leaving signed payloads sitting in mempools or attacker
// inboxes for long. Was 3600 (1h) pre-audit, dropped per the H-1 EIP-712 fix.
const DUEL_EXPIRY_SECONDS = 600;
const WEAPON_TYPE_MAP: readonly WeaponType[] = ['blade', 'blunt', 'ranged'];

function randomBig256(): bigint {
  const bytes = randomBytes(32);
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

function buildChain(chainId: number, rpcUrl: string) {
  return defineChain({
    id: chainId,
    name: chainId === 31337 ? 'Anvil Local' : `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: chainId !== 1,
  });
}

interface OnchainBrawlerView {
  readonly strength: number;
  readonly dexterity: number;
  readonly constitution: number;
  readonly intelligence: number;
  readonly wisdom: number;
  readonly charisma: number;
  readonly weaponId: number;
  readonly level: number;
  readonly xp: number;
  readonly elo: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly isDead: boolean;
  readonly name: string;
}

interface OnchainWeaponView {
  readonly name: string;
  readonly damageMin: number;
  readonly damageMax: number;
  readonly speed: number;
  readonly weaponType: number;
  readonly weight: number;
}

function assembleWeapon(w: OnchainWeaponView): Weapon {
  const known = findWeapon(w.name);
  if (known) return known;
  const type = WEAPON_TYPE_MAP[w.weaponType] ?? 'blade';
  return {
    name: w.name,
    damageMin: w.damageMin,
    damageMax: w.damageMax,
    speed: w.speed,
    type,
    rarity: 'common',
    weight: w.weight,
  };
}

function assembleBrawler(
  tokenId: number,
  b: OnchainBrawlerView,
  weapon: Weapon,
  createdAt: number,
): Brawler {
  return {
    tokenId,
    name: b.name,
    stats: {
      strength: b.strength,
      dexterity: b.dexterity,
      constitution: b.constitution,
      intelligence: b.intelligence,
      wisdom: b.wisdom,
      charisma: b.charisma,
    },
    weapon,
    level: b.level,
    xp: b.xp,
    elo: b.elo,
    wins: b.wins,
    losses: b.losses,
    ties: b.ties,
    status: b.isDead ? 'dead' : 'alive',
    createdAt,
  };
}

interface DuelResultStruct {
  readonly tokenA: bigint;
  readonly tokenB: bigint;
  readonly winnerId: number;
  readonly rounds: number;
  readonly seed: bigint;
  readonly newEloA: number;
  readonly newEloB: number;
  readonly nonce: bigint;
  readonly expiry: bigint;
}

function serializeResult(r: DuelResultStruct) {
  return {
    tokenA: r.tokenA.toString(),
    tokenB: r.tokenB.toString(),
    winnerId: r.winnerId,
    rounds: r.rounds,
    seed: r.seed.toString(),
    newEloA: r.newEloA,
    newEloB: r.newEloB,
    nonce: r.nonce.toString(),
    expiry: r.expiry.toString(),
  };
}

export interface RunDuelResponse {
  result: ReturnType<typeof serializeResult>;
  signature: `0x${string}`;
  events: readonly CombatEvent[];
  winnerId: number | null;
  rounds: number;
  newEloA: number;
  newEloB: number;
  deltaA: number;
  deltaB: number;
  /** When the DuelRouter is configured, the API also returns a signed
   *  FightQuote so the frontend can call router.fight(quote, qsig, result,
   *  rsig). Missing means the frontend should fall back to direct Duel
   *  submission (legacy / pre-router environments). */
  quote?: SerializedFightQuote;
  quoteSignature?: `0x${string}`;
}

// ─── FightQuote types + helpers ────────────────────────────────────

const MODE_BRAWL = 0;
const MODE_ETH = 1;
const SWAP_NONE = 0;
const SWAP_ETH_TO_BRAWL = 1;
const SWAP_BRAWL_TO_ETH = 2;

// Extra slippage tolerance applied on top of Aerodrome's 0.3% pool fee.
// 2% gives the tx ~5-10 min of headroom before legitimate price drift would
// cause a revert, while still rejecting any meaningful sandwich attempt.
const SWAP_SLIPPAGE_BPS = 200n;

interface FightQuoteStruct {
  nonce: bigint;
  expiry: bigint;
  tokenA: bigint;
  tokenB: bigint;
  ownerA: Address;
  ownerB: Address;
  modeA: number;
  modeB: number;
  ethCostA: bigint;
  ethCostB: bigint;
  brawlCostA: bigint;
  brawlCostB: bigint;
  swapDir: number;
  swapAmountIn: bigint;
  swapMinOut: bigint;
  payoutAAddr: Address;
  payoutACurrency: number;
  payoutAAmount: bigint;
  payoutBAddr: Address;
  payoutBCurrency: number;
  payoutBAmount: bigint;
  devEthAmount: bigint;
  devBrawlAmount: bigint;
}

interface SerializedFightQuote {
  nonce: string;
  expiry: string;
  tokenA: string;
  tokenB: string;
  ownerA: Address;
  ownerB: Address;
  modeA: number;
  modeB: number;
  ethCostA: string;
  ethCostB: string;
  brawlCostA: string;
  brawlCostB: string;
  swapDir: number;
  swapAmountIn: string;
  swapMinOut: string;
  payoutAAddr: Address;
  payoutACurrency: number;
  payoutAAmount: string;
  payoutBAddr: Address;
  payoutBCurrency: number;
  payoutBAmount: string;
  devEthAmount: string;
  devBrawlAmount: string;
}

function serializeQuote(q: FightQuoteStruct): SerializedFightQuote {
  return {
    nonce: q.nonce.toString(),
    expiry: q.expiry.toString(),
    tokenA: q.tokenA.toString(),
    tokenB: q.tokenB.toString(),
    ownerA: q.ownerA,
    ownerB: q.ownerB,
    modeA: q.modeA,
    modeB: q.modeB,
    ethCostA: q.ethCostA.toString(),
    ethCostB: q.ethCostB.toString(),
    brawlCostA: q.brawlCostA.toString(),
    brawlCostB: q.brawlCostB.toString(),
    swapDir: q.swapDir,
    swapAmountIn: q.swapAmountIn.toString(),
    swapMinOut: q.swapMinOut.toString(),
    payoutAAddr: q.payoutAAddr,
    payoutACurrency: q.payoutACurrency,
    payoutAAmount: q.payoutAAmount.toString(),
    payoutBAddr: q.payoutBAddr,
    payoutBCurrency: q.payoutBCurrency,
    payoutBAmount: q.payoutBAmount.toString(),
    devEthAmount: q.devEthAmount.toString(),
    devBrawlAmount: q.devBrawlAmount.toString(),
  };
}

/// Apply Aerodrome V2 volatile-pool swap math, returning expected output.
/// Includes the 0.3% pool fee. This is the constant-product formula:
///   amountOut = amountIn * reserveOut * (1 - fee) / (reserveIn + amountIn * (1 - fee))
/// Then we additionally apply SWAP_SLIPPAGE_BPS for safety so the on-chain
/// reality has some wiggle room before the router rejects on slippage.
function aerodromeAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  // 30 bps fee on Aerodrome volatile pools.
  const FEE_BPS = 30n;
  const amountInAfterFee = amountIn * (10_000n - FEE_BPS);
  const numerator = amountInAfterFee * reserveOut;
  const denominator = reserveIn * 10_000n + amountInAfterFee;
  return numerator / denominator;
}

export async function POST(request: Request) {
  let body: { tokenA?: unknown; tokenB?: unknown; modeA?: unknown; modeB?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const tokenA = Number(body.tokenA);
  const tokenB = Number(body.tokenB);
  if (!Number.isInteger(tokenA) || tokenA < 1) {
    return NextResponse.json({ error: 'tokenA must be a positive integer' }, { status: 400 });
  }
  if (!Number.isInteger(tokenB) || tokenB < 1) {
    return NextResponse.json({ error: 'tokenB must be a positive integer' }, { status: 400 });
  }
  if (tokenA === tokenB) {
    return NextResponse.json({ error: 'tokenA and tokenB must differ' }, { status: 400 });
  }

  // Optional currency-mode picks. Default both to BRAWL (legacy path) so old
  // clients keep working. Router-aware clients send 'ETH' or 'BRAWL' per side.
  const modeAStr = String(body.modeA ?? 'BRAWL').toUpperCase();
  const modeBStr = String(body.modeB ?? 'BRAWL').toUpperCase();
  if (modeAStr !== 'BRAWL' && modeAStr !== 'ETH') {
    return NextResponse.json({ error: 'modeA must be "BRAWL" or "ETH"' }, { status: 400 });
  }
  if (modeBStr !== 'BRAWL' && modeBStr !== 'ETH') {
    return NextResponse.json({ error: 'modeB must be "BRAWL" or "ETH"' }, { status: 400 });
  }
  const modeA = modeAStr === 'ETH' ? MODE_ETH : MODE_BRAWL;
  const modeB = modeBStr === 'ETH' ? MODE_ETH : MODE_BRAWL;

  const signerKeyRaw = process.env.BRAWLERS_SIGNER_KEY;
  if (!signerKeyRaw) {
    return NextResponse.json(
      { error: 'Server env missing: BRAWLERS_SIGNER_KEY' },
      { status: 500 },
    );
  }
  const v = validateEnv();
  if (!v.ok) {
    return NextResponse.json(
      { error: `Server env: ${v.errors.join('; ')}` },
      { status: 500 },
    );
  }
  const { rpcUrl, chainId } = v.env;
  const brawlersAddr = v.env.brawlersAddress;
  const duelAddr = v.env.duelAddress;

  const chain = buildChain(chainId, rpcUrl);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const signerKeyPrefixed = (
    signerKeyRaw.startsWith('0x') ? signerKeyRaw : `0x${signerKeyRaw}`
  ) as `0x${string}`;
  let signerAccount;
  try {
    signerAccount = privateKeyToAccount(signerKeyPrefixed);
  } catch (e) {
    return NextResponse.json(
      { error: `BRAWLERS_SIGNER_KEY is invalid: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  try {
    const [rawA, rawWa, rawB, rawWb] = await Promise.all([
      client.readContract({
        abi: BRAWLERS_ABI,
        address: brawlersAddr as `0x${string}`,
        functionName: 'getBrawler',
        args: [BigInt(tokenA)],
      }),
      client.readContract({
        abi: BRAWLERS_ABI,
        address: brawlersAddr as `0x${string}`,
        functionName: 'getBrawlerWeapon',
        args: [BigInt(tokenA)],
      }),
      client.readContract({
        abi: BRAWLERS_ABI,
        address: brawlersAddr as `0x${string}`,
        functionName: 'getBrawler',
        args: [BigInt(tokenB)],
      }),
      client.readContract({
        abi: BRAWLERS_ABI,
        address: brawlersAddr as `0x${string}`,
        functionName: 'getBrawlerWeapon',
        args: [BigInt(tokenB)],
      }),
    ]);

    const onchainA = rawA as unknown as OnchainBrawlerView;
    const onchainB = rawB as unknown as OnchainBrawlerView;
    const onchainWA = rawWa as unknown as OnchainWeaponView;
    const onchainWB = rawWb as unknown as OnchainWeaponView;

    if (onchainA.isDead) {
      return NextResponse.json(
        { error: `Brawler #${tokenA} is in the graveyard` },
        { status: 400 },
      );
    }
    if (onchainB.isDead) {
      return NextResponse.json(
        { error: `Brawler #${tokenB} is in the graveyard` },
        { status: 400 },
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const weaponA = assembleWeapon(onchainWA);
    const weaponB = assembleWeapon(onchainWB);
    const brawlerA = assembleBrawler(tokenA, onchainA, weaponA, now);
    const brawlerB = assembleBrawler(tokenB, onchainB, weaponB, now);

    const seed = randomBig256();
    const fight = simulateFight(brawlerA, brawlerB, seed);

    const outcomeForA: Outcome =
      fight.winnerId === null ? 'tie' : fight.winnerId === tokenA ? 'win' : 'loss';
    const gamesA = brawlerA.wins + brawlerA.losses + brawlerA.ties;
    const gamesB = brawlerB.wins + brawlerB.losses + brawlerB.ties;
    const elo = applyDuelResult(brawlerA.elo, brawlerB.elo, gamesA, gamesB, outcomeForA);

    const result: DuelResultStruct = {
      tokenA: BigInt(tokenA),
      tokenB: BigInt(tokenB),
      winnerId: fight.winnerId ?? 0,
      rounds: fight.rounds,
      seed: fight.seed,
      newEloA: elo.newA,
      newEloB: elo.newB,
      nonce: randomBig256(),
      expiry: BigInt(now + DUEL_EXPIRY_SECONDS),
    };

    // EIP-712 typed-data signing. The domain ties this signature to:
    //   - the specific Duel contract (verifyingContract)
    //   - the specific chain (chainId)
    //   - the contract's name + version
    // so a Sepolia signature cannot be replayed on mainnet (or any other chain)
    // even if the same trustedSigner key is used in both environments.
    //
    // Domain MUST match Duel.sol's EIP712 constructor:
    //   EIP712(EIP712_NAME = "BASEicBrawlersDuel", EIP712_VERSION = "1")
    // and the verifyingContract MUST be the address of the Duel contract this
    // signature will be submitted to.
    const signature = await signerAccount.signTypedData({
      domain: {
        name: 'BASEicBrawlersDuel',
        version: '1',
        chainId,
        verifyingContract: duelAddr as `0x${string}`,
      },
      types: {
        DuelResult: [
          { name: 'tokenA', type: 'uint256' },
          { name: 'tokenB', type: 'uint256' },
          { name: 'winnerId', type: 'uint32' },
          { name: 'rounds', type: 'uint16' },
          { name: 'seed', type: 'uint256' },
          { name: 'newEloA', type: 'uint32' },
          { name: 'newEloB', type: 'uint32' },
          { name: 'nonce', type: 'uint256' },
          { name: 'expiry', type: 'uint256' },
        ],
      },
      primaryType: 'DuelResult',
      message: result,
    });

    const response: RunDuelResponse = {
      result: serializeResult(result),
      signature,
      events: fight.events,
      winnerId: fight.winnerId,
      rounds: fight.rounds,
      newEloA: elo.newA,
      newEloB: elo.newB,
      deltaA: elo.deltaA,
      deltaB: elo.deltaB,
    };

    // ── FightQuote: build + sign when DuelRouter is configured ──
    if (v.env.duelRouterAddress) {
      try {
        const quote = await buildFightQuote({
          client,
          chainId,
          tokenA: BigInt(tokenA),
          tokenB: BigInt(tokenB),
          modeA,
          modeB,
          winnerId: fight.winnerId,
          routerAddr: v.env.duelRouterAddress,
          brawlersAddr,
          brawlPair: v.env.brawlPairAddress,
          duelExpiry: result.expiry,
        });
        const quoteSig = await signerAccount.signTypedData({
          domain: {
            name: 'BASEicBrawlersDuelRouter',
            version: '1',
            chainId,
            verifyingContract: v.env.duelRouterAddress,
          },
          types: {
            FightQuote: [
              { name: 'nonce', type: 'uint256' },
              { name: 'expiry', type: 'uint256' },
              { name: 'tokenA', type: 'uint256' },
              { name: 'tokenB', type: 'uint256' },
              { name: 'ownerA', type: 'address' },
              { name: 'ownerB', type: 'address' },
              { name: 'modeA', type: 'uint8' },
              { name: 'modeB', type: 'uint8' },
              { name: 'ethCostA', type: 'uint256' },
              { name: 'ethCostB', type: 'uint256' },
              { name: 'brawlCostA', type: 'uint256' },
              { name: 'brawlCostB', type: 'uint256' },
              { name: 'swapDir', type: 'uint8' },
              { name: 'swapAmountIn', type: 'uint256' },
              { name: 'swapMinOut', type: 'uint256' },
              { name: 'payoutAAddr', type: 'address' },
              { name: 'payoutACurrency', type: 'uint8' },
              { name: 'payoutAAmount', type: 'uint256' },
              { name: 'payoutBAddr', type: 'address' },
              { name: 'payoutBCurrency', type: 'uint8' },
              { name: 'payoutBAmount', type: 'uint256' },
              { name: 'devEthAmount', type: 'uint256' },
              { name: 'devBrawlAmount', type: 'uint256' },
            ],
          },
          primaryType: 'FightQuote',
          message: quote,
        });
        response.quote = serializeQuote(quote);
        response.quoteSignature = quoteSig;
      } catch (e) {
        // Quote-build failure shouldn't kill the duel sim — frontend can fall
        // back to BRAWL/BRAWL via direct Duel.submitDuel if it really wants.
        // Log + continue so callers without router env still get a response.
        console.error('FightQuote build failed:', e);
      }
    }

    return NextResponse.json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `run-duel failed: ${message}` }, { status: 500 });
  }
}

// ─── FightQuote builder ─────────────────────────────────────────────

interface BuildQuoteArgs {
  client: ReturnType<typeof createPublicClient>;
  chainId: number;
  tokenA: bigint;
  tokenB: bigint;
  modeA: number;
  modeB: number;
  winnerId: number | null;
  routerAddr: Address;
  brawlersAddr: Address;
  brawlPair: Address | null;
  duelExpiry: bigint;
}

async function buildFightQuote(args: BuildQuoteArgs): Promise<FightQuoteStruct> {
  const { client, tokenA, tokenB, modeA, modeB, winnerId, routerAddr, brawlersAddr, brawlPair, duelExpiry } = args;

  // 1. Read router state + brawler ownership in parallel.
  const [
    ownerA, ownerB,
    fighterBrawlA, fighterBrawlB,
    fighterEthA, fighterEthB,
    devShareBps,
  ] = await Promise.all([
    client.readContract({ abi: BRAWLERS_ABI, address: brawlersAddr, functionName: 'ownerOf', args: [tokenA] }) as Promise<Address>,
    client.readContract({ abi: BRAWLERS_ABI, address: brawlersAddr, functionName: 'ownerOf', args: [tokenB] }) as Promise<Address>,
    client.readContract({ abi: DUEL_ROUTER_ABI, address: routerAddr, functionName: 'fighterCostBrawl', args: [tokenA] }) as Promise<bigint>,
    client.readContract({ abi: DUEL_ROUTER_ABI, address: routerAddr, functionName: 'fighterCostBrawl', args: [tokenB] }) as Promise<bigint>,
    client.readContract({ abi: DUEL_ROUTER_ABI, address: routerAddr, functionName: 'fighterCostEth', args: [tokenA] }) as Promise<bigint>,
    client.readContract({ abi: DUEL_ROUTER_ABI, address: routerAddr, functionName: 'fighterCostEth', args: [tokenB] }) as Promise<bigint>,
    client.readContract({ abi: DUEL_ROUTER_ABI, address: routerAddr, functionName: 'devShareBps' }) as Promise<number>,
  ]);

  const ethCostA = modeA === MODE_ETH ? fighterEthA : 0n;
  const ethCostB = modeB === MODE_ETH ? fighterEthB : 0n;
  const brawlCostA = modeA === MODE_BRAWL ? fighterBrawlA : 0n;
  const brawlCostB = modeB === MODE_BRAWL ? fighterBrawlB : 0n;
  const ethTotal = ethCostA + ethCostB;
  const brawlTotal = brawlCostA + brawlCostB;
  const isMixed = modeA !== modeB;
  const anyEth = modeA === MODE_ETH || modeB === MODE_ETH;
  const isTie = winnerId === null || winnerId === 0;

  // 2. Tie path: refund each player's own currency, no dev cut, no swap.
  if (isTie) {
    return {
      nonce: randomBig256(),
      expiry: duelExpiry,
      tokenA, tokenB,
      ownerA: getAddress(ownerA), ownerB: getAddress(ownerB),
      modeA, modeB,
      ethCostA, ethCostB,
      brawlCostA, brawlCostB,
      swapDir: SWAP_NONE,
      swapAmountIn: 0n,
      swapMinOut: 0n,
      payoutAAddr: getAddress(ownerA),
      payoutACurrency: modeA,
      payoutAAmount: modeA === MODE_ETH ? ethCostA : brawlCostA,
      payoutBAddr: getAddress(ownerB),
      payoutBCurrency: modeB,
      payoutBAmount: modeB === MODE_ETH ? ethCostB : brawlCostB,
      devEthAmount: 0n,
      devBrawlAmount: 0n,
    };
  }

  // 3. Non-tie. Determine winner and currency rules.
  const winnerIsA = winnerId === Number(tokenA);
  const winnerOwner = winnerIsA ? getAddress(ownerA) : getAddress(ownerB);
  const winnerMode = winnerIsA ? modeA : modeB;

  // 4. Same-currency cases. No swap.
  if (!isMixed) {
    if (modeA === MODE_BRAWL) {
      const devCut = (brawlTotal * BigInt(devShareBps)) / 10_000n;
      const winnerShare = brawlTotal - devCut;
      return {
        nonce: randomBig256(),
        expiry: duelExpiry,
        tokenA, tokenB,
        ownerA: getAddress(ownerA), ownerB: getAddress(ownerB),
        modeA, modeB,
        ethCostA, ethCostB,
        brawlCostA, brawlCostB,
        swapDir: SWAP_NONE,
        swapAmountIn: 0n,
        swapMinOut: 0n,
        payoutAAddr: winnerIsA ? winnerOwner : '0x0000000000000000000000000000000000000000',
        payoutACurrency: MODE_BRAWL,
        payoutAAmount: winnerIsA ? winnerShare : 0n,
        payoutBAddr: winnerIsA ? '0x0000000000000000000000000000000000000000' : winnerOwner,
        payoutBCurrency: MODE_BRAWL,
        payoutBAmount: winnerIsA ? 0n : winnerShare,
        devEthAmount: 0n,
        devBrawlAmount: devCut,
      };
    } else {
      // ETH / ETH — dev gets ETH because any ETH input → ETH for dev.
      const devCut = (ethTotal * BigInt(devShareBps)) / 10_000n;
      const winnerShare = ethTotal - devCut;
      return {
        nonce: randomBig256(),
        expiry: duelExpiry,
        tokenA, tokenB,
        ownerA: getAddress(ownerA), ownerB: getAddress(ownerB),
        modeA, modeB,
        ethCostA, ethCostB,
        brawlCostA, brawlCostB,
        swapDir: SWAP_NONE,
        swapAmountIn: 0n,
        swapMinOut: 0n,
        payoutAAddr: winnerIsA ? winnerOwner : '0x0000000000000000000000000000000000000000',
        payoutACurrency: MODE_ETH,
        payoutAAmount: winnerIsA ? winnerShare : 0n,
        payoutBAddr: winnerIsA ? '0x0000000000000000000000000000000000000000' : winnerOwner,
        payoutBCurrency: MODE_ETH,
        payoutBAmount: winnerIsA ? 0n : winnerShare,
        devEthAmount: devCut,
        devBrawlAmount: 0n,
      };
    }
  }

  // 5. Mixed pot. Need pair reserves to compute the swap.
  if (!brawlPair) {
    throw new Error('Mixed-currency fights require NEXT_PUBLIC_BRAWL_PAIR_ADDRESS to be set');
  }
  const [reserves, t0, brawlAddr] = await Promise.all([
    client.readContract({ abi: AERODROME_PAIR_ABI, address: brawlPair, functionName: 'getReserves' }) as Promise<readonly [bigint, bigint, number]>,
    client.readContract({ abi: AERODROME_PAIR_ABI, address: brawlPair, functionName: 'token0' }) as Promise<Address>,
    // BRAWL is the brawlToken — we can read it from the router for canonical address
    client.readContract({ abi: DUEL_ROUTER_ABI, address: routerAddr, functionName: 'devTreasury' }).then(() => brawlPair).catch(() => brawlPair) as Promise<Address>,
  ]);
  // Determine which reserve is BRAWL vs ETH (WETH).
  void brawlAddr; // silence unused; we use t0 + a separate read below.
  const brawlAddrCanon = (await client.readContract({
    abi: parseFnAbi('function brawlToken() view returns (address)'),
    address: routerAddr,
    functionName: 'brawlToken',
  })) as Address;
  const [r0, r1] = reserves;
  let brawlReserve: bigint, ethReserve: bigint;
  if (getAddress(t0) === getAddress(brawlAddrCanon)) {
    brawlReserve = r0;
    ethReserve = r1;
  } else {
    brawlReserve = r1;
    ethReserve = r0;
  }

  // Determine swap direction + amount based on winner currency vs loser stake.
  // Dev currency rule: any ETH input → dev gets ETH.
  if (winnerMode === MODE_ETH) {
    // Winner wants ETH. Loser paid BRAWL (since mixed). We need to swap loser's
    // BRAWL → ETH. Dev gets ETH from the pool.
    const loserBrawl = winnerIsA ? brawlCostB : brawlCostA;
    const ethFromSwap = aerodromeAmountOut(loserBrawl, brawlReserve, ethReserve);
    const ethTotalAfterSwap = ethTotal + ethFromSwap;
    const devCut = (ethTotalAfterSwap * BigInt(devShareBps)) / 10_000n;
    const winnerShare = ethTotalAfterSwap - devCut;
    const swapMinOut = (ethFromSwap * (10_000n - SWAP_SLIPPAGE_BPS)) / 10_000n;
    return {
      nonce: randomBig256(),
      expiry: duelExpiry,
      tokenA, tokenB,
      ownerA: getAddress(ownerA), ownerB: getAddress(ownerB),
      modeA, modeB,
      ethCostA, ethCostB,
      brawlCostA, brawlCostB,
      swapDir: SWAP_BRAWL_TO_ETH,
      swapAmountIn: loserBrawl,
      swapMinOut,
      payoutAAddr: winnerIsA ? winnerOwner : '0x0000000000000000000000000000000000000000',
      payoutACurrency: MODE_ETH,
      payoutAAmount: winnerIsA ? winnerShare : 0n,
      payoutBAddr: winnerIsA ? '0x0000000000000000000000000000000000000000' : winnerOwner,
      payoutBCurrency: MODE_ETH,
      payoutBAmount: winnerIsA ? 0n : winnerShare,
      devEthAmount: devCut,
      devBrawlAmount: 0n,
    };
  } else {
    // Winner wants BRAWL. Loser paid ETH. Need partial swap of loser's ETH →
    // BRAWL for the winner; the rest of loser's ETH covers dev's fee.
    // Sequence: total pot value in ETH = ethTotal + (brawlTotal converted).
    // devCut = devShareBps/10000 of pot value (in ETH terms).
    // ethRemainingAfterDev = ethTotal - devCut (must be > 0)
    // Swap that ETH portion to BRAWL; winner gets brawlStake + swapOut.
    const brawlValueAsEth = aerodromeAmountOut(brawlTotal, brawlReserve, ethReserve);
    const ethEquivPot = ethTotal + brawlValueAsEth;
    const devCut = (ethEquivPot * BigInt(devShareBps)) / 10_000n;
    if (devCut > ethTotal) {
      throw new Error('Mixed-pot math: ETH side too small to cover dev cut');
    }
    const ethToSwap = ethTotal - devCut;
    const brawlFromSwap = aerodromeAmountOut(ethToSwap, ethReserve, brawlReserve);
    const winnerBrawl = brawlTotal + brawlFromSwap;
    const swapMinOut = (brawlFromSwap * (10_000n - SWAP_SLIPPAGE_BPS)) / 10_000n;
    return {
      nonce: randomBig256(),
      expiry: duelExpiry,
      tokenA, tokenB,
      ownerA: getAddress(ownerA), ownerB: getAddress(ownerB),
      modeA, modeB,
      ethCostA, ethCostB,
      brawlCostA, brawlCostB,
      swapDir: SWAP_ETH_TO_BRAWL,
      swapAmountIn: ethToSwap,
      swapMinOut,
      payoutAAddr: winnerIsA ? winnerOwner : '0x0000000000000000000000000000000000000000',
      payoutACurrency: MODE_BRAWL,
      payoutAAmount: winnerIsA ? winnerBrawl : 0n,
      payoutBAddr: winnerIsA ? '0x0000000000000000000000000000000000000000' : winnerOwner,
      payoutBCurrency: MODE_BRAWL,
      payoutBAmount: winnerIsA ? 0n : winnerBrawl,
      devEthAmount: devCut,
      devBrawlAmount: 0n,
    };
  }
}

/// Helper: parse a single-function ABI tuple inline.
function parseFnAbi(sig: string) {
  // We only need to read brawlToken() returning address. Build the ABI fragment manually.
  void sig;
  return [{
    type: 'function' as const,
    name: 'brawlToken',
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ type: 'address' as const }],
  }];
}
