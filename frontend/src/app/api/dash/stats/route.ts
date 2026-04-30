/**
 * GET /api/dash/stats
 *
 * Aggregates every revenue/volume/health number the dashboard needs into a
 * single JSON blob. Read-only, never mutates state.
 *
 * Gated by the dash session cookie (enforced via middleware).
 */
import { createPublicClient, defineChain, http, type Address } from 'viem';
import { BRAWL_ABI, BRAWLERS_ABI, DUEL_ABI, GRAVEYARD_ABI, MARKETPLACE_ABI, MINTDROP_ABI } from '@/lib/abi';
import {
  countDuelEvents,
  getSyncState,
  isDbConfigured,
} from '@/lib/duelDb';
import {
  ensureDashSchema,
  sumMintRevenueByType,
  sumResurrectRevenue,
  sumMarketFees,
  dailyMintCounts,
  dailyDuelCounts,
  dailyMarketSales,
  recentAudit,
} from '@/lib/dashDb';
import { getMarketSyncState } from '@/lib/marketDb';
import { validateEnv } from '@/lib/env';
import { sql } from '@vercel/postgres';

export const runtime = 'nodejs';
export const maxDuration = 30;

function chain(chainId: number, rpc: string) {
  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    testnet: chainId !== 1 && chainId !== 56 && chainId !== 8453,
  });
}

async function timeMs<T>(fn: () => Promise<T>): Promise<{ result: T | null; ms: number; error: string | null }> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { result, ms: Date.now() - t0, error: null };
  } catch (e) {
    return {
      result: null,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function GET() {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: 'POSTGRES_URL not configured' }, { status: 503 });
  }

  const v = validateEnv();
  if (!v.ok) {
    return Response.json({ ok: false, error: 'env: ' + v.errors.join('; ') }, { status: 500 });
  }
  const { rpcUrl, chainId } = v.env;
  const brawlersAddr = v.env.brawlersAddress;
  const duelAddr = v.env.duelAddress;
  const graveyardAddr = v.env.graveyardAddress;
  const mintDropAddr = v.env.mintDropAddress;
  const brawlAddr = v.env.brawlAddress;
  const marketAddr = v.env.marketplaceAddress;
  const keeperAddr: Address | undefined = v.env.houseKeeperAddress ?? undefined;

  await ensureDashSchema();

  const client = createPublicClient({
    chain: chain(chainId, rpcUrl),
    transport: http(rpcUrl, { timeout: 4000 }),
  });

  // RPC latency check, time a simple eth_blockNumber call.
  const rpcPing = await timeMs(() => client.getBlockNumber());

  // Postgres latency check, time a no-op roundtrip.
  const dbPing = await timeMs(async () => {
    const { rows } = await sql<{ n: number }>`SELECT 1::int AS n`;
    return rows[0]?.n ?? 1;
  });

  // Revenue aggregations (from DB).
  const mintRev = await sumMintRevenueByType();
  const resurrectRev = await sumResurrectRevenue();
  const marketRev = await sumMarketFees();
  const duelCount = await countDuelEvents();

  // Current on-chain values needed to compute duel dev revenue.
  // Assumes fightCost/devShareBps have been constant; if they change, the
  // computed figure becomes an approximation. We surface the raw counts too
  // so the dashboard can show both.
  const [fightCost, devShareBps, brawlTotalSupply, brawlBalanceInMintDrop, brawlersNextId, kingMinted] = await Promise.all([
    client.readContract({ abi: DUEL_ABI, address: duelAddr, functionName: 'fightCost' }).catch(() => 0n) as Promise<bigint>,
    client.readContract({ abi: DUEL_ABI, address: duelAddr, functionName: 'devShareBps' }).catch(() => 0) as Promise<number>,
    client.readContract({ abi: BRAWL_ABI, address: brawlAddr, functionName: 'totalSupply' }).catch(() => 0n) as Promise<bigint>,
    client.readContract({ abi: BRAWL_ABI, address: brawlAddr, functionName: 'balanceOf', args: [mintDropAddr] }).catch(() => 0n) as Promise<bigint>,
    client.readContract({ abi: BRAWLERS_ABI, address: brawlersAddr, functionName: 'nextTokenId' }).catch(() => 0) as Promise<number>,
    client.readContract({ abi: BRAWLERS_ABI, address: brawlersAddr, functionName: 'kingMinted' }).catch(() => false) as Promise<boolean>,
  ]);

  // Duel dev revenue estimate: each duel consumes fightCost from BOTH owners,
  // then pays devShareBps / 10000 of the 2× pot to the dev treasury.
  const duelDevRevenueWei =
    fightCost && devShareBps
      ? (BigInt(fightCost) * 2n * BigInt(devShareBps)) / 10000n * BigInt(duelCount)
      : 0n;

  // Current tunable settings on-chain, used by Settings read panel.
  const [mintEthPrice, mintUsdtPrice, mintAirdrop, mintTreasury, totalSold, graveyardCost, marketFeeBps, marketTreasury, duelTreasury] = await Promise.all([
    client.readContract({ abi: MINTDROP_ABI, address: mintDropAddr, functionName: 'ethPrice' }).catch(() => null) as Promise<bigint | null>,
    client.readContract({ abi: MINTDROP_ABI, address: mintDropAddr, functionName: 'usdtPrice' }).catch(() => null) as Promise<bigint | null>,
    client.readContract({ abi: MINTDROP_ABI, address: mintDropAddr, functionName: 'airdropPerMint' }).catch(() => null) as Promise<bigint | null>,
    client.readContract({ abi: MINTDROP_ABI, address: mintDropAddr, functionName: 'treasury' }).catch(() => null) as Promise<string | null>,
    client.readContract({ abi: MINTDROP_ABI, address: mintDropAddr, functionName: 'totalSold' }).catch(() => null) as Promise<bigint | null>,
    client.readContract({ abi: GRAVEYARD_ABI, address: graveyardAddr, functionName: 'resurrectionCost' }).catch(() => null) as Promise<bigint | null>,
    client.readContract({ abi: MARKETPLACE_ABI, address: marketAddr, functionName: 'feeBps' }).catch(() => null) as Promise<number | null>,
    client.readContract({ abi: MARKETPLACE_ABI, address: marketAddr, functionName: 'feeTreasury' }).catch(() => null) as Promise<string | null>,
    client.readContract({ abi: DUEL_ABI, address: duelAddr, functionName: 'devTreasury' }).catch(() => null) as Promise<string | null>,
  ]);

  // Marketplace pause state.
  const [marketPaused, duelPaused, graveyardPaused, mintPaused] = await Promise.all([
    client.readContract({ abi: MARKETPLACE_ABI, address: marketAddr, functionName: 'paused' }).catch(() => false) as Promise<boolean>,
    client.readContract({ abi: DUEL_ABI, address: duelAddr, functionName: 'paused' }).catch(() => false) as Promise<boolean>,
    client.readContract({ abi: GRAVEYARD_ABI, address: graveyardAddr, functionName: 'paused' }).catch(() => false) as Promise<boolean>,
    client.readContract({ abi: MINTDROP_ABI, address: mintDropAddr, functionName: 'paused' }).catch(() => false) as Promise<boolean>,
  ]);

  // Keeper wallet balances (only if configured).
  let keeperBnb: string | null = null;
  let keeperBrawl: string | null = null;
  if (keeperAddr && /^0x[0-9a-fA-F]{40}$/.test(keeperAddr)) {
    keeperBnb = (await client.getBalance({ address: keeperAddr }).catch(() => 0n)).toString();
    keeperBrawl = (await client.readContract({
      abi: BRAWL_ABI,
      address: brawlAddr,
      functionName: 'balanceOf',
      args: [keeperAddr],
    }).catch(() => 0n) as bigint).toString();
  }

  // Sync state + daily series.
  const duelSyncState = await getSyncState();
  const marketSyncState = await getMarketSyncState();
  const mintDaily = await dailyMintCounts(30);
  const duelDaily = await dailyDuelCounts(30);
  const marketDaily = await dailyMarketSales(30);
  const audit = await recentAudit(30);

  // Brawler population.
  const totalBrawlers = Math.max(0, Number(brawlersNextId) - 1) + (kingMinted ? 1 : 0);

  return Response.json({
    ok: true,
    health: {
      rpcPingMs: rpcPing.ms,
      rpcError: rpcPing.error,
      dbPingMs: dbPing.ms,
      dbError: dbPing.error,
      duelSyncLastBlock: duelSyncState.lastBlock?.toString() ?? null,
      duelSyncUpdatedAt: duelSyncState.updatedAt?.toISOString() ?? null,
      marketSyncLastBlock: marketSyncState.lastBlock?.toString() ?? null,
      marketSyncUpdatedAt: marketSyncState.updatedAt?.toISOString() ?? null,
    },
    revenue: {
      mint: {
        ethTotalWei: mintRev.ethTotalWei,
        usdtTotal: mintRev.usdtTotal, // 6-decimal USDT: raw units
        ethCount: mintRev.ethCount,
        usdtCount: mintRev.usdtCount,
      },
      duelDev: {
        duelCount,
        revenueWei: duelDevRevenueWei.toString(),
        fightCost: fightCost.toString(),
        devShareBps,
      },
      marketplace: {
        feeTotalWei: marketRev.feeTotalWei,
        priceTotalWei: marketRev.priceTotalWei,
        count: marketRev.count,
        feeBps: marketFeeBps,
      },
      graveyard: {
        totalWei: resurrectRev.totalWei,
        count: resurrectRev.count,
      },
    },
    settings: {
      fightCost: fightCost.toString(),
      devShareBps,
      devTreasury: duelTreasury,
      graveyardCost: graveyardCost !== null ? graveyardCost.toString() : null,
      mintEthPrice: mintEthPrice !== null ? mintEthPrice.toString() : null,
      mintUsdtPrice: mintUsdtPrice !== null ? mintUsdtPrice.toString() : null,
      mintAirdrop: mintAirdrop !== null ? mintAirdrop.toString() : null,
      mintTreasury,
      totalSold: totalSold !== null ? totalSold.toString() : null,
      marketFeeBps,
      marketTreasury,
      marketPaused,
      duelPaused,
      graveyardPaused,
      mintPaused,
    },
    brawl: {
      totalSupply: brawlTotalSupply.toString(),
      mintDropAirdropPool: brawlBalanceInMintDrop.toString(),
    },
    brawlers: {
      nextTokenId: Number(brawlersNextId),
      kingMinted,
      totalMinted: totalBrawlers,
    },
    keeper: {
      address: keeperAddr ?? null,
      bnbBalanceWei: keeperBnb,
      brawlBalanceWei: keeperBrawl,
    },
    daily: {
      mints: mintDaily,
      duels: duelDaily,
      marketSales: marketDaily,
    },
    audit,
    chainId,
  });
}
