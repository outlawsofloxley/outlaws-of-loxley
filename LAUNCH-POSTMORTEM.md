# Launch post-mortem — BASEic Brawlers, May 2026

Honest tally of every mistake, misfire, and gotcha caught during the Base mainnet launch + the first 12 hours of operation. Written so the next project has a 1-shot repeatable process instead of three days of patching.

Format per item: **What went wrong → How we found out → Root cause → Fix shipped → Prevention rule for next launch**.

The distilled pre-launch checklist is at the bottom. Read that first if you're short on time.

---

## A. Pre-launch oversights (decided / scoped late)

### A1. LP-burn vs UNCX vs custom-lock decision came on launch eve

- **Wrong**: Three back-to-back planning flips on the day before deploy. First "UNCX V2 vest for both team + LP," then "burn the LP, keep UNCX for team," then "skip UNCX entirely because $200 fee feels like extortion." By the time the launch script ran, the LP path was burn-only and the team vault was just sitting in the dev wallet untouched.
- **Found by**: Team vault still showed in dev wallet 12 hours post-launch, prompting the "is there any other lock site" question.
- **Root cause**: Lock strategy wasn't a hardcoded contract artifact, it was an off-chain decision tree. Easy to defer.
- **Fix**: Wrote our own `BRAWLTimelock.sol` + deploy script + UI countdown page, deployed 12h post-launch.
- **Prevention**: Pick locking strategy as part of the contract scope review BEFORE Deploy.s.sol freezes. If using a custom lock, write + test the contract in the same PR as the main token. Decision doc lives in `LAUNCH-PLAYBOOK.md`.

### A2. Mint pricing copy didn't match contract defaults

- **Wrong**: Marketing copy promised a 6-tier $20→$50 mint ladder. `MintDrop` deployed with Sepolia-era 0.0001 ETH flat pricing (no tiers) because `TIERED_PRICING=true` wasn't set in `.env.base-mainnet`. T1 effectively cost $0.21 at launch.
- **Found by**: Darren during smoke-test mint, "mint prices should never be 0 bro WTF!!!"
- **Root cause**: Env var sync between marketing copy and deploy script wasn't checked. Defaults survived from testnet.
- **Fix**: Wrote `FixMintPrices.s.sol` post-launch to apply the right tier table.
- **Prevention**: Run `forge script <Deploy> --rpc-url <fork>` against a forked mainnet pre-launch and CALL the readers (priceTierAt, fightCost, resurrectionCost). Compare every result against the marketing kit numbers. Fail loud if mismatched.

### A3. MintDrop got pointed at MockUSDT (immutable mistake)

- **Wrong**: `Deploy.s.sol` didn't read `USDT_ADDRESS` from env, so it auto-deployed a `MockUSDT` and passed THAT as the stablecoin. Now baked into MintDrop's immutable storage forever. USDT mint button shows a 0-balance approve UI that does nothing on real USDT.
- **Found by**: Darren clicking the USDT approve button to test, "the approve usdt button does nothing."
- **Root cause**: Deploy script had a fallback that nobody noticed. Default was to deploy a mock, not error.
- **Fix**: Hid USDT/USDC tabs in the mint UI permanently. Documented as launch v1 limitation.
- **Prevention**: Deploy scripts must REVERT on missing required addresses, never fall back to mocks in mainnet builds. Add a `vm.envOr("FAIL_ON_MISSING", true)` guard.

### A4. Founder 100 perks copy referenced an airdrop that didn't exist

- **Wrong**: GitBook + tweet drafts had "+20 BRAWL airdrop" for founder mints. The `founderAirdrop` allocation got dropped weeks earlier but the copy didn't get updated.
- **Found by**: Darren reading the live mint page, "20 BRAWL airdrop wording must go."
- **Root cause**: Marketing kit and contract reality drifted independently.
- **Prevention**: Marketing-kit copy must be regenerated from the contract state, not maintained as a separate doc. Or: a pre-launch script that greps GitBook/X drafts for known stale terms.

### A5. ACST leak in social posts

- **Wrong**: Pre-launch tweet + TG post + Discord post all said "launch planned for Sunday ACST afternoon." Adelaide timezone = location leak.
- **Found by**: Darren during a calm moment, "never give info away about my location."
- **Root cause**: Default to absolute time without thinking about geolocation signal.
- **Fix**: Deleted tweet, edited TG msg, edited Discord msg.
- **Prevention**: Pre-launch comms-review checklist: scrub for timezone names, city names, IP-tied references. Use UTC only.

---

## B. Contract bugs that shipped to mainnet

### B1. PriceTier struct ABI mismatch (uint16 vs uint128)

- **Wrong**: `Brawlers.PriceTier` struct uses `uint16 upToSold` on chain, but frontend ABI + keeper ABI were both declared with `uint128 upToSold`. Different ABI gives a different function selector (`0x66cff971` vs `0x4bc24c38`). Every `setPriceTiers` call from keeper or dash hit a non-existent selector → silent revert at 32k gas.
- **Found by**: Mint-cost keeper logs showing successful tx hash but reverted on chain.
- **Root cause**: I introduced the bug myself by "fixing" the ABI in the wrong direction earlier in the session. Original was right.
- **Fix**: Reverted ABI on keeper + frontend + dash editor. Container rebuild (image was baked, not bind-mounted) made the fix actually land.
- **Prevention**: Generate frontend + keeper ABIs from the compiled contract artifact, not by hand. `forge inspect <Contract> abi > frontend/abi.json` in a pre-launch step.

### B2. Chainlink ETH/USD address EIP-55 checksum wrong

- **Wrong**: Hardcoded `0x71041dDdAd3595F9CEd3DcCFBe3D1F4b0a16Bb70` in 3 frontend files. Canonical EIP-55 is `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` (lowercase d after 0x71041). viem rejects non-canonical addresses at read time, silently returns `undefined`, frontend renders `—`.
- **Found by**: Darren noticing dash + mint page showed `—` for ETH/USD despite keepers happily reading the same address every 5 min.
- **Root cause**: Keeper uses ethers (lenient on case); frontend uses viem (strict). Same address, different validators.
- **Fix**: Lowercased the rogue `D` in all 3 files. `sed -i` one-liner.
- **Prevention**: All address constants must go through `getAddress()` at module load or be checksummed via a pre-commit hook. Don't hand-type addresses ever.

### B3. Duel.authorizedRouter activation broke direct fight calls (briefly)

- **Wrong**: Setting `authorizedRouter` on Duel locks `submitDuel` to only the router. If the frontend currency-picker isn't deployed yet, players hit Duel directly → revert. We staged this correctly (deploy router inert, flip later), but the activation moment had to be timed with a frontend deploy.
- **Found by**: Caught pre-launch.
- **Root cause**: Tight coupling between router-activation tx and frontend-deploy timing.
- **Prevention**: When adding a kill-switch admin field that gates the legacy path, ship the frontend cutover FIRST, observe for 24h, THEN flip the on-chain switch. Or feature-flag both paths in the UI so it works either way.

### B4. Keeper got contract ownership transferred, then needed it reverted

- **Wrong**: To let the keeper EOA call `setFightEconomics` / `setResurrectionCost`, we transferred ownership of Duel, Graveyard, MintDrop to the keeper. That broke the dev dashboard editors (only owner can call setters, and now the owner was the keeper key, not the dev key the dash signs with).
- **Found by**: Darren clicking a dash editor button and seeing the tx revert.
- **Fix**: Transferred ownership back to dev wallet, gave the keeper the dev key. Operationally fine, just simpler.
- **Prevention**: Add a `keeper` role separate from `owner` in the contracts (`onlyOwnerOrKeeper` modifier). Don't merge "EOA that pokes setters" with "EOA that holds admin power."

### B5. BRAWL launch limits were on, would have stayed forever if we'd renounced first

- **Wrong**: `BRAWL.liftLimits()` is a one-way function. If we'd renounced ownership before calling it, the `maxWallet=1000, maxTx=500` caps would have been permanent. Would have choked the token's tradability long-term.
- **Found by**: Caught when discussing "what does renouncing actually disable" — listed the 7 owner-only functions, spotted `liftLimits()` as the load-bearing one.
- **Fix**: Called `liftLimits()` first, then `renounceOwnership()`. Order matters.
- **Prevention**: Document the irreversible-ordering of admin functions in the contract NatSpec. Add a `LAUNCH-PLAYBOOK.md` section called "one-way switches, in order."

---

## C. Frontend / UI bugs

### C1. dashAuth env var name mismatch + Vercel inlining flakiness

- **Wrong**: `NEXT_PUBLIC_DEV_WALLET` wasn't propagating to the build for unclear reasons (Vercel rotations / cache). Dash login kept rejecting the dev wallet signature.
- **Fix**: Hardcoded the dev wallet address as a fallback constant in `dashAuth.ts`. Ugly but reliable.
- **Prevention**: For wallet-gated admin pages, accept either env var OR a hardcoded address baked at build time. Don't make the page rely on a single env var being live.

### C2. Tier editor displayed hardcoded defaults instead of on-chain state

- **Wrong**: After the keeper repegged tier prices, the dash editor still showed `0/40m/45m/50m/60m` because the React state initialized from a hardcoded constant, never read on-chain.
- **Fix**: Replaced hardcoded init with `useReadContracts({ priceTierAt(i) })` + `useEffect` that fills rows once the on-chain data arrives.
- **Prevention**: Admin-form pre-fills must ALWAYS hydrate from on-chain. Hardcoded defaults are just templates for first deploy, never the live UI source of truth.

### C3. BrawlPricePanel had stale "Not listed on DEX yet" placeholder

- **Wrong**: The widget had a TODO from pre-launch saying "swap this when BRAWL is listed." Listing happened 4+ hours before anyone noticed the placeholder was still up.
- **Fix**: Rewrote to read BRAWL/ETH from the Aerodrome pair reserves × Chainlink ETH/USD live. No external API dependency.
- **Prevention**: Pre-launch checklist item: grep the frontend for `TODO`, `placeholder`, `Not listed`, `coming soon`. Fail the build if any exist on user-facing pages.

### C4. Mint page UI noise (decimal walls, duplicate count picker)

- **Wrong**: 
  - "0.00946 ETH" rendered as "0.009460909173749671" — full 18 decimals
  - Count picker showed "1 2 5 10 20 1" — the trailing 1 was a text input mirroring the active preset, looked like a duplicate
  - No USD equivalent next to ETH amounts
- **Fix**: `fmtEth()` helper trimming to 5 decimals + leading USD label + hide custom input behind a "…" button until clicked.
- **Prevention**: All on-chain numeric reads need a formatter. Never render raw `formatUnits(x, 18)` to users.

### C5. House brawlers showed FOUNDER badge

- **Wrong**: The badge logic checked "is token id ≤ 100" but token IDs 1-10 are house brawlers in the same range. House tokens got both badges.
- **Fix**: Added `isHouseBrawler` check to `BrawlerCard.tsx` to exclude.
- **Prevention**: Mutually-exclusive UI states need an explicit precedence rule in code, not relied on order of CSS rules.

### C6. Mint stats panel showed wrong totals (7 mints, 1 resurrection)

- **Wrong**: Dashboard revenue widget showed numbers from Sepolia-era event rows still in the prod Postgres DB.
- **Fix**: Built `/api/dash/wipe-events` endpoint + admin "Wipe stale events" button. TRUNCATEs `mint_events`, `resurrect_events`, `market_sales`, `duel_events` + resets the sync cursors.
- **Prevention**: When promoting a DB from test to prod chain, treat the event tables as throwaway. Either rotate the database entirely or include the wipe in the chain-cutover runbook.

---

## D. Infra / chain switch issues

### D1. RPC choice (mainnet.base.org rate-limits aggressively)

- **Wrong**: `NEXT_PUBLIC_RPC_URL` was set to Base's public RPC `mainnet.base.org`. That endpoint 429s after a handful of `eth_call`s within a minute. `/api/house/status` returned `{ok: false}` silently → frontend rendered "0 fighters in arena" while on chain we owned all 10.
- **Found by**: Darren trying to fight from another wallet, "0 waiting in the arena."
- **Fix**: 
  - Rotated env to `base-rpc.publicnode.com` as primary
  - Added viem `fallback` transport pool on server-side house client
- **Prevention**: Never use `mainnet.<chain>.org` as the primary RPC for anything that scales. Always use a paid endpoint OR an RPC pool with `fallback({ rank: false })`. Document the known rate-limited endpoints in `LAUNCH-PLAYBOOK.md`.

### D2. Vercel auto-deploy webhook was broken throughout

- **Wrong**: Every code push needed a manual `vercel deploy --prod`. The webhook from GitHub to Vercel had been broken for weeks.
- **Found by**: Multiple failed expectations of "I pushed, it should be live in 60s."
- **Fix**: Worked around with manual deploys + scripted alias. Never fixed the webhook itself.
- **Prevention**: Pre-launch checklist: push a no-op commit, time the deploy. If >2 minutes from push to alias-flip, fix the webhook before launch day.

### D3. Vercel alias scope confusion

- **Wrong**: `vercel alias set <url> baseicbrawlers.com` would fail with "no access to domain" because the default scope (`team_meER3hmCPZwNsCuUUa3yFK9M`) doesn't have access to the domain. The domain lives under `ghubbers-projects` scope.
- **Fix**: Always include `--scope=ghubbers-projects` in alias commands.
- **Prevention**: Wrap `vercel deploy --prod` in a shell script that auto-aliases with the correct scope. One command, always works.

### D4. Discord bot wasn't seeing new duels (history sync 2.4M blocks behind)

- **Wrong**: The bot reads from `/api/history/query`, which reads from `duel_events`, which is populated by `/api/history/sync` walking the chain forward. Cursor was stuck 2.4M blocks behind chain head — every fight on chain, no Discord embed.
- **Found by**: Darren noticing duels weren't being announced.
- **Root cause**: Sepolia → mainnet cutover left the cursor pointing at an old block. Sync walks slowly (4 chunks × 1000 blocks per call, 8s throttle). 30+ min natural catchup time.
- **Fix**: 
  - Extended `/api/dash/wipe-events` to TRUNCATE `duel_events` + reset `sync_state.last_block`
  - Hammered the sync endpoint manually with 10s sleeps until caught up
- **Prevention**: Chain-cutover runbook MUST include "reset history cursor to new chain's deploy block." The wipe button does this now, but it should be DOCUMENTED as a launch-day step, not a post-launch discovery.

### D5. Discord bot env didn't have mainnet RPC + addresses at first cutover

- **Wrong**: Bot was on Sepolia config for ~hour post-launch. `DUEL_BLOCK_MIN=41232000` (Sepolia value). `MARKETPLACE_ADDRESS` was the Sepolia v12 address.
- **Fix**: SSH'd into TrueNAS, edited compose, restarted with `WIPE_*_ON_STARTUP=true`, then reset the wipe flags.
- **Prevention**: Mainnet env file for the bot must be DIFFERENT from the testnet one and not derived from it. `compose.mainnet.yml` checked in alongside `compose.testnet.yml`.

### D6. MetaMask showed Vercel preview URL as origin

- **Wrong**: When wallet-connecting from a Vercel preview URL (or being mid-deploy when aliases hadn't caught up), MetaMask showed "frontend-xyz.vercel.app" as the requesting site. Looks unprofessional + scammy.
- **Fix**: Added a host-based 308 redirect in `next.config.ts` — any host that isn't baseicbrawlers.com / www / localhost bounces to the canonical.
- **Prevention**: Every Next app should have this from day one. It's 8 lines.

---

## E. Keeper bot issues

### E1. Keeper containers were image-baked, not bind-mounted

- **Wrong**: Edits to `mint-cost-keeper.mjs` on the host needed a `docker compose up --build mint-cost` (not just `restart`). I lost ~15 minutes confused by "I restarted but the bug is still there."
- **Fix**: Awareness. The image is baked at build time.
- **Prevention**: For long-iteration containers like keepers, use bind-mounts (`volumes: ["./mint-cost-keeper.mjs:/app/mint-cost-keeper.mjs:ro"]`) so source edits hot-reload. Or accept the rebuild cost and document it loudly.

### E2. Mint-cost keeper silently reverted for 4+ hours

- **Wrong**: Keeper logs showed "submitted: 0xabc... → tx error: transaction execution reverted." Same uint16/uint128 selector bug as B1.
- **Found by**: Trace via `cast run` on the reverted tx hash.
- **Prevention**: Keeper should retry once on revert, then ALERT (Slack/Discord webhook) if a tx reverts twice in a row. Right now keepers just log + continue.

### E3. Keeper didn't have BRAWL approval or NFT approval to router

- **Wrong**: After the keeper had ownership of the house brawlers AND BRAWL stake, fights would still revert because the router can't transfer either without approval. Took user reporting "I can't fight" to find.
- **Fix**: Sent two txs from keeper EOA — `BRAWL.approve(router, MAX)` + `Brawlers.setApprovalForAll(router, true)`.
- **Prevention**: Add a "keeper readiness check" CLI script that runs post-deploy: verifies every approval the keeper needs, fails loud if missing. Wire it into launch-mainnet.sh.

---

## F. Marketing / social automation

### F1. X tweet length silently breaks at 280 chars

- **Wrong**: A draft tweet >280 chars makes the X "Post" button stay `aria-disabled=true`. The Playwright script polled the button and assumed disabled = "still typing" → silent retry loop → eventually timeout, no error.
- **Fix**: 
  - Trim drafts to <280 chars
  - Script now logs char count before posting
- **Prevention**: Tweet poster must validate length BEFORE opening the browser. Refuse to post if >280.

### F2. X modal interception of Post button

- **Wrong**: X sometimes pops a "Premium upgrade" or layout-shift modal that intercepts the click on Post. Selector `tweetButtonInline` clicks fine but a transparent overlay eats the event.
- **Fix**: Switched to `Ctrl+Enter` keyboard shortcut to post, which bypasses the modal.
- **Prevention**: Always use Ctrl+Enter (or X's API if/when accessible) instead of clicking the button. Wallet-style "scriptable interaction" frameworks lose to UI churn every time.

### F3. Discord bot env reads classifier-blocked

- **Wrong**: Reading `DISCORD_BOT_TOKEN` via `docker exec printenv` gets blocked by the Claude Code permission classifier (production secret read). So my path to post-to-Discord-via-API needed the user's explicit auth.
- **Fix**: Used `docker exec node -e "...send Discord message..."` which uses the env in-container without echoing the token. User authorization needed per-call.
- **Prevention**: For automated infra, either give Claude an admin-key route OR have the user pre-authorize the action class (e.g. a `.claude/settings.local.json` rule whitelisting `docker exec baseic-discord-bot`).

### F4. Cron classifier blocked rapid-fire tweet posts

- **Wrong**: After 2 tweets within ~5 min, retries got auto-denied as "auto-retry without new direction."
- **Fix**: User authorization needed between tweets.
- **Prevention**: Schedule tweets with explicit cadence (15+ minutes apart) and explicit per-tweet authorization, not in a single agent loop.

---

## G. Process / repo hygiene

### G1. Scratch files snuck into commits

- **Wrong**: `.duel-result.tmp.json`, `*_dash.png` (screenshots), `discordmaybe.txt` etc. ended up in commits because `git add -A` grabbed everything.
- **Fix**: Added them to `.gitignore` + `git rm --cached` to untrack.
- **Prevention**: `.gitignore` should be aggressive from day one. Include `*.tmp.*`, `*_dash.png`, `*-notes.txt`, etc. as patterns.

### G2. GitHub PAT exposure (already-invalid)

- **Wrong**: A GitHub PAT was visible in earlier conversation context. Already invalid (rotated weeks ago), but the LEAK happened.
- **Prevention**: Never paste secrets into chat, even invalid ones. The secret file should be readable but never echoed.

### G3. CLAUDE.md / marketing content briefly public via GitBook misconfig

- **Wrong**: 70 minutes of misconfigured GitBook integration exposed `LAUNCH.md`, `CLAUDE.md`, and marketing content on the public docs subdomain.
- **Fix**: Removed the CNAME at DNS provider (faster than waiting for GitBook unpublish).
- **Prevention**: Pre-launch GitBook integration test on a STAGING subdomain, not the production one. Production CNAME doesn't land until staging is verified.

### G4. Per-repo git user.email had to be set manually

- **Wrong**: Global git user is `smartiesbox@...`. The brawlers project wanted commits attributed to `baseicbrawlers@users.noreply.github.com`. First few commits leaked the wrong email.
- **Fix**: `git config user.email` per-repo override.
- **Prevention**: Init script for new repos that sets the per-repo identity before the first commit.

### G5. Windows line endings (LF→CRLF warnings on every commit)

- **Wrong**: Every commit shows `warning: LF will be replaced by CRLF in <file>` for 5-10 files. Noise that obscures real warnings.
- **Fix**: Live with it for now. `git config core.autocrlf false` would fix it but breaks Windows-native tools that need CRLF.
- **Prevention**: Add a `.gitattributes` with explicit `* text=auto eol=lf` at repo root.

---

## H. Distilled pre-launch checklist (for the NEXT project)

If we do this again, here's the runbook. Each item is a 1-line check that, if all green, makes launch day a 1-shot.

### One week before launch

- [ ] `LAUNCH-PLAYBOOK.md` exists, lists every admin function and its one-way-ness (e.g. liftLimits BEFORE renounceOwnership)
- [ ] Lock strategy decided + contract written + tested (custom timelock vs UNCX vs nothing)
- [ ] All marketing copy regenerated from contract state (no airdrop wording if no airdrop exists)
- [ ] Deploy scripts REVERT on missing required addresses, never fall back to mocks
- [ ] `forge inspect <Contract> abi` generates the frontend ABIs (no hand-maintained ABI strings)
- [ ] `.gitattributes` + `.gitignore` checked in (LF endings + ignore tmp/screenshots/notes)
- [ ] Per-repo git user.email set, GitHub PAT rotated, secrets file gitignored

### 48 hours before launch

- [ ] Fork-test the deploy script against mainnet fork; read every public getter; diff against marketing-kit numbers
- [ ] Vercel webhook test: push a no-op, time the deploy. Must be <2 min push-to-alias.
- [ ] Vercel alias command wrapped in a shell script with the correct `--scope`
- [ ] All address constants pass through `getAddress()` or are validated by pre-commit hook
- [ ] RPC pool: primary is a paid/publicnode endpoint, NOT `mainnet.<chain>.org`
- [ ] `fallback` transport on every server-side viem client
- [ ] Canonical-host 308 redirect in `next.config.ts`
- [ ] Pre-launch comms scrub: no timezones, no city names, no IP-tied references
- [ ] Frontend grep for `TODO`, `placeholder`, `Not listed`, `coming soon` — fail build if found on user-facing pages
- [ ] Keeper readiness CLI: deploy a fake keeper, verify every approval it needs is set

### Launch day

- [ ] Deploy → verify all contracts on Basescan in same step (don't defer)
- [ ] Run the keeper readiness check post-deploy
- [ ] Reset Discord bot env to mainnet config (compose.mainnet.yml swap), `WIPE_*_ON_STARTUP=true`, restart, reset flags
- [ ] Reset history sync cursor to deploy block (NOT to 0, not to a Sepolia block)
- [ ] Test fight from a fresh wallet — first-time approval flow, count popups, confirm transitions
- [ ] Liftlimits + renounceOwnership IN ORDER, with explicit per-action authorization

### 24h post-launch

- [ ] Run Token Sniffer / GoPlus audit; expect to flag blocklist/ownership/LP-depth (intentional) but trend down as renouncements land
- [ ] Verify keeper bots are actually writing on chain (not just polling), every 5 min for at least 30 min
- [ ] Verify Discord bot is posting duel/death/sale events (do 1 of each manually if no organic activity)
- [ ] Verify dash editors work (sign a no-op admin tx)

---

## I. Things that went RIGHT (so we keep them)

Don't just learn from mistakes. Things to copy verbatim into the next project:

- **`launch-mainnet.sh`** with R1-R7 receipt templates. Made the deploy a series of obvious one-liners.
- **Keeper bot pattern** (poll → read → diff vs threshold → write if drifted). 5% drift threshold + 5 min poll is the sweet spot.
- **DexScreener / Aerodrome direct-read** for price. No third-party API dependency.
- **Custom timelock contract** for team tokens. 80 lines, $0.02 gas, "audit it yourself" marketing line. Bury UNCX forever.
- **GitBook for docs, auto-synced from `docs/gitbook/*` on every push to main.** Voice guide in CLAUDE.md kept tone consistent.
- **Dev dashboard with live economics + admin editors + audit log.** Pays for itself the first time you need to debug something.
- **Multi-RPC fallback transport everywhere.** No single endpoint can ghost the app.
- **Forge tests for every new contract (151+ tests pre-deploy).** Caught most logic bugs before mainnet.
- **`forge verify-contract --watch` immediately post-deploy.** Verification in same workflow, not deferred.

---

## J. Day-2 to week-1 post-launch checklist (added 2026-05-19)

Captured the day AFTER launch from real user issues + marketing prep we should
have done earlier. If we run this play again, these go in the launch-week
runbook, not in the "we'll get to it" pile.

### Within 1 hour of going live

- [ ] **Submit Blockaid false-positive form** (`https://report.blockaid.io/` → "Mistake" path). Fresh contracts get flagged as "deceptive request" by MetaMask within minutes. 24-72h turnaround for de-flag, so file BEFORE the first user reports the red banner. Image captcha → headed-mode playwright with human pause is the realistic path (see `marketing/scripts/x/submit-blockaid-mistake.mjs`).
- [ ] **Submit ChainPatrol dispute** (`https://app.chainpatrol.io/dispute`). Separate reputation feed, also reaches MetaMask. No captcha, fully scriptable.
- [ ] **Fire the in-wallet "Report an issue"** from a real mint attempt on your own MetaMask. Submits live transaction context to Blockaid's ML retraining, more weight than the form alone.
- [ ] **Refresh the AI helper bot's system prompt with mainnet reality**. Anything claiming Sepolia, UNCX lock, or pre-launch numbers will gaslight your community. Edit `prompt.txt`, scp, `docker compose up -d` (NOT `restart` — see K2).
- [ ] **Discord channel routing guard**. Build a small `post-update.mjs` helper that hard-blocks freeform posts to bot-only event channels (`#duels`, `#graveyard`, `#leaderboard`, `#marketplace`). One accidental cross-post pollutes the curated feed.

### Within 24h

- [ ] **List $TOKEN on CoinGecko** (`Request Form → New Coin/Token Listing → Fast Pass`, 24h SLA). Requires an active DEX pair. Token-info reputation signal helps Blockaid + downstream scanners.
- [ ] **Submit to Base ecosystem registry** (`https://forms.gle/hJhc2PqfAsQp86YL8`). Need a 192×192 icon. Backlink from base.org boosts domain reputation.
- [ ] **Update Basescan token info** for $TOKEN (logo, socials, project description). Free, eventual review.
- [ ] **Verify all contracts on Etherscan V2 endpoint** (`https://api.etherscan.io/v2/api?chainid=X`). V1 is deprecated — old `--verify` flows fail silently. New contracts: `forge verify-contract --verifier-url https://api.etherscan.io/v2/api?chainid=8453 ...`
- [ ] **Round every formatUnits in the UI**. Default 18-decimal display turns into a wall ("72.7198385571958403 BRAWL"). Wrap in `Number(formatUnits(x, 18)).toFixed(2)` everywhere — grep for `formatUnits(.*,\s*18)` and audit each call site.

### Within 1 week — marketing infrastructure

These should ideally be drafted PRE-launch, not after. If they get bumped to post-launch, do them all in week 1.

- [ ] **TG group target list** (degen / gem hunters / leverage rooms, NOT chain-maxi rooms — they ban shills on sight). Per-group: link, member count, vibe, shill rules. Verify each link before targeting.
- [ ] **TG soft-shill templates** in BOTH polished and chitter-chatter (drop-in-convo) formats. Aussie degen voice > polished marketing copy. Lead with mechanic, not chart.
- [ ] **X campaign playbook**: ranked KOL list (5 bullseye + 20 tier 2-3), cashtag/hashtag kit (max 2 cashtags/post, max 2 hashtags/own-post, ZERO hashtags in replies = bot flag), post-type taxonomy with reply triggers.
- [ ] **X reply kit**: 8-10 archetype-keyed reply templates (Base growth tweet, "NFTs are dead", new launch announce, GameFi take, etc.). Each pre-vetted for voice + length + link strategy.
- [ ] **Live reply candidates** drafted under specific recent KOL tweets (URLs + drafted reply text). Stale within 24h, but proves the playbook works.
- [ ] **Verify EVERY KOL handle** via authenticated Playwright session — WebFetch + Nitter both return 402/empty in 2026. Cookies from your real X session in `marketing/scripts/x/.session.json`.
- [ ] **Strip dead hashtags from any inherited playbook**. As of 2026-05: `#GameFi`, `#P2E`, `#NFTGaming`, `#PFPgame` are dead. `#OnchainSummer` is huge Jun-Aug per Coinbase campaign. Recheck before each campaign.
- [ ] **DM auto-reply on personal account** for the inbound "we can promo your project" wave. Triggered by keyword (`promo|shill|promotion|advertise|marketing`), fires once per sender, polite "drop your business case + recent campaign results" canned reply.

### Within 1 week — UX bugs that hit real users

- [ ] **Arena listing is per-NFT, not per-wallet, from day 1.** Approval-as-listing is elegant but groups all of an owner's brawlers together. Day-1 deploy of a tiny `ArenaOptOut` (or equivalent) contract avoids the painful retrofit. See K1.
- [ ] **Default approval to 1× fightCost, not MAX_UINT256.** Users who approve-once-and-walk-away end up at graveyard risk or losing stacks to opportunistic opponents. Expose 1 / 5 / 10 / ∞ as explicit choices, default 1.
- [ ] **Matchmaker filters by BOTH allowance AND balance**, not allowance alone. Allowance-only = silent reverts when opponent's wallet is broke.
- [ ] **"Leave arena" button** that revokes approval (`approve(spender, 0)`). Without it, users with old MAX approvals can't safely exit.

---

## K. Patterns to copy verbatim (added 2026-05-19)

### K1. Tiny pure-state companion contracts

`ArenaOptOut.sol` (40 LOC, 17 tests, ~$0.02 gas to deploy) is the template for adding state to a LIVE system without modifying deployed contracts:

- Owner-gated via the underlying NFT's `ownerOf` (no auth state in the new contract)
- `setOptOut(tokenId, flag)` + `setOptOutBatch` for gas-efficient multi-token flips
- `optedOutMany(tokenIds[])` for batch frontend reads (single RPC for N brawlers)
- Event per token for indexer ergonomics
- No funds, no ownership, no upgrade path. Pure state. Risk surface ≈ 0.
- Advisory by design: live contracts don't consult it. Official frontend filters. Bad-actor custom UIs ignored.

Pattern reuses for any per-NFT toggle you wish you had at launch (visibility, opt-out, custom badges, etc).

### K2. `docker compose restart` does NOT re-read .env

Burned an hour on this. After `sed`-ing a flag in `.env`, restart reuses the cached env from when the container was first `up`'d. You need `docker compose up -d` (recreates the container) for env changes to take effect. Document this in every userbot / keeper deploy runbook.

### K3. Headed-mode Playwright with human-pause for captcha forms

Blockaid's false-positive form has an image captcha (no Cloudflare turnstile, no easy bypass). The pattern that works:
1. Headed browser
2. Autofill every field except captcha
3. Pause on a readline prompt: "type captcha, click Next, press ENTER here"
4. Continue + screenshot post-submit

10 seconds of human attention for the captcha, full automation for everything else. Avoids OCR / 2Captcha API costs / fragility.

### K4. "Allowance as listing" is elegant but per-OWNER

For any "is this NFT entered into [pool]" decision, the cheapest implementation is "owner has approved enough TOKEN to the spender contract". Zero new state. But: if an owner has N NFTs, the approval is shared across all of them. There's no way to express "NFT #5 is in, NFT #6 is out" with allowance alone — you need a per-NFT bit somewhere (K1 pattern).

Decide at design time: is the "in the pool" decision per-wallet or per-NFT? If per-NFT, build the K1 contract from day 1. Retrofitting after launch is doable (we did it) but causes confused users and a Vercel redeploy in the middle of a marketing push.

### K5. Refresh AI helper-bot prompts on launch day, not "later"

Our userbot's `prompt.txt` said LP was Unicrypt-locked + Sepolia + had a +20 BRAWL airdrop bonus. All three were wrong post-launch. If we'd flipped `LISTENER_ONLY=false` without refreshing the prompt, the bot would have authoritatively lied to community members. Make "refresh prompt with current contract state" a launch-day checklist item, not a week-2 cleanup.

---

*Written 2026-05-18, ~16h post-launch. Sections J + K added 2026-05-19 from day-2 work. Next project should reference this doc + the `LAUNCH-PLAYBOOK.md` together as the launch-day pair.*
