#!/usr/bin/env node
/**
 * Submits a ChainPatrol false-positive dispute for baseicbrawlers.com.
 *
 * ChainPatrol is one of the reputation feeds MetaMask uses for its
 * "deceptive request" warnings. New legit projects often land on their
 * suspect list until a dispute is filed.
 *
 * Form: URL + email + (optional) details. No captcha at time of writing.
 *
 * Usage:
 *   node submit-chainpatrol-dispute.mjs            # actually submit
 *   node submit-chainpatrol-dispute.mjs --dry-run  # render only, no submit
 *   node submit-chainpatrol-dispute.mjs --headed   # debug: visible browser
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(HERE, 'screenshots');
mkdirSync(SHOTS_DIR, { recursive: true });

const dryRun = process.argv.includes('--dry-run');
const headed = process.argv.includes('--headed');

const url = 'https://baseicbrawlers.com';
const email = 'darren@dnbs.com.au';
const details = [
  'BASEic Brawlers is a legitimate on-chain pixel-art arena game on Base mainnet (chain 8453), live since 2026-05-18.',
  '',
  'MetaMask currently shows a "deceptive request — interaction with a known malicious address" warning when users approve/mint at baseicbrawlers.com/mint. This is a false positive — there is no malicious activity, the mint flow simply sends ETH to receive an NFT from our MintDrop contract.',
  '',
  'Trust signals:',
  '- LP burned to 0xdead permanently at launch (no rugpull possible)',
  '- BRAWL token ownership renounced (basescan: 0x96fb0c4d8e8fceae7fe39d05ca411262d3eaa38d)',
  '- All 8 contracts verified on Basescan with public source code',
  '- Public GitHub repo: https://github.com/baseicbrawlers/baseic-brawlers',
  '- Public handbook: https://docs.baseicbrawlers.com',
  '- 151 forge tests passing',
  '',
  'Contract addresses on Base mainnet (chain 8453):',
  '- BRAWL token: 0x96fb0c4d8e8fceae7fe39d05ca411262d3eaa38d',
  '- Brawlers (NFT): 0xb9701b88d717d9245927cb605df2b0f88718c0d3',
  '- MintDrop: 0x6394151f65b81359a47e193f8a0c80c4c2961544',
  '- Duel: 0xe0d53cf84d599a2257062152effc026cfef6205d',
  '- DuelRouter: 0xbd3abbf670afed06f6bcbe78ebcea93a58a0a4cb',
  '- Marketplace: 0xa2fea2f60a7f1010ee2f7f008801b365ddf79815',
  '- Graveyard: 0x3d5f560ef4fd09015bdd203a0e65d9aa94d96480',
  '- BRAWLTimelock: 0xdD4Fda3AED746E81481d58958e6E8c6D2e7cC761',
  '',
  'Please remove the malicious flag for baseicbrawlers.com and the contract addresses listed. Happy to provide any additional verification.',
].join('\n');

const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

console.log('[chainpatrol] navigating to https://app.chainpatrol.io/dispute');
await page.goto('https://app.chainpatrol.io/dispute', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.screenshot({ path: join(SHOTS_DIR, 'chainpatrol-01-loaded.png'), fullPage: true });

// Fields: URL, Email, Additional details, Submit dispute
// Selectors are guesses based on the WebFetch preview; we try several patterns.
async function fill(label, value) {
  const tryEach = [
    `input[placeholder*="${label}" i]`,
    `input[aria-label*="${label}" i]`,
    `input[name*="${label.toLowerCase()}" i]`,
    `textarea[placeholder*="${label}" i]`,
    `textarea[aria-label*="${label}" i]`,
    `textarea[name*="${label.toLowerCase()}" i]`,
  ];
  for (const sel of tryEach) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.fill(value);
      console.log(`[chainpatrol] filled ${label} via ${sel}`);
      return true;
    }
  }
  // Label-anchored fallback (works for Mantine / Radix / shadcn forms)
  const labelLoc = page.locator(`label`, { hasText: new RegExp(label, 'i') }).first();
  if (await labelLoc.count()) {
    const id = await labelLoc.getAttribute('for');
    if (id) {
      const input = page.locator(`#${id}`).first();
      if (await input.count()) {
        await input.fill(value);
        console.log(`[chainpatrol] filled ${label} via label[for=${id}]`);
        return true;
      }
    }
  }
  console.warn(`[chainpatrol] could NOT find field for ${label}`);
  return false;
}

const urlOk = await fill('URL', url);
const emailOk = await fill('Email', email);
const detailsOk = await fill('details', details);

await page.screenshot({ path: join(SHOTS_DIR, 'chainpatrol-02-filled.png'), fullPage: true });

if (!urlOk || !emailOk) {
  console.error('[chainpatrol] required field missing — aborting');
  await browser.close();
  process.exit(1);
}

if (dryRun) {
  console.log('[chainpatrol] --dry-run, not clicking submit.');
  await browser.close();
  process.exit(0);
}

const submitBtn = page.locator('button', { hasText: /submit/i }).first();
if (!(await submitBtn.count())) {
  console.error('[chainpatrol] no submit button found');
  await browser.close();
  process.exit(1);
}
await submitBtn.click();
console.log('[chainpatrol] clicked submit, waiting for confirmation…');
await page.waitForTimeout(6000);
await page.screenshot({ path: join(SHOTS_DIR, 'chainpatrol-03-after-submit.png'), fullPage: true });

// Heuristic success check: page text contains "thank", "received", "submitted", "success"
const bodyText = (await page.locator('body').innerText()).slice(0, 2000);
const success = /thank|received|submitted|success|will review/i.test(bodyText);
console.log(`[chainpatrol] page after submit (first 500 chars):\n${bodyText.slice(0, 500)}`);
console.log(`[chainpatrol] inferred ${success ? 'SUCCESS' : 'UNKNOWN'}`);

await browser.close();
process.exit(success ? 0 : 2);
