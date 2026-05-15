# Minting

go to [/mint](https://baseicbrawlers.com/mint), pick how many you want (1, 2, 5, 10, or 20 in one tx), pay in eth, usdc, or usdt on base. brawler lands in your wallet a few seconds later.

## the tiers

mint price scales as the drop fills. cheapest at the front, most expensive at the back.

| slot range | price | flag |
|---|---|---|
| 1-50 | $20 | founder 50 (gold badge) |
| 51-100 | $25 | founder 100 (cyan badge) |
| 101-500 | $30 | |
| 501-1000 | $35 | |
| 1001-1500 | $40 | |
| 1501-2000 | $50 | |

the $20 slots are the cheapest moment in the project's life. they never come back. once tier 1 sells out it's $25, then $30, all the way up.

mint money goes 100% to the dev wallet. no LP siphon, no buy/sell tax, no inventory hold.

## founder perks (slots 1-100)

token ids 1-100 carry founder status forever. doesn't matter who owns them later, the perks stick to the brawler:

- **+20 brawl bonus** airdropped on mint. standard mint drops 50, founders drop 70.
- **25% off every duel stake.** non-founders pay $1 per fight (in brawl or eth, their pick), founders pay $0.75. forever.
- **first resurrection free.** your first death doesn't cost eth. only the first.
- **founder badge** on every card. gold for slots 1-50, cyan for 51-100. the gold ones are the trophy case.

founders pay the cheapest tier prices ($20 / $25). they don't mint free. the perks are the privilege.

## bulk discount

mint more, get free brawlers in the same tx:

- **5** → +1 bonus = 6 brawlers for the price of 5
- **10** → +3 bonus = 13 brawlers for the price of 10
- **20** → +7 bonus = 27 brawlers for the price of 20

the bonus brawlers are full citizens. same rarity roll, same combat behaviour, fully tradeable.

## lottery roll

every paid mint has a **1-in-2,000** chance of dropping a free bonus brawler in the same transaction. random, on-chain, no signup. if you've ever wanted a real lottery, it's right there in the mint flow.

## what you get

every brawler is rolled fresh on mint:

- a procedurally generated name (first + last, e.g. "knox tanaka")
- six d&d-style stats (str / dex / con / int / wis / cha)
- a weapon, drawn from the rarity table
- 32×24 deterministic pixel art (same token id always renders the same)
- a starting elo rating of 1,000
- a starting level of 1, 0 wins / 0 losses

## the rarity table

2,000 brawlers in the drop, plus 1 king for the dev:

| rarity | count | weapon examples |
|---|---|---|
| common | 1,240 | knife, baseball bat, crowbar |
| uncommon | 500 | machete, pistol |
| rare | 200 | shotgun, sledgehammer |
| legendary | 40 | flaming sword, electric axe |
| epic | 20 | bazooka, rail gun |
| king (1/1) | 1 | kingsblade |

epic is rarer than legendary in this drop. yes, that's intentional.

## how the rarity is shuffled

rarity isn't picked at the moment you mint. the entire 2,000-slot order is **pre-committed** at deploy time using chainlink vrf. the on-chain `initialRarityHash()` proves the shuffle existed before any mint happened.

anyone can re-derive the shuffle from the master seed and verify their roll. nobody, including the dev, can pre-compute who pulls a king.

## the dev wallet rarity cap

the contract hard-caps dev mints to **common and uncommon only**. when the dev wallet mints (e.g. for the 10 house brawlers seeded at deploy, see the **house fighters** chapter), the rarity-pick logic skips any rare-or-better slot and lands on c/u.

translation: the dev cannot pull a rare, legendary, epic, or king on a public mint. it's an anti-rug signal baked into the bytecode.

## the king (token id #2001)

one 1-of-1, mintable only by the dev wallet, never appears in the public drop. all stats at 18, starting rating 2,000, level 10, wields the kingsblade (50-100 damage), sits on a diamond-blue background.

if you meet him in the arena, expect to lose. if you beat him, expect the internet to talk about it for days.
