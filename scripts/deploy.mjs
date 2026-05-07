#!/usr/bin/env node
/**
 * BASEic Brawlers deploy orchestrator.
 *
 * Wraps `forge script Deploy.s.sol` with everything around it that needs to
 * happen for a fresh chain to be live and serving from baseicbrawlers.com:
 * preflight checks, address parsing, env-file sync, Vercel env updates,
 * frontend redeploy, smoke tests, and a markdown deploy report.
 *
 * Phases (run in order by default, individually selectable via --phase):
 *   1. preflight          verify env, balance, RPC, tooling
 *   2. forge-deploy       run forge script Deploy.s.sol --broadcast
 *   3. parse-broadcast    extract addresses from broadcast/run-latest.json
 *   4. update-env-file    write new addresses back into .env.<target>
 *   5. mint-king          mint the 1-of-1 King NFT to the deployer
 *   6. update-vercel      sync NEXT_PUBLIC_*_ADDRESS to Vercel production
 *   7. vercel-deploy      trigger a Vercel production redeploy
 *   8. smoke-test         hit the live API + cast call read-only contract checks
 *   9. report             write a markdown summary of what just happened
 *
 * Usage:
 *   node scripts/deploy.mjs --target sepolia              # full flow
 *   node scripts/deploy.mjs --target sepolia --dry-run    # preflight only
 *   node scripts/deploy.mjs --target mainnet --yes        # skip "are you sure" prompts
 *   node scripts/deploy.mjs --target sepolia --phase smoke-test
 *
 * Targets:
 *   sepolia   chain 84532, reads .env.base-sepolia
 *   mainnet   chain 8453,  reads .env.base-mainnet
 *
 * Output:
 *   logs/deploy-<target>-<timestamp>.log    full transcript
 *   logs/deploy-<target>-<timestamp>.md     markdown report (addresses, tx hashes, smoke results)
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');

// ─── CLI parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
function arg(flag, fallback = null) {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  return args[i + 1] ?? true;
}
function flag(name) {
  return args.includes(name);
}

const TARGET = arg('--target');
const ONE_PHASE = arg('--phase');
const DRY_RUN = flag('--dry-run');
const SKIP_FRONTEND = flag('--skip-frontend');
const YES = flag('--yes');

if (!TARGET || !['sepolia', 'mainnet'].includes(TARGET)) {
  console.error('Usage: node scripts/deploy.mjs --target {sepolia|mainnet} [flags]');
  console.error('See header of scripts/deploy.mjs for full options.');
  process.exit(1);
}

// ─── Target config ───────────────────────────────────────────────────

const TARGETS = {
  sepolia: {
    chainId: 84532,
    chainIdEnv: 'TESTNET_CHAIN_ID',
    rpcEnv: 'TESTNET_RPC',
    envFile: '.env.base-sepolia',
    explorer: 'https://sepolia.basescan.org',
    // Sepolia gas is dirt cheap (~6 mwei) — actual deploy uses ~0.0001 ETH
    // (v11 measured 0.000117). 0.001 still leaves ~10x headroom for spikes
    // and the +10 mints the house-brawler step now adds. Mainnet check
    // (below) stays at 0.2 ETH.
    minDeployerEth: 0.001,
    siteUrl: 'https://baseicbrawlers.com',
    tieredPricing: false,
    usdcEnvKey: 'USDC_ADDRESS_SEPOLIA',
  },
  mainnet: {
    chainId: 8453,
    chainIdEnv: 'MAINNET_CHAIN_ID',
    rpcEnv: 'MAINNET_RPC',
    envFile: '.env.base-mainnet',
    explorer: 'https://basescan.org',
    minDeployerEth: 0.2,
    siteUrl: 'https://baseicbrawlers.com',
    tieredPricing: true,
    usdcEnvKey: 'USDC_ADDRESS_MAINNET',
  },
};
const T = TARGETS[TARGET];

// ─── Logging ─────────────────────────────────────────────────────────

const LOGS_DIR = join(ROOT, 'logs');
if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = join(LOGS_DIR, `deploy-${TARGET}-${STAMP}.log`);
const REPORT_PATH = join(LOGS_DIR, `deploy-${TARGET}-${STAMP}.md`);
const logBuffer = [];

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(line, color = '') {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  logBuffer.push(stamped);
  console.log(color ? `${color}${line}${C.reset}` : line);
}
function header(title) {
  log('');
  log('═'.repeat(70), C.cyan);
  log(`  ${title}`, C.cyan + C.bold);
  log('═'.repeat(70), C.cyan);
}
function ok(msg) { log(`✓ ${msg}`, C.green); }
function warn(msg) { log(`! ${msg}`, C.yellow); }
function fail(msg) { log(`✗ ${msg}`, C.red); }
function flush() {
  writeFileSync(LOG_PATH, logBuffer.join('\n') + '\n', 'utf8');
}
process.on('exit', () => flush());

// ─── Utilities ───────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`, C.dim);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: opts.stdio ?? 'pipe',
    shell: opts.shell ?? false,
  });
  if (r.stdout) logBuffer.push(r.stdout);
  if (r.stderr) logBuffer.push(r.stderr);
  if (r.status !== 0 && !opts.allowFailure) {
    fail(`command failed (exit ${r.status})`);
    if (r.stdout) console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
  return r;
}

/// Spawn cast/forge with a returned stdout. Tolerates mixed-case env paths.
function captureOutput(cmd, args, opts = {}) {
  const r = run(cmd, args, { ...opts, allowFailure: opts.allowFailure ?? false });
  return (r.stdout ?? '').trim();
}

function parseEnvFile(path) {
  if (!existsSync(path)) {
    fail(`env file not found: ${path}`);
    process.exit(1);
  }
  const content = readFileSync(path, 'utf8');
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/// Update specific keys in a `.env`-style file in-place. Preserves comments,
/// blank lines, and ordering. Adds missing keys at the bottom.
function updateEnvFile(path, updates) {
  const content = readFileSync(path, 'utf8');
  const lines = content.split(/\r?\n/);
  const seen = new Set();
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = line.indexOf('=');
    if (eq === -1) return line;
    const key = line.slice(0, eq).trim();
    if (key in updates) {
      seen.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  writeFileSync(path, out.join('\n'), 'utf8');
}

async function confirm(prompt) {
  if (YES) {
    log(`(skipping confirm: ${prompt})`, C.dim);
    return true;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${C.yellow}${prompt} [y/N] ${C.reset}`, (a) => {
      rl.close();
      resolve(a.toLowerCase() === 'y' || a.toLowerCase() === 'yes');
    });
  });
}

// ─── State carried between phases ────────────────────────────────────

const state = {
  target: TARGET,
  chainId: T.chainId,
  envFile: join(ROOT, T.envFile),
  rpc: null,
  deployerKey: null,
  deployerAddr: null,
  signerAddr: null,
  signerKey: null,
  usdcAddr: null,
  preflightOk: false,
  // populated by parse-broadcast
  deployedAt: null,
  txHash: null,
  addresses: {
    BRAWL: null,
    BRAWLERS: null,
    DUEL: null,
    GRAVEYARD: null,
    MINTDROP: null,
    MOCKUSDT: null,
    MARKETPLACE: null, // may be carried over from previous deploy
  },
  kingMinted: false,
  vercelEnvUpdated: false,
  vercelDeployUrl: null,
  smoke: {},
};

// ─── Phase: preflight ────────────────────────────────────────────────

async function phasePreflight() {
  header('1. PREFLIGHT');

  // 1a. Tooling
  const tools = [
    ['forge', ['--version']],
    ['cast', ['--version']],
    ['node', ['--version']],
  ];
  for (const [cmd, a] of tools) {
    try {
      const r = spawnSync(cmd, a, { encoding: 'utf8' });
      if (r.status === 0) ok(`${cmd}: ${(r.stdout || '').split(/\r?\n/)[0]}`);
      else { fail(`${cmd} not found or non-zero exit`); process.exit(1); }
    } catch (e) {
      fail(`${cmd} not on PATH (${e.message})`); process.exit(1);
    }
  }

  // Vercel optional in dry-run
  if (!SKIP_FRONTEND && !DRY_RUN) {
    const r = spawnSync('vercel', ['whoami'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status === 0) ok(`vercel whoami: ${(r.stdout || '').trim()}`);
    else warn('vercel CLI not authed (will skip Vercel phases)');
  }

  // 1b. Env file
  if (!existsSync(state.envFile)) {
    fail(`env file ${T.envFile} does not exist`);
    fail('  copy .env.base-sepolia.example or hand-edit before retrying');
    process.exit(1);
  }
  const env = parseEnvFile(state.envFile);
  const required = ['DEPLOYER_KEY', 'DEPLOYER_ADDRESS', 'SIGNER_ADDRESS', 'SIGNER_KEY', T.rpcEnv];
  for (const k of required) {
    if (!env[k]) { fail(`${T.envFile} missing ${k}`); process.exit(1); }
  }
  state.deployerKey = env.DEPLOYER_KEY;
  state.deployerAddr = env.DEPLOYER_ADDRESS;
  state.signerAddr = env.SIGNER_ADDRESS;
  state.signerKey = env.SIGNER_KEY;
  state.rpc = env[T.rpcEnv];
  state.usdcAddr = env[T.usdcEnvKey];
  ok(`env loaded from ${T.envFile}`);
  ok(`  deployer: ${state.deployerAddr}`);
  ok(`  signer:   ${state.signerAddr}`);
  ok(`  rpc:      ${state.rpc}`);

  // 1c. RPC reachable
  let blockNum;
  try {
    const r = spawnSync('cast', ['block-number', '--rpc-url', state.rpc], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || 'cast block-number failed');
    blockNum = (r.stdout || '').trim();
    ok(`RPC reachable at block ${blockNum}`);
  } catch (e) {
    fail(`RPC unreachable: ${e.message}`); process.exit(1);
  }

  // 1d. ChainId match
  const chainIdOnRpc = captureOutput('cast', ['chain-id', '--rpc-url', state.rpc]);
  if (parseInt(chainIdOnRpc, 10) !== T.chainId) {
    fail(`chainId mismatch: rpc reports ${chainIdOnRpc}, target wants ${T.chainId}`);
    process.exit(1);
  }
  ok(`chainId ${T.chainId} confirmed`);

  // 1e. Deployer balance
  const balWei = captureOutput('cast', ['balance', state.deployerAddr, '--rpc-url', state.rpc]);
  const balEth = Number(BigInt(balWei)) / 1e18;
  if (balEth < T.minDeployerEth) {
    fail(`deployer balance ${balEth.toFixed(4)} ETH < minimum ${T.minDeployerEth} ETH`);
    if (TARGET === 'sepolia') {
      fail(`  fund via https://www.alchemy.com/faucets/base-sepolia or https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet`);
    } else {
      fail(`  bridge ETH to Base mainnet via https://bridge.base.org`);
    }
    process.exit(1);
  }
  ok(`deployer balance: ${balEth.toFixed(4)} ETH (>= ${T.minDeployerEth} required)`);

  // 1f. Build contracts
  log('  building contracts...');
  run('forge', ['build', '--silent']);
  ok('forge build clean');

  // 1g. Run forge tests as a final gate
  log('  running forge test...');
  run('forge', ['test', '--silent']);
  ok('forge test pass');

  // 1h. Mainnet extra confirmations
  if (TARGET === 'mainnet' && !DRY_RUN && !YES) {
    fail('STOP. Mainnet deploy requested.');
    log('  This will broadcast real transactions on Base mainnet (chain 8453).', C.yellow);
    log('  Estimated cost: ~0.05 ETH for the 6-contract deploy + wiring.', C.yellow);
    log('  This is a one-shot operation. Do NOT proceed without:', C.yellow);
    log('    1. The audit-fixes branch merged and tested', C.yellow);
    log('    2. Sepolia v6 deploy verified end-to-end', C.yellow);
    log('    3. LP funding ETH ready in the deployer wallet', C.yellow);
    log('    4. Friends-test on Sepolia complete (rarity dist OK)', C.yellow);
    log('    5. Marketing kit primed and ready to fire', C.yellow);
    if (!(await confirm('Proceed with mainnet deploy?'))) {
      log('aborted by user', C.dim);
      process.exit(0);
    }
    if (!(await confirm('Final confirmation. ARE YOU REALLY SURE?'))) {
      log('aborted by user', C.dim);
      process.exit(0);
    }
  }

  state.preflightOk = true;
  ok('PREFLIGHT PASSED');
}

// ─── Phase: forge-deploy ─────────────────────────────────────────────

async function phaseForgeDeploy() {
  header('2. FORGE DEPLOY');
  if (DRY_RUN) {
    warn('--dry-run set, skipping broadcast');
    return;
  }
  if (!state.preflightOk) {
    fail('preflight did not run, aborting'); process.exit(1);
  }

  // Build the env that Deploy.s.sol reads.
  const deployEnv = {
    PRIVATE_KEY: state.deployerKey,
    SIGNER_ADDRESS: state.signerAddr,
    BRAWL_INITIAL_HOLDER: state.deployerAddr,
    DEV_TREASURY: state.deployerAddr,
    MINT_TREASURY: state.deployerAddr,
    RESURRECT_TREASURY: state.deployerAddr,
    LP_TREASURY: state.deployerAddr,
    MASTER_SEED: '0x2a',
    BASE_URI: `${T.siteUrl}/api/token/`,
  };
  if (state.usdcAddr) deployEnv.USDC_ADDRESS = state.usdcAddr;

  // House brawlers (optional): forward to the forge script so the deploy
  // mints + flags + transfers them in one shot. Defaults to 0 (off). When
  // set, the orchestrator also seeds the dash whitelist via the matching
  // NEXT_PUBLIC_HOUSE_BRAWLER_IDS Vercel env in phase 6.
  if (process.env.HOUSE_BRAWLERS_COUNT) {
    deployEnv.HOUSE_BRAWLERS_COUNT = process.env.HOUSE_BRAWLERS_COUNT;
  }
  if (process.env.HOUSE_KEEPER_ADDRESS) {
    deployEnv.HOUSE_KEEPER_ADDRESS = process.env.HOUSE_KEEPER_ADDRESS;
  }

  if (TARGET === 'mainnet') {
    // Mainnet tokenomics (locked 2026-05-07):
    //   - 100k BRAWL fixed supply: 30k LP / 5k dev / 65k governance treasury
    //   - 0 BRAWL airdropped on mint (replaced by dynamic fight-cost keeper)
    //   - 0% mint ETH/USDC/USDT routed to LP — 100% goes straight to dev treasury
    //   - LP seeded ONCE at launch via SeedAndLockLP.s.sol from deployer wallet
    //   - Founder discount on duels (25%) and free first resurrect retained
    //   - TIERED pricing on mints: $20/$25/$30/$35/$40/$50 across 6 tiers
    //   - Initial fightCost = 100 BRAWL; keeper rebalances every 5min to ~$1 USD
    Object.assign(deployEnv, {
      ETH_MINT_PRICE: '7500000000000000',
      USDT_MINT_PRICE: '30000000',
      USDC_MINT_PRICE: '30000000',
      RESURRECTION_COST: '100000000000000000',
      FIGHT_COST: '100000000000000000000',     // 100 BRAWL initial; keeper retunes
      AIRDROP_PER_MINT: '0',
      FOUNDER_AIRDROP: '0',                    // killed; founders keep duel discount + free resurrect
      LP_SHARE_BPS: '0',                       // mint ETH 100% to dev, 0% to LP
      LP_BRAWL_PER_MINT: '0',                  // no BRAWL pair-on-mint
      TIERED_PRICING: 'true',
    });
  } else {
    // Sepolia: free mints + airdrop on, so testers can play without
    // begging for testnet ETH every session. Mainnet still uses real prices.
    Object.assign(deployEnv, {
      ETH_MINT_PRICE: '0',
      USDT_MINT_PRICE: '0',
      USDC_MINT_PRICE: '0',
      AIRDROP_PER_MINT: '50000000000000000000',
    });
  }

  log('  forge script Deploy.s.sol --broadcast (this can take a minute)...');
  const r = spawnSync(
    'forge',
    [
      'script', 'script/Deploy.s.sol:Deploy',
      '--rpc-url', state.rpc,
      '--broadcast',
      '--chain-id', String(T.chainId),
      '--slow',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...deployEnv },
    },
  );
  if (r.stdout) logBuffer.push(r.stdout);
  if (r.stderr) logBuffer.push(r.stderr);
  if (r.status !== 0) {
    fail(`forge script failed (exit ${r.status})`);
    if (r.stderr) console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
  ok('forge script complete');
}

// ─── Phase: parse-broadcast ──────────────────────────────────────────

function phaseParseBroadcast() {
  header('3. PARSE BROADCAST');
  const broadcastDir = join(ROOT, 'broadcast', 'Deploy.s.sol', String(T.chainId));
  const latestPath = join(broadcastDir, 'run-latest.json');
  if (!existsSync(latestPath)) {
    fail(`no run-latest.json at ${latestPath}`);
    fail('  did forge-deploy run? check logs above');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(latestPath, 'utf8'));
  state.deployedAt = new Date(data.timestamp * 1000).toISOString();

  const wantedNames = ['BRAWL', 'Brawlers', 'Duel', 'Graveyard', 'MintDrop', 'Marketplace', 'MockUSDT'];
  for (const tx of data.transactions ?? []) {
    if (!tx.contractName || !tx.contractAddress) continue;
    if (wantedNames.includes(tx.contractName)) {
      const key = tx.contractName === 'Brawlers' ? 'BRAWLERS'
        : tx.contractName === 'Duel' ? 'DUEL'
        : tx.contractName === 'Graveyard' ? 'GRAVEYARD'
        : tx.contractName === 'MintDrop' ? 'MINTDROP'
        : tx.contractName === 'Marketplace' ? 'MARKETPLACE'
        : tx.contractName === 'MockUSDT' ? 'MOCKUSDT'
        : tx.contractName;
      state.addresses[key] = tx.contractAddress;
      // Best-effort tx hash
      if (!state.txHash && tx.hash) state.txHash = tx.hash;
    }
  }

  for (const k of ['BRAWL', 'BRAWLERS', 'DUEL', 'GRAVEYARD', 'MINTDROP', 'MARKETPLACE']) {
    if (!state.addresses[k]) { fail(`missing ${k} address in broadcast`); process.exit(1); }
    ok(`${k.padEnd(11)} = ${state.addresses[k]}`);
  }
  if (state.addresses.MOCKUSDT) ok(`MOCKUSDT    = ${state.addresses.MOCKUSDT}`);
}

// ─── Phase: update-env-file ──────────────────────────────────────────

function phaseUpdateEnvFile() {
  header('4. UPDATE .env FILE');
  const updates = {
    BRAWL_ADDRESS: state.addresses.BRAWL,
    BRAWLERS_ADDRESS: state.addresses.BRAWLERS,
    DUEL_ADDRESS: state.addresses.DUEL,
    GRAVEYARD_ADDRESS: state.addresses.GRAVEYARD,
    MINTDROP_ADDRESS: state.addresses.MINTDROP,
    MARKETPLACE_ADDRESS: state.addresses.MARKETPLACE,
  };
  if (state.addresses.MOCKUSDT) updates.MOCKUSDT_ADDRESS = state.addresses.MOCKUSDT;
  if (state.usdcAddr) updates.USDC_ADDRESS = state.usdcAddr;
  updateEnvFile(state.envFile, updates);
  ok(`wrote ${Object.keys(updates).length} addresses into ${T.envFile}`);
}

// ─── Phase: mint-king ────────────────────────────────────────────────

async function phaseMintKing() {
  header('5. MINT KING');
  if (DRY_RUN) { warn('--dry-run set, skipping'); return; }
  // mintKing(address) is a one-shot; if already minted, the tx reverts.
  // Check first.
  const minted = captureOutput(
    'cast', ['call', state.addresses.BRAWLERS, 'kingMinted()(bool)', '--rpc-url', state.rpc],
    { allowFailure: true },
  );
  if (minted.startsWith('true')) {
    ok('king already minted, skipping');
    state.kingMinted = true;
    return;
  }
  log('  cast send mintKing...');
  const r = spawnSync(
    'cast', [
      'send',
      state.addresses.BRAWLERS,
      'mintKing(address)',
      state.deployerAddr,
      '--rpc-url', state.rpc,
      '--private-key', state.deployerKey,
    ],
    { encoding: 'utf8' },
  );
  if (r.stdout) logBuffer.push(r.stdout);
  if (r.stderr) logBuffer.push(r.stderr);
  if (r.status !== 0) {
    fail(`mintKing failed (exit ${r.status})`);
    if (r.stderr) console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
  ok('king minted to deployer');
  state.kingMinted = true;
}

// ─── Phase: update-vercel ────────────────────────────────────────────

async function phaseUpdateVercel() {
  header('6. UPDATE VERCEL ENV');
  if (DRY_RUN || SKIP_FRONTEND) { warn('skipping (dry-run or --skip-frontend)'); return; }

  const frontendDir = join(ROOT, 'frontend');

  // If the deploy minted house brawlers, expose their tokenIds to the dash
  // via NEXT_PUBLIC_HOUSE_BRAWLER_IDS so seedHouseWhitelistFromEnv() picks
  // them up on first /api/house/whitelist access. The on-chain
  // isHouseBrawler flag has already been set inside the forge script.
  const houseCount = Number(process.env.HOUSE_BRAWLERS_COUNT ?? 0);
  const houseIds = houseCount > 0
    ? Array.from({ length: houseCount }, (_, i) => i + 1).join(',')
    : '';

  const vercelEnv = {
    NEXT_PUBLIC_BRAWL_ADDRESS: state.addresses.BRAWL,
    NEXT_PUBLIC_BRAWLERS_ADDRESS: state.addresses.BRAWLERS,
    NEXT_PUBLIC_DUEL_ADDRESS: state.addresses.DUEL,
    NEXT_PUBLIC_GRAVEYARD_ADDRESS: state.addresses.GRAVEYARD,
    NEXT_PUBLIC_MINTDROP_ADDRESS: state.addresses.MINTDROP,
    NEXT_PUBLIC_MARKETPLACE_ADDRESS: state.addresses.MARKETPLACE,
    NEXT_PUBLIC_USDT_ADDRESS: state.addresses.MOCKUSDT ?? '',
    NEXT_PUBLIC_USDC_ADDRESS: state.usdcAddr ?? '',
    NEXT_PUBLIC_CHAIN_ID: String(T.chainId),
    NEXT_PUBLIC_RPC_URL: state.rpc,
    NEXT_PUBLIC_HOUSE_BRAWLER_IDS: houseIds,
  };

  for (const [key, val] of Object.entries(vercelEnv)) {
    if (!val) continue;
    log(`  vercel env: ${key}`);
    // remove silently if exists
    spawnSync('vercel', ['env', 'rm', key, 'production', '--yes'], {
      cwd: frontendDir, encoding: 'utf8', shell: process.platform === 'win32',
    });
    // Vercel CLI 52+ requires --value for non-interactive env add; stdin
    // piping no longer works reliably (especially under shell:true on Win32
    // where args get concatenated and the CLI interactive prompt isn't
    // detected). --yes skips the "this looks like a token" sensitive
    // confirmation.
    const r = spawnSync('vercel', ['env', 'add', key, 'production', '--value', String(val), '--yes'], {
      cwd: frontendDir, encoding: 'utf8', shell: process.platform === 'win32',
    });
    if (r.status !== 0) {
      fail(`vercel env add ${key} failed: ${r.stderr ?? ''}`);
      process.exit(1);
    }
  }
  ok(`updated ${Object.keys(vercelEnv).filter((k) => vercelEnv[k]).length} Vercel env vars`);
  state.vercelEnvUpdated = true;
}

// ─── Phase: vercel-deploy ────────────────────────────────────────────

async function phaseVercelDeploy() {
  header('7. VERCEL PRODUCTION DEPLOY');
  if (DRY_RUN || SKIP_FRONTEND) { warn('skipping'); return; }
  const r = spawnSync(
    'vercel', ['deploy', '--prod', '--yes'],
    {
      cwd: join(ROOT, 'frontend'),
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );
  if (r.stdout) logBuffer.push(r.stdout);
  if (r.stderr) logBuffer.push(r.stderr);
  if (r.status !== 0) {
    fail(`vercel deploy failed: ${r.stderr ?? ''}`);
    process.exit(1);
  }
  // Try to find the deployment URL in stderr (Vercel writes status there).
  const stderr = r.stderr ?? '';
  const m = stderr.match(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  if (m) state.vercelDeployUrl = m[0];
  ok(`Vercel deploy complete${state.vercelDeployUrl ? ': ' + state.vercelDeployUrl : ''}`);
}

// ─── Phase: smoke-test ───────────────────────────────────────────────

async function phaseSmokeTest() {
  header('8. SMOKE TEST');
  if (DRY_RUN) { warn('skipping'); return; }
  const checks = [];

  // On-chain reads
  const onchain = [
    { name: 'BRAWL.tradingEnabled', addr: state.addresses.BRAWL, fn: 'tradingEnabled()(bool)' },
    { name: 'Brawlers.nextTokenId', addr: state.addresses.BRAWLERS, fn: 'nextTokenId()(uint32)' },
    { name: 'Brawlers.kingMinted', addr: state.addresses.BRAWLERS, fn: 'kingMinted()(bool)' },
    { name: 'Brawlers.duelContract', addr: state.addresses.BRAWLERS, fn: 'duelContract()(address)' },
    { name: 'Duel.trustedSigner', addr: state.addresses.DUEL, fn: 'trustedSigner()(address)' },
    { name: 'Duel.brawlers', addr: state.addresses.DUEL, fn: 'brawlers()(address)' },
    { name: 'Graveyard.brawlers', addr: state.addresses.GRAVEYARD, fn: 'brawlers()(address)' },
    { name: 'MintDrop.totalSold', addr: state.addresses.MINTDROP, fn: 'totalSold()(uint256)' },
    { name: 'MintDrop.brawlers', addr: state.addresses.MINTDROP, fn: 'brawlers()(address)' },
  ];
  for (const c of onchain) {
    const r = spawnSync('cast', ['call', c.addr, c.fn, '--rpc-url', state.rpc], { encoding: 'utf8' });
    if (r.status !== 0) {
      fail(`${c.name}: cast call failed`);
      checks.push({ name: c.name, ok: false, value: r.stderr ?? '?' });
      continue;
    }
    const value = (r.stdout ?? '').trim();
    ok(`${c.name.padEnd(28)} = ${value}`);
    checks.push({ name: c.name, ok: true, value });
  }

  // Cross-checks
  const ks = (s) => (s ?? '').toLowerCase();
  const brawlersOnDuel = ks(checks.find((c) => c.name === 'Duel.brawlers')?.value);
  if (brawlersOnDuel === ks(state.addresses.BRAWLERS)) {
    ok('Duel <-> Brawlers wiring matches');
  } else {
    fail('Duel.brawlers does not match deployed Brawlers');
  }
  const brawlersOnMintDrop = ks(checks.find((c) => c.name === 'MintDrop.brawlers')?.value);
  if (brawlersOnMintDrop === ks(state.addresses.BRAWLERS)) {
    ok('MintDrop <-> Brawlers wiring matches');
  } else {
    fail('MintDrop.brawlers does not match deployed Brawlers');
  }
  const duelContractOnBrawlers = ks(checks.find((c) => c.name === 'Brawlers.duelContract')?.value);
  if (duelContractOnBrawlers === ks(state.addresses.DUEL)) {
    ok('Brawlers.duelContract <-> Duel wiring matches');
  } else {
    fail('Brawlers.duelContract does not match deployed Duel');
  }

  // HTTP smoke (only if we touched Vercel)
  if (!SKIP_FRONTEND) {
    const httpChecks = [
      { url: `${T.siteUrl}/api/token/2001`, want: '"name":"Brawler #2001' },
      { url: `${T.siteUrl}/api/marketplace/listings`, want: '"ok":true' },
      { url: `${T.siteUrl}/api/history/sync`, want: '"ok":' },
    ];
    for (const c of httpChecks) {
      try {
        // Vercel takes a beat to roll the new deploy through CDN.
        const res = await fetch(c.url, { method: c.url.includes('/sync') ? 'POST' : 'GET' });
        const txt = (await res.text()).slice(0, 400);
        if (res.ok && txt.includes(c.want)) {
          ok(`HTTP ${res.status} ${c.url}`);
          checks.push({ name: c.url, ok: true, value: `${res.status}` });
        } else {
          warn(`HTTP ${res.status} ${c.url} body=${txt}`);
          checks.push({ name: c.url, ok: false, value: `${res.status} ${txt.slice(0, 120)}` });
        }
      } catch (e) {
        fail(`HTTP error ${c.url}: ${e.message}`);
        checks.push({ name: c.url, ok: false, value: e.message });
      }
    }
  }

  state.smoke = checks;
}

// ─── Phase: report ───────────────────────────────────────────────────

function phaseReport() {
  header('9. WRITE REPORT');
  const lines = [];
  lines.push(`# BASEic Brawlers deploy: ${TARGET} (chain ${T.chainId})`);
  lines.push('');
  lines.push(`**Timestamp**: ${new Date().toISOString()}`);
  lines.push(`**Deployer**: \`${state.deployerAddr}\``);
  lines.push(`**Signer**: \`${state.signerAddr}\``);
  lines.push(`**RPC**: ${state.rpc}`);
  lines.push(`**Explorer**: ${T.explorer}`);
  lines.push('');
  lines.push('## Contracts');
  lines.push('');
  lines.push('| Name | Address | Explorer |');
  lines.push('|------|---------|----------|');
  for (const [name, addr] of Object.entries(state.addresses)) {
    if (!addr) continue;
    lines.push(`| ${name} | \`${addr}\` | [view](${T.explorer}/address/${addr}) |`);
  }
  lines.push('');
  lines.push('## Smoke checks');
  lines.push('');
  if (state.smoke && state.smoke.length) {
    lines.push('| Check | Result | Value |');
    lines.push('|-------|--------|-------|');
    for (const c of state.smoke) {
      lines.push(`| ${c.name} | ${c.ok ? '✓' : '✗'} | \`${(c.value ?? '').toString().slice(0, 80)}\` |`);
    }
  } else {
    lines.push('_No smoke results recorded._');
  }
  lines.push('');
  lines.push('## Frontend');
  lines.push('');
  lines.push(`- Vercel env updated: ${state.vercelEnvUpdated ? 'yes' : 'no'}`);
  lines.push(`- Vercel production deploy URL: ${state.vercelDeployUrl ?? '(unknown)'}`);
  lines.push(`- Live site: ${T.siteUrl}`);
  lines.push('');
  lines.push('## What still needs a human');
  lines.push('');
  if (TARGET === 'mainnet') {
    lines.push('- Run `script/SeedAndLockLP.s.sol` to seed BRAWL/ETH on Aerodrome and lock LP on Unicrypt.');
    lines.push('- After 24-48h soak: blacklist obvious bots, then `liftLimits()`, then `renounceOwnership()` on BRAWL.');
    lines.push('- Manually transfer BRAWL allocations: 50k LP, 10k dev, 15k reserve.');
  } else {
    lines.push('- Update `frontend/.env.local` with the new addresses if you run the dev server.');
    lines.push('- Distribute mint links to your test cohort for the 500-mint Sepolia rehearsal.');
  }
  lines.push('');
  lines.push(`Full log: \`${LOG_PATH.replace(ROOT + '\\', '').replace(ROOT + '/', '')}\``);
  writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');
  ok(`report written to ${REPORT_PATH}`);
}

// ─── Phase dispatch ──────────────────────────────────────────────────

const PHASES = [
  ['preflight', phasePreflight],
  ['forge-deploy', phaseForgeDeploy],
  ['parse-broadcast', phaseParseBroadcast],
  ['update-env-file', phaseUpdateEnvFile],
  ['mint-king', phaseMintKing],
  ['update-vercel', phaseUpdateVercel],
  ['vercel-deploy', phaseVercelDeploy],
  ['smoke-test', phaseSmokeTest],
  ['report', phaseReport],
];

(async () => {
  log(`BASEic Brawlers deploy orchestrator`, C.bold);
  log(`target=${TARGET} chainId=${T.chainId} dry-run=${DRY_RUN} skip-frontend=${SKIP_FRONTEND}`);

  if (ONE_PHASE) {
    const phase = PHASES.find(([n]) => n === ONE_PHASE);
    if (!phase) {
      fail(`unknown phase ${ONE_PHASE}. valid: ${PHASES.map(([n]) => n).join(', ')}`);
      process.exit(1);
    }
    // Some single-phase invocations still need preflight to load env into state.
    if (ONE_PHASE !== 'preflight') {
      await phasePreflight();
    }
    // parse-broadcast / update-env-file / mint-king / smoke-test / report
    // depend on addresses being populated. If we skipped forge-deploy, try
    // to load addresses from the env file as a fallback.
    if (['update-env-file', 'mint-king', 'update-vercel', 'vercel-deploy', 'smoke-test', 'report'].includes(ONE_PHASE)) {
      const env = parseEnvFile(state.envFile);
      state.addresses.BRAWL = state.addresses.BRAWL ?? env.BRAWL_ADDRESS;
      state.addresses.BRAWLERS = state.addresses.BRAWLERS ?? env.BRAWLERS_ADDRESS;
      state.addresses.DUEL = state.addresses.DUEL ?? env.DUEL_ADDRESS;
      state.addresses.GRAVEYARD = state.addresses.GRAVEYARD ?? env.GRAVEYARD_ADDRESS;
      state.addresses.MINTDROP = state.addresses.MINTDROP ?? env.MINTDROP_ADDRESS;
      state.addresses.MARKETPLACE = state.addresses.MARKETPLACE ?? env.MARKETPLACE_ADDRESS;
      state.addresses.MOCKUSDT = state.addresses.MOCKUSDT ?? env.MOCKUSDT_ADDRESS;
    }
    await phase[1]();
  } else {
    for (const [name, fn] of PHASES) {
      await fn();
    }
  }

  log('');
  log(`Done. Log: ${LOG_PATH}`, C.green + C.bold);
  log(`      Report: ${REPORT_PATH}`, C.green + C.bold);
})().catch((e) => {
  fail(`unexpected error: ${e?.message ?? e}`);
  if (e?.stack) console.error(e.stack);
  flush();
  process.exit(1);
});
