// Last check: load @daromer with longer wait + screenshot fallback to confirm
// whether it's a real KOL or a near-empty handle.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: join(__dirname, '.session.json'),
  viewport: { width: 1280, height: 1600 },
});
const page = await ctx.newPage();
for (const h of ['daromer', 'insider_base']) {
  await page.goto(`https://x.com/${h}`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const txt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  console.log(`===== @${h} body (1500 chars) =====`);
  console.log(txt.slice(0, 1500));
  console.log('\n');
}
await browser.close();
