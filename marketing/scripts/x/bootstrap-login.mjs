// One-time manual-login bootstrap.
//
// X aggressively flags scripted credential submission and silently resets
// the form. The workaround: launch chromium with a real user-data-dir,
// open x.com/login, and let the human do the username/password/2FA dance
// once. As soon as we detect /home in the URL, we close the browser and
// the persistent context already holds the cookies/localStorage.
//
// Run again later with HEADLESS=1 and the saved profile picks up where
// the human left off, no further interaction needed.

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getTwitterCreds } from './creds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_DIR = join(__dirname, '.chrome-profile');
const SESSION_PATH = join(__dirname, '.session.json');

async function main() {
  const { handle, username, email } = getTwitterCreds();
  console.log(`[bootstrap] launching chromium for @${handle}`);
  console.log(`[bootstrap] log in manually as:`);
  console.log(`              username:  ${username}`);
  console.log(`              email:     ${email}`);
  console.log(`              password:  (in secrets.env, paste from there)`);
  console.log(`[bootstrap] I'll auto-close once /home loads.`);

  if (!existsSync(USER_DIR)) mkdirSync(USER_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });

  console.log('[bootstrap] waiting for /home (timeout 5min) …');
  try {
    await page.waitForURL(/x\.com\/home/, { timeout: 5 * 60_000 });
  } catch {
    console.error('[bootstrap] timed out before /home. Either you didn\'t finish logging in, or X is throwing a captcha. Re-run when ready.');
    await context.close();
    process.exit(1);
  }

  console.log('[bootstrap] /home reached — saving session');
  const state = await context.storageState();
  writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`[bootstrap] saved -> ${SESSION_PATH}`);
  console.log(`[bootstrap] profile dir kept at -> ${USER_DIR}`);
  await context.close();
}

main().catch((e) => {
  console.error('[bootstrap] FAILED:', e.message);
  process.exit(1);
});
