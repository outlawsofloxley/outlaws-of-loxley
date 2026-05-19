// Final pass: deeper inspection of daromer + insider_base recency, plus
// resolve canonical names of the survivors.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');

const HANDLES = [
  'daromer',          // wait longer, full DOM dump
  'DaRomer',          // case
  'DAROMER',
  'BaseInsider',      // possible reframing of insider_base
  'insiderbase',
];

async function fetchHandle(page, handle) {
  const out = { handle, status: '', bio: '', followers: '', body: '', tweets: [] };
  try {
    await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(4500);
    const bodyTxt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 800);
    out.body = bodyTxt;
    if (/account doesn’t exist|This account doesn't exist/i.test(bodyTxt)) { out.status = 'NX'; return out; }
    if (/Account suspended/i.test(bodyTxt)) { out.status = 'suspended'; return out; }
    if (/These posts are protected/i.test(bodyTxt)) out.status = 'protected';
    else out.status = 'ok';
    out.bio = (await page.locator('[data-testid="UserDescription"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const fl = await page.locator('a[href$="/verified_followers"], a[href$="/followers"]').first().innerText().catch(() => '');
    out.followers = fl.replace(/\n/g, ' ').trim();
    const arts = await page.locator('article[data-testid="tweet"]').all();
    for (const a of arts.slice(0, 4)) {
      const t = (await a.locator('[data-testid="tweetText"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      const tm = await a.locator('time').first().getAttribute('datetime').catch(() => null);
      const ls = await a.locator('a[href*="/status/"]').all();
      let h = null;
      for (const l of ls) { const x = await l.getAttribute('href'); if (x && /\/status\/\d+$/.test(x)) { h = x; break; } }
      out.tweets.push({ t, h, tm });
    }
  } catch (e) { out.status = 'err: ' + e.message.slice(0,80); }
  return out;
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: SESSION_PATH, viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();
const results = [];
for (const h of HANDLES) { process.stderr.write(`@${h}\n`); results.push(await fetchHandle(page, h)); await page.waitForTimeout(800); }
console.log(JSON.stringify(results, null, 2));
await browser.close();
