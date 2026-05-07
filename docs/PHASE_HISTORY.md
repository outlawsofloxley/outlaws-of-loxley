# Brawlers, Phase / Iteration History

Archived from `CLAUDE.md` on 2026-04-26 to keep the live tracker concise.
This file is the long-form record of every shipped iteration, addresses
and decisions current to v1 launch on BSC Testnet.

## Phase summary

| Phase | Scope | Status |
|------:|:------|:-------|
| 1–3 | TypeScript game engine, CLI REPL, persistence | Complete (164 tests pass) |
| 4 | Solidity contracts (Brawlers / Duel / Graveyard) | Complete (72 forge tests, byte-identical TS↔Solidity parity) |
| 5 | On-chain integration: CLI talks to deployed contracts via ethers v6 | Complete |
| 6 | Next.js frontend | Complete, all 6 turns shipped |
| 7a | Contract `tokenURI` + hybrid metadata API endpoints | Complete locally |
| 7-TOKENOMICS | BRAWL ERC-20 + MintDrop + fight stake economics | Complete (86 forge tests) |
| 7-FRONTEND-WIRE | Frontend wired to Phase 7 contracts | Complete |
| 7b | Live testnet deploy + Vercel hosting (BSC Testnet chain 97) | LIVE at https://frontend-liard-nine-57.vercel.app |
| 7-ITERATION-1 | Random names (50×50) + curve A resurrection + strip rename + King 1/1 + frontend polish | Complete (2026-04-24) |
| 7-ITERATION-2 | Batch mint (20/tx) + win-scaled resurrection + signer key uploaded | Complete (2026-04-24 pm) |
| 7-ITERATION-3 | Batch reveal grid + one-click duel + history + leaderboard + visual duel animation | Complete (2026-04-24 pm+1) |
| 7-ITERATION-3 polish | BSC-RPC-safe getLogs (1k chunks, retry-halve), pot-centric duel UI, leaderboard fighters-only, weapon glyphs + clash spark | Complete (2026-04-24 pm+2) |
| 7-ITERATION-4 art v1 | Procedural 32×32 avatar generator, round head, googly eyes, rarity-driven hats, 12 hand-drawn weapon sprites, /audit page | Complete (2026-04-24 pm+3) |
| 7-ITERATION-4 art v2 | Big variety pass: gender split + 7 hairstyles + hair streaks + 17 hat types + 6 arm accessories + 5 auras + 4 eyewear + 6 pet types + pet collars + 10 pant palettes | Complete (2026-04-24 pm+4) |
| 7-ITERATION-4 art v3 | Off-hand items, background scenes, floor props, chest badges, face extras, species variants | Complete (2026-04-24 pm+5) |
| 7-ITERATION-4 art v4 | Weather scenes + boosted scene chance on lower tiers + expanded palettes, art ready for 500-mint test | Complete (2026-04-24 pm+6) |
| 7-ITERATION-5 matchmaking-lite | Auto-match opponent ±75→±150→±300→any window with reroll | Complete (2026-04-24 pm+7) |
| 7-ITERATION-6 duel pizazz + DB | Animation gated on wallet-sign, intro stare-down + feints, thunder/lightning/disco/blood, ~10s pacing, frozen arena outcome overlays. Neon Postgres wired via `@vercel/postgres`, `/api/history/sync` + `/api/history/query`, RPC pool rotation | Complete (2026-04-24 pm+8) |
| 7-ITERATION-7 marketplace | `Marketplace.sol` deployed, approval-based, 5% fee, native-currency. `/market` page, `MarketplacePanel`, sync/listings APIs, daily cron. 26 forge tests | Complete (2026-04-24 pm+9) |
| 7-ITERATION-8 mobile polish | Hamburger nav, safe-area insets, 44px tap targets, text-base inputs (no iOS auto-zoom), full-width primary CTAs on mobile | Complete (2026-04-24 pm+10) |
| 7-ITERATION-9 mobile wallet | Tried `@metamask/sdk` connector alongside `injected()` | Complete (2026-04-24 pm+11) |
| 7-ITERATION-10 mobile duel tap | Mobile gesture-bound submit button instead of useEffect auto-fire (custom-scheme deep-links require user-gesture) | Complete (2026-04-24 pm+12) |
| 7-ITERATION-11 reverted SDK + deeplink + matchmaking filter + house keeper | Reverted MM SDK (was hijacking window.ethereum); use `https://metamask.app.link/dapp/...` deep-link. Matchmaker filters by allowance. House fighters with auto-resurrect keeper | Complete (2026-04-24 pm+13) |
| 7-ITERATION-12 fresh-wallet + strict MM + death anim + art v5 + arena lineup | Preflight split into opponentReady/mySideReady. Strict matchmaking (no "any" fallback). Death animation on 3 consecutive losses. Art v5 (chunky 24×32 humanoids per `ss/v1imge.jpg`). ArenaLineup component | Complete (2026-04-24 pm+14) |
| 7-ITERATION-13 /dash dev dashboard | Dev dashboard at `/dash` with SIWE auth (HMAC cookie keyed by `DASH_SESSION_SECRET`), revenue/health/audit/settings widgets, house whitelist manager. Built autonomously overnight 2026-04-25 | Complete (2026-04-25) |
| 7-ITERATION-14 art polish | Multi-turn D-driven art tightening: all-purple background per rarity, archetype system (brawler/pirate/ninja/thug/wrestler/boxer/cowboy/knight/punjab/samurai/royal), removed scenes/off-hand/sparkles/species, faces tightened (drop wide/oneeyed expressions, drop warpaint, drop beard/bigbeard, keep moustache/goatee), dark-skin brightPupil override, dead state = red X + 7 blood drips, weapons redesigned 9-10 rows tall + held above head, detailed pets (6×6 sitting dog/cat with eyes), `/sample10` review page | Complete (2026-04-26) |
| 7c | Base mainnet | Pending, decide migration from BSC Testnet |

## Iter-3 verification (2026-04-24 pm+1)

- `npx tsc --noEmit` clean
- `npx next build` succeeds; routes added: `/leaderboard`, `/history`, `/brawler/[id]/history`. All render statically except `/brawler/[id]/*` (dynamic) and the API routes.

## Phase 7 tokenomics, design decisions

Set 2026-04-23, revised 2026-04-24:

| Decision | Choice |
| --- | --- |
| 500 rarity distribution (internal tier 0..4) | 5 in top tier / 10 next / 50 / 125 / 310 |
| Display labels (after 2026-04-24 swap) | Epic = rarest (5 brawlers, tier 4, Bazooka/Rail Gun), Legendary = next (10 brawlers, tier 3, Flaming Sword/Electric Axe) |
| King (1-of-1, dev) | tokenId 501, tier 5, Kingsblade weapon (50-100 dmg, speed 10), all-18 stats, ELO 2000, level 10 |
| Mint raise split ($20k) | $10k LP / $5k dev / $5k reserve |
| BRAWL distribution (100k) | 50k LP / 25k minter airdrop (50 each) / 10k dev / 15k reserve |
| Fight mechanic | Both-stake (100 BRAWL each), winner 180, dev 20; tie splits 90/90/20 |
| Mint price (testnet) | 0.0001 tBNB or 1 MockUSDT |
| Resurrection cost | `base × tierMult/10 × (10 + wins)/10` where tierMult ∈ [10,15,25,40,70,150]. On mainnet set base to $100 equivalent |
| Batch mint | `mintMultipleWithETH/USDT(to, count)`, MAX_BATCH=20/tx, single signature, N events, N×50 BRAWL airdrop |
| Rename | REMOVED, names permanent, rolled from 50×50 pool on mint |
| Rarity gameplay effect | Weapon tier only, no extra stat bonus |
| BRAWL initial holder | EOA (deployer by default), no multisig |

## Phase 7a, hybrid metadata architecture

**Contract side** (`contracts/Brawlers.sol`):
- `_baseTokenURI` storage var
- `function setBaseURI(string) external onlyOwner`
- `function baseURI() external view returns (string)`
- `function _baseURI() internal view override` wires OZ ERC721's `tokenURI(id)`
- `event BaseURISet(string oldURI, string newURI)`

**Backend side** (Next.js API routes):
- `GET /api/token/:id` → OpenSea-spec JSON (15 attributes), Cache-Control: 60s.
- `GET /api/token/:id/image` → `image/svg+xml`, same portrait the in-app card uses.
- `POST /api/run-duel` → runs TS combat sim server-side, applies ELO, signs with `BRAWLERS_SIGNER_KEY` env var.

**Client side** (`frontend/src/app/duel/page.tsx`):
- POSTs to `/api/run-duel`, animates returned events at 350ms intervals, then submits `submitDuel(result, signature)` via user wallet.

## Stale Anvil addresses (last used 2026-04-23)

Two deploys live on Anvil from older sessions:

**Phase 7a tokenURI-only**: BRAWLERS=0x8A79…aa3 / DUEL=0x6101…788 / GRAVEYARD=0xB7f8…5e

**Phase 7 tokenomics**: BRAWL=0x4ed7…1C1 / BRAWLERS=0x3228…c44 / DUEL=0xa852…38f / GRAVEYARD=0x4A67…319 / MockUSDT=0x7a20…14F / MintDrop=0x0963…bef

- Deployer/player account 0: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (privkey `0xac0974…ff80`)
- Duel signer account 1: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- Master seed: `0x2a` (42)
- Resurrection cost: `0.01 ETH`
- Base URI: `http://localhost:3000/api/token/`
- Chain ID: 31337, RPC: http://127.0.0.1:8545

## Prior BSC Testnet deploys (superseded 2026-04-24 pm)

- Graveyard v2: 0x9FEf76dc5e6Ff80E239A808a944E24D9632B3229
- MintDrop v2:  0x86E329EA34a977e9479d57732FD02d431b1C25ad
