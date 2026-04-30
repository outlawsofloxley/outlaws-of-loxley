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
import { createPublicClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import { BRAWLERS_ABI } from '@/lib/abi';
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
}

export async function POST(request: Request) {
  let body: { tokenA?: unknown; tokenB?: unknown };
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
    return NextResponse.json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `run-duel failed: ${message}` }, { status: 500 });
  }
}
