/**
 * Brawlers CLI entry point.
 *
 * Launches the REPL after loading .env and existing state (if any).
 * Run with `npm run game`.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadState } from './store.js';
import type { GameState } from './store.js';
import { runRepl } from './repl.js';
import { c } from './format.js';

function fail(message: string): never {
  process.stderr.write(c.red(message) + '\n');
  process.exit(1);
}

function parseSeed(raw: string): bigint {
  try {
    const v = BigInt(raw); // BigInt accepts '42' or '0x2a'
    if (v < 0n) {
      fail(`BRAWLERS_SEED must be non-negative, got ${raw}`);
    }
    return v;
  } catch {
    fail(`Invalid BRAWLERS_SEED value "${raw}". Must be a non-negative integer.`);
  }
}

async function main(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = resolve(__dirname, '../..');
  config({ path: resolve(projectRoot, '.env') });

  const dataDir = process.env['BRAWLERS_DATA_DIR'] ?? './data';
  const dataPath = resolve(projectRoot, dataDir, 'brawlers.json');
  const seedEnv = process.env['BRAWLERS_SEED'] ?? '42';
  const masterSeed = parseSeed(seedEnv);

  let state: GameState;
  try {
    state = loadState(dataPath, masterSeed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail('Failed to load state: ' + msg);
  }

  process.stdout.write(
    c.gray(`  data: ${dataPath}\n  seed: 0x${masterSeed.toString(16)}\n`),
  );

  try {
    await runRepl({ dataPath, initialState: state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail('REPL error: ' + msg);
  }
}

await main();
