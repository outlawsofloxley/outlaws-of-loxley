// X (Twitter) login flow with persistent storage state.
//
// Reads BB_TWITTER_* from ~/.claude/secrets/secrets.env, drives the
// x.com/i/flow/login form, handles the email-verification challenge that
// X throws on unrecognised machines, and handles TOTP 2FA if the seed
// is present. Saves session to ./.session.json on success — subsequent
// scripts (profile-setup.mjs, tweet.mjs, post.mjs) load it and skip
// straight to the action.
//
// Default is HEADED on first run so X's bot heuristics don't pin us as
// a script. Re-runs with a saved session can go HEADLESS=1 — X stops
// scrutinising once you have valid cookies.

import { chromium } from 'playwright';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as OTPAuth from 'otpauth';
import { getTwitterCreds } from './creds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');
const SCREENSHOT_DIR = join(__dirname, 'screenshots');

const HEADLESS = process.env.HEADLESS === '1';
const VERBOSE = process.env.VERBOSE === '1';

function log(...a) { console.log('[login]', ...a); }
function vlog(...a) { if (VERBOSE) console.log('[login.v]', ...a); }

async function screenshot(page, name) {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const p = join(SCREENSHOT_DIR, `${Date.now()}-${name}.png`);
  await page.screenshot({ path: p, fullPage: false }).catch(() => {});
  vlog('screenshot ->', p);
}

async function typeSlow(locator, text) {
  await locator.click();
  await locator.fill('');
  for (const ch of text) {
    await locator.type(ch, { delay: 40 + Math.floor(Math.random() * 60) });
  }
}

async function main() {
  const { username, password, email, totpSecret, handle } = getTwitterCreds();
  log(`logging in as @${handle} (username=${username}, email=${email})`);

  // Persistent context: launches with a real user-data-dir so Chrome looks
  // like a fresh install rather than a Playwright child. X is aggressive
  // about flagging the latter and resetting the login form silently.
  const USER_DIR = join(__dirname, '.chrome-profile');
  if (!existsSync(USER_DIR)) mkdirSync(USER_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Mask navigator.webdriver + a few common automation fingerprints.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // chrome runtime presence — automation strips this, real Chrome has it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(window).chrome) (window).chrome = { runtime: {} };
    // permissions.query for notifications often returns differently in headless.
    const orig = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (p) =>
      p?.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : orig(p);
  });

  const page = context.pages()[0] || await context.newPage();

  log('opening x.com/i/flow/login');
  await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });

  // STEP 1: username. Press Enter via keyboard instead of clicking Next —
  // X's form sometimes treats programmatic clicks as suspicious and resets
  // the field. Enter on the input is more human.
  const usernameField = page.locator('input[autocomplete="username"]').first();
  await usernameField.waitFor({ state: 'visible', timeout: 30_000 });
  await typeSlow(usernameField, username);
  await page.waitForTimeout(500 + Math.random() * 500);
  await screenshot(page, '01-username-filled');
  await usernameField.press('Enter');

  // STEP 2: either password (happy path) OR an "unusual login, enter email"
  // challenge. Wait for one of them by visible attribute uniqueness.
  // Password input has [autocomplete="current-password"]; the challenge
  // input has data-testid="ocfEnterTextTextInput". The first-step username
  // field has neither of those, so the race is unambiguous.
  const pwSel = 'input[autocomplete="current-password"]';
  const challengeSel = 'input[data-testid="ocfEnterTextTextInput"]';
  let step2;
  try {
    step2 = await Promise.race([
      page.waitForSelector(pwSel, { state: 'visible', timeout: 20_000 }).then(() => 'password'),
      page.waitForSelector(challengeSel, { state: 'visible', timeout: 20_000 }).then(() => 'challenge'),
    ]);
  } catch (e) {
    await screenshot(page, '02-step2-stuck');
    // diagnostics: dump visible text for debugging without leaking secrets
    const text = await page.locator('body').innerText().catch(() => '');
    const snippet = text.split('\n').filter((l) => l.trim()).slice(0, 30).join(' | ');
    throw new Error(`After username, neither password nor email-challenge appeared in 20s. Screenshot saved. Visible page text: ${snippet}`);
  }
  vlog('step2 ->', step2);

  if (step2 === 'challenge') {
    log('unusual-login challenge shown, filling email');
    const ch = page.locator(challengeSel).first();
    await typeSlow(ch, email);
    await page.waitForTimeout(500);
    await screenshot(page, '02-email-challenge');
    await ch.press('Enter');
  }

  // STEP 3: password
  const pwField = page.locator(pwSel).first();
  await pwField.waitFor({ state: 'visible', timeout: 30_000 });
  await typeSlow(pwField, password);
  await page.waitForTimeout(500 + Math.random() * 500);
  await screenshot(page, '03-password-filled');
  await pwField.press('Enter');

  // STEP 4: optional 2FA
  try {
    const totpField = page
      .locator('input[autocomplete="one-time-code"], input[data-testid="ocfEnterTextTextInput"]')
      .first();
    await totpField.waitFor({ state: 'visible', timeout: 6000 });
    if (!totpSecret) {
      await screenshot(page, '04-totp-blocked');
      throw new Error(
        'X requested a 2FA code but BB_TWITTER_2FA_SECRET is empty. Paste the TOTP seed into secrets.env then re-run.'
      );
    }
    const totp = new OTPAuth.TOTP({
      issuer: 'X',
      label: handle,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(totpSecret.replace(/\s+/g, '')),
    });
    const code = totp.generate();
    log('filling TOTP code');
    await typeSlow(totpField, code);
    await screenshot(page, '04-totp-filled');
    await page.getByRole('button', { name: /^next$|^verify$|^log in$/i }).first().click();
  } catch (e) {
    if (e.message?.includes('BB_TWITTER_2FA_SECRET')) throw e;
    vlog('no 2FA prompt — already past it');
  }

  // STEP 5: confirm we landed authenticated
  // X redirects to /home after a successful login.
  await page.waitForURL(/x\.com\/home/, { timeout: 30_000 }).catch(() => {});
  const finalUrl = page.url();
  log('landed at', finalUrl);
  await screenshot(page, '05-final');

  if (!/x\.com\/home/.test(finalUrl)) {
    throw new Error(`Login did not land on /home (final url: ${finalUrl}). Check the latest screenshot in ${SCREENSHOT_DIR}.`);
  }

  // Persist session for subsequent scripts.
  const state = await context.storageState();
  writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
  log('session saved ->', SESSION_PATH);

  await context.close();
  log('done.');
}

main().catch((e) => {
  console.error('[login] FAILED:', e.message);
  process.exit(1);
});
