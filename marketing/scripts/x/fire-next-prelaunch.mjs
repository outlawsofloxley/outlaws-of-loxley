// Fire the next un-fired prelaunch tweet draft from
// marketing/content/scheduled-prelaunch/. Each draft is a .txt file
// with a body and optional `IMAGE: relative/path.png` line. After a
// successful post, the file is renamed to *.fired so the next run picks
// the next one.
//
// Usage: node fire-next-prelaunch.mjs
//        node fire-next-prelaunch.mjs --dry-run

import { readdirSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRAFT_DIR = resolve(__dirname, '..', '..', 'content', 'scheduled-prelaunch');
const TWEET_SCRIPT = resolve(__dirname, 'tweet.mjs');
const DRY_RUN = process.argv.includes('--dry-run');

if (!existsSync(DRAFT_DIR)) {
  console.error('[fire-next] no draft dir at', DRAFT_DIR);
  process.exit(1);
}

const drafts = readdirSync(DRAFT_DIR)
  .filter((f) => f.endsWith('.txt') && !f.endsWith('.fired.txt'))
  .sort();

if (drafts.length === 0) {
  console.log('[fire-next] queue empty — nothing to post');
  process.exit(0);
}

const next = drafts[0];
const fullPath = join(DRAFT_DIR, next);
const raw = readFileSync(fullPath, 'utf8');

// Extract optional `IMAGE: ...` line.
const lines = raw.split('\n');
const imgIdx = lines.findIndex((l) => /^IMAGE:\s*/i.test(l));
let imagePath = null;
let bodyLines = lines;
if (imgIdx >= 0) {
  imagePath = resolve(__dirname, '..', '..', '..', lines[imgIdx].replace(/^IMAGE:\s*/i, '').trim());
  bodyLines = lines.filter((_, i) => i !== imgIdx);
}
const body = bodyLines.join('\n').trim();

console.log('[fire-next] firing:', next);
console.log('[fire-next] body length:', body.length, 'chars');
if (imagePath) console.log('[fire-next] image:', imagePath);
if (DRY_RUN) {
  console.log('---');
  console.log(body);
  console.log('---');
  console.log('[fire-next] dry-run, not firing');
  process.exit(0);
}

const args = ['--text', body];
if (imagePath) args.push('--image', imagePath);
const result = spawnSync('node', [TWEET_SCRIPT, ...args], { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('[fire-next] tweet.mjs failed with status', result.status);
  process.exit(result.status || 1);
}

// Mark fired (rename so the next run picks the next file).
const fired = fullPath.replace(/\.txt$/, '.fired.txt');
renameSync(fullPath, fired);
console.log('[fire-next] marked:', fired);
