#!/usr/bin/env node
/**
 * fight-cost-keeper.mjs — keeps Duel.fightCost pegged to ~$1 USD in BRAWL.
 *
 * Polls every POLL_SEC seconds (default 300 = 5 min). For each cycle:
 *   1. Read BRAWL/ETH spot from the Aerodrome v2 BRAWL/ETH pair reserves.
 *   2. Read ETH/USD spot from Chainlink (Base mainnet).
 *   3. BRAWL/USD = (ETH per BRAWL) × (USD per ETH).
 *   4. target = TARGET_USD_CENTS / BRAWL_USD_CENTS  (in BRAWL wei).
 *   5. Clamp to [MIN_FIGHT_COST_WEI, MAX_FIGHT_COST_WEI].
 *   6. If |target − current| / current ≥ DELTA_THRESHOLD, call
 *      Duel.setFightEconomics(target, devShareBps, devTreasury).
 *   7. Log + sleep.
 *
 * Run as a long-lived process (Docker, systemd, pm2, etc.). Uses a dedicated
 * KEEPER_PRIVATE_KEY — funded with a small ETH balance for tx gas. NEVER use
 * the deployer or dev wallet.
 *
 * Required env (see .env.example):
 *   RPC_URL                 https://mainnet.base.org
 *   CHAIN_ID                8453
 *   KEEPER_PRIVATE_KEY      0x... (small ETH balance for gas only)
 *   DUEL_ADDRESS            0x... (the deployed Duel contract)
 *   DEV_TREASURY            0x... (passed back to setFightEconomics unchanged)
 *   DEV_SHARE_BPS           1000 (10%; passed back unchanged)
 *   BRAWL_PAIR_ADDRESS      0x... (Aerodrome BRAWL/ETH pair, set after LP seed)
 *   CHAINLINK_ETH_USD       0x71041dDdAd3595F9CEd3DcCFBe3D1F4b0a16Bb70 (Base ETH/USD)
 *   BRAWL_ADDRESS           0x... (used to determine token0/token1 ordering in pair)
 *
 * Optional env (defaults shown):
 *   POLL_SEC                300        (5 minutes)
 *   TARGET_USD_CENTS        100        ($1.00)
 *   DELTA_THRESHOLD         0.05       (5% — only update if delta exceeds)
 *   MIN_FIGHT_COST_WEI      1000000000000000000   (1 BRAWL floor)
 *   MAX_FIGHT_COST_WEI      1000000000000000000000 (1,000 BRAWL ceiling; well
 *                                                   under the contract's
 *                                                   MAX_FIGHT_COST=10k BRAWL)
 *   DRY_RUN                 false      (compute + log, never broadcast)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JsonRpcProvider, Wallet, Contract, getAddress } from 'ethers';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, '.env');

function loadDotenv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadDotenv(ENV_PATH);

// ─── Config ──────────────────────────────────────────────────────────
const RPC_URL = required('RPC_URL');
const CHAIN_ID = Number(required('CHAIN_ID'));
const KEEPER_KEY = required('KEEPER_PRIVATE_KEY');
const DUEL = getAddress(required('DUEL_ADDRESS'));
const DEV_TREASURY = getAddress(required('DEV_TREASURY'));
const DEV_SHARE_BPS = Number(required('DEV_SHARE_BPS'));
const PAIR = getAddress(required('BRAWL_PAIR_ADDRESS'));
const ETH_USD_FEED = getAddress(required('CHAINLINK_ETH_USD'));
const BRAWL = getAddress(required('BRAWL_ADDRESS'));

const POLL_SEC = Number(process.env.POLL_SEC || '300');
const TARGET_USD_CENTS = Number(process.env.TARGET_USD_CENTS || '100');
const DELTA_THRESHOLD = Number(process.env.DELTA_THRESHOLD || '0.05');
const MIN_FIGHT_COST_WEI = BigInt(process.env.MIN_FIGHT_COST_WEI || '1000000000000000000');
const MAX_FIGHT_COST_WEI = BigInt(process.env.MAX_FIGHT_COST_WEI || '1000000000000000000000');
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`FATAL: env ${name} not set`); process.exit(1); }
  return v;
}

// ─── ABIs (minimal slices) ───────────────────────────────────────────
const DUEL_ABI = [
  'function fightCost() view returns (uint256)',
  'function devShareBps() view returns (uint16)',
  'function devTreasury() view returns (address)',
  'function setFightEconomics(uint256 _fightCost, uint16 _devShareBps, address _devTreasury)',
];
const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];
const FEED_ABI = [
  'function latestRoundData() view returns (uint80, int256 answer, uint256, uint256, uint80)',
  'function decimals() view returns (uint8)',
];

// ─── Setup ───────────────────────────────────────────────────────────
const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
const keeper = new Wallet(KEEPER_KEY, provider);
const duel = new Contract(DUEL, DUEL_ABI, keeper);
const pair = new Contract(PAIR, PAIR_ABI, provider);
const feed = new Contract(ETH_USD_FEED, FEED_ABI, provider);

console.log(`▶ fight-cost-keeper`);
console.log(`  rpc=${RPC_URL} chain=${CHAIN_ID}`);
console.log(`  keeper=${keeper.address}`);
console.log(`  duel=${DUEL}`);
console.log(`  pair=${PAIR}`);
console.log(`  feed=${ETH_USD_FEED}`);
console.log(`  poll=${POLL_SEC}s threshold=${(DELTA_THRESHOLD*100).toFixed(1)}% target=$${TARGET_USD_CENTS/100}`);
console.log(`  bounds=[${MIN_FIGHT_COST_WEI / 10n**18n}..${MAX_FIGHT_COST_WEI / 10n**18n}] BRAWL`);
console.log(`  ${DRY_RUN ? 'DRY-RUN (no broadcasts)' : 'LIVE (will broadcast)'}`);

// ─── Helpers ─────────────────────────────────────────────────────────
async function getBrawlUsdMicros() {
  // 1. Pair reserves + token order
  const [reserves, t0, t1, feedDecimals, feedRound] = await Promise.all([
    pair.getReserves(),
    pair.token0(),
    pair.token1(),
    feed.decimals(),
    feed.latestRoundData(),
  ]);
  const [r0, r1] = [BigInt(reserves[0]), BigInt(reserves[1])];
  // 2. Determine which side is BRAWL
  const t0lc = t0.toLowerCase(); const t1lc = t1.toLowerCase();
  const brawlLc = BRAWL.toLowerCase();
  let brawlReserve, ethReserve;
  if (t0lc === brawlLc)      { brawlReserve = r0; ethReserve = r1; }
  else if (t1lc === brawlLc) { brawlReserve = r1; ethReserve = r0; }
  else throw new Error(`pair ${PAIR} doesn't include BRAWL ${BRAWL}`);
  if (brawlReserve === 0n || ethReserve === 0n) {
    throw new Error('pair reserves are zero (LP not seeded yet?)');
  }
  // 3. ETH/USD with Chainlink decimals (typically 8)
  const ethUsdAnswer = BigInt(feedRound.answer);
  if (ethUsdAnswer <= 0n) throw new Error('Chainlink feed returned non-positive answer');
  // 4. BRAWL/USD = (ETH per BRAWL) × (USD per ETH)
  //    = (ethReserve / brawlReserve) × (ethUsdAnswer / 10**feedDecimals)
  //    All in micros (10^6) = $0.000001 units, both BRAWL and ETH have 18 decimals
  //    BRAWL_USD_micros = (ethReserve * ethUsdAnswer * 1e6) / (brawlReserve * 10^feedDecimals)
  const FD = 10n ** BigInt(feedDecimals);
  const brawlUsdMicros = (ethReserve * ethUsdAnswer * 1_000_000n) / (brawlReserve * FD);
  return { brawlUsdMicros, brawlReserve, ethReserve, ethUsdAnswer, feedDecimals };
}

function clamp(v, lo, hi) { if (v < lo) return lo; if (v > hi) return hi; return v; }

async function tick() {
  const ts = new Date().toISOString();
  let metric;
  try {
    metric = await getBrawlUsdMicros();
  } catch (e) {
    console.log(`[${ts}] ! price read failed: ${e.message}`);
    return;
  }
  const { brawlUsdMicros, brawlReserve, ethReserve } = metric;
  const brawlUsdDollars = Number(brawlUsdMicros) / 1_000_000;
  if (brawlUsdMicros === 0n) {
    console.log(`[${ts}] ! brawlUsdMicros=0, skipping`);
    return;
  }
  // target_brawl_wei = TARGET_USD_CENTS * 10^16 / brawlUsdMicros  (since 1 micro = $0.000001 and 1 cent = $0.01)
  // target_brawl_wei = (TARGET_USD_CENTS * 10^4 / brawlUsdMicros) * 10^18
  // Cleaner: target_brawl_in_smallest = (TARGET_USD_CENTS / 100) / brawlUsdDollars × 10^18
  // Use integer math: target_wei = (TARGET_USD_CENTS * 10000 * 10^18) / brawlUsdMicros
  const targetRaw = (BigInt(TARGET_USD_CENTS) * 10_000n * 10n ** 18n) / brawlUsdMicros;
  const target = clamp(targetRaw, MIN_FIGHT_COST_WEI, MAX_FIGHT_COST_WEI);

  const current = BigInt(await duel.fightCost());
  const delta = current === 0n
    ? 1.0
    : Math.abs(Number(target - current)) / Number(current);

  const targetBrawl = Number(target) / 1e18;
  const currentBrawl = Number(current) / 1e18;
  console.log(
    `[${ts}] BRAWL=$${brawlUsdDollars.toFixed(6)} | ` +
    `target=${targetBrawl.toFixed(2)} | current=${currentBrawl.toFixed(2)} | ` +
    `Δ=${(delta*100).toFixed(2)}%`
  );

  if (delta < DELTA_THRESHOLD) {
    console.log(`         → within threshold, no update`);
    return;
  }

  if (DRY_RUN) {
    console.log(`         → would call setFightEconomics(${target}, ${DEV_SHARE_BPS}, ${DEV_TREASURY})`);
    return;
  }

  try {
    const tx = await duel.setFightEconomics(target, DEV_SHARE_BPS, DEV_TREASURY, {
      gasLimit: 200_000n,
    });
    console.log(`         → setFightEconomics submitted: ${tx.hash}`);
    const rc = await tx.wait(1);
    console.log(`         → confirmed at block ${rc.blockNumber} (gas used ${rc.gasUsed})`);
  } catch (e) {
    console.error(`         ✗ tx error: ${e.shortMessage || e.message}`);
  }
}

// ─── Main loop ───────────────────────────────────────────────────────
(async () => {
  // Tick once immediately so logs show the bot is alive on boot.
  await tick();
  setInterval(() => { void tick(); }, POLL_SEC * 1000);
})();
