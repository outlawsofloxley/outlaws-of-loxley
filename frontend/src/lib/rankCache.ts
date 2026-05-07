/**
 * Server-side cached rank table for the BASEic Brawlers collection.
 * Fetched on demand by /api/rank/route.ts and folded into /api/token/[id]
 * responses so OpenSea / DexScreener / our own UI can show "Rank N / M".
 *
 * Cache TTL: 5 minutes. Single-flight: if multiple callers hit it during
 * a cold cache, they share one chain-walk.
 */
import { createPublicClient, defineChain, http } from 'viem';
import { BRAWLERS_ABI } from '@/lib/abi';
import { validateEnv } from '@/lib/env';
import { computeRanks, type BrawlerForRank, type RankedBrawler } from '@/lib/rankCalc';

const KING_TOKEN_ID = 2001;
const CACHE_TTL_MS = 5 * 60 * 1000;

const RARITY_FOR_WEIGHT: Record<number, string> = {
  18: 'Common', 17: 'Common', 15: 'Common',
  12: 'Uncommon', 11: 'Uncommon',
  9: 'Rare', 7: 'Rare',
  5: 'Legendary', 3: 'Legendary',
  2: 'Epic', 1: 'Epic',
  0: 'King',
};
function rarityFor(weight: number): string {
  return RARITY_FOR_WEIGHT[weight] ?? 'Common';
}

interface OnchainBrawler {
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
interface OnchainWeapon {
  readonly name: string;
  readonly damageMin: number;
  readonly damageMax: number;
  readonly speed: number;
  readonly weaponType: number;
  readonly weight: number;
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

let CACHE: { at: number; ranks: RankedBrawler[] } | null = null;
let INFLIGHT: Promise<RankedBrawler[]> | null = null;

// Sepolia rate-limits sepolia.base.org hard. Use publicnode first for big
// reads. Mainnet path falls back to whatever validateEnv returns.
const SEPOLIA_RPC_POOL = [
  'https://base-sepolia-rpc.publicnode.com',
  'https://sepolia.base.org',
];

async function fetchAllBrawlers(): Promise<BrawlerForRank[]> {
  const v = validateEnv();
  if (!v.ok) throw new Error('env: ' + v.errors.join('; '));
  const { rpcUrl, chainId } = v.env;
  const brawlersAddr = v.env.brawlersAddress;
  const rpcPool = chainId === 84532
    ? [...SEPOLIA_RPC_POOL, rpcUrl].filter((u, i, arr) => arr.indexOf(u) === i)
    : [rpcUrl];
  const clients = rpcPool.map((u) =>
    createPublicClient({ chain: buildChain(chainId, u), transport: http(u, { timeout: 5000 }) }),
  );

  // Read nextTokenId from any working client.
  let nextTokenId: number = 0;
  for (const c of clients) {
    try {
      nextTokenId = Number(
        (await c.readContract({
          abi: BRAWLERS_ABI,
          address: brawlersAddr as `0x${string}`,
          functionName: 'nextTokenId',
        })) as number,
      );
      break;
    } catch { /* try next */ }
  }
  if (nextTokenId === 0) throw new Error('all RPCs failed on nextTokenId');

  const ids: number[] = [];
  for (let i = 1; i < nextTokenId; i++) ids.push(i);
  ids.push(KING_TOKEN_ID);

  // Read with retry across RPC pool. Each id tries each RPC up to once, then
  // is dropped. Batched to keep concurrency reasonable.
  const BATCH = 20;
  const out: BrawlerForRank[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const reads = await Promise.all(
      batch.map(async (id) => {
        for (const c of clients) {
          try {
            const [b, w] = await Promise.all([
              c.readContract({
                abi: BRAWLERS_ABI,
                address: brawlersAddr as `0x${string}`,
                functionName: 'getBrawler',
                args: [BigInt(id)],
              }),
              c.readContract({
                abi: BRAWLERS_ABI,
                address: brawlersAddr as `0x${string}`,
                functionName: 'getBrawlerWeapon',
                args: [BigInt(id)],
              }),
            ]);
            return { id, b: b as unknown as OnchainBrawler, w: w as unknown as OnchainWeapon };
          } catch { /* try next RPC */ }
        }
        return null;
      }),
    );
    for (const r of reads) {
      if (!r) continue;
      out.push({
        tokenId: r.id,
        rarity: rarityFor(r.w.weight),
        weapon: r.w.name,
        stats: {
          strength: r.b.strength,
          dexterity: r.b.dexterity,
          constitution: r.b.constitution,
          intelligence: r.b.intelligence,
          wisdom: r.b.wisdom,
          charisma: r.b.charisma,
        },
      });
    }
  }
  return out;
}

export async function getCachedRanks(): Promise<{ ranks: RankedBrawler[]; cachedAt: number }> {
  const now = Date.now();
  if (CACHE && now - CACHE.at < CACHE_TTL_MS) {
    return { ranks: CACHE.ranks, cachedAt: CACHE.at };
  }
  if (INFLIGHT) {
    const ranks = await INFLIGHT;
    return { ranks, cachedAt: CACHE?.at ?? Date.now() };
  }
  INFLIGHT = (async () => {
    const brawlers = await fetchAllBrawlers();
    const ranks = computeRanks(brawlers);
    CACHE = { at: Date.now(), ranks };
    return ranks;
  })();
  try {
    const ranks = await INFLIGHT;
    return { ranks, cachedAt: CACHE?.at ?? Date.now() };
  } finally {
    INFLIGHT = null;
  }
}

export async function rankForToken(tokenId: number): Promise<RankedBrawler | null> {
  const { ranks } = await getCachedRanks();
  return ranks.find((r) => r.tokenId === tokenId) ?? null;
}
