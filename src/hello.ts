/**
 * Brawlers - Phase 1 sanity check.
 *
 * If you can run `npm run hello` and see the banner below,
 * your environment is ready for Phase 2.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load .env from the project root (one level up from src/).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
config({ path: resolve(projectRoot, '.env') });

const BANNER = `
╔══════════════════════════════════════════╗
║          BRAWLERS - PHASE 1 OK          ║
╚══════════════════════════════════════════╝
`;

console.log(BANNER);

// Show Node version
console.log(`Node:             ${process.version}`);
console.log(`Platform:         ${process.platform}`);
console.log(`Working dir:      ${process.cwd()}`);
console.log(`Project root:     ${projectRoot}`);

// Show env variables (we print whether they're set, never the value).
// This is a good habit: never log secret values, even in dev.
const envVars = [
  'BRAWLERS_DATA_DIR',
  'BRAWLERS_SEED',
  'SIGNER_PRIVATE_KEY',
  'RPC_URL',
  'CHAIN_ID',
  'DISCORD_WEBHOOK_URL',
];
console.log('');
console.log('Environment variables:');
for (const name of envVars) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    console.log(`  ${name.padEnd(22)} (not set)`);
  } else if (name.includes('KEY') || name.includes('WEBHOOK')) {
    console.log(`  ${name.padEnd(22)} SET (hidden)`);
  } else {
    console.log(`  ${name.padEnd(22)} ${value}`);
  }
}

console.log('');
console.log('Phase 1 is working. Ready for Phase 2 (core game logic).');
