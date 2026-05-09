# CLAUDE.md — session-to-session running notes

Living doc for Claude Code sessions on this project. Append to the top, prune the bottom. Most recent session at the top.

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
