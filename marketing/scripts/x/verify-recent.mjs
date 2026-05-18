import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: './.session.json', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto('https://x.com/BASEicBrawlers', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
const links = await page.locator('a[href*="/BASEicBrawlers/status/"]').all();
const seen = new Set();
for (const l of links.slice(0, 15)) {
  const href = await l.getAttribute('href');
  if (href && /\/status\/\d+$/.test(href)) seen.add(href);
}
console.log('recent tweets:', [...seen].slice(0, 5));
await browser.close();
