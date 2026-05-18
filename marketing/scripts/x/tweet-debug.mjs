import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const text = readFileSync('./drafts/soft-shill-1.txt', 'utf8').trim();
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: './.session.json', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'screenshots/dbg-1-home.png' });

// Try clicking the inline composer area directly
const inlineEditor = page.locator('div[data-testid="tweetTextarea_0"]').first();
const visible = await inlineEditor.isVisible().catch(() => false);
console.log('inline editor visible on /home:', visible);

if (!visible) {
  // Try the compose nav button instead
  await page.locator('a[href="/compose/post"]').first().click({ timeout: 5000 }).catch(e => console.log('compose link click err:', e.message));
  await page.waitForTimeout(2500);
}

const editor = page.locator('div[data-testid="tweetTextarea_0"]').first();
await editor.click();
await page.keyboard.type(text, { delay: 15 });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'screenshots/dbg-2-typed.png' });

// Find the post button. Poll its aria-disabled state.
const postBtn = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first();
let attempts = 0;
while (attempts++ < 30) {
  const disabled = await postBtn.getAttribute('aria-disabled').catch(() => '');
  if (disabled !== 'true') break;
  await page.waitForTimeout(500);
}
const disabledFinal = await postBtn.getAttribute('aria-disabled');
console.log('post button aria-disabled:', disabledFinal);
await page.screenshot({ path: 'screenshots/dbg-3-pre-click.png' });
await postBtn.click({ force: true });
console.log('clicked post (force=true)');
await page.waitForTimeout(6000);
await page.screenshot({ path: 'screenshots/dbg-4-post-click.png' });
// Re-check tweets
const links = await page.locator('a[href*="/BASEicBrawlers/status/"]').all();
const ids = [];
for (const l of links.slice(0, 6)) {
  const href = await l.getAttribute('href');
  if (href && /\/status\/\d+$/.test(href)) ids.push(href);
}
console.log('recent tweets after post:', ids.slice(0, 5));
await browser.close();
