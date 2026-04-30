/**
 * Boots all three bots in one node process. Each bot is its own grammy
 * instance with its own token; they run concurrently without collision.
 * If any bot's start() fails, log + carry on (others stay up).
 */
import 'dotenv/config';
import { start as startWelcome } from './welcome-bot/index.js';
import { start as startRaid } from './raid-bot/index.js';
import { start as startLeaderboard } from './leaderboard-bot/index.js';

const tasks = [
  { name: 'welcome', start: startWelcome },
  { name: 'raid', start: startRaid },
  { name: 'leaderboard', start: startLeaderboard },
];

for (const t of tasks) {
  try {
    t.start();
  } catch (e) {
    console.error(`[run-all] ${t.name} FAILED to start:`, e?.message || e);
  }
}

// Keep the process alive even if grammy bots' loops are async-detached.
setInterval(() => {}, 1 << 30);
