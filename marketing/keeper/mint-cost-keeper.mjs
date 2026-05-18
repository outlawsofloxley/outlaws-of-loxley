#!/usr/bin/env node
/**
 * mint-cost-keeper.mjs — keeps the MintDrop tier ETH prices pegged to USD
 * targets. The USD targets per tier are baked in (matches the launch
 * thread's price ladder); only the wei amount per tier is recomputed each
 * tick to track ETH/USD.
 *
 * Each tick (default 5 min):
 *   1. Read ETH/USD from Chainlink (Base mainnet aggregator).
 *   2. Compute target ETH wei for each tier given its USD target.
 *   3. Read MintDrop.priceTierCount + each tier's current ethPrice.
 *   4. If any tier's drift ≥ DELTA_THRESHOLD, rebuild the full PriceTier[]
 *      array (USDC + USDT amounts stay constant — they're already USD-
 *      denominated) and call MintDrop.setPriceTiers(tiers).
 *
 * Required env (see .env.example):
 *   RPC_URL              https://mainnet.base.org
 *   CHAIN_ID             8453
 *   KEEPER_PRIVATE_KEY   0x... (small ETH balance; needs to be MintDrop owner)
 *   MINTDROP_ADDRESS     0x... (deployed MintDrop)
 *   CHAINLINK_ETH_USD    0x71041dDdAd3595F9CEd3DcCFBe3D1F4b0a16Bb70
 *
 * Optional (defaults shown):
 *   POLL_SEC             600       (10 min — mint prices move slower than fight cost)
 *   DELTA_THRESHOLD      0.05      (5% trigger)
 *   DRY_RUN              false
 *
 * Tier USD targets are HARDCODED to match the launch thread copy:
 *   T1 1-50:     $20
 *   T2 51-100:   $25
 *   T3 101-500:  $30
 *   T4 501-1000: $35
 *   T5 1001-1500:$40
 *   T6 1501-2000:$50
 * If you change these, also update x-launch-thread.md and the mint page copy.
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
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotenv(ENV_PATH);

const RPC_URL = required('RPC_URL');
const CHAIN_ID = Number(required('CHAIN_ID'));
const KEEPER_KEY = required('KEEPER_PRIVATE_KEY');
const MINTDROP = getAddress(required('MINTDROP_ADDRESS'));
const ETH_USD_FEED = getAddress(required('CHAINLINK_ETH_USD'));
const POLL_SEC = Number(process.env.POLL_SEC || '600');
const DELTA_THRESHOLD = Number(process.env.DELTA_THRESHOLD || '0.05');
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`FATAL: env ${name} not set`); process.exit(1); }
  return v;
}

// Canonical USD targets per tier (cents). Index = tier index (0-5).
const TIER_USD_CENTS = [2000, 2500, 3000, 3500, 4000, 5000]; // $20, $25, $30, $35, $40, $50
const TIER_UP_TO_SOLD = [50, 100, 500, 1000, 1500, 2000];
const TIER_USDC_USDT = [20_000_000n, 25_000_000n, 30_000_000n, 35_000_000n, 40_000_000n, 50_000_000n]; // 6-decimal

const MINTDROP_ABI = [
  'function priceTierCount() view returns (uint256)',
  'function priceTiers(uint256) view returns (uint128 upToSold, uint128 ethPrice, uint128 usdcPrice, uint128 usdtPrice)',
  'function setPriceTiers((uint128,uint128,uint128,uint128)[])',
];
const FEED_ABI = [
  'function latestRoundData() view returns (uint80, int256 answer, uint256, uint256, uint80)',
  'function decimals() view returns (uint8)',
];

const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
const keeper = new Wallet(KEEPER_KEY, provider);
const mintDrop = new Contract(MINTDROP, MINTDROP_ABI, keeper);
const feed = new Contract(ETH_USD_FEED, FEED_ABI, provider);

console.log('▶ mint-cost-keeper (USD-pegged tier ETH prices)');
console.log(`  rpc=${RPC_URL} chain=${CHAIN_ID}`);
console.log(`  keeper=${keeper.address}`);
console.log(`  mintdrop=${MINTDROP}`);
console.log(`  tier USD ladder (cents): ${TIER_USD_CENTS.join(', ')}`);
console.log(`  poll=${POLL_SEC}s threshold=${(DELTA_THRESHOLD*100).toFixed(1)}%`);
console.log(`  ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);

async function getEthUsdMicros() {
  const [d, r] = await Promise.all([feed.decimals(), feed.latestRoundData()]);
  const ans = BigInt(r.answer);
  if (ans <= 0n) throw new Error('Chainlink non-positive');
  return (ans * 1_000_000n) / 10n ** BigInt(d);
}

async function tick() {
  const ts = new Date().toISOString();
  let ethUsdMicros, currentTiers, count;
  try {
    ethUsdMicros = await getEthUsdMicros();
    count = Number(await mintDrop.priceTierCount());
    currentTiers = await Promise.all(
      Array.from({ length: count }, (_, i) => mintDrop.priceTiers(i)),
    );
  } catch (e) {
    console.log(`[${ts}] ! read failed: ${e.message}`);
    return;
  }
  if (count !== TIER_USD_CENTS.length) {
    console.log(`[${ts}] ! priceTierCount=${count} but expected ${TIER_USD_CENTS.length}; skipping (table shape mismatch)`);
    return;
  }
  const ethUsdDollars = Number(ethUsdMicros) / 1_000_000;
  console.log(`[${ts}] ETH=$${ethUsdDollars.toFixed(2)}`);

  // target_eth_wei = usdCents × 1e22 / ethUsdMicros (same arithmetic as fight-cost-keeper)
  const targetWei = TIER_USD_CENTS.map(c => (BigInt(c) * 10n ** 22n) / ethUsdMicros);
  let anyDrift = false;
  const newTiers = [];
  for (let i = 0; i < count; i++) {
    const current = BigInt(currentTiers[i].ethPrice);
    const target = targetWei[i];
    const delta = current === 0n ? 1.0 : Math.abs(Number(target - current)) / Number(current);
    const tag = delta >= DELTA_THRESHOLD ? '*' : ' ';
    console.log(`         T${i+1} $${TIER_USD_CENTS[i]/100} ${tag} ${Number(current)/1e18} → ${Number(target)/1e18} ETH (Δ ${(delta*100).toFixed(2)}%)`);
    if (delta >= DELTA_THRESHOLD) anyDrift = true;
    newTiers.push([
      BigInt(TIER_UP_TO_SOLD[i]),
      target,
      TIER_USDC_USDT[i],
      TIER_USDC_USDT[i],
    ]);
  }
  if (!anyDrift) {
    console.log(`         → all within threshold, no update`);
    return;
  }
  if (DRY_RUN) {
    console.log(`         → would call setPriceTiers (${count} tiers)`);
    return;
  }
  try {
    const tx = await mintDrop.setPriceTiers(newTiers, { gasLimit: 500_000n });
    console.log(`         → setPriceTiers submitted: ${tx.hash}`);
    const rc = await tx.wait(1);
    console.log(`         → confirmed block ${rc.blockNumber} (gas ${rc.gasUsed})`);
  } catch (e) {
    console.error(`         ✗ tx error: ${e.shortMessage || e.message}`);
  }
}

(async () => {
  await tick();
  setInterval(() => { void tick(); }, POLL_SEC * 1000);
})();
