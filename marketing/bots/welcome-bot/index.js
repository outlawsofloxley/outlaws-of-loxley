/**
 * Welcome bot — greets new joiners with the pinned-message reminder + scam
 * warning, and answers /ca, /mint, /chart, /docs, /founders, /scam, /rules,
 * /links.
 *
 * Anti-impersonation: we don't auto-greet users whose usernames look like
 * admin handles (contain "baseic", "brawler", "admin", "mod", "support",
 * "dev"). Real admins shouldn't be auto-greeted, and impersonators
 * shouldn't gain legitimacy from a bot acknowledgement.
 */
import 'dotenv/config';
import { Bot, GrammyError, HttpError } from 'grammy';
import { isWelcomed, markWelcomed } from '../db.js';

export function start() {
const TOKEN = process.env.WELCOME_BOT_TOKEN;
if (!TOKEN) {
  console.warn('[welcome] WELCOME_BOT_TOKEN missing — skipping welcome bot');
  return;
}
const SITE = process.env.SITE_URL || 'https://baseicbrawlers.com';
const TG = process.env.TG_PUBLIC || 'https://t.me/baseicbrawlers';
const ANN = process.env.TG_ANNOUNCE || 'https://t.me/baseicbrawlers_announce';
const X = process.env.X_HANDLE || 'https://x.com/BASEicBrawlers';
const BRAWLERS = process.env.BRAWLERS_ADDRESS || '[NFT_CA_PENDING]';
const BRAWL = process.env.BRAWL_ADDRESS || '[BRAWL_CA_PENDING]';
const PAIR = process.env.PAIR_ADDRESS || '[PAIR_PENDING]';

const bot = new Bot(TOKEN);

const SUSPICIOUS = /baseic|brawler|admin|mod(erator)?|support|dev/i;

function welcomeText(name) {
  return [
    `Welcome to the arena, ${name}.`,
    '',
    '⚔️ BASEic BRAWLERS — 2,000 on-chain warriors on Base.',
    `Mint: ${SITE}/mint`,
    'Read the pinned message before you ask anything 🙏',
    '',
    '⚠️ SECURITY:',
    'We never DM first. The only CAs are in the pinned message.',
    "Anyone DM'ing you \"from the dev\" is a scammer.",
    '',
    'Type /ca to verify the contract address any time.',
  ].join('\n');
}

bot.on('chat_member', async (ctx) => {
  const update = ctx.chatMember;
  if (update.old_chat_member.status !== 'left' && update.old_chat_member.status !== 'kicked') return;
  if (update.new_chat_member.status !== 'member') return;

  const u = update.new_chat_member.user;
  if (u.is_bot) return;
  if (u.username && SUSPICIOUS.test(u.username)) {
    console.warn(`[welcome] skipping suspicious join: @${u.username}`);
    return;
  }
  if (isWelcomed(u.id)) return;
  markWelcomed(u.id);
  await ctx.reply(welcomeText(u.first_name || 'brawler'));
});

bot.command('start', (ctx) => ctx.reply(welcomeText(ctx.from?.first_name || 'brawler')));

bot.command('ca', (ctx) =>
  ctx.reply(
    [
      '⚔️ OFFICIAL CONTRACT ADDRESSES',
      '',
      `NFT (Brawlers): ${BRAWLERS}`,
      `Token ($BRAWL): ${BRAWL}`,
      `LP Pair:        ${PAIR}`,
      '',
      '⚠️ ANY OTHER CA IS A SCAM.',
      `Verify on basescan.org/address/${BRAWLERS}`,
    ].join('\n'),
  ),
);

bot.command('mint', (ctx) =>
  ctx.reply(
    [
      '⚔️ MINT A BRAWLER',
      '',
      `→ ${SITE}/mint`,
      '',
      'Pricing: $30 in ETH / USDC / USDT',
      'Bulk: 5+ → 1 free, 10+ → 3 free, 20 → 7 free',
      'Founder slots (1-100): FREE mint + 25% off fights + free first resurrect + 20 $BRAWL bonus',
    ].join('\n'),
  ),
);

bot.command('chart', (ctx) =>
  ctx.reply(`📈 Chart: https://dexscreener.com/base/${PAIR}`),
);

bot.command('docs', (ctx) => ctx.reply(`📚 Game mechanics: ${SITE}/about`));

bot.command('founders', (ctx) =>
  ctx.reply(
    [
      '👑 FOUNDER PERKS — token IDs 1-100 only',
      '',
      '★ FOUNDER 50  (gold badge, IDs 1-50)',
      '★ FOUNDER 100 (cyan badge, IDs 51-100)',
      '',
      'For LIFE:',
      '✅ 25% off every fight cost',
      '✅ Free first resurrect',
      '✅ +20 $BRAWL airdrop on mint',
      '✅ Visible founder badge',
      '',
      `Mint early: ${SITE}/mint`,
    ].join('\n'),
  ),
);

bot.command('scam', (ctx) =>
  ctx.reply(
    [
      '⚠️ SCAM SURVIVAL',
      '',
      '• We NEVER DM you first. Ever.',
      '• The only real CAs are in the pinned message (or /ca).',
      '• Admins will never ask for your seed phrase.',
      '• If anyone DMs you claiming to be the dev: block + report.',
    ].join('\n'),
  ),
);

bot.command('rules', (ctx) =>
  ctx.reply(
    [
      '📜 HOUSE RULES',
      '',
      '1. No "wen 1B" / "wen CEX" — we\'re a game first.',
      '2. No shilling other tokens.',
      '3. Memes welcome. NSFW + racism + doxxing = lifetime ban.',
      '4. English in main; ask for a localized sub-group.',
      '5. Scammers / drainer links / fake CAs = lifetime ban + reported.',
    ].join('\n'),
  ),
);

bot.command('links', (ctx) =>
  ctx.reply(
    [
      '⚔️ BASEic BRAWLERS LINKS',
      '',
      `🌐 Site:     ${SITE}`,
      `💬 Public:   ${TG}`,
      `📢 Announce: ${ANN}`,
      `🐦 X:        ${X}`,
    ].join('\n'),
  ),
);

// Setup helper — prints this chat's ID. Use to seed PUBLIC_GROUP_ID or
// ANNOUNCE_CHANNEL_ID in .env.
function groupIdReply(ctx) {
  return ctx.reply(
    [
      `Chat ID: ${ctx.chat.id}`,
      `Type: ${ctx.chat.type}`,
      ctx.chat.title ? `Title: ${ctx.chat.title}` : '',
      '',
      ctx.chat.type === 'channel'
        ? 'Channel detected — drop into ANNOUNCE_CHANNEL_ID in .env.'
        : 'Group detected — drop into PUBLIC_GROUP_ID in .env.',
    ].filter(Boolean).join('\n'),
  );
}
bot.command('groupid', groupIdReply);
// Channels deliver via channel_post, not message; commands too.
bot.on('channel_post:text', (ctx) => {
  if (ctx.channelPost.text.startsWith('/groupid')) return groupIdReply(ctx);
});

bot.catch((err) => {
  if (err.error instanceof GrammyError) {
    console.error('[welcome] grammy error:', err.error.description);
  } else if (err.error instanceof HttpError) {
    console.error('[welcome] http error:', err.error);
  } else {
    console.error('[welcome] unknown error:', err);
  }
});

console.log('[welcome] bot starting…');
bot.start({ allowed_updates: ['message', 'chat_member', 'channel_post'] });
}

// Run directly (not via run-all)
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  start();
}
