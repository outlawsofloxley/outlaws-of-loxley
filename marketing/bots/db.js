/**
 * JSON-file-backed store for the three bots. Tiny volume (raid scores,
 * weekly leaderboard, welcomed users, KOL log) — JSON on disk is plenty
 * and avoids native-build pain (better-sqlite3 needs MSBuild on Windows
 * + prebuilt-binary catch-up for new Node versions).
 *
 * Concurrency: each bot runs in its own process, so they can write to
 * the same file. We use a tiny atomic-write pattern (write tmp + rename)
 * + a shared in-memory cache that re-reads on every mutation. Good
 * enough for ≤1k events/week.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import 'dotenv/config';

const DB_PATH = process.env.DB_PATH || './bots-state.json';

const EMPTY = {
  raid_targets: [],   // { id, tweet_url, posted_by, created_at, closed_at? }
  raid_scores: [],    // { raid_id, user_id, username, proof_url, points, created_at }
  leaderboard_weekly: [], // { week_start, user_id, username, total_points }
  welcome_seen: [],   // { user_id, welcomed_at }
  kol_outreach: [],   // { handle, tier, interactions, dm_sent_at, replied, airdropped_token_id, posted, notes }
  next_raid_id: 1,
};

function load() {
  if (!existsSync(DB_PATH)) return structuredClone(EMPTY);
  try {
    const raw = readFileSync(DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed };
  } catch (e) {
    console.warn('[db] load failed, starting empty:', e.message);
    return structuredClone(EMPTY);
  }
}

function save(state) {
  const dir = dirname(DB_PATH);
  if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = DB_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, DB_PATH);
}

export function now() {
  return Math.floor(Date.now() / 1000);
}

export function startOfIsoWeek(epochSec) {
  const d = new Date(epochSec * 1000);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

// ─── Welcome ──────────────────────────────────────────────────────────
export function isWelcomed(userId) {
  const s = load();
  return s.welcome_seen.some((w) => w.user_id === userId);
}

export function markWelcomed(userId) {
  const s = load();
  if (s.welcome_seen.some((w) => w.user_id === userId)) return false;
  s.welcome_seen.push({ user_id: userId, welcomed_at: now() });
  save(s);
  return true;
}

// ─── Raids ────────────────────────────────────────────────────────────
export function getOpenRaid() {
  const s = load();
  return s.raid_targets
    .filter((r) => r.closed_at == null)
    .sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

export function openRaidTarget(tweetUrl, postedBy) {
  const s = load();
  const id = s.next_raid_id++;
  s.raid_targets.push({ id, tweet_url: tweetUrl, posted_by: postedBy, created_at: now(), closed_at: null });
  save(s);
  return id;
}

export function closeRaidById(raidId) {
  const s = load();
  const r = s.raid_targets.find((r) => r.id === raidId);
  if (!r) return false;
  r.closed_at = now();
  save(s);
  return true;
}

export function recordRaidScore({ raidId, userId, username, proofUrl, points = 1 }) {
  const s = load();
  // Idempotent on (raid_id, user_id, proof_url)
  if (
    s.raid_scores.some(
      (x) => x.raid_id === raidId && x.user_id === userId && x.proof_url === proofUrl,
    )
  ) {
    return false;
  }
  s.raid_scores.push({
    raid_id: raidId,
    user_id: userId,
    username,
    proof_url: proofUrl,
    points,
    created_at: now(),
  });
  // Roll into weekly leaderboard.
  const weekStart = startOfIsoWeek(now());
  let row = s.leaderboard_weekly.find((r) => r.week_start === weekStart && r.user_id === userId);
  if (!row) {
    row = { week_start: weekStart, user_id: userId, username, total_points: 0 };
    s.leaderboard_weekly.push(row);
  }
  row.total_points += points;
  row.username = username;
  save(s);
  return true;
}

export function myWeekScore(userId) {
  const s = load();
  const weekStart = startOfIsoWeek(now());
  return (
    s.leaderboard_weekly.find((r) => r.week_start === weekStart && r.user_id === userId)
      ?.total_points ?? 0
  );
}

// ─── Leaderboard ──────────────────────────────────────────────────────
export function topNForCurrentWeek(n = 10) {
  const s = load();
  const weekStart = startOfIsoWeek(now());
  return s.leaderboard_weekly
    .filter((r) => r.week_start === weekStart)
    .sort((a, b) => b.total_points - a.total_points)
    .slice(0, n);
}

export function manualReward(username, points) {
  const s = load();
  const weekStart = startOfIsoWeek(now());
  // Manual rewards keyed by username only (user_id=0); rare event.
  let row = s.leaderboard_weekly.find(
    (r) => r.week_start === weekStart && r.user_id === 0 && r.username === username,
  );
  if (!row) {
    row = { week_start: weekStart, user_id: 0, username, total_points: 0 };
    s.leaderboard_weekly.push(row);
  }
  row.total_points += points;
  save(s);
}
