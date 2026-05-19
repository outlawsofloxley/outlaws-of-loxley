// One-off: fetch profile + latest tweets for a list of KOL handles using
// the authenticated @BASEicBrawlers session. Writes JSON to stdout.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');

const HANDLES = [
  'daromer',
  'keccak254',
  '0xRamonos',
  'basebookHQ',
  'insider_base',
  'base',
  'jessepollak',
  'cygaar',
  'frenpetonbase',
  'amittm',
  'Onchain_Heroes',
];

function parseFollowers(text) {
  if (!text) return null;
  const m = text.match(/([\d.,]+)\s*([KMB]?)/i);
  if (!m) return text;
  const n = parseFloat(m[1].replace(/,/g, ''));
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] || 1;
  return Math.round(n * mult);
}

async function fetchHandle(page, handle) {
  const out = { handle, exists: null, bio: '', followers: null, tweets: [], notes: '' };
  try {
    const resp = await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2500);

    // Detect "doesn't exist"
    const bodyTxt = await page.locator('body').innerText().catch(() => '');
    if (/account doesn’t exist|This account doesn't exist|Hmm.{0,40}page doesn’t exist/i.test(bodyTxt)) {
      out.exists = false;
      out.notes = 'account does not exist';
      return out;
    }
    if (/Account suspended/i.test(bodyTxt)) {
      out.exists = false;
      out.notes = 'suspended';
      return out;
    }

    out.exists = true;

    // bio
    out.bio = (await page.locator('[data-testid="UserDescription"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

    // followers — try the verified format
    const followLink = await page.locator(`a[href$="/verified_followers"], a[href$="/followers"]`).first().innerText().catch(() => '');
    if (followLink) {
      // typical text: "12.3K\nFollowers" or "1,234\nFollowers"
      const numPart = followLink.split('\n')[0] || followLink;
      out.followers = parseFollowers(numPart);
      out.followersRaw = numPart.trim();
    }

    // latest tweets — pull article elements
    const articles = await page.locator('article[data-testid="tweet"]').all();
    for (const art of articles.slice(0, 6)) {
      try {
        const txt = (await art.locator('[data-testid="tweetText"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        const linkEl = await art.locator(`a[href*="/${handle.toLowerCase()}/status/"], a[href*="/status/"]`).filter({ hasText: /^$|·|\d/ }).first();
        const href = await linkEl.getAttribute('href').catch(() => null);
        const time = await art.locator('time').first().getAttribute('datetime').catch(() => null);
        const isPinned = (await art.innerText().catch(() => '')).startsWith('Pinned');
        if (txt || href) {
          out.tweets.push({ text: txt, href, time, isPinned });
          if (out.tweets.length >= 3) break;
        }
      } catch (_) {}
    }
  } catch (e) {
    out.notes = `fetch error: ${e.message.slice(0, 200)}`;
  }
  return out;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: { width: 1280, height: 1200 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const results = [];
  for (const h of HANDLES) {
    process.stderr.write(`fetching @${h}…\n`);
    const r = await fetchHandle(page, h);
    results.push(r);
    await page.waitForTimeout(1200);
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
