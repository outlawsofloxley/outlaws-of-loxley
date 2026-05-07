/**
 * POST/GET /api/marketplace/sync
 *
 * Walks the chain forward from `market_sync_state.last_block` to the head
 * and replays every Listed / PriceUpdated / Unlisted / Sold event into
 * the `market_listings` Postgres cache:
 *   - Listed         → upsert row
 *   - PriceUpdated   → update the price column
 *   - Unlisted/Sold  → delete the row
 *
 * Same throttle + RPC rotation pattern as the duel sync so we stay under
 * BSC public RPC rate limits and Hobby's 10s serverless budget.
 */
import { createPublicClient, defineChain, http, parseAbi, parseAbiItem, type Log, type PublicClient } from 'viem';
import { validateEnv } from '@/lib/env';
import {
  clearMarketLastSyncedBlock,
  deleteListing,
  ensureMarketSchema,
  getAllCachedTokenIds,
  getMarketSyncState,
  getTrackedMarketplaceAddress,
  setMarketLastSyncedBlock,
  setTrackedMarketplaceAddress,
  updateListingPrice,
  upsertListing,
  wipeAllListings,
} from '@/lib/marketDb';
import { DASH_COOKIE_NAME, verifySessionCookie } from '@/lib/dashAuth';
import { isDbConfigured } from '@/lib/duelDb';

export const runtime = 'nodejs';
export const maxDuration = 60;

const LISTED_EVENT = parseAbiItem(
  'event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)',
);
const UNLISTED_EVENT = parseAbiItem(
  'event Unlisted(uint256 indexed tokenId, address indexed seller)',
);
const PRICE_UPDATED_EVENT = parseAbiItem(
  'event PriceUpdated(uint256 indexed tokenId, uint256 oldPrice, uint256 newPrice)',
);
const SOLD_EVENT = parseAbiItem(
  'event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee)',
);

/// Tiny ABI subset for the reconciliation pass. We don't want to import the
/// full MARKETPLACE_ABI here because it's TS-typed for client components.
const ISLISTED_ABI = parseAbi(['function isListed(uint256 tokenId) view returns (bool)']);

type ListedLog = Log<bigint, number, false, typeof LISTED_EVENT>;
type UnlistedLog = Log<bigint, number, false, typeof UNLISTED_EVENT>;
type PriceUpdatedLog = Log<bigint, number, false, typeof PRICE_UPDATED_EVENT>;
type SoldLog = Log<bigint, number, false, typeof SOLD_EVENT>;

const CHUNK_BLOCKS = 1000n;
const MAX_SYNC_CHUNKS = 4;
const STALE_SECONDS = 8;
const INITIAL_BACKFILL_BLOCKS = 5_000n;
const MIN_CHUNK = 100n;
const CHUNK_DELAY_MS = 150;
const RPC_TIMEOUT_MS = 2500;
const BASE_SEPOLIA_RPC_POOL = [
  'https://base-sepolia-rpc.publicnode.com',
  'https://sepolia.base.org',
  // base-sepolia.public.blastapi.io was retired by Blast in 2026; calls now
  // return HTTP 403 with a "use Alchemy instead" body. Removed from the pool.
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function chain(chainId: number, rpc: string) {
  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    testnet: chainId !== 1 && chainId !== 56 && chainId !== 8453,
  });
}

type EventRow =
  | { type: 'listed'; blockNumber: bigint; logIndex: number; tokenId: number; seller: string; price: bigint; txHash: string; listedAt: number }
  | { type: 'unlisted'; blockNumber: bigint; logIndex: number; tokenId: number }
  | { type: 'price-updated'; blockNumber: bigint; logIndex: number; tokenId: number; newPrice: bigint }
  | { type: 'sold'; blockNumber: bigint; logIndex: number; tokenId: number };

/// Walk every cached row and confirm it's still listed on-chain. Drops any
/// row whose token isListed = false. Catches ghosts left behind when an
/// Unlisted/Sold event was missed during a cursor jump or RPC outage.
async function reconcileCachedListings(
  clients: PublicClient[],
  marketAddr: `0x${string}`,
  tokenIds: number[],
): Promise<{ pruned: number; checked: number }> {
  let pruned = 0;
  for (const tokenId of tokenIds) {
    let stillListed: boolean | null = null;
    for (const c of clients) {
      try {
        stillListed = (await c.readContract({
          abi: ISLISTED_ABI,
          address: marketAddr,
          functionName: 'isListed',
          args: [BigInt(tokenId)],
        })) as boolean;
        break;
      } catch {
        continue;
      }
    }
    // If every RPC failed, leave the row alone, retry on the next sync.
    if (stillListed === false) {
      await deleteListing(tokenId);
      pruned++;
    }
  }
  return { pruned, checked: tokenIds.length };
}

async function syncImpl(request?: Request): Promise<Response> {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: 'POSTGRES_URL not configured' }, { status: 503 });
  }

  const v = validateEnv();
  if (!v.ok) {
    return Response.json({ ok: false, error: 'env: ' + v.errors.join('; ') }, { status: 500 });
  }
  const { rpcUrl, chainId } = v.env;
  // marketplaceAddress is already canonical-checksummed by validateEnv.
  const normalizedMarketAddr = v.env.marketplaceAddress;

  // Operator escape hatch: ?wipe=1 forces a full wipe before the regular
  // sync runs. Use this to clear ghosts left by a chain switch or a missed
  // Unlisted event without waiting for the reconciliation pass to catch up.
  //
  // Auth: either a valid dash session cookie (D logged in at /dash) OR the
  // raw DASH_SESSION_SECRET via &key=... for headless ops.
  let forcedWipe = 0;
  if (request) {
    const url = new URL(request.url);
    if (url.searchParams.get('wipe') === '1') {
      const cookieHeader = request.headers.get('cookie') ?? '';
      const cookieValue = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${DASH_COOKIE_NAME}=`))
        ?.slice(DASH_COOKIE_NAME.length + 1);
      const sessionPayload = await verifySessionCookie(cookieValue);
      const provided = url.searchParams.get('key') ?? '';
      const expected = process.env.DASH_SESSION_SECRET ?? '';
      const keyOk = expected.length >= 32 && provided === expected;
      if (sessionPayload || keyOk) {
        await ensureMarketSchema();
        forcedWipe = await wipeAllListings();
        // Clear (NOT zero) so the next sync triggers backfill from
        // latest - INITIAL_BACKFILL_BLOCKS instead of walking from genesis.
        await clearMarketLastSyncedBlock();
      } else {
        return Response.json(
          { ok: false, error: 'wipe requires dash session or DASH_SESSION_SECRET key' },
          { status: 401 },
        );
      }
    }
  }

  await ensureMarketSchema();

  // Detect Marketplace contract swap (e.g. v4, v5 redeploy). Old listings
  // would otherwise sit forever in the cache because the new contract emits
  // no events for those tokenIds. Wipe and start fresh when we notice the
  // tracked address differ from the configured one.
  const tracked = await getTrackedMarketplaceAddress();
  const configured = normalizedMarketAddr.toLowerCase();
  let wipedRows = forcedWipe;
  if (tracked === null) {
    await setTrackedMarketplaceAddress(configured);
  } else if (tracked !== configured) {
    wipedRows += await wipeAllListings();
    await setTrackedMarketplaceAddress(configured);
    // Clear cursor so the next sync backfills from latest - INITIAL_BACKFILL_BLOCKS
    // instead of walking from genesis (the bug we hit on v10 rehearsal).
    await clearMarketLastSyncedBlock();
    console.warn(
      `[marketplace/sync] tracked addr ${tracked} != configured ${configured}, wiped ${wipedRows} stale rows`,
    );
  }

  const state = await getMarketSyncState();
  const now = new Date();
  const throttled =
    state.updatedAt !== null &&
    (now.getTime() - state.updatedAt.getTime()) / 1000 < STALE_SECONDS &&
    wipedRows === 0;

  const rpcPool = chainId === 84532
    ? [...BASE_SEPOLIA_RPC_POOL, rpcUrl].filter((u, i, arr) => arr.indexOf(u) === i)
    : [rpcUrl];
  const clients = rpcPool.map(
    (u) =>
      createPublicClient({
        chain: chain(chainId, u),
        transport: http(u, { timeout: RPC_TIMEOUT_MS }),
      }) as PublicClient,
  );

  // Always reconcile the cache against on-chain state, even when chunk-level
  // event sync is throttled. This catches ghost rows left over from missed
  // Unlisted/Sold events (cursor jumps, RPC outages, contract redeploys
  // without a wipe). marketplaceAddress is already in canonical EIP-55
  // checksum form thanks to validateEnv.
  const cachedIds = await getAllCachedTokenIds();
  const reconciliation = cachedIds.length > 0
    ? await reconcileCachedListings(clients, normalizedMarketAddr, cachedIds)
    : { pruned: 0, checked: 0 };

  if (throttled) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: 'throttled',
      lastBlock: state.lastBlock?.toString() ?? null,
      reconciliation,
    });
  }

  let latest: bigint = 0n;
  for (const c of clients) {
    try {
      latest = await c.getBlockNumber();
      break;
    } catch {
      continue;
    }
  }
  if (latest === 0n) {
    return Response.json({ ok: false, error: 'All RPC endpoints failed' }, { status: 502 });
  }

  // Auto-reset stale cursor in three scenarios:
  //  1. chain switched (cursor > head) — fast-forward to recent
  //  2. cursor is null or zero (fresh / address change wipe) — backfill window
  //  3. cursor is absurdly behind (>100k blocks) — implies a previous bug
  //     left it at near-zero. Fast-forward instead of walking from there.
  //     Self-heal so the same bug can't bite again on future address swaps.
  const HEAVILY_LAGGED = 100_000n;
  const staleCursor = state.lastBlock !== null && state.lastBlock > latest;
  const freshOrZero = state.lastBlock === null || state.lastBlock === 0n;
  const heavilyLagged =
    state.lastBlock !== null &&
    state.lastBlock > 0n &&
    latest > state.lastBlock + HEAVILY_LAGGED;
  let from: bigint;
  if (staleCursor || freshOrZero || heavilyLagged) {
    from = latest > INITIAL_BACKFILL_BLOCKS ? latest - INITIAL_BACKFILL_BLOCKS : 0n;
  } else {
    from = (state.lastBlock as bigint) + 1n;
  }
  if (staleCursor) {
    console.warn(
      `[marketplace/sync] cursor ${state.lastBlock} > head ${latest}, resetting to ${from}`,
    );
  } else if (freshOrZero) {
    console.warn(
      `[marketplace/sync] cursor=${state.lastBlock} treated as fresh, backfilling from ${from}`,
    );
  } else if (heavilyLagged) {
    console.warn(
      `[marketplace/sync] cursor ${state.lastBlock} is ${latest - (state.lastBlock as bigint)} behind head, fast-forwarding to ${from}`,
    );
  }

  let span = CHUNK_BLOCKS;
  let chunksRun = 0;
  let eventsProcessed = 0;

  while (from <= latest && chunksRun < MAX_SYNC_CHUNKS) {
    if (chunksRun > 0) await sleep(CHUNK_DELAY_MS);
    const to = from + span > latest ? latest : from + span - 1n;

    // Try each RPC until one serves the four event queries.
    let allEvents: EventRow[] | null = null;
    for (const c of clients) {
      try {
        const [listedLogs, unlistedLogs, priceLogs, soldLogs] = await Promise.all([
          c.getLogs({
            address: normalizedMarketAddr,
            event: LISTED_EVENT,
            fromBlock: from,
            toBlock: to,
          }) as Promise<ListedLog[]>,
          c.getLogs({
            address: normalizedMarketAddr,
            event: UNLISTED_EVENT,
            fromBlock: from,
            toBlock: to,
          }) as Promise<UnlistedLog[]>,
          c.getLogs({
            address: normalizedMarketAddr,
            event: PRICE_UPDATED_EVENT,
            fromBlock: from,
            toBlock: to,
          }) as Promise<PriceUpdatedLog[]>,
          c.getLogs({
            address: normalizedMarketAddr,
            event: SOLD_EVENT,
            fromBlock: from,
            toBlock: to,
          }) as Promise<SoldLog[]>,
        ]);

        const merged: EventRow[] = [];

        for (const log of listedLogs) {
          if (log.blockNumber === null || log.logIndex === null || !log.transactionHash) continue;
          const { tokenId, seller, price } = log.args;
          if (tokenId === undefined || seller === undefined || price === undefined) continue;
          // We use block.timestamp indirectly via the ordering, use block
          // number * (approx 3s) as a sortable listedAt. Good enough for
          // display; precise timestamps aren't worth an extra RPC.
          merged.push({
            type: 'listed',
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            tokenId: Number(tokenId),
            seller,
            price,
            txHash: log.transactionHash,
            listedAt: Number(log.blockNumber), // proxy; timestamp would need eth_getBlockByNumber
          });
        }
        for (const log of unlistedLogs) {
          if (log.blockNumber === null || log.logIndex === null) continue;
          const { tokenId } = log.args;
          if (tokenId === undefined) continue;
          merged.push({
            type: 'unlisted',
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            tokenId: Number(tokenId),
          });
        }
        for (const log of priceLogs) {
          if (log.blockNumber === null || log.logIndex === null) continue;
          const { tokenId, newPrice } = log.args;
          if (tokenId === undefined || newPrice === undefined) continue;
          merged.push({
            type: 'price-updated',
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            tokenId: Number(tokenId),
            newPrice,
          });
        }
        for (const log of soldLogs) {
          if (log.blockNumber === null || log.logIndex === null) continue;
          const { tokenId } = log.args;
          if (tokenId === undefined) continue;
          merged.push({
            type: 'sold',
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            tokenId: Number(tokenId),
          });
        }

        // Apply in chain order (block then log index) so later events
        // overwrite earlier ones cleanly.
        merged.sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? 1 : -1;
          return a.logIndex - b.logIndex;
        });
        allEvents = merged;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/limit|exceed|rate|too many|too large|timeout/i.test(msg)) continue;
        continue;
      }
    }

    if (allEvents === null) {
      if (span > MIN_CHUNK) {
        span = span / 2n < MIN_CHUNK ? MIN_CHUNK : span / 2n;
        await sleep(500);
        continue;
      }
      await setMarketLastSyncedBlock(from === 0n ? 0n : from - 1n);
      return Response.json(
        {
          ok: false,
          error: 'All RPCs rate-limited at min chunk',
          chunksRun,
          eventsProcessed,
          stoppedAt: from.toString(),
        },
        { status: 502 },
      );
    }

    for (const ev of allEvents) {
      if (ev.type === 'listed') {
        await upsertListing({
          tokenId: ev.tokenId,
          seller: ev.seller,
          price: ev.price,
          listedAt: ev.listedAt,
          txHash: ev.txHash,
          blockNumber: ev.blockNumber,
        });
      } else if (ev.type === 'price-updated') {
        await updateListingPrice(ev.tokenId, ev.newPrice);
      } else {
        // unlisted or sold, clear the row.
        await deleteListing(ev.tokenId);
      }
      eventsProcessed++;
    }

    if (span < CHUNK_BLOCKS) {
      span = span * 2n > CHUNK_BLOCKS ? CHUNK_BLOCKS : span * 2n;
    }

    const nextFrom = to + 1n;
    from = nextFrom;
    chunksRun++;
  }

  const finalLastBlock = from === 0n ? 0n : from - 1n;
  await setMarketLastSyncedBlock(finalLastBlock);

  return Response.json({
    ok: true,
    synced: true,
    chunksRun,
    eventsProcessed,
    lastBlock: finalLastBlock.toString(),
    latestChainBlock: latest.toString(),
    fullyCaughtUp: finalLastBlock >= latest,
    reconciliation,
    wipedRows,
  });
}

export async function POST(request: Request) {
  return syncImpl(request);
}
export async function GET(request: Request) {
  return syncImpl(request);
}
