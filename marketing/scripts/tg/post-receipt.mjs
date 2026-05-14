// Post one of the R1..R10 launch receipts to Telegram via the bot API.
//
// Usage mirrors marketing/scripts/x/post-receipt.mjs:
//   node post-receipt.mjs R4 --var BRAWL_IN_LP=30000 --var ETH_IN_LP=0.5 \
//                            --var PAIR_ADDRESS=0xabc... --var TX_HASH=0xdef...
//   node post-receipt.mjs R1 --dry-run
//
// Target: BB_TG_ANNOUNCE_CHANNEL_ID if set, else BB_TG_PUBLIC_GROUP_ID.
// Uses BB_TG_BOT_LEADERBOARD_TOKEN as the sender (least personality-tied
// of the three project bots — happy to swap to a dedicated bot later).
//
// Telegram Bot API: https://core.telegram.org/bots/api#sendmessage
// We disable web preview to keep multi-link receipts compact, and use
// HTML parse_mode so {{LOCK_URL}} etc. render as clickable links.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', '..', 'content', 'launch-receipts');
const SECRETS_PATH = join(homedir(), '.claude', 'secrets', 'secrets.env');

function loadSecrets() {
  const txt = readFileSync(SECRETS_PATH, 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

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
  console.error('usage: node post-receipt.mjs R<1..10> --var KEY=VALUE [--dry-run]');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');

const files = readdirSync(TEMPLATES_DIR).filter((f) => f.startsWith(receipt + '-') && f.endsWith('.txt'));
if (files.length !== 1) {
  console.error(`expected exactly 1 template matching ${receipt}-*.txt in ${TEMPLATES_DIR}`);
  process.exit(1);
}
let text = readFileSync(join(TEMPLATES_DIR, files[0]), 'utf8').trim();

const vars = {};
const jsonArg = arg('vars-json');
if (jsonArg) Object.assign(vars, JSON.parse(jsonArg));
for (const kv of allArgs('var')) {
  const eq = kv.indexOf('=');
  if (eq <= 0) { console.error(`bad --var '${kv}'`); process.exit(1); }
  vars[kv.slice(0, eq)] = kv.slice(eq + 1);
}

text = text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => {
  if (!(k in vars)) {
    console.error(`missing --var ${k}=... (template ${files[0]} requires it)`);
    process.exit(1);
  }
  return vars[k];
});

const secrets = loadSecrets();
const botToken = secrets.BB_TG_BOT_LEADERBOARD_TOKEN;
const chatId = secrets.BB_TG_ANNOUNCE_CHANNEL_ID || secrets.BB_TG_PUBLIC_GROUP_ID;
if (!botToken) { console.error('BB_TG_BOT_LEADERBOARD_TOKEN missing'); process.exit(1); }
if (!chatId) { console.error('BB_TG_ANNOUNCE_CHANNEL_ID or BB_TG_PUBLIC_GROUP_ID required'); process.exit(1); }

console.log(`[tg-receipt] ${receipt} -> ${files[0]}`);
console.log(`[tg-receipt] target chat: ${chatId}`);
console.log('---');
console.log(text);
console.log('---');

if (dryRun) {
  console.log('[tg-receipt] --dry-run, not posting.');
  process.exit(0);
}

// Send via Telegram Bot API.
const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }),
});
const body = await res.json();
if (!body.ok) {
  console.error('[tg-receipt] FAILED:', body);
  process.exit(1);
}
console.log(`[tg-receipt] posted. message_id=${body.result.message_id}`);
