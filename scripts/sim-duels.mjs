#!/usr/bin/env node
/**
 * sim-duels.mjs — broadcast end-to-end pipeline test:
 *   1. Mint N brawlers from deployer (so the fighter pool is wider than 2)
 *   2. Run M duels by:
 *        a. Hitting prod /api/run-duel for an EIP-712-signed result
 *        b. Submitting Duel.submitDuel(result, sig) from deployer wallet
 *   3. Trigger /api/history/sync to index events into Postgres
 *   4. Confirm v6-era row count went up
 *
 * Usage:
 *   node scripts/sim-duels.mjs --mints 6 --duels 50
 *   node scripts/sim-duels.mjs --duels 5     # smoke run
 */
import { readFileSync } from 'node:fs';
import { JsonRpcProvider, Wallet, Contract, getAddress, parseUnits } from 'ethers';

// ---------- env ----------
function loadEnv(path) {
  const raw = readFileSync(path, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv(new URL('../.env.base-sepolia', import.meta.url));

const RPC = 'https://base-sepolia-rpc.publicnode.com';
const CHAIN_ID = Number(env.TESTNET_CHAIN_ID || 84532);
const BRAWLERS = getAddress(env.BRAWLERS_ADDRESS);
const DUEL = getAddress(env.DUEL_ADDRESS);
const MINTDROP = getAddress(env.MINTDROP_ADDRESS);
const BRAWL = getAddress(env.BRAWL_ADDRESS);
const SITE = process.env.SITE || 'https://baseicbrawlers.com';

// ---------- args ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const N_MINTS = Number(args.mints ?? 6);
const N_DUELS = Number(args.duels ?? 50);

// ---------- ABIs (minimal slices) ----------
const BRAWLERS_ABI = [
  'function getBrawler(uint256) view returns (uint8 strength,uint8 dexterity,uint8 constitution,uint8 intelligence,uint8 wisdom,uint8 charisma,uint16 weaponId,uint16 level,uint32 xp,uint32 elo,uint32 wins,uint32 losses,uint32 ties,bool isDead,string name)',
  'function ownerOf(uint256) view returns (address)',
];
const DUEL_ABI = [
  'function submitDuel((uint256 tokenA,uint256 tokenB,uint32 winnerId,uint16 rounds,uint256 seed,uint32 newEloA,uint32 newEloB,uint256 nonce,uint256 expiry) result, bytes signature)',
  'event DuelCompleted(uint256 indexed tokenA,uint256 indexed tokenB,uint32 winnerId,uint16 rounds,uint256 seed,uint256 nonce,uint32 newEloA,uint32 newEloB)',
  'event BrawlerDied(uint256 indexed tokenId)',
];
const MINTDROP_ABI = [
  'function mintWithETH(address to) payable returns (uint256 tokenId)',
  'function priceForMint(uint256) view returns (uint256 eth, uint256 usdc, uint256 usdt)',
  'function totalSold() view returns (uint256)',
];
const BRAWL_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// ---------- helpers ----------
function rand(n) { return Math.floor(Math.random() * n); }
function pickPair(pool) {
  const a = pool[rand(pool.length)];
  let b = pool[rand(pool.length)];
  let g = 0;
  while (b === a && g++ < 10) b = pool[rand(pool.length)];
  return [a, b];
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`▶ sim-duels: ${N_MINTS} mints + ${N_DUELS} duels`);
  console.log(`  chain ${CHAIN_ID}, RPC ${RPC}`);
  console.log(`  BRAWLERS ${BRAWLERS}`);
  console.log(`  DUEL     ${DUEL}`);
  console.log(`  MINTDROP ${MINTDROP}`);
  console.log(`  Site     ${SITE}`);

  const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const deployer = new Wallet(env.DEPLOYER_KEY, provider);
  console.log(`  deployer ${deployer.address}`);

  const brawlers = new Contract(BRAWLERS, BRAWLERS_ABI, deployer);
  const duel = new Contract(DUEL, DUEL_ABI, deployer);
  const mintDrop = new Contract(MINTDROP, MINTDROP_ABI, deployer);
  const brawl = new Contract(BRAWL, BRAWL_ABI, deployer);

  // ---------- step 0: approve BRAWL for Duel ----------
  const allowance = await brawl.allowance(deployer.address, DUEL);
  const MIN_ALLOWANCE = 100_000n * 10n ** 18n; // 100k BRAWL — buffer for thousands of fights
  if (allowance < MIN_ALLOWANCE) {
    console.log(`\n▶ BRAWL approval — allowance ${allowance} < ${MIN_ALLOWANCE}, approving max...`);
    const tx = await brawl.approve(DUEL, (1n << 256n) - 1n);
    await tx.wait(1);
    console.log(`  ✓ ${tx.hash}`);
  } else {
    console.log(`\n▶ BRAWL approval — already set (${allowance})`);
  }

  // ---------- step 1: mint ----------
  if (N_MINTS > 0) {
    const startSold = await mintDrop.totalSold();
    console.log(`\n▶ MINT phase — current totalSold=${startSold}`);
    for (let i = 0; i < N_MINTS; i++) {
      const next = Number(startSold) + i + 1;
      const [eth] = await mintDrop.priceForMint(next);
      console.log(`  mint #${i + 1}/${N_MINTS} (token-slot ${next}, cost ${eth} wei)`);
      // Explicit gasLimit — ethers v6 sometimes underestimates these mints.
      // 500k headroom comfortably covers the ~285k actual usage + buffer.
      const tx = await mintDrop.mintWithETH(deployer.address, { value: eth, gasLimit: 500_000n });
      const rc = await tx.wait(1);
      console.log(`    ✓ ${tx.hash} block ${rc.blockNumber}`);
    }
    const endSold = await mintDrop.totalSold();
    console.log(`  ✓ mint phase done. totalSold ${startSold} → ${endSold}`);
  }

  // ---------- step 2: build alive pool ----------
  const KING = 2001;
  const candidates = [];
  for (let id = 1; id <= 200; id++) {
    try {
      const owner = await brawlers.ownerOf(id);
      if (owner.toLowerCase() === deployer.address.toLowerCase()) candidates.push(id);
    } catch { break; }
  }
  // exclude King from duel pool (1-of-1, weird ELO)
  let alive = [];
  for (const id of candidates) {
    if (id === KING) continue;
    const b = await brawlers.getBrawler(id);
    if (!b.isDead) alive.push(id);
  }
  console.log(`\n▶ ALIVE POOL: ${alive.join(', ')} (${alive.length} fighters, King excluded)`);
  if (alive.length < 2) {
    console.error('Not enough alive brawlers to duel. Bump --mints.');
    process.exit(1);
  }

  // ---------- step 3: duels ----------
  console.log(`\n▶ DUEL phase — ${N_DUELS} fights`);
  let okCount = 0, errCount = 0, deathCount = 0;
  const txHashes = [];

  for (let i = 0; i < N_DUELS; i++) {
    if (alive.length < 2) {
      console.warn(`  ! pool exhausted at fight ${i + 1}, stopping early`);
      break;
    }
    const [a, b] = pickPair(alive);
    process.stdout.write(`  fight ${String(i + 1).padStart(2, ' ')}/${N_DUELS}: #${a} vs #${b} ... `);

    let signed;
    try {
      const res = await fetch(`${SITE}/api/run-duel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenA: a, tokenB: b }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.log(`run-duel HTTP ${res.status}: ${text.slice(0, 200)}`);
        errCount++;
        continue;
      }
      signed = await res.json();
    } catch (e) {
      console.log(`run-duel fetch error: ${e.message}`);
      errCount++;
      continue;
    }

    // Convert string bigints back
    const result = {
      tokenA: BigInt(signed.result.tokenA),
      tokenB: BigInt(signed.result.tokenB),
      winnerId: signed.result.winnerId,
      rounds: signed.result.rounds,
      seed: BigInt(signed.result.seed),
      newEloA: signed.result.newEloA,
      newEloB: signed.result.newEloB,
      nonce: BigInt(signed.result.nonce),
      expiry: BigInt(signed.result.expiry),
    };

    try {
      // Explicit gasLimit — submitDuel can swing wide on round count + deaths.
      const tx = await duel.submitDuel(result, signed.signature, { gasLimit: 700_000n });
      const rc = await tx.wait(1);
      txHashes.push(tx.hash);

      // Inspect events for deaths
      const dead = [];
      for (const log of rc.logs) {
        try {
          const parsed = duel.interface.parseLog(log);
          if (parsed?.name === 'BrawlerDied') dead.push(Number(parsed.args[0]));
        } catch { /* not our event */ }
      }
      if (dead.length) {
        deathCount += dead.length;
        alive = alive.filter(id => !dead.includes(id));
      }
      const verdict = signed.winnerId === null ? 'TIE' : `winner=#${signed.winnerId}`;
      const deathTag = dead.length ? ` 💀 #${dead.join(', #')}` : '';
      console.log(`✓ ${verdict} (${signed.rounds}r)${deathTag}`);
      okCount++;
    } catch (e) {
      console.log(`submit error: ${(e.shortMessage || e.message || '').slice(0, 200)}`);
      errCount++;
    }

    // Tiny pacing breath so RPC + Postgres-syncer both stay healthy.
    await sleep(150);
  }

  console.log(`\n▶ DUEL summary: ${okCount} ok, ${errCount} errors, ${deathCount} deaths`);
  console.log(`  alive after: ${alive.join(', ') || '(none)'}`);

  // ---------- step 4: trigger sync ----------
  console.log(`\n▶ Trigger /api/history/sync (may take 10-20s)...`);
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`${SITE}/api/history/sync`, { method: 'POST' });
      const j = await r.json();
      console.log(`  sync attempt ${i + 1}: ok=${j.ok} synced=${j.synced ?? false} events=${j.eventsInserted ?? 0} fullyCaughtUp=${j.fullyCaughtUp ?? false} lastBlock=${j.lastBlock ?? '?'}`);
      if (j.fullyCaughtUp) break;
    } catch (e) {
      console.log(`  sync error: ${e.message}`);
    }
    await sleep(2000);
  }

  // ---------- step 5: verify ----------
  console.log(`\n▶ Verify v6-era row count...`);
  const r = await fetch(`${SITE}/api/history/query?limit=200`);
  const j = await r.json();
  const rows = j.rows || [];
  const v6 = rows.filter(x => Number(x.block_number) >= 40889595 && Number(x.block_number) < 90000000);
  console.log(`  total rows: ${rows.length}`);
  console.log(`  v6-era rows (Discord-bot visible): ${v6.length}`);

  console.log('\n✓ done.');
  console.log(`  Last 5 tx hashes:\n    ${txHashes.slice(-5).join('\n    ')}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
