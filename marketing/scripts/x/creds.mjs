// Cred loader — grep-extracts each var from secrets.env (do not `source` it,
// the file has a `<paste-key>` placeholder on line 42 that breaks bash).
//
// All values stay in process memory; never written to disk, logs, or commits.
// Run only on Darren's box; secrets.env is gitignored and never leaves it.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SECRETS_PATH = join(homedir(), '.claude', 'secrets', 'secrets.env');

let cached;

function loadAll() {
  if (cached) return cached;
  const txt = readFileSync(SECRETS_PATH, 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    // strip optional surrounding quotes
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  cached = out;
  return out;
}

export function getCred(name, { required = true, placeholderOk = false } = {}) {
  const all = loadAll();
  const v = all[name];
  if (v == null) {
    if (required) throw new Error(`Missing ${name} in secrets.env`);
    return undefined;
  }
  if (!placeholderOk && /^<.*>$/.test(v.trim())) {
    if (required) throw new Error(`${name} is still a placeholder (${v}). Fill it in secrets.env first.`);
    return undefined;
  }
  return v;
}

export function getTwitterCreds() {
  return {
    username: getCred('BB_TWITTER_USERNAME').replace(/^@/, ''),
    password: getCred('BB_TWITTER_PASSWORD'),
    email: getCred('BB_TWITTER_EMAIL'),
    totpSecret: getCred('BB_TWITTER_2FA_SECRET', { required: false }),
    handle: getCred('BB_X_HANDLE').replace(/^@/, ''),
  };
}
