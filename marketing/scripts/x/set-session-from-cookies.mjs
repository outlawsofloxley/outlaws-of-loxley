// Bake auth_token + ct0 cookies (copied from a real logged-in Chrome) into
// the .session.json Playwright storageState format. Reads the two values
// from env vars X_AUTH_TOKEN and X_CT0 — never accept them on argv, which
// would log them via process listings.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = join(__dirname, '.session.json');

const auth = process.env.X_AUTH_TOKEN;
const ct0 = process.env.X_CT0;
if (!auth || !ct0) {
  console.error('set X_AUTH_TOKEN and X_CT0 env vars first.');
  process.exit(1);
}

// Cookies expire ~2 years out; X regenerates ct0 occasionally but auth_token
// usually lives until explicit logout.
const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;

const cookie = (name, value, opts = {}) => ({
  name,
  value,
  domain: '.x.com',
  path: '/',
  expires,
  httpOnly: false,
  secure: true,
  sameSite: 'Lax',
  ...opts,
});

const state = {
  cookies: [
    cookie('auth_token', auth, { httpOnly: true, sameSite: 'None' }),
    cookie('ct0', ct0),
    // X is mid-migration off twitter.com but still issues some duplicates.
    // Including both prevents random 401s from any code that still routes
    // via the old domain.
    { ...cookie('auth_token', auth, { httpOnly: true, sameSite: 'None' }), domain: '.twitter.com' },
    { ...cookie('ct0', ct0), domain: '.twitter.com' },
  ],
  origins: [],
};

writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
console.log('wrote', SESSION_PATH);
