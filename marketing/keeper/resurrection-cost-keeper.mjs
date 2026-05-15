#!/usr/bin/env node
/**
 * resurrection-cost-keeper.mjs — keeps Graveyard.resurrectionCost pegged
 * to TARGET_USD_CENTS (default 10_000 cents = $100 USD).
 *
 * Mirrors the fight-cost-keeper structure exactly. Only differences:
 *   - Reads ETH/USD from Chainlink directly (no BRAWL pool needed; resurrect
 *     cost is paid in ETH, so we just need ETH→USD).
 *   - Calls Graveyard.setResurrectionCost(uint256) instead of
 *     Duel.setFightEconomics(...).
 *   - Hard cap MAX = 0.5 ETH (well under the contract's MAX_RESURRECTION_COST
 *     of 1 ETH). MIN = 0.001 ETH so we never accidentally hit zero.
 *
 * NOTE: this only sets the BASE resurrection cost. The final cost a player
 * pays is:  base × tierMult/10 × (10 + wins)/10
 *   Common (mult 10) at 0 wins: 1.0× base → ~$100 at target
 *   King   (mult 150) at 0 wins: 15× base → ~$1500 at target
 * See trust.md / docs for the table.
 *
 * Required env (see .env.example for full list):
 *   RPC_URL                 https://mainnet.base.org
 *   CHAIN_ID                8453
 *   KEEPER_PRIVATE_KEY      0x... (same keeper EOA as fight-cost-keeper, or
 *                                  a separate one if you want isolated keys)
 *   GRAVEYARD_ADDRESS       0x... (deployed Graveyard)
 *   CHAINLINK_ETH_USD       0x71041dDdAd3595F9CEd3DcCFBe3D1F4b0a16Bb70 (Base)
 *
 * Optional env (defaults shown):
 *   POLL_SEC                300        (5 minutes; resurrect cost moves
 *                                       slower than fight cost so less freq
 *                                       is fine)
 *   TARGET_USD_CENTS        10000      ($100.00)
 *   DELTA_THRESHOLD         0.05       (5% trigger)
 *   MIN_RESURRECT_WEI       1000000000000000     (0.001 ETH = floor)
 *   MAX_RESURRECT_WEI       500000000000000000   (0.5 ETH = ~$2k cap)
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
const GRAVEYARD = getAddress(required('GRAVEYARD_ADDRESS'));
const ETH_USD_FEED = getAddress(required('CHAINLINK_ETH_USD'));

const POLL_SEC = Number(process.env.POLL_SEC || '300');
const TARGET_USD_CENTS = Number(process.env.TARGET_USD_CENTS || '10000');
const DELTA_THRESHOLD = Number(process.env.DELTA_THRESHOLD || '0.05');
const MIN_RESURRECT_WEI = BigInt(process.env.MIN_RESURRECT_WEI || '1000000000000000');
const MAX_RESURRECT_WEI = BigInt(process.env.MAX_RESURRECT_WEI || '500000000000000000');
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`FATAL: env ${name} not set`); process.exit(1); }
  return v;
}

// ─── ABIs (minimal slices) ───────────────────────────────────────────
const GRAVEYARD_ABI = [
  'function resurrectionCost() view returns (uint256)',
  'function setResurrectionCost(uint256 newCost)',
];
const FEED_ABI = [
  'function latestRoundData() view returns (uint80, int256 answer, uint256, uint256, uint80)',
  'function decimals() view returns (uint8)',
];

// ─── Setup ───────────────────────────────────────────────────────────
const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
const keeper = new Wallet(KEEPER_KEY, provider);
const graveyard = new Contract(GRAVEYARD, GRAVEYARD_ABI, keeper);
const feed = new Contract(ETH_USD_FEED, FEED_ABI, provider);

console.log(`▶ resurrection-cost-keeper`);
console.log(`  rpc=${RPC_URL} chain=${CHAIN_ID}`);
console.log(`  keeper=${keeper.address}`);
console.log(`  graveyard=${GRAVEYARD}`);
console.log(`  feed=${ETH_USD_FEED}`);
console.log(`  poll=${POLL_SEC}s threshold=${(DELTA_THRESHOLD*100).toFixed(1)}% target=$${TARGET_USD_CENTS/100}`);
console.log(`  bounds=[${Number(MIN_RESURRECT_WEI)/1e18}..${Number(MAX_RESURRECT_WEI)/1e18}] ETH`);
console.log(`  ${DRY_RUN ? 'DRY-RUN (no broadcasts)' : 'LIVE (will broadcast)'}`);

// ─── Helpers ─────────────────────────────────────────────────────────
async function getEthUsdCents() {
  const [feedDecimals, feedRound] = await Promise.all([
    feed.decimals(),
    feed.latestRoundData(),
  ]);
  const ethUsdAnswer = BigInt(feedRound.answer);
  if (ethUsdAnswer <= 0n) throw new Error('Chainlink feed returned non-positive answer');
  // ETH/USD in cents: answer × 100 / 10^decimals
  const FD = 10n ** BigInt(feedDecimals);
  const ethUsdCents = (ethUsdAnswer * 100n) / FD;
  return ethUsdCents;
}

function clamp(v, lo, hi) { if (v < lo) return lo; if (v > hi) return hi; return v; }

async function tick() {
  const ts = new Date().toISOString();
  let ethUsdCents;
  try {
    ethUsdCents = await getEthUsdCents();
  } catch (e) {
    console.log(`[${ts}] ! price read failed: ${e.message}`);
    return;
  }
  if (ethUsdCents === 0n) {
    console.log(`[${ts}] ! ethUsdCents=0, skipping`);
    return;
  }

  // target_wei = (TARGET_USD_CENTS × 10^18) / ethUsdCents
  // e.g. $100 = 10000 cents; ETH=$4000=400000 cents → target = 10000e18/400000 = 0.025e18 = 0.025 ETH
  const targetRaw = (BigInt(TARGET_USD_CENTS) * 10n ** 18n) / ethUsdCents;
  const target = clamp(targetRaw, MIN_RESURRECT_WEI, MAX_RESURRECT_WEI);

  const current = BigInt(await graveyard.resurrectionCost());
  const delta = current === 0n
    ? 1.0
    : Math.abs(Number(target - current)) / Number(current);

  const targetEth = Number(target) / 1e18;
  const currentEth = Number(current) / 1e18;
  const ethUsdDollars = Number(ethUsdCents) / 100;
  console.log(
    `[${ts}] ETH=$${ethUsdDollars.toFixed(2)} | ` +
    `target=${targetEth.toFixed(5)} ETH | current=${currentEth.toFixed(5)} ETH | ` +
    `Δ=${(delta*100).toFixed(2)}%`
  );

  if (delta < DELTA_THRESHOLD) {
    console.log(`         → within threshold, no update`);
    return;
  }

  if (DRY_RUN) {
    console.log(`         → would call setResurrectionCost(${target})`);
    return;
  }

  try {
    const tx = await graveyard.setResurrectionCost(target, { gasLimit: 100_000n });
    console.log(`         → setResurrectionCost submitted: ${tx.hash}`);
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
