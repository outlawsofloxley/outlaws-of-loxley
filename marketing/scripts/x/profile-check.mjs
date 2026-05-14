// Read-only inspection of @BASEicBrawlers profile state. Reports
// display name, bio, location, website, and whether a pfp/banner are
// set, without touching anything.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getTwitterCreds } from './creds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');

async function main() {
  const { handle } = getTwitterCreds();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-testid="UserName"], [data-testid="UserBio"], [data-testid="UserProfileHeader_Items"]', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Display name
  const name = await page.locator('[data-testid="UserName"] span').first().innerText().catch(() => '');
  // Bio
  const bio = await page.locator('[data-testid="UserDescription"]').first().innerText().catch(() => '');
  // Banner — Twitter's banner is an img inside [data-testid="UserProfileHeader_Items"]'s ancestor; simpler:
  const bannerImg = await page.locator('a[href*="header_photo"] img').first().getAttribute('src').catch(() => null);
  // PFP
  const pfpImg = await page.locator('a[href*="photo"] img[draggable="true"]').first().getAttribute('src').catch(() => null);
  // Website
  const website = await page.locator('[data-testid="UserUrl"]').first().innerText().catch(() => '');
  // Location
  const location = await page.locator('[data-testid="UserLocation"]').first().innerText().catch(() => '');

  console.log('=== @' + handle + ' current profile ===');
  console.log('display name :', name || '(blank)');
  console.log('bio          :', bio.replace(/\n/g, ' ') || '(blank)');
  console.log('location     :', location || '(blank)');
  console.log('website      :', website || '(blank)');
  console.log('pfp set      :', pfpImg ? 'YES' : 'NO', pfpImg ? `(src: ${pfpImg.slice(0, 80)}…)` : '');
  console.log('banner set   :', bannerImg ? 'YES' : 'NO', bannerImg ? `(src: ${bannerImg.slice(0, 80)}…)` : '');

  await browser.close();
}

main().catch((e) => {
  console.error('[check] FAILED:', e.message);
  process.exit(1);
});
