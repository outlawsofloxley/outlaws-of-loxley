import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const text = readFileSync('./drafts/team-lock.txt', 'utf8').trim();
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: './.session.json', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
// dismiss any modal
const closeBtns = await page.locator('[aria-label="Close"], [data-testid="app-bar-close"], [data-testid="confirmationSheetCancel"]').all();
for (const b of closeBtns) { try { await b.click({ timeout: 1500 }); console.log('closed a modal'); } catch {} }
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
// click compose
await page.keyboard.press('n');
await page.waitForTimeout(1500);
const editor = page.locator('div[data-testid="tweetTextarea_0"]').first();
await editor.click();
await page.keyboard.type(text, { delay: 12 });
await page.waitForTimeout(2500);
// post via Ctrl+Enter
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(8000);
const links = await page.locator('a[href*="/BASEicBrawlers/status/"]').all();
let posted = null;
for (const l of links) {
  const href = await l.getAttribute('href');
  if (href && /\/status\/\d+$/.test(href)) { posted = href; break; }
}
console.log('latest status link:', posted ?? '(none found)');
await browser.close();
