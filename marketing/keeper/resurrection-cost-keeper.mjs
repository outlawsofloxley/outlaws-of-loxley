#!/usr/bin/env node
/**
 * resurrection-cost-keeper.mjs — keeps Graveyard.resurrectionCost +
 * Graveyard.resurrectionCap pegged to whatever USD targets the dashboard has
 * written on-chain via setResurrectionCostUsdCents + setResurrectionCapUsdCents.
 *
 * Each tick (default 5 min):
 *   1. Read graveyard.resurrectionCostUsdCents + resurrectionCapUsdCents.
 *   2. Read ETH/USD from Chainlink.
 *   3. Compute target ETH wei for each.
 *   4. If drift ≥ DELTA_THRESHOLD, call the matching setter.
 *
 * The two values track the dashboard exactly — change $100 → $150 in the
 * dashboard and within 5 min the on-chain ETH amount matches at the new
 * target. Same for the cap.
 *
 * Required env (see .env.example):
 *   RPC_URL                 https://mainnet.base.org
 *   CHAIN_ID                8453
 *   KEEPER_PRIVATE_KEY      0x... (small ETH balance for gas)
 *   GRAVEYARD_ADDRESS       0x... (deployed Graveyard)
 *   CHAINLINK_ETH_USD       0x71041dDdAd3595F9CEd3DcCFBe3D1F4b0a16Bb70
 *
 * Optional env (defaults shown):
 *   POLL_SEC                300
 *   DELTA_THRESHOLD         0.05  (5% trigger)
 *   MIN_RESURRECT_WEI       1000000000000  (1e12 wei = 0.000001 ETH, basically zero floor)
 *   MAX_RESURRECT_WEI       1000000000000000000  (1 ETH, matches MAX_RESURRECTION_COST)
 *   DRY_RUN                 false
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

const RPC_URL = required('RPC_URL');
const CHAIN_ID = Number(required('CHAIN_ID'));
const KEEPER_KEY = required('KEEPER_PRIVATE_KEY');
const GRAVEYARD = getAddress(required('GRAVEYARD_ADDRESS'));
const ETH_USD_FEED = getAddress(required('CHAINLINK_ETH_USD'));

const POLL_SEC = Number(process.env.POLL_SEC || '300');
const DELTA_THRESHOLD = Number(process.env.DELTA_THRESHOLD || '0.05');
const MIN_WEI = BigInt(process.env.MIN_RESURRECT_WEI || '1000000000000');
const MAX_WEI = BigInt(process.env.MAX_RESURRECT_WEI || '1000000000000000000');
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`FATAL: env ${name} not set`); process.exit(1); }
  return v;
}

const GRAVEYARD_ABI = [
  'function resurrectionCost() view returns (uint256)',
  'function resurrectionCap() view returns (uint256)',
  'function resurrectionCostUsdCents() view returns (uint256)',
  'function resurrectionCapUsdCents() view returns (uint256)',
  'function setResurrectionCost(uint256 newCost)',
  'function setResurrectionCap(uint256 newCap)',
];
const FEED_ABI = [
  'function latestRoundData() view returns (uint80, int256 answer, uint256, uint256, uint80)',
  'function decimals() view returns (uint8)',
];

const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
const keeper = new Wallet(KEEPER_KEY, provider);
const graveyard = new Contract(GRAVEYARD, GRAVEYARD_ABI, keeper);
const feed = new Contract(ETH_USD_FEED, FEED_ABI, provider);

console.log(`▶ resurrection-cost-keeper (on-chain USD targets)`);
console.log(`  rpc=${RPC_URL} chain=${CHAIN_ID}`);
console.log(`  keeper=${keeper.address}`);
console.log(`  graveyard=${GRAVEYARD}`);
console.log(`  feed=${ETH_USD_FEED}`);
console.log(`  poll=${POLL_SEC}s threshold=${(DELTA_THRESHOLD*100).toFixed(1)}%`);
console.log(`  bounds=[${MIN_WEI}..${MAX_WEI}] wei`);
console.log(`  ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);

async function getEthUsdMicros() {
  const [feedDecimals, feedRound] = await Promise.all([
    feed.decimals(),
    feed.latestRoundData(),
  ]);
  const ethUsdAnswer = BigInt(feedRound.answer);
  if (ethUsdAnswer <= 0n) throw new Error('Chainlink feed non-positive');
  const FD = 10n ** BigInt(feedDecimals);
  return (ethUsdAnswer * 1_000_000n) / FD;
}

function clamp(v, lo, hi) { if (v < lo) return lo; if (v > hi) return hi; return v; }

async function maybeUpdate(label, currentFn, targetFn, setterFn) {
  const current = BigInt(await currentFn());
  const target = await targetFn();
  if (target === null) return;
  const delta = current === 0n
    ? 1.0
    : Math.abs(Number(target - current)) / Number(current);
  const currentEth = Number(current) / 1e18;
  const targetEth = Number(target) / 1e18;
  console.log(`         ${label}: ${currentEth.toFixed(6)} → ${targetEth.toFixed(6)} ETH (Δ ${(delta*100).toFixed(2)}%)`);
  if (delta < DELTA_THRESHOLD) return;
  if (DRY_RUN) {
    console.log(`         → dry-run, would set ${label} to ${target}`);
    return;
  }
  try {
    const tx = await setterFn(target);
    console.log(`         → ${label} tx ${tx.hash}`);
    await tx.wait(1);
  } catch (e) {
    console.error(`         ✗ ${label} error: ${e.shortMessage || e.message}`);
  }
}

async function tick() {
  const ts = new Date().toISOString();
  let ethUsdMicros, costCents, capCents;
  try {
    [ethUsdMicros, costCents, capCents] = await Promise.all([
      getEthUsdMicros(),
      graveyard.resurrectionCostUsdCents().then(v => BigInt(v)),
      graveyard.resurrectionCapUsdCents().then(v => BigInt(v)),
    ]);
  } catch (e) {
    console.log(`[${ts}] ! read failed: ${e.message}`);
    return;
  }
  if (ethUsdMicros === 0n) {
    console.log(`[${ts}] ! ETH/USD = 0, skipping`);
    return;
  }
  const ethUsdDollars = Number(ethUsdMicros) / 1_000_000;
  const costDollars = Number(costCents) / 100;
  const capDollars = Number(capCents) / 100;
  console.log(`[${ts}] ETH=$${ethUsdDollars.toFixed(2)} | targets: cost=$${costDollars} cap=$${capDollars}`);

  // Targets in ETH wei.
  const costTargetRaw = costCents === 0n ? 0n : (costCents * 10n ** 22n) / ethUsdMicros;
  const capTargetRaw  = capCents === 0n ? 0n : (capCents * 10n ** 22n) / ethUsdMicros;
  const costTarget = clamp(costTargetRaw, MIN_WEI, MAX_WEI);
  const capTarget = clamp(capTargetRaw, MIN_WEI, MAX_WEI);

  await maybeUpdate(
    'resurrectionCost',
    () => graveyard.resurrectionCost(),
    async () => costTarget,
    (v) => graveyard.setResurrectionCost(v, { gasLimit: 100_000n }),
  );
  await maybeUpdate(
    'resurrectionCap',
    () => graveyard.resurrectionCap(),
    async () => capTarget,
    (v) => graveyard.setResurrectionCap(v, { gasLimit: 100_000n }),
  );
}

(async () => {
  await tick();
  setInterval(() => { void tick(); }, POLL_SEC * 1000);
})();
