// Upload marketing/art/x-banner.png as the @BASEicBrawlers header image.
// Opens the Edit profile modal, clicks the banner camera button, uploads
// the file, accepts the default position, then Save.

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { getTwitterCreds } from './creds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');
const BANNER_PATH = resolve(__dirname, '..', '..', 'art', 'x-banner.png');
const SCREENSHOT_DIR = join(__dirname, 'screenshots');

if (!existsSync(BANNER_PATH)) {
  console.error('banner not found at', BANNER_PATH);
  process.exit(1);
}

async function shot(page, name) {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const p = join(SCREENSHOT_DIR, `banner-${Date.now()}-${name}.png`);
  await page.screenshot({ path: p }).catch(() => {});
  console.log('[banner] screenshot ->', p);
}

async function main() {
  const { handle } = getTwitterCreds();
  console.log('[banner] uploading', BANNER_PATH, 'to @' + handle);
  const browser = await chromium.launch({ headless: process.env.HEADLESS === '1' });
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

  // Click "Edit profile" — the button has data-testid="editProfileButton" in
  // modern X UI; falls back to text match.
  const editBtn = page.locator('[data-testid="editProfileButton"]').first();
  await editBtn.click({ timeout: 10_000 });
  console.log('[banner] edit modal opening');
  await page.waitForTimeout(2000);
  await shot(page, '02-edit-modal');

  // Inside the modal: the banner upload input is a hidden <input type=file>
  // whose data-testid is typically "fileInput" alongside a camera button.
  // Strategy: find the banner camera button (positioned over the header
  // image area) and click it, then set the file on the file chooser.
  // The simpler approach is to grab the input by accept=image/* + index 0
  // (banner is rendered first in DOM, pfp second).
  const fileInputs = page.locator('input[type="file"][accept*="image"]');
  const count = await fileInputs.count();
  console.log('[banner] found', count, 'file inputs in modal');
  if (count < 1) {
    await shot(page, '03-no-file-input');
    throw new Error('no file input found in edit modal');
  }
  // First one is the banner; second is the pfp. Verify by data-testid if set.
  await fileInputs.nth(0).setInputFiles(BANNER_PATH);
  console.log('[banner] file set on first input');
  await page.waitForTimeout(2500);
  await shot(page, '04-after-upload');

  // X may show a crop / position editor with an Apply button. data-testid
  // "applyButton" is common; fall back to text.
  const applyBtn = page.locator('[data-testid="applyButton"]').first();
  if (await applyBtn.isVisible().catch(() => false)) {
    console.log('[banner] crop editor shown, clicking Apply');
    await applyBtn.click();
    await page.waitForTimeout(1500);
    await shot(page, '05-after-apply');
  }

  // Save the modal — data-testid "Profile_Save_Button"
  const saveBtn = page.locator('[data-testid="Profile_Save_Button"]').first();
  await saveBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await saveBtn.click();
  console.log('[banner] save clicked');
  await page.waitForTimeout(4000);
  await shot(page, '06-after-save');

  // Confirm banner is now set by re-reading the profile.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="UserName"]', { timeout: 20_000 });
  await page.waitForTimeout(1500);
  const bannerImg = await page
    .locator('a[href*="header_photo"] img')
    .first()
    .getAttribute('src')
    .catch(() => null);
  if (bannerImg) {
    console.log('[banner] OK — banner img src:', bannerImg.slice(0, 100));
  } else {
    console.error('[banner] save reported success but banner not visible on reload');
    await shot(page, '07-post-reload');
  }

  await browser.close();
}

main().catch((e) => {
  console.error('[banner] FAILED:', e.message);
  process.exit(1);
});
