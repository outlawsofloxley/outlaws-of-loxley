/**
 * Leaderboard bot — Posts the weekly raid leaderboard to the public group.
 *
 * Modes:
 *   - On-demand: /leaderboard prints the current week's top 10
 *   - Scheduled: every Sunday 18:00 UTC, auto-posts to PUBLIC_GROUP_ID
 *
 * Admin commands:
 *   /publish              — force-post the current week's leaderboard
 *   /lbreward @user N     — admin awards N points (rare; for art submissions,
 *                           bug reports, anything beyond the auto-raid scoring)
 */
import 'dotenv/config';
import { Bot } from 'grammy';
import { manualReward, now, startOfIsoWeek, topNForCurrentWeek } from '../db.js';

export function start() {
const TOKEN = process.env.LEADERBOARD_BOT_TOKEN;
if (!TOKEN) {
  console.warn('[leaderboard] LEADERBOARD_BOT_TOKEN missing — skipping leaderboard bot');
  return;
}
const PUBLIC_GROUP_ID = process.env.PUBLIC_GROUP_ID
  ? Number(process.env.PUBLIC_GROUP_ID)
  : null;

const bot = new Bot(TOKEN);

function formatBoard(rows, weekStart) {
  if (rows.length === 0) return 'No raids logged this week. Open a raid with /raid <url>.';
  const date = new Date(weekStart * 1000).toISOString().slice(0, 10);
  const lines = [`🏆 BASEic BRAWLERS — WEEKLY LEADERBOARD (week of ${date})`, ''];
  rows.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    lines.push(`${medal} @${r.username}: ${r.total_points} pts`);
  });
  lines.push('');
  lines.push('Top shillers earn week-end perks (founder airdrops while supplies last).');
  return lines.join('\n');
}

async function isAdmin(ctx) {
  try {
    const m = await ctx.getChatMember(ctx.from.id);
    return m.status === 'creator' || m.status === 'administrator';
  } catch {
    return false;
  }
}

bot.command('leaderboard', (ctx) => {
  const weekStart = startOfIsoWeek(now());
  const rows = topNForCurrentWeek(10);
  ctx.reply(formatBoard(rows, weekStart));
});

bot.command('publish', async (ctx) => {
  if (!(await isAdmin(ctx))) return;
  if (!PUBLIC_GROUP_ID) return ctx.reply('PUBLIC_GROUP_ID not set in env.');
  const weekStart = startOfIsoWeek(now());
  const rows = topNForCurrentWeek(10);
  await bot.api.sendMessage(PUBLIC_GROUP_ID, formatBoard(rows, weekStart));
  await ctx.reply('Published.');
});

bot.command('lbreward', async (ctx) => {
  if (!(await isAdmin(ctx))) return;
  const parts = (ctx.match || '').trim().split(/\s+/);
  if (parts.length !== 2) return ctx.reply('Usage: /lbreward @username <points>');
  const username = parts[0].replace(/^@/, '');
  const pts = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(pts)) return ctx.reply('Points must be a number.');
  manualReward(username, pts);
  ctx.reply(`Granted ${pts} pts to @${username}.`);
});

// Auto-publish every Sunday at 18:00 UTC. Tick once per 5 min.
let lastPubKey = null;
setInterval(async () => {
  if (!PUBLIC_GROUP_ID) return;
  const d = new Date();
  if (d.getUTCDay() !== 0 || d.getUTCHours() !== 18) return;
  const key = d.toISOString().slice(0, 13);
  if (key === lastPubKey) return;
  lastPubKey = key;
  const weekStart = startOfIsoWeek(now());
  const rows = topNForCurrentWeek(10);
  try {
    await bot.api.sendMessage(PUBLIC_GROUP_ID, formatBoard(rows, weekStart));
    console.log('[leaderboard] auto-published weekly board');
  } catch (e) {
    console.error('[leaderboard] auto-publish failed:', e);
  }
}, 5 * 60 * 1000);

console.log('[leaderboard] bot starting…');
bot.start();
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  start();
}
