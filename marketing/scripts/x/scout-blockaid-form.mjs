#!/usr/bin/env node
/**
 * Scout the Blockaid report portal — loads the SPA, waits for it to render,
 * dumps the form structure, screenshots the page. No submission.
 *
 * Use this to figure out field selectors before writing the real submit.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(HERE, 'screenshots');
mkdirSync(SHOTS_DIR, { recursive: true });

const headed = process.argv.includes('--headed');
const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();

console.log('[scout-blockaid] navigating…');
await page.goto('https://report.blockaid.io/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: join(SHOTS_DIR, 'blockaid-scout-00.png'), fullPage: true });
console.log('[scout-blockaid] first screenshot saved');

// Click "Mistake" (false-positive path)
const mistakeBtn = page.locator('text=Mistake').first();
if (await mistakeBtn.count()) {
  await mistakeBtn.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SHOTS_DIR, 'blockaid-scout-01-mistake.png'), fullPage: true });
  console.log('[scout-blockaid] clicked Mistake, screenshot saved');

  // Look for a "Continue" or "Next" button if the click only selected the radio
  const continueBtn = page.locator('button', { hasText: /continue|next|proceed/i }).first();
  if (await continueBtn.count() && await continueBtn.isVisible()) {
    await continueBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(SHOTS_DIR, 'blockaid-scout-02-after-continue.png'), fullPage: true });
    console.log('[scout-blockaid] clicked Continue, screenshot saved');
  }
}

// Dump every input / textarea / select / button on the page, with their labels.
const structure = await page.evaluate(() => {
  const out = [];
  const els = document.querySelectorAll('input, textarea, select, button, [role="combobox"], [role="button"]');
  els.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const type = el.getAttribute('type') || '';
    const name = el.getAttribute('name') || '';
    const id = el.getAttribute('id') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const labelFor = id ? document.querySelector(`label[for="${id}"]`)?.innerText?.trim() : '';
    const innerText = el.tagName === 'BUTTON' ? (el.innerText || '').trim().slice(0, 50) : '';
    const visible = el.getBoundingClientRect().height > 0;
    out.push({ tag, role, type, name, id, placeholder, ariaLabel, labelFor, innerText, visible });
  });
  return out;
});

console.log(`[scout-blockaid] found ${structure.length} interactive elements`);
const summaryPath = join(SHOTS_DIR, 'blockaid-scout-structure.json');
writeFileSync(summaryPath, JSON.stringify(structure, null, 2));
console.log(`[scout-blockaid] structure dumped to ${summaryPath}`);

// Also capture page text for context
const bodyText = await page.locator('body').innerText();
const textPath = join(SHOTS_DIR, 'blockaid-scout-text.txt');
writeFileSync(textPath, bodyText);
console.log(`[scout-blockaid] page text saved to ${textPath} (${bodyText.length} chars)`);

await browser.close();
console.log('[scout-blockaid] done.');
