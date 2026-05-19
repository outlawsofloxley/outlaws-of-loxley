#!/usr/bin/env node
/**
 * Submits a Blockaid false-positive report (the "Mistake" path) for the
 * BASEic Brawlers mint flow being flagged as "deceptive request".
 *
 * Blockaid's form has an image CAPTCHA that we can't solve headlessly, so
 * this runs in HEADED mode by default and pauses at the captcha for the
 * user to type the 6 characters + click Next. Everything else is autofilled.
 *
 * Usage:
 *   node submit-blockaid-mistake.mjs            # headed, pauses at captcha
 *   node submit-blockaid-mistake.mjs --headless # try headless (will fail at captcha)
 *
 * Multi-step form:
 *   step 1: pick "Mistake" tile
 *   step 2: fill Domain, Chain, Wallet, Address, Email, Additional details, Captcha → Next
 *   step 3: possible confirmation / second screen — TBD
 */
import { chromium } from 'playwright';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(HERE, 'screenshots');
mkdirSync(SHOTS_DIR, { recursive: true });

const headless = process.argv.includes('--headless');

const project = {
  domain: 'baseicbrawlers.com',
  chain: 'Base',
  wallet: 'MetaMask',
  // The "interacting with" address that MM flagged. MintDrop is the contract
  // the mint flow calls. We list every contract in Additional Details too.
  flaggedAddress: '0x6394151f65b81359a47e193f8a0c80c4c2961544', // MintDrop
  email: 'darren@dnbs.com.au',
  notes: [
    'BASEic Brawlers is a legitimate on-chain pixel-art arena game on Base mainnet (chain 8453), live since 2026-05-18.',
    '',
    'MetaMask currently shows a "deceptive request — interaction with a known malicious address" warning (powered by Blockaid) when users approve/mint at baseicbrawlers.com/mint. This is a false positive — the mint flow simply sends ETH to receive an NFT from our MintDrop contract.',
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
    'Please remove the deceptive-request flag for baseicbrawlers.com and the contract addresses listed. Happy to provide any additional verification.',
  ].join('\n'),
};

const browser = await chromium.launch({ headless });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();

console.log('[blockaid] navigating to report portal…');
await page.goto('https://report.blockaid.io/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);

// Step 1: pick "Mistake"
console.log('[blockaid] selecting Mistake (false positive) path…');
await page.locator('text=Mistake').first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: join(SHOTS_DIR, 'blockaid-01-mistake-form.png'), fullPage: true });

// Step 2: fill the form.
async function fillByPlaceholder(placeholder, value) {
  const sel = `input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`;
  const el = page.locator(sel).first();
  if (await el.count()) {
    await el.fill(value);
    console.log(`[blockaid] filled "${placeholder}"`);
    return true;
  }
  console.warn(`[blockaid] could not find placeholder "${placeholder}"`);
  return false;
}

// Domain
await fillByPlaceholder('example.com', project.domain);

// Chain (placeholder is "Ethereum")
await fillByPlaceholder('Ethereum', project.chain);

// Wallet (placeholder lists Coinbase, Rainbow, Zerion, OKX etc.)
await fillByPlaceholder('Coinbase, Rainbow, Zerion, OKX etc...', project.wallet);

// Address (placeholder "0x...")
await fillByPlaceholder('0x...', project.flaggedAddress);

// Email
await fillByPlaceholder('name@email.com', project.email);

// "Anything you want to add" — textarea, placeholder "..."
const textareaSel = page.locator('textarea').first();
if (await textareaSel.count()) {
  await textareaSel.fill(project.notes);
  console.log('[blockaid] filled notes textarea');
}

await page.screenshot({ path: join(SHOTS_DIR, 'blockaid-02-filled.png'), fullPage: true });
console.log('[blockaid] all fields filled — screenshot blockaid-02-filled.png');

if (headless) {
  console.error('[blockaid] HEADLESS mode requested but captcha needs a human. Aborting.');
  console.error('[blockaid] re-run without --headless to complete the submission.');
  await browser.close();
  process.exit(1);
}

// Pause for human captcha entry.
console.log('');
console.log('================================================================');
console.log('  CAPTCHA TIME');
console.log('  The browser window is open. Type the 6-character captcha into');
console.log('  the "Enter the code shown above" field, then click Next.');
console.log('  I will keep the browser open and screenshot the result.');
console.log('================================================================');
console.log('');

const rl = readline.createInterface({ input, output });
await rl.question('Press ENTER here once you have clicked Next in the browser… ');
rl.close();

await page.waitForTimeout(4000);
await page.screenshot({ path: join(SHOTS_DIR, 'blockaid-03-after-next.png'), fullPage: true });

const bodyText = (await page.locator('body').innerText()).slice(0, 1500);
console.log('---');
console.log(bodyText);
console.log('---');

await page.waitForTimeout(2000);
await browser.close();
console.log('[blockaid] done. Check blockaid-03-after-next.png for confirmation.');
