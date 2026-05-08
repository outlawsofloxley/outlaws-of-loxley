#!/usr/bin/env node
/**
 * BASEic Brawlers — long-running Discord bot.
 *
 * Responsibilities:
 *   1. Verification gate. ⚔ on the welcome message in #verify → grant the
 *      Verified role.
 *   2. Welcome DM. New member joins → DM them how to verify.
 *   3. Duel watcher. Polls the live duel-history API and posts rich embeds
 *      with brawler names, weapons, ratings, and PNG portraits to
 *      #duels in real time.
 *   4. Leaderboard digest. Posts a top-10 ranked-by-Rating summary to
 *      #leaderboard on an interval (default 24h, and once on startup if
 *      LEADERBOARD_ON_STARTUP=true).
 *
 * Required env: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID
 *
 * Optional env (with defaults):
 *   BRAWLERS_API_BASE          https://baseicbrawlers.com
 *   BASESCAN_TX_BASE           https://sepolia.basescan.org/tx/
 *   DUEL_POLL_SEC              60
 *   LEADERBOARD_INTERVAL_HOURS 24
 *   LEADERBOARD_ON_STARTUP     false
 *   DUEL_BACKFILL_COUNT        0
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  Client, GatewayIntentBits, Partials, Events, EmbedBuilder, AttachmentBuilder,
  SlashCommandBuilder, PermissionFlagsBits,
} from 'discord.js';
import { Resvg } from '@resvg/resvg-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(HERE, 'template.json');
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

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const API_BASE = process.env.BRAWLERS_API_BASE || 'https://baseicbrawlers.com';
const TX_BASE = process.env.BASESCAN_TX_BASE || 'https://sepolia.basescan.org/tx/';
const DUEL_POLL_SEC = Number(process.env.DUEL_POLL_SEC || '60');
// Marketplace watcher — reads Sold events directly from chain via JSON-RPC.
// Set MARKETPLACE_ADDRESS + RPC_URL on launch day to enable.
const MARKETPLACE_ADDRESS = (process.env.MARKETPLACE_ADDRESS || '').toLowerCase();
const RPC_URL = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const MARKETPLACE_POLL_SEC = Number(process.env.MARKETPLACE_POLL_SEC || '60');
const MARKETPLACE_CHANNEL = process.env.MARKETPLACE_CHANNEL || 'marketplace';
const LEADERBOARD_INTERVAL_HOURS = Number(process.env.LEADERBOARD_INTERVAL_HOURS || '24');
const LEADERBOARD_ON_STARTUP = /^(1|true|yes)$/i.test(process.env.LEADERBOARD_ON_STARTUP || '');
const DUEL_BACKFILL_COUNT = Math.max(0, Number(process.env.DUEL_BACKFILL_COUNT || '0'));
// The duel-history DB carries rows from previous contract eras whose
// token IDs collide with v6 IDs but reference different brawlers. Filter
// to the block-range of the v6 Duel contract.
//   DUEL_BLOCK_MIN — v6 Duel contract deploy block on Base Sepolia
//                    (0x09ac227a…d4df, block 40,889,595)
//   DUEL_BLOCK_MAX — upper guard against rows from other chains whose
//                    block numbers exceed Base Sepolia's head (e.g.
//                    BSC-Testnet rows at ~103M).
const DUEL_BLOCK_MIN = Number(process.env.DUEL_BLOCK_MIN || '40889595');
// Default high enough to cover Base Sepolia for years; override per-deploy
// when migrating chains (e.g. mainnet) so legacy testnet rows can't bleed in.
const DUEL_BLOCK_MAX = Number(process.env.DUEL_BLOCK_MAX || '999999999');
// Auto-repost the leaderboard when the top-N has materially changed.
// Throttled by LEADERBOARD_MIN_INTERVAL_MIN so a busy night can't spam.
const LEADERBOARD_AUTO_UPDATE = /^(1|true|yes)$/i.test(process.env.LEADERBOARD_AUTO_UPDATE || '');
const LEADERBOARD_MIN_INTERVAL_MIN = Math.max(1, Number(process.env.LEADERBOARD_MIN_INTERVAL_MIN || '30'));
// Top-N depth that defines a "material change" — only top-K positions
// trigger a repost, so a duel that only shuffles ranks 8/9 stays quiet.
const LEADERBOARD_FP_DEPTH = Math.max(1, Number(process.env.LEADERBOARD_FP_DEPTH || '5'));
// On boot, run refreshPins() once — useful when message files change on disk
// and you want the channel content auto-synced without typing /refresh-pins.
const REFRESH_PINS_ON_STARTUP = /^(1|true|yes)$/i.test(process.env.REFRESH_PINS_ON_STARTUP || '');
// On boot, scan the latest 200 duels and post any death notifications for
// currently-dead brawlers. Useful one-shot after wiring the graveyard
// channel for the first time.
const BACKFILL_DEATHS_ON_STARTUP = /^(1|true|yes)$/i.test(process.env.BACKFILL_DEATHS_ON_STARTUP || '');
// On boot, delete the bot's own messages from #graveyard before running
// backfill. Useful when an earlier run double-posted and you want a clean
// graveyard. Only deletes messages authored by THIS bot.
const WIPE_GRAVEYARD_ON_STARTUP = /^(1|true|yes)$/i.test(process.env.WIPE_GRAVEYARD_ON_STARTUP || '');

if (!TOKEN) { console.error('FATAL: DISCORD_BOT_TOKEN not set.'); process.exit(1); }
if (!GUILD_ID) { console.error('FATAL: DISCORD_GUILD_ID not set.'); process.exit(1); }

const tpl = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
const VERIFY_CHANNEL = tpl.verification?.channel || 'verify';
const VERIFY_EMOJI = tpl.verification?.reaction || '⚔️';
const VERIFIED_ROLE = tpl.verification?.grantsRole || 'Verified';
const RULES_CHANNEL = tpl.guildPointers?.rulesChannel || 'rules';
// #duels = bot-only auto-posts of duel outcomes (admin posting locked).
// `DUELS_CHANNEL` is the legacy env name — kept as a fallback so existing
// deploys don't break, but new envs should use `DUELS_CHANNEL`.
const DUELS_CHANNEL = process.env.DUELS_CHANNEL || process.env.DUELS_CHANNEL || 'duels';
const LEADERBOARD_CHANNEL = process.env.LEADERBOARD_CHANNEL || 'leaderboard';
const GRAVEYARD_CHANNEL = process.env.GRAVEYARD_CHANNEL || 'graveyard';

// Rarity → embed-bar colour. Mirrors frontend's rarity palette so the
// Discord visuals match the in-app card colours.
const RARITY_COLOR = {
  Common: 0x9a9a9a,
  Uncommon: 0x4a9eff,
  Rare: 0xb866e8,
  Legendary: 0xf5a623,
  Epic: 0xe6c200,
  King: 0x4bc9d4,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Reaction, Partials.Message, Partials.Channel, Partials.User],
});

let verifyChannelId = null;
let verifiedRoleId = null;
let rulesChannelId = null;
let duelsChannelId = null;
let leaderboardChannelId = null;
let graveyardChannelId = null;
let marketplaceChannelId = null;
const seenDuelKeys = new Set();
// Death dedup is by tokenId only — a brawler dies once. If they later
// resurrect (returns to Alive), we drop the entry so a future death posts.
const seenDeathTokens = new Set();
// Marketplace sales dedup by tx_hash:log_index.
const seenSaleKeys = new Set();
let marketplaceLastBlock = null;
function duelKey(d) { return `${d.tx_hash}:${d.log_index}`; }

// Leaderboard repost tracking — fingerprint of the top-N positions and
// the last-post timestamp drive the auto-update path. Slash command
// bypasses the throttle.
let lastLeaderboardFingerprint = null;
let lastLeaderboardPostAt = 0;
function leaderboardFingerprint(ranked) {
  return ranked
    .slice(0, LEADERBOARD_FP_DEPTH)
    .map(s => `${s.tokenId}:${s.elo}:${s.wins}:${s.losses}`)
    .join('|');
}

// ─── chain-data helpers ──────────────────────────────────────────
// Cache shape: tokenId → { meta, png, at }. TTL is short because brawlers
// die / revive / win duels and the metadata changes.
const TOKEN_CACHE = new Map();
const TOKEN_CACHE_TTL_MS = 60_000;

async function getMetadata(tokenId) {
  const hit = TOKEN_CACHE.get(tokenId);
  if (hit && hit.meta && Date.now() - hit.at < TOKEN_CACHE_TTL_MS) return hit.meta;
  try {
    const res = await fetch(`${API_BASE}/api/token/${tokenId}`, {
      headers: { 'User-Agent': 'BaseicBrawlersBot/1.0' },
    });
    if (!res.ok) return null;
    const meta = await res.json();
    if (meta?.error) return null;
    TOKEN_CACHE.set(tokenId, { ...(hit || {}), meta, at: Date.now() });
    return meta;
  } catch {
    return null;
  }
}

async function getPortraitPng(tokenId) {
  const hit = TOKEN_CACHE.get(tokenId);
  if (hit && hit.png && Date.now() - hit.at < TOKEN_CACHE_TTL_MS) return hit.png;
  try {
    const res = await fetch(`${API_BASE}/api/token/${tokenId}/image`, {
      headers: { 'User-Agent': 'BaseicBrawlersBot/1.0' },
    });
    if (!res.ok) return null;
    const svg = await res.text();
    // Render at 256px; small file (~5-15 KB), looks crisp as a Discord
    // thumbnail (default 80px) and as a non-stretched embed image.
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 256 },
      background: '#0d0d0f',
    });
    const png = resvg.render().asPng();
    TOKEN_CACHE.set(tokenId, { ...(hit || {}), png, at: Date.now() });
    return png;
  } catch (e) {
    console.error(`portrait #${tokenId} render error:`, e.message);
    return null;
  }
}

function extractFromMeta(meta, fallbackId) {
  if (!meta) {
    return {
      name: `Brawler #${fallbackId}`,
      shortName: `#${fallbackId}`,
      weapon: 'Unknown',
      weaponType: '',
      rarity: 'Common',
      status: 'Alive',
      tokenId: fallbackId,
    };
  }
  // "Brawler #1, Hank Thorn" → "Hank Thorn"
  const m = /^Brawler #\d+,\s*(.+)$/.exec(meta.name || '');
  const shortName = m ? m[1] : meta.name || `Brawler #${fallbackId}`;
  const attrMap = Object.fromEntries(
    (meta.attributes || []).map((a) => [a.trait_type, a.value]),
  );
  return {
    name: meta.name || `Brawler #${fallbackId}`,
    shortName,
    weapon: attrMap.Weapon || 'Unknown',
    weaponType: attrMap['Weapon Type'] || '',
    rarity: attrMap.Rarity || 'Common',
    status: attrMap.Status || 'Alive',
    tokenId: fallbackId,
  };
}

function rarityColor(name) {
  return RARITY_COLOR[name] ?? RARITY_COLOR.Common;
}

function weaponEmoji(type) {
  switch ((type || '').toLowerCase()) {
    case 'blade': return '🗡️';
    case 'blunt': return '🔨';
    case 'ranged': return '🔫';
    default: return '⚔️';
  }
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

// ─── verification ────────────────────────────────────────────────
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (!verifyChannelId || !verifiedRoleId) return;
    if (reaction.message.channelId !== verifyChannelId) return;
    if (reaction.emoji.name !== VERIFY_EMOJI && reaction.emoji.name !== VERIFY_EMOJI.replace(/️/g, '')) return;

    const guild = reaction.message.guild;
    if (!guild || guild.id !== GUILD_ID) return;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member || member.roles.cache.has(verifiedRoleId)) return;

    await member.roles.add(verifiedRoleId, 'Verification reaction in #verify');
    console.log(`+ verified ${member.user.tag} (${member.id})`);
    member.send(
      `You're verified in **${guild.name}** — welcome to the arena. Head to <#${
        rulesChannelId || verifyChannelId
      }> if you haven't read the rules, then say GM in #general.`,
    ).catch(() => {});
  } catch (e) {
    console.error('reaction handler error:', e.message);
  }
});

// ─── welcome DM on join ──────────────────────────────────────────
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (member.guild.id !== GUILD_ID || member.user.bot) return;
    const verifyMention = verifyChannelId ? `<#${verifyChannelId}>` : '#verify';
    const rulesMention = rulesChannelId ? `<#${rulesChannelId}>` : '#rules';
    await member.send(
      `**Welcome to ${member.guild.name}** ⚔\n\n` +
        `Two quick steps before the rest of the server unlocks:\n\n` +
        `1. Skim ${rulesMention}.\n` +
        `2. Tap **${VERIFY_EMOJI}** on the pinned welcome message in ${verifyMention}.\n\n` +
        `That grants you the **${VERIFIED_ROLE}** role and opens up #general, the arena, ` +
        `the marketplace, and everything else.\n\n` +
        `If you ever see someone DM you claiming to be staff, asking for your seed phrase, ` +
        `or offering a "free mint", they're a scammer. Report and block.`,
    ).catch(() => {});
    console.log(`+ welcomed ${member.user.tag} (${member.id})`);
  } catch (e) {
    console.error('member-add handler error:', e.message);
  }
});

// ─── duel embed (rich) ───────────────────────────────────────────
async function buildDuelMessage(d) {
  const [metaA, metaB, pngA, pngB] = await Promise.all([
    getMetadata(d.token_a),
    getMetadata(d.token_b),
    getPortraitPng(d.token_a),
    getPortraitPng(d.token_b),
  ]);
  const a = extractFromMeta(metaA, d.token_a);
  const b = extractFromMeta(metaB, d.token_b);

  const isTie = d.winner_id !== d.token_a && d.winner_id !== d.token_b;
  const winner = isTie ? null : d.winner_id === d.token_a ? a : b;
  const loser  = isTie ? null : d.winner_id === d.token_a ? b : a;
  const winnerElo = isTie ? null : d.winner_id === d.token_a ? d.new_elo_a : d.new_elo_b;
  const loserElo  = isTie ? null : d.winner_id === d.token_a ? d.new_elo_b : d.new_elo_a;

  const colour = isTie ? 0xe6c200 : rarityColor(winner.rarity);
  const title  = isTie
    ? `⚔ Duel — Drawn after ${d.rounds} rounds`
    : `⚔ ${winner.shortName} beats ${loser.shortName}`;

  const fields = [];
  if (isTie) {
    fields.push({
      name: `${weaponEmoji(a.weaponType)} ${a.shortName}`,
      value: `\`#${a.tokenId}\` · ${a.rarity}\n${a.weapon} (${a.weaponType})\nRating now **${d.new_elo_a}**`,
      inline: true,
    });
    fields.push({
      name: `${weaponEmoji(b.weaponType)} ${b.shortName}`,
      value: `\`#${b.tokenId}\` · ${b.rarity}\n${b.weapon} (${b.weaponType})\nRating now **${d.new_elo_b}**`,
      inline: true,
    });
  } else {
    fields.push({
      name: `🏆 Winner — ${winner.shortName}`,
      value:
        `\`#${winner.tokenId}\` · ${winner.rarity}\n` +
        `${weaponEmoji(winner.weaponType)} ${winner.weapon}\n` +
        `Rating now **${winnerElo}**`,
      inline: true,
    });
    fields.push({
      name: `💀 Loser — ${loser.shortName}`,
      value:
        `\`#${loser.tokenId}\` · ${loser.rarity}\n` +
        `${weaponEmoji(loser.weaponType)} ${loser.weapon}\n` +
        `Rating now **${loserElo}**`,
      inline: true,
    });
  }

  // Description: a single dramatic line, varies by rounds count.
  let blow;
  if (isTie) blow = `Both fighters hit zero on the same swing. Pot splits 50/50.`;
  else if (d.rounds <= 1) blow = `One round. **${winner.shortName}** ended it before ${loser.shortName} could blink.`;
  else if (d.rounds <= 3) blow = `${d.rounds} rounds. Decisive — **${winner.shortName}** found the opening early.`;
  else if (d.rounds <= 5) blow = `${d.rounds} rounds of trading blows. **${winner.shortName}** outlasted ${loser.shortName}.`;
  else blow = `Marathon — ${d.rounds} rounds. **${winner.shortName}** scraped through.`;

  const embed = new EmbedBuilder()
    .setColor(colour)
    .setTitle(title)
    .setDescription(blow)
    .addFields(fields)
    .addFields({
      name: 'On chain',
      value: `[\`${shortHash(d.tx_hash)}\`](${TX_BASE}${d.tx_hash}) · block ${d.block_number}`,
      inline: false,
    })
    .setFooter({ text: 'BASEic Brawlers · Base Sepolia' })
    .setURL(`${API_BASE}/history`)
    .setTimestamp(new Date());

  // Thumbnail = winner's portrait (or A's portrait on tie).
  const files = [];
  const thumbPng = isTie ? pngA : (d.winner_id === d.token_a ? pngA : pngB);
  const thumbId  = isTie ? d.token_a : d.winner_id;
  if (thumbPng) {
    files.push(new AttachmentBuilder(thumbPng, { name: `brawler-${thumbId}.png` }));
    embed.setThumbnail(`attachment://brawler-${thumbId}.png`);
  }

  return { embeds: [embed], files };
}

async function fetchHistory(limit = 50) {
  const res = await fetch(`${API_BASE}/api/history/query?limit=${limit}`, {
    headers: { 'User-Agent': 'BaseicBrawlersBot/1.0' },
  });
  if (!res.ok) throw new Error(`history fetch ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error('history API not configured');
  const rows = json.rows || [];
  // Drop legacy-era rows (different contract, ambiguous token IDs).
  return rows.filter((r) => {
    const b = Number(r.block_number);
    return b >= DUEL_BLOCK_MIN && b < DUEL_BLOCK_MAX;
  });
}

async function pollDuels() {
  if (!duelsChannelId) return;
  let rows;
  try { rows = await fetchHistory(50); } catch (e) { console.error('duel poll error:', e.message); return; }
  const fresh = rows.filter((d) => !seenDuelKeys.has(duelKey(d)));
  fresh.reverse();
  for (const d of fresh) {
    seenDuelKeys.add(duelKey(d));
    try {
      const channel = await client.channels.fetch(duelsChannelId);
      const msg = await buildDuelMessage(d);
      await channel.send(msg);
      console.log(`+ posted duel #${d.token_a} vs #${d.token_b}`);
    } catch (e) {
      console.error('duel post error:', e.message);
    }
    // Death watcher — both brawlers' status is freshly fetched in
    // buildDuelMessage (cache-warm). Check on-chain Status; if newly
    // dead, post fanfare to #graveyard.
    if (graveyardChannelId) {
      void postDeathIfFresh(d);
    }
  }
  if (LEADERBOARD_AUTO_UPDATE && fresh.length > 0) {
    void maybeAutoRepostLeaderboard();
  }
}

async function postDeathIfFresh(duel) {
  for (const tokenId of [duel.token_a, duel.token_b]) {
    if (seenDeathTokens.has(tokenId)) continue;
    let meta;
    try {
      // Bypass the 60s metadata cache. A brawler can die between two
      // duels in the same poll burst, and stale-Alive cache would hide
      // the death from us until next TTL window — by which point the
      // sim is over and we've moved past the fight. Force a fresh read.
      TOKEN_CACHE.delete(tokenId);
      meta = await getMetadata(tokenId);
    } catch { continue; }
    if (!meta) continue;
    const attrMap = Object.fromEntries((meta.attributes || []).map((a) => [a.trait_type, a.value]));
    if (attrMap.Status !== 'Dead') continue;
    seenDeathTokens.add(tokenId);
    try {
      const channel = await client.channels.fetch(graveyardChannelId);
      const msg = await buildDeathMessage(duel, tokenId, meta, attrMap);
      await channel.send(msg);
      console.log(`+ posted death #${tokenId} → #${GRAVEYARD_CHANNEL}`);
    } catch (e) {
      console.error('death post error:', e.message);
    }
  }
}

// Helper: drop a tokenId from seenDeathTokens if it's currently Alive.
// Called from the leaderboard path which already touches metadata for
// every active brawler — cheap to also reset death tracking on revive.
// Not wired anywhere yet; will hook up when resurrection-watching lands.
function maybeClearDeathSeen(tokenId, attrMap) {
  if (attrMap?.Status === 'Alive' && seenDeathTokens.has(tokenId)) {
    seenDeathTokens.delete(tokenId);
  }
}

async function buildDeathMessage(duel, tokenId, meta, attrMap) {
  const png = await getPortraitPng(tokenId);
  const m = /^Brawler #\d+,\s*(.+)$/.exec(meta.name || '');
  const shortName = m ? m[1] : meta.name || `Brawler #${tokenId}`;
  const rarity = attrMap.Rarity || 'Common';
  const weapon = attrMap.Weapon || 'Unknown';
  const wins = attrMap.Wins ?? '?';
  const losses = attrMap.Losses ?? '?';
  const elo = attrMap.Rating ?? '?';
  const isFounder = tokenId <= 100;
  const killerId = duel.winner_id === tokenId ? null : duel.winner_id;

  // Killer info if we know who landed the blow.
  let killerLine = '';
  if (killerId) {
    const killerMeta = await getMetadata(killerId);
    const km = /^Brawler #\d+,\s*(.+)$/.exec(killerMeta?.name || '');
    const killerName = km ? km[1] : `Brawler #${killerId}`;
    killerLine = `Final blow by **${killerName}** \`#${killerId}\`. ${duel.rounds} round${duel.rounds === 1 ? '' : 's'}.`;
  } else {
    killerLine = `Drawn duel — both fighters hit zero on the same swing. The graveyard takes its share.`;
  }

  const eulogy = isFounder
    ? `A founder falls. **${shortName}** burned three losses in a row — the founder freebie covers the first resurrect, but the bag still empties.`
    : `**${shortName}** ate three losses in a row. The arena is unforgiving. ETH is the only way back.`;

  const embed = new EmbedBuilder()
    .setColor(0x4a1010) // dark red, mourning
    .setTitle(`💀 RIP — ${shortName}`)
    .setDescription(`${eulogy}\n\n${killerLine}`)
    .addFields(
      {
        name: '⚰ Final stats',
        value: `\`#${tokenId}\` · ${rarity}\n${weapon}\nRecord: **${wins}W ${losses}L**\nFinal Rating: **${elo}**`,
        inline: true,
      },
      {
        name: '🪦 Bring them back',
        value: `[Graveyard](${API_BASE}/graveyard) — pay ETH to resurrect.${isFounder ? '\n*(Founder: first resurrect free)*' : ''}`,
        inline: true,
      },
      {
        name: 'On chain',
        value: `[\`${shortHash(duel.tx_hash)}\`](${TX_BASE}${duel.tx_hash}) · block ${duel.block_number}`,
        inline: false,
      },
    )
    .setURL(`${API_BASE}/graveyard`)
    .setFooter({ text: 'BASEic Brawlers · Base Sepolia · the graveyard claims another' })
    .setTimestamp(new Date());

  const files = [];
  if (png) {
    files.push(new AttachmentBuilder(png, { name: `rip-${tokenId}.png` }));
    embed.setThumbnail(`attachment://rip-${tokenId}.png`);
  }
  return { embeds: [embed], files };
}

async function maybeAutoRepostLeaderboard() {
  if (!leaderboardChannelId) return;
  try {
    const wider = await fetchHistory(200);
    const ranked = buildLeaderboardFromHistory(wider);
    if (ranked.length === 0) return;
    const fp = leaderboardFingerprint(ranked);
    if (fp === lastLeaderboardFingerprint) return;
    const ageMs = Date.now() - lastLeaderboardPostAt;
    if (lastLeaderboardPostAt > 0 && ageMs < LEADERBOARD_MIN_INTERVAL_MIN * 60_000) {
      console.log(`  leaderboard changed but throttled (${Math.round(ageMs/1000)}s < ${LEADERBOARD_MIN_INTERVAL_MIN}m)`);
      return;
    }
    await postLeaderboard();
    lastLeaderboardFingerprint = fp;
    lastLeaderboardPostAt = Date.now();
    console.log(`+ auto-reposted leaderboard (top-${LEADERBOARD_FP_DEPTH} changed)`);
  } catch (e) {
    console.error('auto-leaderboard error:', e.message);
  }
}

// ─── leaderboard digest (rich) ───────────────────────────────────
function buildLeaderboardFromHistory(rows) {
  const stats = new Map();
  for (const r of rows) {
    const ensure = (id, latestElo) => {
      if (!stats.has(id)) stats.set(id, { tokenId: id, wins: 0, losses: 0, ties: 0, elo: latestElo });
    };
    ensure(r.token_a, r.new_elo_a);
    ensure(r.token_b, r.new_elo_b);
    const sa = stats.get(r.token_a);
    const sb = stats.get(r.token_b);
    if (r.winner_id === r.token_a) { sa.wins++; sb.losses++; }
    else if (r.winner_id === r.token_b) { sb.wins++; sa.losses++; }
    else { sa.ties++; sb.ties++; }
  }
  return [...stats.values()].sort((x, y) => y.elo - x.elo || y.wins - x.wins);
}

async function buildLeaderboardMessage() {
  const rows = await fetchHistory(200);
  const allRanked = buildLeaderboardFromHistory(rows);
  if (allRanked.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x4bc9d4)
          .setTitle('🏆 Leaderboard')
          .setDescription('No duels recorded yet. First fight wires up the board.')
          .setTimestamp(new Date()),
      ],
      files: [],
    };
  }

  // Pull metadata for up to the top 30 by raw rating, then keep only
  // brawlers that exist on the current contract. The DB still holds duel
  // history from previous contract versions (e.g. BSC-Testnet era); those
  // tokens 404 on the metadata endpoint and we filter them out so the
  // leaderboard only reflects the live v6 roster.
  const candidates = allRanked.slice(0, 30);
  const enrichedAll = await Promise.all(
    candidates.map(async (s) => {
      const meta = await getMetadata(s.tokenId);
      return meta ? { ...s, ...extractFromMeta(meta, s.tokenId), hasMeta: true } : null;
    }),
  );
  const enriched = enrichedAll.filter(Boolean).slice(0, 10);

  if (enriched.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x4bc9d4)
          .setTitle('🏆 Leaderboard')
          .setDescription(
            'No duels yet from current-contract brawlers. ' +
              `${rows.length} legacy duel${rows.length === 1 ? '' : 's'} are cached but reference brawlers from a previous contract version. ` +
              'Mint and fight on baseicbrawlers.com to populate the v6 leaderboard.',
          )
          .setURL(`${API_BASE}/leaderboard`)
          .setTimestamp(new Date()),
      ],
      files: [],
    };
  }

  const champPng = await getPortraitPng(enriched[0].tokenId);

  const lines = enriched.map((s, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${String(i + 1).padStart(2, ' ')}\``;
    const rarityTag = s.rarity === 'King' ? '👑 King' : s.rarity;
    const record = `${s.wins}W ${s.losses}L${s.ties ? ` ${s.ties}T` : ''}`;
    return (
      `${medal} **${s.shortName}** \`#${s.tokenId}\` · ${rarityTag}\n` +
      `    ${weaponEmoji(s.weaponType)} ${s.weapon} · Rating **${s.elo}** · ${record}`
    );
  });

  const embed = new EmbedBuilder()
    .setColor(0xe6c200)
    .setTitle('🏆 BASEic Brawlers — Leaderboard')
    .setURL(`${API_BASE}/leaderboard`)
    .setDescription(lines.join('\n\n'))
    .setFooter({
      text: `Top ${enriched.length} of ${allRanked.length} ranked brawler${allRanked.length === 1 ? '' : 's'} · ${rows.length} duel${rows.length === 1 ? '' : 's'} on record`,
    })
    .setTimestamp(new Date());

  const files = [];
  if (champPng) {
    files.push(new AttachmentBuilder(champPng, { name: `champion.png` }));
    embed.setThumbnail('attachment://champion.png');
  }

  return { embeds: [embed], files };
}

// ─── marketplace Sold watcher ────────────────────────────────────
// Reads Sold events directly from chain via JSON-RPC eth_getLogs. No new
// dependency — just fetch. Stores last-processed block in memory; on bot
// restart, watermarks at current head so historical sales don't re-spam.
//
// Sold(tokenId indexed, seller indexed, buyer indexed, price, fee)
// keccak256("Sold(uint256,address,address,uint256,uint256)") =
//   0xa70b1a854695e7921b122988e216d3a6cd10ed799017c67b1ff231967e6bf56d
const SOLD_TOPIC0 = '0xa70b1a854695e7921b122988e216d3a6cd10ed799017c67b1ff231967e6bf56d';

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

function paddedAddress(topic) {
  // 32-byte topic → 0x + 24 zero hex chars + 40 addr hex chars.
  return '0x' + topic.slice(-40);
}

function shortAddr(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

async function pollMarketplaceSales() {
  if (!marketplaceChannelId || !MARKETPLACE_ADDRESS) return;
  let head;
  try {
    head = parseInt(await rpcCall('eth_blockNumber', []), 16);
  } catch (e) {
    console.error('marketplace poll: head fetch error:', e.message);
    return;
  }
  if (marketplaceLastBlock === null) {
    // First poll: watermark to current head minus a small buffer so any
    // sale in the last 30s isn't missed if RPC was slightly behind.
    marketplaceLastBlock = Math.max(0, head - 50);
    console.log(`  marketplace watermark set at block ${marketplaceLastBlock}`);
    return;
  }
  if (head <= marketplaceLastBlock) return;
  let logs;
  try {
    logs = await rpcCall('eth_getLogs', [{
      address: MARKETPLACE_ADDRESS,
      fromBlock: '0x' + (marketplaceLastBlock + 1).toString(16),
      toBlock: '0x' + head.toString(16),
      topics: [SOLD_TOPIC0],
    }]);
  } catch (e) {
    console.error('marketplace poll: getLogs error:', e.message);
    return;
  }
  for (const log of logs || []) {
    const key = `${log.transactionHash}:${log.logIndex}`;
    if (seenSaleKeys.has(key)) continue;
    seenSaleKeys.add(key);
    try {
      const tokenId = parseInt(log.topics[1], 16);
      const seller = paddedAddress(log.topics[2]);
      const buyer = paddedAddress(log.topics[3]);
      // data: price (32 bytes) + fee (32 bytes)
      const data = log.data.slice(2); // strip 0x
      const price = BigInt('0x' + data.slice(0, 64));
      const fee = BigInt('0x' + data.slice(64, 128));
      const blockNumber = parseInt(log.blockNumber, 16);
      const meta = await getMetadata(tokenId);
      const png = await getPortraitPng(tokenId);
      const m = /^Brawler #\d+,\s*(.+)$/.exec(meta?.name || '');
      const shortName = m ? m[1] : `Brawler #${tokenId}`;
      const attrMap = Object.fromEntries((meta?.attributes || []).map((a) => [a.trait_type, a.value]));
      const rarity = attrMap.Rarity || 'Common';
      const weapon = attrMap.Weapon || 'Unknown';
      const priceEth = (Number(price) / 1e18).toFixed(6).replace(/\.?0+$/, '');
      const sellerNet = (Number(price - fee) / 1e18).toFixed(6).replace(/\.?0+$/, '');
      const feeEth = (Number(fee) / 1e18).toFixed(6).replace(/\.?0+$/, '');

      const embed = new EmbedBuilder()
        .setColor(rarityColor(rarity))
        .setTitle(`💸 ${shortName} sold for ${priceEth} ETH`)
        .setDescription(`A new owner steps into the arena. Welcome **${shortAddr(buyer)}** — bring the heat.`)
        .addFields(
          {
            name: '⚔ Brawler',
            value: `\`#${tokenId}\` · ${rarity}\n${weaponEmoji(attrMap['Weapon Type'])} ${weapon}`,
            inline: true,
          },
          {
            name: '💰 Sale',
            value: `**${priceEth} ETH**\nSeller net: ${sellerNet} ETH\nFee: ${feeEth} ETH`,
            inline: true,
          },
          {
            name: '🤝 Wallets',
            value: `Seller: \`${shortAddr(seller)}\`\nBuyer: \`${shortAddr(buyer)}\``,
            inline: false,
          },
          {
            name: 'On chain',
            value: `[\`${shortHash(log.transactionHash)}\`](${TX_BASE}${log.transactionHash}) · block ${blockNumber}`,
            inline: false,
          },
        )
        .setURL(`${API_BASE}/market`)
        .setFooter({ text: 'BASEic Brawlers · marketplace' })
        .setTimestamp(new Date());
      const files = [];
      if (png) {
        files.push(new AttachmentBuilder(png, { name: `sold-${tokenId}.png` }));
        embed.setThumbnail(`attachment://sold-${tokenId}.png`);
      }
      const channel = await client.channels.fetch(marketplaceChannelId);
      await channel.send({ embeds: [embed], files });
      console.log(`+ posted sale #${tokenId} → #${MARKETPLACE_CHANNEL} (${priceEth} ETH)`);
    } catch (e) {
      console.error(`marketplace post #${log.topics[1]}:`, e.message);
    }
  }
  marketplaceLastBlock = head;
}

async function postLeaderboard() {
  if (!leaderboardChannelId) return false;
  try {
    const msg = await buildLeaderboardMessage();
    const channel = await client.channels.fetch(leaderboardChannelId);
    await channel.send(msg);
    lastLeaderboardPostAt = Date.now();
    // Refresh fingerprint so a subsequent auto-update doesn't fire on the
    // same data we just posted.
    try {
      const wider = await fetchHistory(200);
      const ranked = buildLeaderboardFromHistory(wider);
      lastLeaderboardFingerprint = leaderboardFingerprint(ranked);
    } catch { /* non-fatal */ }
    console.log(`+ posted leaderboard → #${LEADERBOARD_CHANNEL}`);
    return true;
  } catch (e) {
    console.error('leaderboard error:', e.message);
    return false;
  }
}

// ─── slash commands ──────────────────────────────────────────────
const SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Force-post the current top-10 leaderboard to #leaderboard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('refresh-pins')
    .setDescription("Re-sync pinned/seed messages from disk (welcome, rules, links, announcements, etc.)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

// Channels whose canonical first-message gets re-synced from disk on
// /refresh-pins. The bot's first authored message in each channel is the
// edit target — preserves reactions on the verify-gate message.
const PIN_TARGETS = [
  { channel: 'verify',        file: 'messages/welcome.md' },
  { channel: 'rules',         file: 'messages/rules.md' },
  { channel: 'links',         file: 'messages/links.md' },
  { channel: 'announcements', file: 'messages/seed-announcements.md' },
  { channel: 'general',       file: 'messages/seed-general.md' },
  { channel: 'introductions', file: 'messages/seed-introductions.md' },
  { channel: 'strategy',      file: 'messages/seed-strategy.md' },
];

async function refreshPins(guild) {
  const channels = await guild.channels.fetch();
  const findText = (name) => channels.find((c) => c?.name === name && c.type === 0);
  const lines = [];
  for (const target of PIN_TARGETS) {
    const channel = findText(target.channel);
    if (!channel) { lines.push(`⊘ #${target.channel}: channel not found`); continue; }
    const fp = join(HERE, target.file);
    if (!existsSync(fp)) { lines.push(`⊘ #${target.channel}: ${target.file} missing on disk`); continue; }
    const content = readFileSync(fp, 'utf8');
    try {
      const recent = await channel.messages.fetch({ limit: 50 });
      // Exclude system messages (channel-creation notice, pins-added notice, etc.)
      // — those are authored by the bot but `.system === true` and can't be edited.
      const ours = recent
        .filter((m) => m.author.id === client.user.id && !m.system)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      const target_msg = ours.first();
      if (!target_msg) {
        await channel.send({ content });
        lines.push(`+ #${target.channel}: posted fresh from ${target.file}`);
        continue;
      }
      if (target_msg.content === content) {
        lines.push(`= #${target.channel}: already up to date`);
        continue;
      }
      if (!target_msg.editable) {
        // Defence in depth: if the message somehow isn't editable, post fresh
        // and leave the old one intact (manual cleanup is safer than a crash).
        await channel.send({ content });
        lines.push(`+ #${target.channel}: existing not editable, posted fresh`);
        continue;
      }
      await target_msg.edit({ content });
      lines.push(`✓ #${target.channel}: updated from ${target.file}`);
    } catch (e) {
      lines.push(`✗ #${target.channel}: ${e.message}`);
    }
  }
  return lines;
}

async function registerSlashCommands(guild) {
  try {
    await guild.commands.set(SLASH_COMMANDS);
    console.log(`  registered ${SLASH_COMMANDS.length} slash command(s) on guild`);
  } catch (e) {
    console.error('slash-command register error:', e.message);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== GUILD_ID) return;
  try {
    if (interaction.commandName === 'leaderboard') {
      await interaction.deferReply({ ephemeral: true });
      if (!leaderboardChannelId) {
        await interaction.editReply(`No #${LEADERBOARD_CHANNEL} channel resolved on startup.`);
        return;
      }
      const ok = await postLeaderboard();
      await interaction.editReply(
        ok
          ? `✓ Leaderboard posted to <#${leaderboardChannelId}>.`
          : '✗ Leaderboard post failed (see bot logs).',
      );
      return;
    }
    if (interaction.commandName === 'refresh-pins') {
      await interaction.deferReply({ ephemeral: true });
      const guild = await client.guilds.fetch(GUILD_ID);
      const lines = await refreshPins(guild);
      const reply = lines.join('\n') || '(no targets)';
      await interaction.editReply(reply.length > 1900 ? reply.slice(0, 1900) + '\n…' : reply);
      console.log('refresh-pins:\n' + lines.join('\n'));
      return;
    }
  } catch (e) {
    console.error('slash handler error:', e.message);
    if (interaction.deferred) {
      try { await interaction.editReply(`✗ Error: ${e.message}`); } catch { /* ignore */ }
    }
  }
});

// ─── bootstrap + ready ───────────────────────────────────────────
async function bootstrap() {
  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) { console.error(`FATAL: bot is not in guild ${GUILD_ID}.`); process.exit(1); }
  const channels = await guild.channels.fetch();
  const findText = (name) => channels.find((c) => c?.name === name && c.type === 0);

  const verify = findText(VERIFY_CHANNEL);
  if (verify) { verifyChannelId = verify.id; console.log(`  resolved #${VERIFY_CHANNEL} → ${verify.id}`); }
  const rules = findText(RULES_CHANNEL);
  if (rules) rulesChannelId = rules.id;
  const duelTalk = findText(DUELS_CHANNEL);
  if (duelTalk) { duelsChannelId = duelTalk.id; console.log(`  resolved #${DUELS_CHANNEL} → ${duelTalk.id}`); }
  const lb = findText(LEADERBOARD_CHANNEL);
  if (lb) { leaderboardChannelId = lb.id; console.log(`  resolved #${LEADERBOARD_CHANNEL} → ${lb.id}`); }
  const gy = findText(GRAVEYARD_CHANNEL);
  if (gy) { graveyardChannelId = gy.id; console.log(`  resolved #${GRAVEYARD_CHANNEL} → ${gy.id}`); }
  const mp = findText(MARKETPLACE_CHANNEL);
  if (mp) { marketplaceChannelId = mp.id; console.log(`  resolved #${MARKETPLACE_CHANNEL} → ${mp.id}`); }

  const roles = await guild.roles.fetch();
  const verified = roles.find((r) => r.name === VERIFIED_ROLE);
  if (verified) { verifiedRoleId = verified.id; console.log(`  resolved role "${VERIFIED_ROLE}" → ${verified.id}`); }

  await registerSlashCommands(guild);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✓ Bot online as ${c.user.tag} (${c.user.id})`);
  await bootstrap();

  let initial = [];
  try {
    initial = await fetchHistory(50);
    for (const d of initial) seenDuelKeys.add(duelKey(d));
    console.log(`  duel watermark set to ${initial.length} historical duels`);
  } catch (e) {
    console.error('  duel watermark init failed:', e.message);
  }

  if (DUEL_BACKFILL_COUNT > 0 && duelsChannelId && initial.length > 0) {
    const slice = initial.slice(0, DUEL_BACKFILL_COUNT).reverse();
    console.log(`  backfilling ${slice.length} historical duel(s) → #${DUELS_CHANNEL}…`);
    try {
      const channel = await client.channels.fetch(duelsChannelId);
      for (const d of slice) {
        const msg = await buildDuelMessage(d);
        msg.content = '_(backfill — historical duel for wiring verification)_';
        await channel.send(msg);
        console.log(`+ backfilled duel #${d.token_a} vs #${d.token_b}`);
      }
    } catch (e) {
      console.error('backfill error:', e.message);
    }
  }

  console.log(
    `✓ Watching: ⚔ in #${VERIFY_CHANNEL}, joins, new duels in #${DUELS_CHANNEL}, deaths in #${GRAVEYARD_CHANNEL}, sales in #${MARKETPLACE_CHANNEL}${MARKETPLACE_ADDRESS ? '' : ' (DISABLED — MARKETPLACE_ADDRESS unset)'}, leaderboard digest every ${LEADERBOARD_INTERVAL_HOURS}h.`,
  );
  console.log(
    `✓ Slash: /leaderboard, /refresh-pins (Manage-Guild gated). Auto-update on top-${LEADERBOARD_FP_DEPTH} change: ${LEADERBOARD_AUTO_UPDATE ? `ON (≥${LEADERBOARD_MIN_INTERVAL_MIN}m gap)` : 'OFF'}.`,
  );

  setInterval(() => { void pollDuels(); }, Math.max(15, DUEL_POLL_SEC) * 1000);
  setInterval(() => { void postLeaderboard(); }, Math.max(1, LEADERBOARD_INTERVAL_HOURS) * 3600 * 1000);
  if (MARKETPLACE_ADDRESS) {
    setInterval(() => { void pollMarketplaceSales(); }, Math.max(15, MARKETPLACE_POLL_SEC) * 1000);
    // Run once immediately so the watermark sets without waiting a full poll cycle.
    void pollMarketplaceSales();
  }

  if (LEADERBOARD_ON_STARTUP) void postLeaderboard();

  if (REFRESH_PINS_ON_STARTUP) {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const lines = await refreshPins(guild);
      console.log('refresh-pins (startup):\n' + lines.join('\n'));
    } catch (e) {
      console.error('refresh-pins startup error:', e.message);
    }
  }

  if (WIPE_GRAVEYARD_ON_STARTUP && graveyardChannelId) {
    try {
      const channel = await client.channels.fetch(graveyardChannelId);
      const messages = await channel.messages.fetch({ limit: 100 });
      const ours = messages.filter((m) => m.author.id === client.user.id);
      let wiped = 0;
      for (const [, m] of ours) {
        try { await m.delete(); wiped++; } catch (e) { console.error('wipe error:', e.message); }
      }
      console.log(`✓ wiped ${wiped} bot message(s) from #${GRAVEYARD_CHANNEL}`);
    } catch (e) {
      console.error('graveyard wipe error:', e.message);
    }
  }

  if (BACKFILL_DEATHS_ON_STARTUP && graveyardChannelId) {
    try {
      const rows = await fetchHistory(200);
      // For each unique tokenId in recent duels, find their MOST RECENT
      // duel and check on-chain status. If currently dead, post the death.
      // We only post once per tokenId — the brawler can't die twice
      // without a resurrection in between.
      const latestDuelByToken = new Map();
      for (const r of rows) {
        for (const tid of [r.token_a, r.token_b]) {
          const prev = latestDuelByToken.get(tid);
          if (!prev || Number(r.block_number) > Number(prev.block_number)) {
            latestDuelByToken.set(tid, r);
          }
        }
      }
      let posted = 0;
      for (const [tokenId, lastDuel] of latestDuelByToken.entries()) {
        if (seenDeathTokens.has(tokenId)) continue;
        TOKEN_CACHE.delete(tokenId);
        const meta = await getMetadata(tokenId);
        if (!meta) continue;
        const attrMap = Object.fromEntries((meta.attributes || []).map((a) => [a.trait_type, a.value]));
        if (attrMap.Status !== 'Dead') continue;
        seenDeathTokens.add(tokenId);
        try {
          const channel = await client.channels.fetch(graveyardChannelId);
          const msg = await buildDeathMessage(lastDuel, tokenId, meta, attrMap);
          msg.content = '_(backfill — historical death surfaced after the graveyard channel was wired)_';
          await channel.send(msg);
          posted++;
          console.log(`+ backfilled death #${tokenId} → #${GRAVEYARD_CHANNEL}`);
        } catch (e) {
          console.error(`backfill death #${tokenId}:`, e.message);
        }
      }
      console.log(`✓ death backfill complete: ${posted} posted`);
    } catch (e) {
      console.error('death backfill error:', e.message);
    }
  }
});

client.on(Events.Error, (e) => console.error('client error:', e.message));
client.on(Events.Warn, (m) => console.warn('client warn:', m));
process.on('SIGTERM', () => { client.destroy(); process.exit(0); });
process.on('SIGINT',  () => { client.destroy(); process.exit(0); });

client.login(TOKEN);
