#!/usr/bin/env node
/**
 * fight-cost-keeper.mjs — keeps DuelRouter.fightCostBrawl + fightCostEth
 * pegged to whatever USD target the dashboard has written on-chain via
 * `setFightCostUsdCents`. The dashboard is the source of truth; this bot
 * just propagates it to the BRAWL + ETH wei amounts.
 *
 * Each tick (default 5 min):
 *   1. Read router.fightCostUsdCents (source of truth).
 *   2. Read BRAWL/ETH spot from the Aerodrome v2 BRAWL/ETH pair reserves.
 *   3. Read ETH/USD spot from Chainlink (Base mainnet).
 *   4. Compute BRAWL/USD = (eth_reserve / brawl_reserve) × eth_usd.
 *   5. target_brawl_wei = (usdCents × 1e22) / brawl_usd_micros   (so the
 *      18-decimal BRAWL math lands at $1 worth of BRAWL when cents=100)
 *      target_eth_wei   = (usdCents × 1e22) / eth_usd_micros
 *   6. Clamp to [MIN_*_WEI, MAX_*_WEI] safety bounds.
 *   7. If |target − current| / current ≥ DELTA_THRESHOLD (default 5%),
 *      call router.setFightEconomics(target_brawl, target_eth, devShareBps).
 *
 * Run as a long-lived process (Docker, systemd, pm2, etc.). Uses a dedicated
 * KEEPER_PRIVATE_KEY — funded with a small ETH balance for tx gas. NEVER use
 * the deployer or dev wallet.
 *
 * Required env (see .env.example):
 *   RPC_URL                 https://mainnet.base.org
 *   CHAIN_ID                8453
 *   KEEPER_PRIVATE_KEY      0x... (small ETH balance for gas only)
 *   ROUTER_ADDRESS          0x... (the deployed DuelRouter contract)
 *   BRAWL_PAIR_ADDRESS      0x... (Aerodrome BRAWL/ETH pair, set after LP seed)
 *   BRAWL_ADDRESS           0x... (used to determine token0/token1 ordering in pair)
 *   CHAINLINK_ETH_USD       0x71041dDdAd3595F9CEd3DcCFBe3D1F4b0a16Bb70 (Base ETH/USD)
 *
 * Optional env (defaults shown):
 *   POLL_SEC                300        (5 minutes)
 *   DELTA_THRESHOLD         0.05       (5% — only update if delta exceeds)
 *   MIN_FIGHT_COST_BRAWL_WEI  1000000        (1e6 wei = 1e-12 BRAWL → peg
 *                                              holds to FDV ~$10T. Effectively
 *                                              no floor.)
 *   MAX_FIGHT_COST_BRAWL_WEI  1000000000000000000000  (1,000 BRAWL — well
 *                                                       under the contract's
 *                                                       MAX_FIGHT_COST_BRAWL
 *                                                       of 10,000.)
 *   MIN_FIGHT_COST_ETH_WEI    1000           (1e3 wei = 1e-15 ETH — practical
 *                                              floor for $1 fights regardless
 *                                              of ETH price.)
 *   MAX_FIGHT_COST_ETH_WEI    500000000000000000     (0.5 ETH — well under
 *                                                     the contract's
 *                                                     MAX_FIGHT_COST_ETH.)
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
const ROUTER = getAddress(required('ROUTER_ADDRESS'));
const PAIR = getAddress(required('BRAWL_PAIR_ADDRESS'));
const ETH_USD_FEED = getAddress(required('CHAINLINK_ETH_USD'));
const BRAWL = getAddress(required('BRAWL_ADDRESS'));

const POLL_SEC = Number(process.env.POLL_SEC || '300');
const DELTA_THRESHOLD = Number(process.env.DELTA_THRESHOLD || '0.05');
const MIN_BRAWL_WEI = BigInt(process.env.MIN_FIGHT_COST_BRAWL_WEI || '1000000');
const MAX_BRAWL_WEI = BigInt(process.env.MAX_FIGHT_COST_BRAWL_WEI || '1000000000000000000000');
const MIN_ETH_WEI = BigInt(process.env.MIN_FIGHT_COST_ETH_WEI || '1000');
const MAX_ETH_WEI = BigInt(process.env.MAX_FIGHT_COST_ETH_WEI || '500000000000000000');
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`FATAL: env ${name} not set`); process.exit(1); }
  return v;
}

// ─── ABIs (minimal slices) ───────────────────────────────────────────
const ROUTER_ABI = [
  'function fightCostBrawl() view returns (uint256)',
  'function fightCostEth() view returns (uint256)',
  'function fightCostUsdCents() view returns (uint256)',
  'function devShareBps() view returns (uint16)',
  'function setFightEconomics(uint256 _fightCostBrawl, uint256 _fightCostEth, uint16 _devShareBps)',
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
const router = new Contract(ROUTER, ROUTER_ABI, keeper);
const pair = new Contract(PAIR, PAIR_ABI, provider);
const feed = new Contract(ETH_USD_FEED, FEED_ABI, provider);

console.log(`▶ fight-cost-keeper (router-mode, on-chain USD target)`);
console.log(`  rpc=${RPC_URL} chain=${CHAIN_ID}`);
console.log(`  keeper=${keeper.address}`);
console.log(`  router=${ROUTER}`);
console.log(`  pair=${PAIR}`);
console.log(`  feed=${ETH_USD_FEED}`);
console.log(`  poll=${POLL_SEC}s threshold=${(DELTA_THRESHOLD*100).toFixed(1)}%`);
console.log(`  bounds: BRAWL=[${MIN_BRAWL_WEI}..${MAX_BRAWL_WEI}] ETH=[${MIN_ETH_WEI}..${MAX_ETH_WEI}]`);
console.log(`  ${DRY_RUN ? 'DRY-RUN (no broadcasts)' : 'LIVE (will broadcast)'}`);

// ─── Helpers ─────────────────────────────────────────────────────────
async function getPrices() {
  const [reserves, t0, t1, feedDecimals, feedRound] = await Promise.all([
    pair.getReserves(),
    pair.token0(),
    pair.token1(),
    feed.decimals(),
    feed.latestRoundData(),
  ]);
  const [r0, r1] = [BigInt(reserves[0]), BigInt(reserves[1])];
  const t0lc = t0.toLowerCase(); const t1lc = t1.toLowerCase();
  const brawlLc = BRAWL.toLowerCase();
  let brawlReserve, ethReserve;
  if (t0lc === brawlLc)      { brawlReserve = r0; ethReserve = r1; }
  else if (t1lc === brawlLc) { brawlReserve = r1; ethReserve = r0; }
  else throw new Error(`pair ${PAIR} doesn't include BRAWL ${BRAWL}`);
  if (brawlReserve === 0n || ethReserve === 0n) {
    throw new Error('pair reserves are zero (LP not seeded yet?)');
  }
  const ethUsdAnswer = BigInt(feedRound.answer);
  if (ethUsdAnswer <= 0n) throw new Error('Chainlink feed returned non-positive answer');
  const FD = 10n ** BigInt(feedDecimals);
  // ETH/USD in micro-dollars: answer × 1e6 / 10^decimals
  const ethUsdMicros = (ethUsdAnswer * 1_000_000n) / FD;
  // BRAWL/USD micros = (ETH per BRAWL) × (USD per ETH)
  //   = (ethReserve / brawlReserve) × (ethUsdAnswer / 10^feedDecimals)
  const brawlUsdMicros = (ethReserve * ethUsdAnswer * 1_000_000n) / (brawlReserve * FD);
  return { brawlUsdMicros, ethUsdMicros, brawlReserve, ethReserve };
}

function clamp(v, lo, hi) { if (v < lo) return lo; if (v > hi) return hi; return v; }

async function tick() {
  const ts = new Date().toISOString();
  let usdCents, prices;
  try {
    [usdCents, prices] = await Promise.all([
      router.fightCostUsdCents().then(v => BigInt(v)),
      getPrices(),
    ]);
  } catch (e) {
    console.log(`[${ts}] ! read failed: ${e.message}`);
    return;
  }
  if (usdCents === 0n) {
    console.log(`[${ts}] fightCostUsdCents=0 — feature disabled, no peg work`);
    return;
  }
  const { brawlUsdMicros, ethUsdMicros } = prices;
  if (brawlUsdMicros === 0n || ethUsdMicros === 0n) {
    console.log(`[${ts}] ! price=0, skipping`);
    return;
  }

  // target_brawl_wei = (usdCents × 1e22) / brawlUsdMicros
  //   reasoning: $1 = 100 cents, BRAWL has 18 decimals, brawlUsdMicros is
  //   USD micros (1e6 per dollar). To convert cents → BRAWL wei:
  //     wei = cents × 1e16 (cents→dollars then 1e18 BRAWL) / (brawlUsdMicros/1e6)
  //         = cents × 1e22 / brawlUsdMicros
  const targetBrawlRaw = (usdCents * 10n ** 22n) / brawlUsdMicros;
  const targetEthRaw   = (usdCents * 10n ** 22n) / ethUsdMicros;
  const targetBrawl = clamp(targetBrawlRaw, MIN_BRAWL_WEI, MAX_BRAWL_WEI);
  const targetEth = clamp(targetEthRaw, MIN_ETH_WEI, MAX_ETH_WEI);

  const [currentBrawl, currentEth, devBps] = await Promise.all([
    router.fightCostBrawl().then(v => BigInt(v)),
    router.fightCostEth().then(v => BigInt(v)),
    router.devShareBps().then(v => Number(v)),
  ]);

  const deltaBrawl = currentBrawl === 0n
    ? 1.0
    : Math.abs(Number(targetBrawl - currentBrawl)) / Number(currentBrawl);
  const deltaEth = currentEth === 0n
    ? 1.0
    : Math.abs(Number(targetEth - currentEth)) / Number(currentEth);

  const usdDollars = Number(usdCents) / 100;
  const brawlUsdDollars = Number(brawlUsdMicros) / 1_000_000;
  const ethUsdDollars = Number(ethUsdMicros) / 1_000_000;
  console.log(
    `[${ts}] target=$${usdDollars.toFixed(2)} | ` +
    `BRAWL=$${brawlUsdDollars.toFixed(6)} ETH=$${ethUsdDollars.toFixed(2)} | ` +
    `BRAWL ${Number(currentBrawl)/1e18}→${Number(targetBrawl)/1e18} (Δ ${(deltaBrawl*100).toFixed(1)}%) | ` +
    `ETH ${Number(currentEth)/1e18}→${Number(targetEth)/1e18} (Δ ${(deltaEth*100).toFixed(1)}%)`
  );

  if (deltaBrawl < DELTA_THRESHOLD && deltaEth < DELTA_THRESHOLD) {
    console.log(`         → both within threshold, no update`);
    return;
  }

  if (DRY_RUN) {
    console.log(`         → would call setFightEconomics(${targetBrawl}, ${targetEth}, ${devBps})`);
    return;
  }

  try {
    const tx = await router.setFightEconomics(targetBrawl, targetEth, devBps, { gasLimit: 200_000n });
    console.log(`         → setFightEconomics submitted: ${tx.hash}`);
    const rc = await tx.wait(1);
    console.log(`         → confirmed at block ${rc.blockNumber} (gas used ${rc.gasUsed})`);
  } catch (e) {
    console.error(`         ✗ tx error: ${e.shortMessage || e.message}`);
  }
}

// ─── Main loop ───────────────────────────────────────────────────────
(async () => {
  await tick();
  setInterval(() => { void tick(); }, POLL_SEC * 1000);
})();
