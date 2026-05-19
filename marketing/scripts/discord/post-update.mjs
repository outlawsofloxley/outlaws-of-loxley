#!/usr/bin/env node
/**
 * Post a free-form text update to a chosen Discord channel via the bot's
 * REST API. Designed for ad-hoc launch/marketing posts that previously got
 * accidentally cross-posted to #duels.
 *
 * HARD-BLOCKED channels (never post here from this script):
 *   - duels, leaderboard, graveyard, marketplace
 *     These are auto-managed by the long-running bot. Posting freeform
 *     text here pollutes the bot's curated feed and confuses members.
 *
 * Default channel: announcements
 *
 * Usage:
 *   node post-update.mjs --file ../../scripts/x/drafts/launch-done.txt
 *   node post-update.mjs --channel general --text "GM. Day 2 of the arena."
 *   node post-update.mjs --channel announcements --file path.txt --ping here
 *   node post-update.mjs --dry-run --channel general --text "..."
 *
 * Requires in ~/.claude/secrets/secrets.env:
 *   BB_DISCORD_BOT_TOKEN   (the same token baseic-discord uses)
 *   BB_DISCORD_GUILD_ID    (guild we operate in)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SECRETS = join(homedir(), '.claude', 'secrets', 'secrets.env');

const BLOCKED = new Set(['duels', 'leaderboard', 'graveyard', 'marketplace']);
const VALID_PINGS = new Set(['none', 'here', 'everyone']);

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  return process.argv[i + 1];
}
function flag(name) { return process.argv.includes('--' + name); }

function loadSecrets() {
  const out = {};
  for (const line of readFileSync(SECRETS, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const channel = (arg('channel', 'announcements') || '').toLowerCase().replace(/^#/, '');
const file = arg('file');
const text = arg('text');
const ping = (arg('ping', 'none') || 'none').toLowerCase();
const dryRun = flag('dry-run');

if (BLOCKED.has(channel)) {
  console.error(`✗ #${channel} is a bot-only event channel. Use #announcements, #general, or another community channel.`);
  console.error(`  Blocked list: ${[...BLOCKED].join(', ')}`);
  process.exit(2);
}
if (!VALID_PINGS.has(ping)) {
  console.error(`✗ --ping must be one of: ${[...VALID_PINGS].join(', ')}`);
  process.exit(2);
}
if (!file && !text) {
  console.error('✗ provide --file <path> or --text "<message>"');
  process.exit(2);
}

let body = text || readFileSync(file, 'utf8').trim();
if (ping === 'here') body = `@here\n\n${body}`;
else if (ping === 'everyone') body = `@everyone\n\n${body}`;

const secrets = loadSecrets();
const token = secrets.BB_DISCORD_BOT_TOKEN;
const guildId = secrets.BB_DISCORD_GUILD_ID;
if (!token) { console.error('✗ BB_DISCORD_BOT_TOKEN missing in secrets.env'); process.exit(1); }
if (!guildId) { console.error('✗ BB_DISCORD_GUILD_ID missing in secrets.env'); process.exit(1); }

console.log(`[discord-post] guild=${guildId} channel=#${channel} ping=${ping} dryRun=${dryRun}`);
console.log('---');
console.log(body);
console.log('---');
if (dryRun) { console.log('[discord-post] --dry-run, not posting.'); process.exit(0); }

// Resolve channel id by name via Discord REST.
const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
const chRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers });
if (!chRes.ok) {
  console.error(`✗ failed to fetch channels: ${chRes.status} ${await chRes.text()}`);
  process.exit(1);
}
const channels = await chRes.json();
const match = channels.find((c) => c.type === 0 && c.name === channel);
if (!match) {
  console.error(`✗ no text channel named #${channel} in guild ${guildId}`);
  process.exit(1);
}

const allowed_mentions = ping === 'none'
  ? { parse: [] }
  : { parse: [ping] };

const sendRes = await fetch(`https://discord.com/api/v10/channels/${match.id}/messages`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ content: body, allowed_mentions }),
});
if (!sendRes.ok) {
  console.error(`✗ post failed: ${sendRes.status} ${await sendRes.text()}`);
  process.exit(1);
}
const sent = await sendRes.json();
console.log(`✓ posted to #${channel} (msg ${sent.id})`);
console.log(`  https://discord.com/channels/${guildId}/${match.id}/${sent.id}`);
