# 🧾 Key holders — $BRAWL distribution explained

If you've checked the top-holders chart on Dexscreener/Basescan and seen four wallets sitting at 10-20% each, here's what each of those wallets actually is. None of them is a hidden insider stash.

## the headline

**100,000 fixed supply. owner renounced. no more $BRAWL can ever exist.**

- ~20% **locked** in a team-vault timelock contract (6-month linear vest, no admin)
- ~20% **in the burned LP** (LP tokens at `0xdead`, can't be pulled ever)
- ~20% **keeper float** for the house brawlers + arena ops (recycles through duels)
- ~10% **dev wallet** for ongoing dev / marketing / season prizes
- ~30% **in players' hands** (everything bought on Aerodrome since launch)

## the address list

| role | address | balance | can it sell? |
|------|---------|---------|--------------|
| 🔒 **Team vault (timelock)** | [`0xdD4F…C761`](https://basescan.org/address/0xdD4Fda3AED746E81481d58958e6E8c6D2e7cC761#code) | 20,000 | only linear release to dev wallet over 6 months. beneficiary immutable, no admin function, no escape hatch. live countdown at [/lock](https://baseicbrawlers.com/lock) |
| 🏟️ **Aerodrome BRAWL/ETH pair** | [`0xf99F…e3c`](https://basescan.org/address/0xf99F374AC9479BC8E224d5E56e3e815B6cc48e3c) | ~19,700 | only via swaps. the LP receipt tokens were burned to `0xdead` at launch. `removeLiquidity()` can never be called by anyone |
| ⚙️ **Keeper (game ops)** | [`0x6137…c04E`](https://basescan.org/address/0x613794Dc02cc1a9f29Fbbdc8C5A82d08162bc04E) | ~19,500 | dev-controlled, stake float for the 10 house brawlers. recycles through duels — house wins → BRAWL back, house loses → BRAWL out. roughly constant over time |
| 👤 **Dev wallet** | [`0x5b1A…6805`](https://basescan.org/address/0x5b1A749cc7bF1dE8ecA505769BD34Ba65f456805) | ~10,100 | dev's ops + marketing + future season prizes. no contract lock — trust-based. every move shows on basescan within a block |

## what each address physically can't do

- **The timelock**: can't be sped up, can't change beneficiary, can't be pulled early. It's a 40-line contract with zero admin functions. Anyone (you, me, a stranger) can call `release()` — it just pushes the currently-vested amount to the immutable beneficiary.
- **The LP pair**: the LP tokens representing pool ownership were sent to `0x000…dEaD` immediately after seeding. No private key for that address exists. The BRAWL+ETH inside the pool can only move via swaps (and even then, fees accrue back to the pool).
- **The keeper**: not on-chain locked. If you don't trust the dev to keep using it for game ops, you can mentally treat it as part of the dev allocation. The 10 house brawlers actively use it — it's not sitting idle.
- **The dev wallet**: not on-chain locked. Trust-based. Used for infra costs, marketing, future season pools, partnerships. Every transfer is public — if you ever see a large amount move to a CEX, ask questions.

## what about the wallet at 21%?

If you see a single wallet near the top that's NOT in the list above, it's almost always an early aggressive buyer who aped sub-$10k mcap. Look at the transfer history on basescan — if it bought via swap on Aerodrome, it's a real buyer, not a dev stash.

## verify any of this yourself

1. `BRAWL.totalSupply()` on basescan → 100,000e18
2. `BRAWL.owner()` on basescan → `0x0` (renounced)
3. `BRAWL.balanceOf(0xdD4F…C761)` → 20,000e18 (the timelock)
4. read the timelock contract source on basescan, search for `Ownable` — not there
5. find the Aerodrome BRAWL/ETH LP token contract, read its `balanceOf(0x000…dEaD)` → expect full LP supply

If anything doesn't match, **the on-chain truth wins** — and tag a mod in #bug-reports so we can fix the doc.

## tl;dr for the scroll-past reader

~69% of $BRAWL is either locked, burned, or operational. ~31% is in players' hands. The two scariest-looking top wallets (the timelock and the LP) are both **bytecode-enforced** — no human can move those tokens early, ever.

Full breakdown with on-chain proofs: **https://docs.baseicbrawlers.com/key-holders**
