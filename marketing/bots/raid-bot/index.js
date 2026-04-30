/**
 * Raid bot, admins post a tweet URL, the bot opens a "raid" round in the
 * group. Members reply with a link to their like / RT / QT (any x.com or
 * twitter.com URL counts as proof, idempotent per user+url). Each unique
 * proof scores 1 point that flows into the weekly leaderboard.
 *
 * Admin commands:
 *   /raid <tweet_url>, open raid (auto-closes in 6h)
 *   /closeraid       , manually close the latest open raid
 *
 * Member commands:
 *   /me             , show your week-to-date points
 *   /raidstatus     , show open raid + your contribution
 *
 * Any text message with an x.com/twitter.com URL inside an open raid
 * window is auto-credited. Keeps friction low.
 */
import 'dotenv/config';
import { Bot } from 'grammy';
import {
  closeRaidById,
  getOpenRaid,
  myWeekScore,
  now,
  openRaidTarget,
  recordRaidScore,
} from '../db.js';

export function start() {
const TOKEN = process.env.RAID_BOT_TOKEN;
if (!TOKEN) {
  console.warn('[raid] RAID_BOT_TOKEN missing, skipping raid bot');
  return;
}

const RAID_WINDOW_SEC = 6 * 60 * 60; // 6h auto-close

const bot = new Bot(TOKEN);

async function isAdmin(ctx) {
  try {
    const m = await ctx.getChatMember(ctx.from.id);
    return m.status === 'creator' || m.status === 'administrator';
  } catch {
    return false;
  }
}

const X_URL = /https?:\/\/(twitter|x)\.com\/[^\s]+/i;

bot.command('raid', async (ctx) => {
  if (!(await isAdmin(ctx))) return;
  const url = (ctx.match || '').trim();
  if (!X_URL.test(url)) {
    return ctx.reply('Usage: /raid <tweet x.com URL>');
  }
  const id = openRaidTarget(url, ctx.from.username || String(ctx.from.id));
  await ctx.reply(
    [
      `⚔️ RAID #${id} OPEN, 6 hours`,
      '',
      `Target: ${url}`,
      '',
      'Like + RT + QT this tweet, then reply HERE with the URL of your QT (or your profile if you only liked/RT\'d).',
      'Each unique proof-url = 1 point toward the weekly leaderboard.',
    ].join('\n'),
  );
});

bot.command('closeraid', async (ctx) => {
  if (!(await isAdmin(ctx))) return;
  const r = getOpenRaid();
  if (!r) return ctx.reply('No raid open.');
  closeRaidById(r.id);
  await ctx.reply(`Raid #${r.id} closed.`);
});

bot.command('me', (ctx) => {
  const total = myWeekScore(ctx.from.id);
  ctx.reply(`@${ctx.from.username || ctx.from.first_name}: ${total} pts this week.`);
});

bot.command('raidstatus', (ctx) => {
  const r = getOpenRaid();
  if (!r) return ctx.reply('No raid open right now.');
  const ageH = ((now() - r.created_at) / 3600).toFixed(1);
  const left = (6 - Number.parseFloat(ageH)).toFixed(1);
  ctx.reply(`Open raid #${r.id}: ${r.tweet_url}\nOpened ${ageH}h ago. Closes in ${left}h.`);
});

bot.on('message:text', (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const r = getOpenRaid();
  if (!r) return;
  // Auto-close if expired.
  if (now() - r.created_at > RAID_WINDOW_SEC) {
    closeRaidById(r.id);
    return;
  }
  const m = ctx.message.text.match(X_URL);
  if (!m) return;
  const proofUrl = m[0];
  const username = ctx.from.username || ctx.from.first_name || String(ctx.from.id);
  const accepted = recordRaidScore({
    raidId: r.id,
    userId: ctx.from.id,
    username,
    proofUrl,
    points: 1,
  });
  if (accepted) {
    ctx.reply(`+1 ${username} ⚔️`, { reply_parameters: { message_id: ctx.message.message_id } });
  }
});

console.log('[raid] bot starting…');
bot.start();
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  start();
}
