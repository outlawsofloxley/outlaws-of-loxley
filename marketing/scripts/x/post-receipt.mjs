// Fire one of the R1..R10 launch receipts to @BASEicBrawlers.
//
// Usage:
//   node post-receipt.mjs R4 --var BRAWL_IN_LP=30000 --var ETH_IN_LP=0.5 \
//                            --var PAIR_ADDRESS=0xabc... --var TX_HASH=0xdef...
//
//   node post-receipt.mjs R1 --vars-json '{"BRAWL_ADDRESS":"0x...","TX_HASH":"0x..."}'
//
//   node post-receipt.mjs R7 --dry-run     # preview without posting
//
// Templates live in ../../content/launch-receipts/R{1..10}-*.txt with
// {{VARNAME}} placeholders. Unsubstituted placeholders cause an error so
// you can't accidentally post a half-templated tweet.
//
// Hands the final text + optional image off to tweet.mjs.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', '..', 'content', 'launch-receipts');

function arg(name) {
  const idx = process.argv.indexOf('--' + name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function allArgs(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--' + name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

const receipt = process.argv[2];
if (!receipt || !/^R(10|[1-9])$/.test(receipt)) {
  console.error('usage: node post-receipt.mjs R<1..10> --var KEY=VALUE [--var ...] [--image path] [--dry-run]');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');
const imageArg = arg('image');

// Resolve template file: TEMPLATES_DIR/R{N}-*.txt
const files = readdirSync(TEMPLATES_DIR).filter((f) => f.startsWith(receipt + '-') && f.endsWith('.txt'));
if (files.length !== 1) {
  console.error(`expected exactly 1 template matching ${receipt}-*.txt in ${TEMPLATES_DIR}, found ${files.length}`);
  process.exit(1);
}
const templatePath = join(TEMPLATES_DIR, files[0]);
let text = readFileSync(templatePath, 'utf8');

// Collect vars from --var KEY=VALUE pairs and --vars-json '{...}'.
const vars = {};
const jsonArg = arg('vars-json');
if (jsonArg) Object.assign(vars, JSON.parse(jsonArg));
for (const kv of allArgs('var')) {
  const eq = kv.indexOf('=');
  if (eq <= 0) {
    console.error(`bad --var '${kv}' (expected KEY=VALUE)`);
    process.exit(1);
  }
  vars[kv.slice(0, eq)] = kv.slice(eq + 1);
}

// Substitute. Pre-trim text (template files have a trailing newline).
text = text.trim();
text = text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => {
  if (!(k in vars)) {
    console.error(`missing --var ${k}=... (template ${files[0]} requires it)`);
    process.exit(1);
  }
  return vars[k];
});

console.log(`[receipt] ${receipt} -> ${files[0]}`);
console.log(`[receipt] ${text.length} chars`);
console.log('---');
console.log(text);
console.log('---');

if (dryRun) {
  console.log('[receipt] --dry-run, not posting.');
  process.exit(0);
}

// Delegate to tweet.mjs. We pass text via env so spaces/newlines survive cleanly.
const tweetScript = join(__dirname, 'tweet.mjs');
const env = { ...process.env, RECEIPT_TEXT: text };
const args = ['--text', text];
if (imageArg) args.push('--image', imageArg);

const result = spawnSync('node', [tweetScript, ...args], { env, stdio: 'inherit' });
if (result.status !== 0) {
  console.error('[receipt] tweet.mjs failed with exit code', result.status);
  process.exit(result.status ?? 1);
}
