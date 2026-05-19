#!/usr/bin/env node
/**
 * Post arbitrary text to the BB Telegram group via the leaderboard bot.
 *
 * Companion to post-receipt.mjs (which only handles R1..R10 launch
 * receipt templates). This one takes a file or inline text and fires
 * once. No template substitution. No HTML — plain text only by default.
 *
 * Usage:
 *   node post-text.mjs --file drafts/key-holders-announce.txt
 *   node post-text.mjs --text "GM. just a quick one."
 *   node post-text.mjs --file path.txt --to announce      # default: group
 *   node post-text.mjs --file path.txt --dry-run
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function loadSecrets() {
  const txt = readFileSync(join(homedir(), '.claude', 'secrets', 'secrets.env'), 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}
const flag = (n) => process.argv.includes('--' + n);

const file = arg('file');
const inline = arg('text');
const to = arg('to') || 'group'; // 'group' (default) or 'announce'
const dryRun = flag('dry-run');
const pin = flag('pin'); // call pinChatMessage after posting

if (!file && !inline) {
  console.error('usage: node post-text.mjs --file <path> | --text "<msg>"');
  process.exit(1);
}
const text = (file ? readFileSync(file, 'utf8') : inline).trim();
if (!text) { console.error('empty text — aborting'); process.exit(1); }

const secrets = loadSecrets();
const token = secrets.BB_TG_BOT_LEADERBOARD_TOKEN;
const chatId = to === 'announce' ? secrets.BB_TG_ANNOUNCE_CHANNEL_ID : secrets.BB_TG_PUBLIC_GROUP_ID;
if (!token) { console.error('BB_TG_BOT_LEADERBOARD_TOKEN missing'); process.exit(1); }
if (!chatId) { console.error(`chat id for "${to}" missing in secrets`); process.exit(1); }

console.log(`[tg-post] to=${to} chat=${chatId} dry=${dryRun}`);
console.log('---'); console.log(text); console.log('---');

if (dryRun) { console.log('[tg-post] --dry-run, not posting.'); process.exit(0); }

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  }),
});
const body = await res.json();
if (!body.ok) {
  console.error('[tg-post] FAILED:', body);
  process.exit(1);
}
const msgId = body.result.message_id;
console.log(`[tg-post] posted. message_id=${msgId}`);

if (pin) {
  const pinRes = await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: msgId,
      disable_notification: false,
    }),
  });
  const pinBody = await pinRes.json();
  if (!pinBody.ok) {
    console.error('[tg-post] PIN FAILED:', pinBody);
    process.exit(1);
  }
  console.log(`[tg-post] pinned message_id=${msgId}`);
}
