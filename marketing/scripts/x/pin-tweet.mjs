// Pin one of our own tweets to the @BASEicBrawlers profile. Cookie-session
// flow, mirrors delete-tweet.mjs.
//
// Usage:
//   node pin-tweet.mjs --id 2055204776955044096
//   node pin-tweet.mjs --url https://x.com/BASEicBrawlers/status/2055204776955044096

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
  console.error('usage: node pin-tweet.mjs --id <numeric> | --url <status-url>');
  process.exit(1);
}

async function shot(page, name) {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const p = join(SCREENSHOT_DIR, `pin-${Date.now()}-${name}.png`);
  await page.screenshot({ path: p }).catch(() => {});
  console.log('[pin] screenshot ->', p);
}

async function main() {
  const { handle } = getTwitterCreds();
  const url = `https://x.com/${handle}/status/${tweetId}`;
  console.log('[pin] target:', url);

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

  const caret = page.locator('article[data-testid="tweet"] [data-testid="caret"]').first();
  await caret.click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await shot(page, '02-menu-open');

  const pinItem = page.locator('div[role="menuitem"]', { hasText: /pin to your profile|pin to profile/i }).first();
  await pinItem.click({ timeout: 5_000 });
  await page.waitForTimeout(800);
  await shot(page, '03-confirm-modal');

  const confirmBtn = page.locator('[data-testid="confirmationSheetConfirm"]').first();
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
    console.log('[pin] confirm clicked');
    await page.waitForTimeout(2500);
  }
  await shot(page, '04-after-pin');
  console.log('[pin] done — verify on profile at https://x.com/' + handle);
  await browser.close();
}

main().catch((e) => {
  console.error('[pin] FAILED:', e.message);
  process.exit(1);
});
