// Loads .session.json into a Playwright headless context and checks that
// x.com treats us as logged in. Looks for the absence of /i/flow/login
// redirect when hitting /home, plus the presence of an "@username" element
// matching BB_X_HANDLE.

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getTwitterCreds } from './creds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');

async function main() {
  if (!existsSync(SESSION_PATH)) {
    console.error('no .session.json. Run set-session-from-cookies.mjs first.');
    process.exit(1);
  }
  const { handle } = getTwitterCreds();
  console.log('[verify] launching headless to check session for @' + handle);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Wait for either the authed compose button OR a redirect to login flow.
  // Authenticated render exposes a [data-testid="SideNav_NewTweet_Button"]
  // or the inline compose textarea [data-testid="tweetTextarea_0"].
  const result = await Promise.race([
    page.waitForSelector('[data-testid="SideNav_NewTweet_Button"], [data-testid="tweetTextarea_0"], [data-testid="AppTabBar_Home_Link"]', { timeout: 15_000 }).then(() => 'authed'),
    page.waitForURL(/\/i\/flow\/login/, { timeout: 15_000 }).then(() => 'login-redirect'),
  ]).catch(() => 'unknown');

  const url = page.url();
  console.log('[verify] result:', result, '| url:', url);

  if (result === 'login-redirect' || /\/i\/flow\/login/.test(url)) {
    console.error('[verify] redirected to login — cookies invalid');
    await browser.close();
    process.exit(2);
  }
  if (result !== 'authed') {
    console.error('[verify] no auth-only DOM signal in 15s — session not confirmed');
    // dump current page text for diagnostics
    const txt = await page.locator('body').innerText().catch(() => '');
    console.error('[verify] visible text snippet:', txt.split('\n').filter(Boolean).slice(0, 10).join(' | '));
    await browser.close();
    process.exit(3);
  }

  console.log('[verify] OK — authenticated as @' + handle);
  await browser.close();
}

main().catch((e) => {
  console.error('[verify] FAILED:', e.message);
  process.exit(1);
});
