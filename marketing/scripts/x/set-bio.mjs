// Update the @BASEicBrawlers bio. Mirrors set-banner.mjs's flow:
// open Edit profile modal → clear the bio textarea → type new bio → Save.
//
// Usage:
//   node set-bio.mjs                              # uses DEFAULT_BIO below
//   BIO="custom bio text" node set-bio.mjs        # custom
//
// X bio limit is 160 characters. Script asserts before submit.

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getTwitterCreds } from './creds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');
const SCREENSHOT_DIR = join(__dirname, 'screenshots');

const DEFAULT_BIO =
  'on-chain arena on @base. 2,000 pixel-art warriors. $1 per fight (brawl or eth). win, die, resurrect. discord.gg/RjvBEA5CVd';

async function shot(page, name) {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const p = join(SCREENSHOT_DIR, `bio-${Date.now()}-${name}.png`);
  await page.screenshot({ path: p }).catch(() => {});
  console.log('[bio] screenshot ->', p);
}

async function main() {
  const bio = process.env.BIO || DEFAULT_BIO;
  if (bio.length > 160) {
    console.error('[bio] FATAL: bio is', bio.length, 'chars, max 160');
    process.exit(1);
  }
  const { handle } = getTwitterCreds();
  console.log('[bio] setting bio on @' + handle + ' (' + bio.length + ' chars)');
  console.log('[bio] >> ' + bio);

  const browser = await chromium.launch({ headless: process.env.HEADLESS === '0' ? false : true });
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-testid="UserName"]', { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await shot(page, '01-profile-loaded');

  const editBtn = page.locator('[data-testid="editProfileButton"]').first();
  await editBtn.click({ timeout: 10_000 });
  console.log('[bio] edit modal opening');
  await page.waitForTimeout(2000);
  await shot(page, '02-edit-modal');

  // The bio textarea changes testid frequently in X. Try several locators
  // in order, falling back to "textarea with maxlength=160" (X enforces 160).
  let bioField = page.locator('[data-testid="UserDescriptionField"]').first();
  if (!(await bioField.isVisible().catch(() => false))) {
    bioField = page.locator('textarea[name="description"]').first();
  }
  if (!(await bioField.isVisible().catch(() => false))) {
    bioField = page.locator('textarea[maxlength="160"]').first();
  }
  if (!(await bioField.isVisible().catch(() => false))) {
    // Last resort: any visible textarea inside the edit-profile dialog.
    bioField = page.locator('[role="dialog"] textarea').first();
  }
  if (!(await bioField.isVisible().catch(() => false))) {
    await shot(page, '03-no-bio-field');
    throw new Error('bio textarea not visible in edit modal');
  }
  // Select-all and replace. Triple-click selects current value cleanly.
  await bioField.click({ clickCount: 3 });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  await bioField.type(bio, { delay: 8 });
  console.log('[bio] new bio typed');
  await page.waitForTimeout(800);
  await shot(page, '04-bio-typed');

  const saveBtn = page.locator('[data-testid="Profile_Save_Button"]').first();
  await saveBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await saveBtn.click();
  console.log('[bio] save clicked');
  await page.waitForTimeout(4000);
  await shot(page, '05-after-save');

  // Verify: reload + scrape the rendered bio.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="UserName"]', { timeout: 20_000 });
  await page.waitForTimeout(1500);
  const renderedBio = await page
    .locator('[data-testid="UserDescription"]')
    .first()
    .innerText()
    .catch(() => null);
  if (renderedBio) {
    console.log('[bio] OK — rendered bio: ' + renderedBio);
  } else {
    console.error('[bio] save reported success but bio not visible on reload');
    await shot(page, '06-post-reload');
  }

  await browser.close();
}

main().catch((e) => {
  console.error('[bio] FAILED:', e.message);
  process.exit(1);
});
