// Retry pass for unresolved/variant handles.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');

// Candidates to try (original + likely variants)
const HANDLES = [
  'daromer',           // exists per pass 1 but empty bio/tweets — verify suspended/private
  '_daromer',          // playbook hinted this might be real one
  'keccak_254',        // alt
  'keccak2_5_4',
  'Ramonos',           // alt for 0xRamonos
  '0xramonos',         // case variant
  'basebookHQ',        // re-verify
  'basebookhq',        // case
  'BaseBookHQ',
  'cygaar',
  'cygaar_',
  '0xcygaar',
  'OnchainHeroes',     // likely real handle (no underscore)
  'OnchainHeroesNFT',
];

async function fetchHandle(page, handle) {
  const out = { handle, exists: null, bio: '', followers: null, tweets: [], notes: '' };
  try {
    await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2500);
    const bodyTxt = await page.locator('body').innerText().catch(() => '');
    if (/account doesn’t exist|This account doesn't exist|Hmm.{0,40}page doesn’t exist/i.test(bodyTxt)) {
      out.exists = false; out.notes = 'account does not exist'; return out;
    }
    if (/Account suspended/i.test(bodyTxt)) { out.exists = false; out.notes = 'suspended'; return out; }
    if (/These posts are protected/i.test(bodyTxt)) { out.exists = true; out.notes = 'protected (private)'; }
    out.exists = true;
    out.bio = (await page.locator('[data-testid="UserDescription"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const followLink = await page.locator(`a[href$="/verified_followers"], a[href$="/followers"]`).first().innerText().catch(() => '');
    if (followLink) {
      const numPart = followLink.split('\n')[0] || followLink;
      out.followersRaw = numPart.trim();
    }
    const articles = await page.locator('article[data-testid="tweet"]').all();
    for (const art of articles.slice(0, 5)) {
      try {
        const txt = (await art.locator('[data-testid="tweetText"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        const links = await art.locator('a[href*="/status/"]').all();
        let href = null;
        for (const l of links) {
          const h = await l.getAttribute('href');
          if (h && /\/status\/\d+$/.test(h)) { href = h; break; }
        }
        const time = await art.locator('time').first().getAttribute('datetime').catch(() => null);
        if (txt || href) {
          out.tweets.push({ text: txt, href, time });
          if (out.tweets.length >= 3) break;
        }
      } catch (_) {}
    }
  } catch (e) { out.notes = `fetch error: ${e.message.slice(0, 200)}`; }
  return out;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: SESSION_PATH,
  viewport: { width: 1280, height: 1200 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
});
const page = await context.newPage();
const results = [];
for (const h of HANDLES) {
  process.stderr.write(`@${h}...\n`);
  results.push(await fetchHandle(page, h));
  await page.waitForTimeout(900);
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
