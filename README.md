# BASEic Brawlers

On-chain NFT battle game on Base. 2000 pixel-art warriors duel for ELO with
$BRAWL stakes. Lose three in a row and you die. Pay ETH to resurrect.

🟢 **Live (testnet):** [baseicbrawlers.com](https://baseicbrawlers.com) (Base Sepolia, chain 84532)
🐦 **X:** [@BASEicBrawlers](https://x.com/BASEicBrawlers)
📣 **Telegram:** [t.me/baseicbrawlers](https://t.me/baseicbrawlers)

## What's in the box

- **Solidity contracts** (`contracts/`). Brawlers ERC-721, BRAWL ERC-20 with
  anti-sniping rails, Duel engine with off-chain signed result settlement,
  Graveyard with tier-scaled resurrect cost, MintDrop with tiered pricing
  (100 free / $40 / $45 / $50 / $60), Marketplace.
- **Game engine** (`src/`). TypeScript brawler stats, ELO, RNG, weapon
  matchups. Same algorithm as the on-chain version (Phase-4 parity).
- **Web UI** (`frontend/`). Next.js 16 + wagmi 3 + viem. Browse, mint, duel,
  graveyard, leaderboard, marketplace, history. Pixel-art SVG avatars
  generated deterministically per tokenId.
- **Marketing kit** (`marketing/`). Telegram bots (welcome / raid /
  leaderboard, Grammy + JSON state), launch copy, art generators, KOL
  outreach templates.
- **Test suites**. 211 vitest (engine + sim parity) + 112 forge.

## Repo layout

```
contracts/      Solidity (Foundry)
script/         Deploy + ops scripts
src/            TypeScript CLI + game engine
test/           vitest (engine) + forge (Solidity)
frontend/       Next.js 16 dapp + API routes
marketing/      Bots + content + art generators
docs/           PHASE_HISTORY.md (full iteration log)
CLAUDE.md       Stable project context (read by Claude Code)
SESSION_STATE.md Live handoff doc (read first, update last)
```

## Setup

You'll need Node 22+ (24/25 work too), Foundry 1.5+, Git.

```bash
git clone <repo-url> --recurse-submodules
cd brawlers
npm install                              # root engine + CLI
cd frontend && npm install && cd ..      # frontend deps
cp .env.example .env                     # local Anvil defaults
cp frontend/.env.example frontend/.env.local
forge install                            # if submodules didn't recurse
```

## Run locally

Two terminals:

```bash
# terminal 1
anvil

# terminal 2
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
cd frontend && npm run dev
```

Open <http://localhost:3000>. Anvil's account 0 is the deployer. Import its
key into MetaMask for test ETH and contract owner permissions.

## Tests

```bash
npm test         # 211 vitest (CLI engine + frontend sim parity)
forge test       # 112 forge tests
```

## Deployed contracts (Base Sepolia, chain 84532)

See `.env.base-sepolia` for the canonical address list. As of v5
(2026-04-29):

| Contract     | Address |
|--------------|---------|
| `BRAWL`      | `0x1d2caa58c6b2d70e84405a68ca6bf7b9b5675b51` |
| `Brawlers`   | `0x936ae7d74930d52ef460b77d34e9947dd8c8bb4d` |
| `Duel`       | `0xf4dfb5f21c9c11623d79fc360747f83f34e57d35` |
| `Graveyard`  | `0x43cd05987ab4528f2332a9e9aabaf90a8bd9c9c7` |
| `MintDrop`   | `0xc58d5f6cf1659100a1476eeec5f3c7f0d074372f` |
| `Marketplace`| `0xEeab07c9CE7EaEFCfa378619b61d97fbCBbFDB4d` |

## Mainnet plan

- Tiered pricing locked. 100 free founder slots, then 400 @ $40, 500 @ $45,
  500 @ $50, 500 @ $60.
- BRAWL/ETH pool seeded on Aerodrome v2. LP locked on Unicrypt for 6 months
  (`script/SeedAndLockLP.s.sol`).
- BRAWL renounce sequence after a 24 to 48 hour soak: whitelist game
  contracts, enable trading, blacklist obvious bots, liftLimits,
  renounceOwnership.
- Game contracts (Duel/MintDrop/Marketplace/Graveyard) stay dev-controlled
  for game tuning. No rug-able functions in those.

## Licence

Licence TBD. Owner will pick one before any public push.
