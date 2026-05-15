// Delete one of our own tweets by status URL or numeric ID. Cookie-session
// flow, mirrors set-bio.mjs / set-banner.mjs.
//
// Usage:
//   node delete-tweet.mjs --id 2055130848555319325
//   node delete-tweet.mjs --url https://x.com/BASEicBrawlers/status/2055130848555319325

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getTwitterCreds } from './creds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');
const SCREENSHOT_DIR = join(__dirname, 'screenshots');

function arg(name) {
  const idx = process.argv.indexOf('--' + name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

const idArg = arg('id');
const urlArg = arg('url');
let tweetId = idArg;
if (!tweetId && urlArg) {
  const m = urlArg.match(/status\/(\d+)/);
  if (m) tweetId = m[1];
}
if (!tweetId) {
  console.error('usage: node delete-tweet.mjs --id <numeric> | --url <status-url>');
  process.exit(1);
}

async function shot(page, name) {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const p = join(SCREENSHOT_DIR, `delete-${Date.now()}-${name}.png`);
  await page.screenshot({ path: p }).catch(() => {});
  console.log('[delete] screenshot ->', p);
}

async function main() {
  const { handle } = getTwitterCreds();
  const url = `https://x.com/${handle}/status/${tweetId}`;
  console.log('[delete] target:', url);

  const browser = await chromium.launch({ headless: process.env.HEADLESS === '0' ? false : true });
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('article[data-testid="tweet"]', { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await shot(page, '01-tweet-loaded');

  // Open the "..." caret menu on the tweet. data-testid="caret".
  const caret = page.locator('article[data-testid="tweet"] [data-testid="caret"]').first();
  await caret.click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await shot(page, '02-menu-open');

  // Click "Delete". Menu items use data-testid="Dropdown" wrapper and text.
  const deleteItem = page.locator('div[role="menuitem"]', { hasText: /delete/i }).first();
  await deleteItem.click({ timeout: 5_000 });
  await page.waitForTimeout(800);
  await shot(page, '03-confirm-modal');

  // Confirm modal: button data-testid="confirmationSheetConfirm"
  const confirmBtn = page.locator('[data-testid="confirmationSheetConfirm"]').first();
  await confirmBtn.click({ timeout: 5_000 });
  console.log('[delete] confirm clicked');
  await page.waitForTimeout(3000);
  await shot(page, '04-after-delete');

  // Verify — re-navigate to URL, should now be 404-ish or "post unavailable".
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText().catch(() => '');
  if (/this post (was|is) (deleted|unavailable)|page (doesn'?t exist|isn'?t available)/i.test(body)) {
    console.log('[delete] OK — tweet is gone');
  } else if (await page.locator('article[data-testid="tweet"]').count() === 0) {
    console.log('[delete] OK — tweet article no longer on page');
  } else {
    console.error('[delete] tweet may still be present — check screenshot');
    await shot(page, '05-post-verify');
  }

  await browser.close();
}

main().catch((e) => {
  console.error('[delete] FAILED:', e.message);
  process.exit(1);
});
