// Compose + post a single tweet to @BASEicBrawlers, optionally with an
// image attachment. Reads text from --text "..." and image from --image
// /path/to.png. Headless by default; HEADLESS=0 for visual debugging.
//
// Usage:
//   node tweet.mjs --text "hello" --image /path/to/img.png
//   node tweet.mjs --text-file ./draft.txt
//
// Posts via the inline composer on x.com/home, not the modal — the inline
// composer is more reliable across X UI churn.

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { getTwitterCreds } from './creds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');
const SCREENSHOT_DIR = join(__dirname, 'screenshots');

function arg(name) {
  const idx = process.argv.indexOf('--' + name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

const textArg = arg('text');
const textFileArg = arg('text-file');
const imageArg = arg('image');
const dryRun = process.argv.includes('--dry-run');

let text = textArg;
if (!text && textFileArg) text = readFileSync(textFileArg, 'utf8').trim();
if (!text) {
  console.error('usage: node tweet.mjs --text "..." [--image path] [--dry-run]');
  process.exit(1);
}
const image = imageArg ? resolve(imageArg) : undefined;
if (image && !existsSync(image)) {
  console.error('image not found:', image);
  process.exit(1);
}

async function shot(page, name) {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const p = join(SCREENSHOT_DIR, `tweet-${Date.now()}-${name}.png`);
  await page.screenshot({ path: p }).catch(() => {});
  console.log('[tweet] screenshot ->', p);
}

async function main() {
  const { handle } = getTwitterCreds();
  console.log(`[tweet] composing for @${handle}`);
  console.log(`[tweet] length: ${text.length} chars (limit 280 unless premium)`);
  console.log(`[tweet] image:  ${image || '(none)'}`);
  console.log(`[tweet] preview:\n---\n${text}\n---`);
  if (dryRun) {
    console.log('[tweet] --dry-run, not posting.');
    return;
  }

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Inline composer on /home: data-testid="tweetTextarea_0"
  const composer = page.locator('[data-testid="tweetTextarea_0"]').first();
  await composer.waitFor({ state: 'visible', timeout: 20_000 });
  await composer.click();
  await page.waitForTimeout(400);

  // Use keyboard.type for paragraph breaks (Enter inside contenteditable
  // creates a newline, not a submit).
  await page.keyboard.type(text, { delay: 8 });
  await page.waitForTimeout(600);

  if (image) {
    // The compose form has a hidden <input type=file> for media uploads.
    // It's typically scoped to data-testid="fileInput".
    const fileInput = page.locator('input[type="file"][accept*="image"], [data-testid="fileInput"]').first();
    await fileInput.setInputFiles(image);
    console.log('[tweet] image attached, waiting for upload');
    // Wait until the image preview appears in the composer.
    await page.waitForSelector('[data-testid="attachments"] img, [data-testid="tweetPhoto"] img', { timeout: 30_000 }).catch(async () => {
      await shot(page, 'image-not-previewed');
      throw new Error('image upload preview never appeared');
    });
  }
  // Post button — data-testid changed over time, accept both names.
  const postBtn = page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]').first();
  await postBtn.waitFor({ state: 'visible', timeout: 10_000 });

  // Poll the Post button's enabled state. X sets aria-disabled=true while
  // images are still uploading (even after the preview thumbnail appears) —
  // the previous fixed 800ms wait was too short for some attachments and
  // tripped the "disabled" guard. Poll up to 30s for the button to enable.
  let enabled = false;
  const enableDeadline = Date.now() + 30_000;
  while (Date.now() < enableDeadline) {
    const disabled = await postBtn.getAttribute('aria-disabled');
    if (disabled !== 'true') { enabled = true; break; }
    await page.waitForTimeout(400);
  }
  if (!enabled) {
    await shot(page, 'post-button-disabled');
    throw new Error('Post button never enabled within 30s — check character count or media upload state.');
  }
  await shot(page, 'pre-post');
  await postBtn.click();
  console.log('[tweet] post clicked');
  await page.waitForTimeout(4000);
  await shot(page, 'post-after');

  // Confirm: navigate to profile and grab top tweet text.
  await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="UserName"]', { timeout: 20_000 });
  await page.waitForTimeout(1500);
  const top = await page
    .locator('[data-testid="tweetText"]').first().innerText().catch(() => '');
  const topUrl = await page
    .locator('article[data-testid="tweet"] a[href*="/status/"]').first().getAttribute('href').catch(() => null);
  console.log('[tweet] top tweet text snippet:', top.slice(0, 120));
  if (topUrl) console.log('[tweet] top tweet url: https://x.com' + topUrl);

  await browser.close();
  console.log('[tweet] done.');
}

main().catch((e) => {
  console.error('[tweet] FAILED:', e.message);
  process.exit(1);
});
