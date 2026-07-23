# Trust signals

i'm one person building this. that's the charm and the limit. this chapter is the unsexy part: what's actually true today, what's contract-enforced, and what's a promise about mainnet rather than a fact about now. read it anyway.

## the biggest trust signal: it's testnet

there is no real money in this game yet. full stop.

- the game runs on **robinhood chain testnet** (chain id 46630). mainnet (chain id 4663) has nothing deployed.
- mint prices are micro amounts of faucet eth. LAWS is airdropped free with every mint. none of it has value, none of it can be sold for value, and that's by design.
- **$LAWS the real token does not exist yet.** the testnet LAWS contract is a stand-in for playtesting. no LP, no trading, no price.
- nobody can lose money on outlaws of loxley today, which makes this the easiest "is it a rug" question i'll ever answer: there's nothing to rug.

if anyone offers to sell you $LAWS or a loxley nft for real money right now, they are scamming you. there is nothing to buy.

## what's contract-enforced today

the testnet contracts already carry the guardrails that mainnet will ship with. these aren't promises, they're bytecode:

- **rarity pre-commit**: the full 2,000-slot rarity order is shuffled from a master seed at deploy and hash-committed on-chain (`initialRarityHash`). nobody re-rolls it after the fact.
- **dev rarity cap**: dev mints can only roll common or uncommon. the dev cannot pull a rare, legendary, epic, or the public-drop equivalent of a king.
- **fully pvp**: no dev-owned house fighters in the arena, every opponent is a real player.
- **marketplace fee cap**: the sale fee is hard-capped at 10% in the contract. the dev can tune it below that, never above.
- **duel dev-cut cap**: the dev share of any fight pot is hard-capped at 20%.
- **signed results**: every duel result is signed by the game server and verified on-chain before any tokens move. re-requesting a matchup returns the same signed result, so outcomes can't be re-rolled.
- **listing lockout**: a listed outlaw can't duel, so a fighter can't be sold out from under a buyer mid-match.

## what's promised for mainnet (per the roadmap, no dates)

when the game graduates to robinhood chain mainnet, the plan is the same launch shape that keeps a token honest:

- **$LAWS launches with a fixed supply** through a launchpad, as a plain ERC-20 with zero admin functions from block one: no minting more, no blacklists, no pausing trades, nothing to renounce because there was never a key.
- **LP pooled and locked at creation**: the launchpad puts the entire supply into the DEX pool the moment the token exists and locks the LP in its locker. the dev never touches the liquidity, so the dev can't pull it.
- **any dev buy happens in the open** at launch, on the same terms as everyone else, wallet disclosed in the receipts.
- **contracts verified on blockscout** so anyone can read exactly what they do.
- **keeper bots** pegging fight and cut-down costs to usd targets.
- **founder perks** for the first 100 mainnet mints.

none of that exists yet. it's written here so you can hold me to it later, not so you treat it as done.

## what stays dev-controlled at mainnet (intentionally)

the game contracts (duel, mint, gallows, marketplace) will stay dev-owned even after the token is renounced. they need ongoing tuning: fight costs, cut-down costs, fees within their hard caps, and a pause switch as a bug escape-hatch. the difference between **game tuning** and **rug capability** is the whole design: the caps live in the bytecode, the tuning happens under them.

## scope, honestly

- **no paid security audit.** the solidity test suite covers the core flows and passes clean, but a test suite is not an audit.
- **solo dev, single wallet.** there's no team, no multisig yet, no support desk.
- **testnet addresses churn.** contracts get redeployed as the game changes. never trust a loxley address from anywhere except the site itself: [outlaws-of-loxley.vercel.app](https://outlaws-of-loxley.vercel.app).
- **assume testnet progress resets.** mints, ratings, and records are playtest data.

when there's real money involved, this page gets rewritten with addresses, receipts, and on-chain proof for every claim. today the honest version is shorter: it's a testnet game, come play it for free. 🏹
