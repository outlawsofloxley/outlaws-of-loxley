# NEW-PROJECT-BOOTSTRAP.md

How to spin up another on-chain game like BASEic Brawlers, on a different chain (immediate target: **Sonic / $S**, the rebranded Fantom L1), reusing 80%+ of this repo.

This doc is the canonical "fork + rebrand + redeploy" checklist. Pair it with `LAUNCH-POSTMORTEM.md` (sections H, J, K) for the lessons-learned layer. Pair it with `LAUNCH-PLAYBOOK.html` for the deploy day order-of-ops.

---

## TL;DR for the impatient

1. `git clone` this repo into a new directory (`sonic-brawlers/` or similar)
2. Run `script/rename-project.sh <new-slug> <NEW_TOKEN_TICKER>` to bulk-rename
3. Generate new pixel art for the new collection (the only thing that CAN'T be reused — needs visual differentiation)
4. Update env vars for the new chain (RPC, chain id, DEX router, oracle, native token, explorer)
5. Re-deploy contracts to the new chain (forge scripts are already chain-agnostic)
6. Vercel + NAS bot stack reuses with new env
7. Marketing scripts (X/TG/Discord) all reusable, just swap creds + handles

Realistic timeline if you copy hard: **3-5 days** from `git clone` to mainnet, vs ~6 months on the original build.

---

## What's portable (reuse as-is)

### Smart contracts (100% portable, just redeploy)

`contracts/` is chain-agnostic Solidity. Every contract works on any EVM chain.

- `BRAWL.sol` — fixed-supply ERC-20 with renounceable owner. Rename + redeploy.
- `Brawlers.sol` — ERC-721 with on-chain stats, rarity hash commit-reveal, founder badges. Just retheme metadata.
- `Duel.sol` — signed-result PvP engine, ELO, permadeath. Untouched.
- `DuelRouter.sol` — currency-aware fight wrapper, sandwich-resistant swap quotes. Replace Aerodrome interface with destination chain's DEX (see Chain Deltas below).
- `MintDrop.sol` — payable mint, 6 tiers, USDC/USDT fallbacks. Update USDC/USDT addresses for destination chain.
- `Marketplace.sol` — peer-to-peer NFT sales with fee. Untouched.
- `Graveyard.sol` — resurrection with tier-scaled cost cap. Untouched.
- `BRAWLTimelock.sol` — 40-line linear vest with immutable beneficiary. Untouched.
- `ArenaOptOut.sol` — per-NFT opt-out flag, advisory. Untouched.

**Test suite at `test/solidity/` (183 tests, all passing) is also 100% portable.** Same `forge test` after rename.

**Deploy scripts at `script/`** — chain-agnostic, env-driven. Just point `MAINNET_RPC` + `DEPLOYER_KEY` at the new chain and run.

### Frontend (95% portable, retheme the visuals)

`frontend/` is Next.js + wagmi + viem. All chain interactions are abstracted via env vars.

- `frontend/src/core/` (elo, rng, stats, weapons) — game logic, 100% reusable.
- `frontend/src/lib/abi.ts` — ABIs match the contracts, copy-paste once contracts redeploy.
- `frontend/src/lib/env.ts` — env validator. Just add/remove fields as the chain changes (e.g. swap `aerodromeRouterAddress` for the new DEX).
- `frontend/src/hooks/` — all generic ERC-721/ERC-20 wagmi hooks, reusable.
- `frontend/src/components/` — all reusable. Rebrand colors via Tailwind config + the `brawl-*` CSS classes.
- `frontend/src/app/` — pages reusable. Update copy + brand name.
- `frontend/public/wallet-icons/` — keep all (MetaMask, WalletConnect, Coinbase, etc).

**Things to swap visually:**
- Brand name everywhere (`BASEic Brawlers` → `<new name>`)
- Color palette in `tailwind.config.ts` (orange/cyan → new theme)
- Logo / favicon / OG image / banner in `frontend/public/`
- Pixel-avatar generator (`frontend/src/lib/pixelAvatarSvg.ts`) — same code, swap the sprite source assets

### Bots (90% portable, env-driven)

- **Discord bot** (`marketing/discord/bot.mjs`, 1100 LOC) — change env (`BB_DISCORD_GUILD_ID`, `RPC_URL`, contract addresses, channel names if you renamed). Embed copy needs a sweep for "Brawler" → new term.
- **TG userbot** (`marketing/userbot/`) — change prompt.txt + Telegram credentials + group name. The prompt structure (VOICE / PROJECT FACTS / DO / DON'T / HOLDER DISTRIBUTION) is the template — fill in new project facts.
- **Welcome bot** (`marketing/bots/welcome-bot/`) — change handles + auto-replies.
- **Keeper bots** (`marketing/keeper/`) — fight-cost / resurrect-cost / mint-cost keepers. 100% reusable. Update env (new chain RPC, contract addresses, ORACLE address — see Chain Deltas).

### Marketing infra (95% portable)

- **X automation** (`marketing/scripts/x/`) — Playwright cookie-session flow. Just paste new account's `auth_token` + `ct0` into `.session.json`. Set-bio, set-banner, tweet, thread-chain all work.
- **TG automation** (`marketing/scripts/tg/`) — post-text.mjs + post-receipt.mjs reusable, just new bot token + group/channel IDs.
- **Discord post-update** (`marketing/scripts/discord/post-update.mjs`) — guarded posting helper, reusable.
- **Blockaid + ChainPatrol false-positive submission** (`marketing/scripts/x/submit-blockaid-mistake.mjs`, `submit-chainpatrol-dispute.mjs`) — same forms work for any new project on any chain.
- **All `marketing/content/` artefacts** — shill-pack, KOL playbook, reply kit, soft-shill templates, telegram-pinned, key-holders breakdown template — usable as TEMPLATES, swap numbers + handles.

### Lessons learned (100% portable, read first)

- **`LAUNCH-POSTMORTEM.md`** — sections H (pre-launch), J (day-2 to week-1), K (patterns to copy verbatim). Read this before doing anything.
- **`LAUNCH-PLAYBOOK.html`** — deploy-day order of operations. The R1-R10 receipt pattern is reusable; just retheme the receipt text.
- **`CLAUDE.md`** — session-to-session notes from this build. Useful context but specific to BASEic.
- **`LAUNCH_AUTOMATION.md`** + **`LAUNCH-LESSONS.md`** — supplementary.

### Memory files in `~/.claude/projects/`

Most BB-specific memories don't transfer, BUT these are universal:
- `feedback_launch_day_patterns.md` — hard + soft rules from this launch
- `feedback_no_em_dash_no_ai_speak.md` — universal voice rule
- `feedback_discord_channel_routing.md` — universal Discord pattern
- `feedback_autonomy.md` — Darren's operating model

Copy these into the new project's memory folder.

---

## What's NOT portable (must redo)

### Pixel art

The 2,000 Brawler PNGs + 1 King + the 5-rarity weapon sprite set are visually tied to BASEic Brawlers. The NEW project needs:
- New character sprite sheet (different vibe — Sonic theme could be speed-coded mascots, fox-tribe, neon-cyber, etc)
- New weapon sprites
- New King 1/1
- New banner / icon / OG image

The art-generation pipeline (in `frontend/src/lib/brawlerArt.ts` + `pixelAvatarSvg.ts`) IS reusable — same composition logic, new source sprites. But the actual sprites themselves are project-unique.

If you have time, generate via Midjourney / SDXL pixel-art prompt, then post-process to retro palette + tile alignment.

### Brand identity

- Name
- Tagline ("BASEic by name. Brutal by attitude.")
- Domain
- Social handles (@BASEicBrawlers reserved for current project)
- Color palette
- Copy voice (aussie casual is portable — just don't claim to be the same person/project)

### Per-project deployment artefacts

- Contract addresses (will be new on new chain)
- Vercel project (new one)
- Discord guild (new one)
- TG group + channel (new)
- X account (new)
- GitHub repo (new)
- TrueNAS stacks (new container names, new dirs)

### What ALSO can't be carried over

- Founder badges of original project (those are tokenIds 1-100 of THAT collection)
- Existing players + leaderboard
- LP burn proof (you'll do a fresh LP burn on the new chain)
- The actual reputation / brand trust you've built — has to be re-earned

---

## Chain deltas: Base → Sonic ($S)

This is the bit that needs verification at the time of building, since Sonic is newer than Base and tooling may have evolved. Don't trust any of these without re-checking.

### Confirmed / probably stable

| Item | Base | Sonic | Notes |
|---|---|---|---|
| Chain ID | 8453 | **146** | verify at sonic.org / chainlist.org |
| Native token | ETH | **$S** | rebrand from ETH everywhere in UI / contracts |
| Block explorer | basescan.org | **sonicscan.org** | use V2 API endpoint for verify (`https://api.etherscan.io/v2/api?chainid=146`) |
| EVM compatibility | yes | **yes** (FVM = full EVM compatible) | contracts deploy as-is |
| Token standards | ERC-20/721/1155 | **same** | no change |
| MetaMask | works | **works** (auto-prompts to add Sonic on first interaction) | document the chain-add UX for users |

### Needs research at build time

| Item | Base | Sonic | What to find |
|---|---|---|---|
| Primary DEX | Aerodrome v2 | **?** (Beethoven X / SwapX / Equalizer / Shadow / new launches likely) | research live TVL leaders + best LP-burn UX |
| Stable USDC | 0x833589f... | **?** | confirm canonical USDC on Sonic |
| ETH/USD oracle | Chainlink | **?** (Chainlink, Pyth, RedStone, DIA all candidates) | confirm which is most-used + lowest latency for keeper bots |
| RPC primary | base-rpc.publicnode.com | **?** (publicnode? Sonic Labs official? Ankr?) | find a paid/private RPC that won't 429 |
| Bridge | bridge.base.org | **?** (Sonic Gateway, LayerZero, deBridge) | document the bridge path for user onboarding |
| Coinbase Wallet | works | **may not** | flag in connect modal if missing |
| Blockaid coverage | yes | **probably yes** (Blockaid covers EVM broadly) | still file FP if flagged |

### Sonic-specific narrative angles to lean into

- "Fantom is back" / "$S = phoenix rising" — the reboot narrative is a real attention vector
- Fee Monetisation (FeeM) — Sonic offers a portion of gas back to dApps. Check eligibility, this is a marketing angle ("90% of fees you pay come back to the protocol")
- Sonic Boom airdrop campaign — was a thing during early Sonic months, check status
- Sonic's S Airdrop NFT — many sonic-native projects build mini-games for airdrop hunters
- The "lower fees than Base, faster than Solana" pitch only works if true at build time — verify

### Things that get HARDER on Sonic (probably)

- Reputation systems: GoPlus, TokenSniffer, Blockaid may not have full Sonic coverage at launch — your project gets flagged longer
- Wallet coverage: fewer wallets support Sonic by default in 2026
- KOL ecosystem: smaller than Base — find Sonic-native KOLs early (Andre Cronje is still active, $S Foundation accounts, Equalizer / Beethoven team members)
- LP-burn UX: each chain's preferred LP burning pattern differs

---

## Bootstrap sequence (recommended order)

### Day 1: setup
1. `git clone` BASEic Brawlers repo → new directory
2. Run `script/rename-project.sh <new-slug> <NEW_TICKER>` (creates a chore commit)
3. Create new GitHub repo, push
4. Decide: new repo public or private during dev? (BASEic went public ~launch eve, paid for it via the GitBook leak — see post-mortem G3)
5. Reserve socials: X handle, TG group + channel, Discord guild, domain
6. Set up Vercel project, link to new repo

### Day 2: chain research + assets
1. Verify all Chain Delta items above for Sonic at current date
2. Update `frontend/.env.example` with the new chain's env vars
3. Find oracle, DEX, USDC addresses
4. Generate pixel art (or commission)
5. Replace logo / banner / icon / OG image

### Day 3: contracts
1. Update `script/Deploy.s.sol` env requirements for new chain
2. Update `contracts/DuelRouter.sol` Aerodrome interface → new DEX interface
3. Update `contracts/MintDrop.sol` USDC/USDT addresses
4. `forge test` should still pass 183/183 (game logic unchanged)
5. Deploy to Sonic mainnet via `script/launch-mainnet.sh` (after env tweaks)
6. Verify all contracts on sonicscan.org via Etherscan V2 endpoint

### Day 4: frontend + bots
1. Update Vercel env vars with new contract addresses
2. Deploy frontend, alias to new domain
3. Discord server: create from `marketing/discord/template.json` via setup.mjs
4. TG group: create + add welcome bot + userbot
5. Spin up keeper bots on TrueNAS (new stack: `<new-slug>-keepers`)
6. Spin up Discord bot stack (new container, same code, new env)

### Day 5: launch
1. Run the post-mortem section H + J pre-launch checklist
2. Use `LAUNCH-PLAYBOOK.html` for the deploy-day order of ops
3. R1-R10 receipt templates: rewrite for new project, fire as each step lands
4. Within 1 hour of going live: Blockaid + ChainPatrol false-positive forms (per post-mortem section J)

---

## Rename helper

`script/rename-project.sh` (created alongside this doc) does the bulk-rename:

```bash
bash script/rename-project.sh sonicfighters $SFIGHT
```

What it does:
- Replaces `BASEic Brawlers` → `<new project name>` across markdown + frontend + bot copy
- Replaces `BRAWL` → `<NEW_TICKER>` across contracts + frontend + tests
- Replaces `brawlers` → `<new-slug>` across env files + repo identifiers
- Replaces `baseicbrawlers.com` → `<new-domain>` across docs + scripts
- Renames `contracts/BRAWL.sol` + corresponding test/script files

What it DOESN'T do:
- Doesn't touch addresses (those need manual update after redeploy)
- Doesn't change Solidity contract NAMES (you'll want to do that manually + carefully)
- Doesn't regenerate art
- Doesn't redeploy

Always review the diff before committing.

---

## Sonic-specific build notes (placeholder)

Once you start the Sonic clone, append a section here documenting the chain deltas you actually discover. Future-you (or future-Claude) will thank you. Key things to capture:

- The actual chain ID, RPC, oracle, DEX you ended up using
- The Sonic LP burn pattern (does Sonic have a SushiSwap/Aerodrome-equivalent with native burn UX?)
- FeeM enrolment status
- Any wallet compat issues you hit
- Sonic KOL handles that responded
- TG / Discord rooms that don't ban Sonic shill (vs which do)

This becomes the section J equivalent for the Sonic project.

---

## Where the memory + reference files live

- This doc: `NEW-PROJECT-BOOTSTRAP.md` (repo root)
- Rename helper: `script/rename-project.sh`
- Lessons learned: `LAUNCH-POSTMORTEM.md` sections H / J / K
- Memory pointer: `~/.claude/projects/C--tools-brawlers/memory/reference_new_project_bootstrap.md`

If you start the Sonic project, the FIRST thing the new Claude session should do is read this doc + `LAUNCH-POSTMORTEM.md` sections H, J, K. That alone will save weeks.
