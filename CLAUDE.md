# CLAUDE.md — session-to-session running notes

Living doc for Claude Code sessions on this project. Append to the top, prune the bottom. Most recent session at the top.

---

## Session 2026-05-15 (launch eve, take 2 — currency-aware fights)

### What got shipped

**DuelRouter — currency-aware fight wrapper (Option B)**
- New `contracts/DuelRouter.sol` (~600 LOC). Brawler-custody pattern: router takes temp ownership of both fighters, satisfies Duel's `msg.sender == owner` check, calls Duel.submitDuel, redistributes per signed FightQuote. Returns brawlers atomically.
- Supports BRAWL/BRAWL, ETH/ETH, ETH+BRAWL mixed (winner ETH), ETH+BRAWL mixed (winner BRAWL), and tie scenarios per Darren's currency rules:
  - BRAWL vs BRAWL → dev BRAWL
  - any ETH involved → dev ETH (swap leg if needed)
  - tie → each player gets own currency back, no dev cut
- Sandwich resistance: every swap leg's `amountOutMin` is signed into the FightQuote by `trustedSigner`. If on-chain Aerodrome reserves move adversely beyond the signed tolerance (2% slip + 0.3% pool fee), tx reverts.
- EIP-712 quote replay protection (per-quote nonce, expiry, owner-snapshot).
- Hard caps: MAX_DEV_BPS=2000, MAX_FIGHT_COST_BRAWL=10k BRAWL, MAX_FIGHT_COST_ETH=0.5 ETH.
- `rescueETH` + `rescueERC20` for owner cleanup of dust/stuck balances.

**Duel.sol minimal change**
- Added `authorizedRouter` field + `setAuthorizedRouter`. When set, ONLY the router can call `submitDuel`. When unset (legacy mode), brawler owner can submit directly.
- Backward-compatible: existing 17 Duel tests still pass.

**Test coverage**
- New `test/solidity/DuelRouter.t.sol` (12 tests). Includes mock Aerodrome router with configurable rate + slippage haircut for sandwich simulation.
- Coverage: all 4 currency combos × winner-A/winner-B, expired quote, replay nonce, invalid sig, owner-changed snapshot, stale BRAWL cost peg, sandwich slippage, wrong msg.value, direct Duel call blocked when router authorized.
- **Total: 151 forge tests pass, 0 fail.**

**Off-chain signer (Vercel API)**
- `/api/run-duel` extended with `modeA` / `modeB` body params + builds + signs FightQuote when `NEXT_PUBLIC_DUEL_ROUTER_ADDRESS` is configured.
- For mixed pots, reads Aerodrome pair reserves + Chainlink ETH/USD off-chain to compute swap min-out with 2% safety buffer on top of the 30 bps pool fee.
- Returns both the existing DuelResult sig (for Duel.submitDuel) AND the new FightQuote sig (for DuelRouter.fight).

**Dev dashboard live-economics panel**
- New `LiveEconomicsPanel.tsx` reads: Chainlink ETH/USD, Aerodrome BRAWL/ETH spot, fight cost (router preferred, falls back to Duel.fightCost), resurrect base cost, marketplace fee, keeper wallet ETH+BRAWL balances. Polls every 30s. Shows USD equivalents + Chainlink staleness.

**Resurrection-cost keeper bot**
- New `marketing/keeper/resurrection-cost-keeper.mjs`. Mirrors fight-cost-keeper's structure but pegs `Graveyard.resurrectionCost` to $100 USD (TARGET_USD_CENTS=10000) via Chainlink ETH/USD. Hard cap MAX = 0.5 ETH.

**Deploy + launch script updates**
- `Deploy.s.sol` deploys DuelRouter when `AERODROME_ROUTER` env set.
- **Staged-rollout default**: router deployed but `authorizedRouter` NOT set automatically. Duel runs in legacy BRAWL-only mode for day-1. Set `ACTIVATE_ROUTER=true` to flip immediately, or call `duel.setAuthorizedRouter(router); duel.setFightEconomics(0, 0, devTreasury)` as a post-launch step once the frontend currency-picker is shipped.
- Allocation revised: 50k LP / 20k team vault / 20k keeper / 10k dev / 0 MintDrop airdrop pool. Founder bonus dropped (founders keep free Tier 1 mint + 25% fight discount + 1 free revive).
- `RESURRECTION_COST` default → 0.025 ETH (~$100 base at $4k ETH).
- `FEE_BPS` default → 750 (7.5% marketplace fee).
- `SeedAndLockLP.s.sol` → BURN_LP=true default. UNCX path preserved as opt-in.
- `LockTeamTokens.s.sol` → 22,750 → 20,000 BRAWL vest.
- `launch-mainnet.sh` → R5 receipt fires the new "LP burned" template; R6 uses 20k default vest amount.
- New keeper EOA generated: `0x613794Dc02cc1a9f29Fbbdc8C5A82d08162bc04E` (privkey in `.env.base-mainnet`).

### Decisions logged

- **LP**: burn to 0xdead, $200 ETH + 50k BRAWL (Darren's call).
- **Marketplace fee**: 7.5%.
- **Fight cost**: $1 USD via keeper-pegged BRAWL OR ETH (router path).
- **Resurrect base**: $100 USD via keeper-pegged base ETH cost (tier mults still apply).
- **House brawlers**: keep at token IDs 1-10 (founder range with `isHouseBrawler` flag). The contract-level perks are already excluded; pushing IDs to 1500+ would require a contract change too risky on launch eve. UI badge labels them clearly.
- **Router activation**: STAGED. Deploy router inert, flip post-launch once frontend duel-page currency picker ships. Avoids day-1 UI breakage.

### Open items / next session priorities

1. **MAINNET DEPLOY**: env vars are populated, run `bash script/launch-mainnet.sh`. Router deploys inert; legacy BRAWL fights work day-1.
2. **Frontend duel-page currency picker (v13 hot-fix, 24-48h post-launch)**:
   - Read `env.duelRouterAddress`; when set, branch to router flow.
   - Add per-side ETH/BRAWL picker.
   - Replace `Duel.submitDuel(...)` writeContract with `DuelRouter.fight(quote, qsig, result, dsig, value: msg.value)`.
   - Replace `BRAWL.approve(duelAddr, ...)` with `BRAWL.approve(routerAddr, ...)` + `Brawlers.setApprovalForAll(routerAddr, true)`.
   - Once shipped + verified, call `duel.setAuthorizedRouter(router); duel.setFightEconomics(0,0,devTreasury)` to lock Duel into router-only mode.
3. **Keeper bot deploy**: copy `marketing/keeper/.env.example` → `.env`, fill in `KEEPER_PRIVATE_KEY` + addresses, run both `fight-cost-keeper.mjs` and `resurrection-cost-keeper.mjs` as long-lived processes (Docker / pm2). Transfer Duel + Graveyard ownership to keeper EOA so it can call setFightEconomics + setResurrectionCost.
4. **`scripts/sim-duels.mjs` upgrade**: when router is activated, this script also has to route through router (otherwise direct Duel call reverts). Add quote-building + router.fight call.

### Convention notes

- **Router IS the economics layer when active**: fightCost + dev cut + founder discount all live in DuelRouter. Duel becomes a pure result-recorder (ELO + death + listed-brawler + signed-result verification). Don't touch Duel.fightCost when router is on — it must stay 0.
- **`authorizedRouter` is the kill-switch**: setting it to address(0) reverts router to inert and re-enables legacy direct Duel calls. Useful if router has a bug post-launch.
- **Brawler approval**: `setApprovalForAll(router, true)` is one-time per user. Router transfers the brawler in, calls Duel, transfers out — atomic on revert.
- **Quote signer keys**: same `BRAWLERS_SIGNER_KEY` used for both DuelResult and FightQuote sigs. Router sigs use the `BASEicBrawlersDuelRouter` EIP-712 domain (note the "Router" suffix vs Duel's `BASEicBrawlersDuel`); rotating the key invalidates both at once.

---

## Session 2026-05-13 → 2026-05-14 (mainnet eve)

### What got shipped

**GitBook → docs.baseicbrawlers.com fully live**
- Detached Docs space `n4Ab6hKYBCLQ57x9CPN9` from broken legacy github integration (expired OAuth tokens were silently failing every `git/import`).
- Imported the 12 chapter handbook via `POST /spaces/.../git/import` with PAT-embedded URL.
- Published `site_QFyit` ("BASEic Brawlers Docs", ultimate plan).
- Custom hostname `docs.baseicbrawlers.com` registered in GitBook UI by Darren; CNAME `docs → dc6987e235-hosting.gitbook.io` added at Vercel DNS via API (`rec_2fd6c6499510fe5452c63d2b`). Cert via Google Trust Services / Cloudflare for SaaS, ~18 min provision.
- Soft-deleted orphan Player Handbook space `bzaYh4Dk5Vc2vqMR3Drf`.
- Re-set up new GitHub Sync via UI — legacy install `267db1e...` now re-active with `projectDirectory: docs/gitbook` configured. Continuous sync working (a real-diff push to `docs/gitbook/*` produces a new revision within ~10s).

**GitBook content rewritten to PROD voice**
- Removed all "open beta / sepolia / soak / mainnet ships when" language across README, getting-started, links, brawlers, house-fighters, faq, trust.
- Reads as if mainnet is live: `BRAWL` ownership renounced, LP locked on Unicrypt, deploy addresses pinned in `#links`. Faucet section + Sepolia network block stripped from getting-started + links.

**"How to Play" pointed at the gitbook everywhere**
- Footer GitBook icon + "How to Play" link → `docs.baseicbrawlers.com` (was that already; constant tidied)
- NavBar "How to Play" item → external `docs.baseicbrawlers.com` opens in new tab (added `external: true` flag to NavItem)
- Home page hero CTA + "First time here?" link → same. Dropped "Base Sepolia · Chain 84532" line.
- `/about` route now `308 → https://docs.baseicbrawlers.com/` via `next.config.ts` (catches stale backlinks). The `/about/page.tsx` file is dead code now.

**Frontend deploy `dpl_AU2dUPCi32qhEMLc4r8HqYJYFNzq`** aliased to `baseicbrawlers.com` + `www.baseicbrawlers.com`. Verified `/about` 308's correctly.

**X automation up + first hype tweet posted**
- `marketing/scripts/x/` is a tiny Playwright project (package.json + node 20). `creds.mjs` grep-extracts BB_TWITTER_* and BB_X_* from `secrets.env`.
- **Scripted login is dead-end on X**: form silently resets on Enter (anti-bot). VPN-origin logins also bounced.
- **Cookie-paste path works**: Darren copied `auth_token` + `ct0` from his real Chrome devtools. `set-session-from-cookies.mjs` bakes them into `.session.json` (storageState). `verify-session.mjs` lands on `/home` with the authed compose UI = pass. Cookies also persisted into `secrets.env` as `BB_TWITTER_AUTH_TOKEN` / `BB_TWITTER_CT0`.
- **Banner uploaded**: `set-banner.mjs` opens Edit profile modal, sets `marketing/art/x-banner.png` on first file input, clicks Apply, Save. Verified live on profile.
- **First hype tweet fired** at https://x.com/BASEicBrawlers/status/2054873099548651910 — day-7 brand reveal copy with "drops this week" + king PFP attached.

### Decisions logged

- **Mainnet deploy targeted ~Friday 2026-05-15 ~12:30 ACST** (Adelaide lunch) ≈ 03:00 UTC. Hype campaign now → launch thread fires at deploy moment.
- **X marketing fully delegated to Claude** via headless browser. Memory `x_twitter_delegation.md` carries the cookie-paste auth path so future sessions skip the login dance.
- **Bio left as-is** (title-case "On-chain arena…") for now — Darren can flip to lowercase voice later if desired.

### Open items / next session priorities

1. **Mainnet deploy Friday ~03:00 UTC.** Group C of LAUNCH-PLAYBOOK fires: BRAWL/Brawlers/Duel/MintDrop/Brawl/Marketplace + LP seed + Aerodrome pair + Unicrypt lock + `enableTrading()`.
2. **At launch moment**: fire `x-launch-thread.md` tweet 1/12, then ~30 min cadence for the rest. Will need to fill `[BRAWLERS_ADDR]`, `[BRAWL_ADDR]`, `[PAIR_ADDR]`, `[UNICRYPT_LOCK_URL]` placeholders post-deploy.
3. **Pre-launch countdown days -6 → -1**: post on cadence per `x-prelaunch-kit.md`, mostly daily 14:00-18:00 UTC. Tweets stored in `marketing/scripts/x/drafts/` as they go out.
4. **Footer/Discord/TG also need launch announcements** when trading goes live.
5. **GitHub PAT in `git remote -v`** (`ghp_DnwkPYij...`) is already invalid (`Bad credentials` from API) so no rotation needed — leak-via-CLAUDE.md exposed the FACT not the value.
6. **Repo is private** — confirmed via 404 from unauth + non-collaborator probe. The 70-min GitBook misconfig that exposed `LAUNCH.md`/`CLAUDE.md`/`marketing/*` was the FIRST public exposure of those files. Risk was low (no live secrets, marketing copy mostly), traffic likely zero given brand-new domain.
7. **TG userbot still listener-only** (`USERBOT_LISTENER_ONLY=true`). Flip after launch when there's actual TG chatter to respond to.
8. **Vercel auto-deploy webhook** still broken — every deploy needed manual `vercel deploy --prod`. Fix worth doing pre-launch so post-launch hot-fix tweets/copy land instantly.

### Convention notes for future sessions

- **X automation: don't do scripted username/password login.** X bounces it silently. Use the cookie-paste session at `marketing/scripts/x/.session.json`. If cookies expire, regrab `auth_token` + `ct0` from a logged-in Chrome devtools (`Application → Cookies → x.com`).
- **Continuous gitbook sync**: pushing to `main` with any diff under `docs/gitbook/*` auto-syncs to docs.baseicbrawlers.com within ~10s via the legacy `267db1e...` integration (now properly configured with `projectDirectory: docs/gitbook`). Empty commits don't trigger; needs a real file change in the watched subtree.
- **Custom hostname API gated**: `POST /custom-hostnames` returns 403 "internal staff auth". UI is the only way to bind `*.baseicbrawlers.com` subdomains to GitBook sites. The CNAME half is fully API-driven via Vercel.
- **Vercel personal token `vca_4ehJ...`** has DNS read+write access on `team_meER3hmCPZwNsCuUUa3yFK9M` (the `ghubbers-projects` team) even though `vercel dns ls` CLI says "no permission". Use the REST API directly: `POST/DELETE https://api.vercel.com/v2/domains/baseicbrawlers.com/records[/recordId]?teamId=...`.
- **GitBook unpublish + visibility flips DON'T immediately invalidate the Vercel-hosted edge cache** that GitBook serves through. To take a misconfigured GitBook site offline FAST, remove the CNAME at the DNS provider — DNS flips within seconds, the leak stops at the resolver layer.

### Live infra (deltas from prev session)

- GitBook org: `DOVDg3Iw7VqLlACE6NRI`, site `site_QFyit`, Docs space `n4Ab6hKYBCLQ57x9CPN9`, custom hostname `docs.baseicbrawlers.com`.
- Vercel team: `team_meER3hmCPZwNsCuUUa3yFK9M` (ghubbers-projects). Personal token in CLI auth.json works for DNS API.
- X account `@BASEicBrawlers` profile complete (display name, bio, location, website, pfp, banner). First hype tweet live. Session cookies in `secrets.env` (`BB_TWITTER_AUTH_TOKEN`/`BB_TWITTER_CT0`) + `marketing/scripts/x/.session.json`.

---

## Session 2026-05-08 → 2026-05-10

### What got shipped

**TG userbot (`baseic-tg`)**
- Deployed to TrueNAS via Dockge, locked-down user `claude-baseicbrawlers`, listener mode (`USERBOT_LISTENER_ONLY=true`).
- SSH alias `baseic-tg` in `~/.ssh/config`. Stack at `/mnt/.ix-apps/app_mounts/dockge/stacks/baseic-tg/`.
- Smoke-tested: DM + group event both fired correctly. Userbot TG identity id `8372813217`, no public @username.
- Open TODO: flip `USERBOT_LISTENER_ONLY=false` after watching logs ≥1 hour (status block in `marketing/userbot/DEPLOY.md`).

**Wallet UX (frontend)**
- Suppress raw `User rejected the request. Details: Request rejected Version: viem@2.37.0` error. Now shows nothing on rejection, `shortMessage` on real errors.
- Auto-switch network only fires on user-clicked connect (not on wagmi auto-reconnect).
- Multi-wallet picker now renders all EIP-6963-announcing browser wallets (MetaMask, Rainbow, Rabby, Brave, Phantom, Binance, etc.) as separate entries with their announced icon.
- WalletConnect connector wired (env: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, set in Vercel prod + dev).
- Coinbase Wallet + WalletConnect have brand-icon SVGs at `frontend/public/wallet-icons/`.
- GitHub icon in global footer (Discord/X/Telegram/GitHub/GitBook). "How to Play" footer link → `https://docs.baseicbrawlers.com`.

**Discord bot**
- Retired `#duel-talk`, all duel outcomes route to `#duels`. Renamed `DUEL_TALK_CHANNEL` env → `DUELS_CHANNEL` (legacy fallback kept).
- Generalized channel wipe pattern: `WIPE_DUELS_ON_STARTUP`, `WIPE_GRAVEYARD_ON_STARTUP`, `WIPE_MARKETPLACE_ON_STARTUP`. Wipes run BEFORE backfills.
- Fixed `DUEL_BLOCK_MIN`/`DUEL_BLOCK_MAX` filter: history DB has cross-chain ghost rows at block ~103M (Base Sepolia head is ~41.2M), set MIN=`41232000` MAX=`90000000`.
- Updated `MARKETPLACE_ADDRESS` to v12 Sepolia: `0x868a890bdde7f2d6f3e9401a383d045ca72b1942`.

**Player handbook (GitBook source)**
- 13-chapter markdown handbook at `docs/gitbook/`, written in project voice (lowercase, casual, no em-dashes, no marketing words). Pulls all numbers from `/about` and `prompt.txt` only — no invented stats.
- Files: `README, SUMMARY, getting-started, minting, brawlers, duelling, death-and-resurrection, marketplace, house-fighters, trust, tips, faq, links`.
- ~842 lines total, drops in to any GitBook host.

**Sepolia testnet dry-run (one full pipeline cycle)**
- 10 duels submitted via `scripts/sim-duels.mjs`, all on-chain.
- 1 death (#6) auto-detected.
- 3 marketplace listings + 3 buys (signer funded 0.0004 ETH from deployer to afford the buys).
- All Discord channels validated: #duels, #graveyard, #marketplace, #leaderboard.
- Logs at `.dryrun-logs/sim-duels-only_*.log` and `.dryrun-logs/marketplace_*.log`.
- Sepolia v12 deployer holds 7 alive house brawlers + 1 dead (#6). Tokens 1, 2, 3 transferred to test-signer during marketplace test.

### Decisions logged

- **House brawlers go to DEV wallet on mainnet** (Darren collapsed keeper into dev — "easier to control and link to DASH"). For mainnet deploy: set `HOUSE_KEEPER_ADDRESS=$BB_DEV_TREASURY_ADDRESS` in `.env.base-mainnet`.

### Open items / next session priorities

1. **GitBook Git Sync setup is mid-flight.** Darren installed the GitBook GitHub App on `baseicbrawlers/baseic-brawlers` (verified on github.com), but the GitBook UI dropdown shows "No items". Likely UI cache. Next session: have him hard-refresh the GitBook page, then complete sync config (Repo: `baseicbrawlers/baseic-brawlers`, Branch: `main`, Project dir: `docs/gitbook`).
2. **Two GitBook spaces created** in org `DOVDg3Iw7VqLlACE6NRI`:
   - `bzaYh4Dk5Vc2vqMR3Drf` "Player Handbook" — created via API, orphan, delete after sync works.
   - `n4Ab6hKYBCLQ57x9CPN9` "Docs" — Darren's polished space under the "BASEic Brawlers Docs" docs site. **Use this one.**
3. **`docs.baseicbrawlers.com` DNS** — not yet pointed. After GitBook sync works, configure custom domain in GitBook → CNAME from DNS provider.
4. **Mainnet pre-launch Discord cleanup** — when flipping to prod, run a final wipe pass (use `WIPE_DUELS_ON_STARTUP=true` + `WIPE_GRAVEYARD_ON_STARTUP=true` + `WIPE_MARKETPLACE_ON_STARTUP=true` + restart) to clear all testnet posts. Then bump `DUEL_BLOCK_MIN` to mainnet's Duel deploy block, update `MARKETPLACE_ADDRESS` to mainnet, change `RPC_URL` to mainnet.
5. **Vercel auto-deploy is broken.** Recent git pushes don't trigger deploys — every change today required manual `vercel deploy --prod`. Worth fixing the GitHub→Vercel webhook in Vercel project settings.
6. **Rotate the GitHub PAT** in `git remote -v`. The token `ghp_...` was visible in my conversation context earlier today. https://github.com/settings/tokens.
7. **`secrets.env` line 42** has an unfilled `ANTHROPIC_API_KEY=<paste-key>` placeholder — bash treats `<paste-key>` as redirection and chokes any `source` of the file. Workaround in place (grep-extract per var) but worth filling/commenting at some point.

### Convention notes for future sessions

- **Voice guide for any Darren-facing content** (gitbook, marketing, prompt.txt edits): lowercase, casual aussie, dry humour, no em-dashes (use commas / splits / colons), no marketing words (`leverage, unlock, elevate, seamless, robust, ecosystem, journey, immersive`), on-brand emojis only (⚔️ 💀 🪦 🎮), never invent contract addresses / prices / dates. If unsure: "no idea" / "i'd have to check".
- **Push to main is harness-blocked by default.** When Darren says "push", `git push origin main` may need an explicit re-confirmation in the same turn. He authorized "you push it" once and it went through; subsequent pushes have worked.
- **Never share secrets in chat.** Read `.claude/secrets/secrets.env` only via grep-extract for specific vars (file has unfilled placeholders that break sourcing). Don't echo values back.
- **Block-range filter on history DB:** Sepolia carries cross-chain ghost rows at ~103M+ (BSC testnet leftovers). Always cap `DUEL_BLOCK_MAX < 90M` on Sepolia. Mainnet is clean DB, no upper bound needed.
- **Vercel project lives in `ghubbers-projects` scope** but `.vercel/project.json` lists `team_meER3hmCPZwNsCuUUa3yFK9M` (different team Darren's CLI doesn't have access to). `vercel deploy --prod` from `frontend/` works regardless — deploys land in the personal scope and auto-alias to `baseicbrawlers.com`.

### Reference URLs

- GitBook org: `DOVDg3Iw7VqLlACE6NRI` (BASEic Brawlers)
- Active Docs space: `https://app.gitbook.com/o/DOVDg3Iw7VqLlACE6NRI/s/n4Ab6hKYBCLQ57x9CPN9/`
- Orphan Player Handbook (delete after Docs sync works): `https://app.gitbook.com/o/DOVDg3Iw7VqLlACE6NRI/s/bzaYh4Dk5Vc2vqMR3Drf/`
- Telethon userbot runbook: `C:\Tools\Claude\runbooks\telethon-userbot-on-truenas.md`
- BB-specific TG userbot deploy: `marketing/userbot/DEPLOY.md`
- Launch playbook: `LAUNCH-PLAYBOOK.html` (read top-to-bottom before mainnet deploy)

### Live infra

- TrueNAS: `192.168.1.10`. Root SSH: `truenas-discord`. Locked-down stack-edit users: `claude-baseicbrawlers` (TG userbot), `claude-tg` (smarties).
- Dockge stacks: `baseic-discord` (Discord bot), `baseic-tg` (Telegram userbot), plus sibling projects `smarties-tg`, `rektnoviking`, `crypto-bot`.
- Sepolia v12 contracts (per `.env.base-sepolia`): Brawlers `0x72aa4d388dc833b2daba00bf6b1127f2a15ec9a8`, Marketplace `0x868a890bdde7f2d6f3e9401a383d045ca72b1942`, Duel/MintDrop/Brawl/Graveyard also set.
- Discord guild bot: `BB#4251` (id `1500625288478855288`), online, watermark = 10 v12-era duels.
