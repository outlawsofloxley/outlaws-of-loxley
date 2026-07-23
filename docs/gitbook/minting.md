# Minting

go to [/mint](https://outlaws-of-loxley.vercel.app/mint), pick how many you want, pay a micro test price in testnet eth. your outlaw lands in your wallet a few seconds later, along with **50 LAWS airdropped per mint** so you can go straight to the arena.

## testnet pricing, in full

prices right now are deliberately tiny test amounts. they're not listed here because they're not the point and they'll change: the current numbers are on the mint page itself. what matters is that nothing on testnet costs real money. the real mint, with real pricing and founder perks for the first 100, is a mainnet thing (see the **roadmap**).

## bulk bonus

mint in bulk, get free outlaws in the same transaction:

- **5** → +1 bonus = 6 outlaws for the price of 5
- **10** → +3 bonus = 13 outlaws for the price of 10
- **20** → +7 bonus = 27 outlaws for the price of 20

bonus outlaws are full citizens. same rarity roll, same combat behaviour, fully tradeable.

## lottery roll

every paid mint has a **1-in-2,000** chance of dropping an extra free outlaw in the same transaction. random, on-chain, no signup. it's a testnet lottery for testnet stakes, but a free outlaw is a free outlaw.

## what you get

every outlaw is rolled fresh on mint:

- an on-chain name like **"Bandit of Blyth"**, medieval firsts and bynames, rolled from the name pools baked into the contract
- six d&d-style stats (str / dex / con / int / wis / cha)
- a weapon from the sherwood catalogue, drawn by rarity
- deterministic 32×44 pixel art (same token id always renders the same archer)
- a starting elo rating of 1,000
- 0 wins, 0 losses, and a whole life ahead of them

## the rarity ladder

2,000 outlaws in the drop, plus 1 king above them all:

| rarity | count | weapons |
|---|---|---|
| common | 1,240 | dagger, quarterstaff, mace |
| uncommon | 500 | sword, hunting bow |
| rare | 200 | crossbow, flail |
| legendary | 40 | flaming sword, war axe |
| epic | 20 | longbow, arbalest |
| king (1/1) | 1 | golden longbow |

yes, epic sits **above** legendary here. 20 epics versus 40 legendaries. the longbow is the rarest thing in sherwood short of robin himself, which feels right.

## how the rarity is shuffled

the entire 2,000-slot rarity order is shuffled from a master seed when the contract deploys, and the result is hash-committed on-chain as `initialRarityHash`. nobody re-rolls it afterwards, the dev included. what slot you mint is what you get.

one extra guardrail: **dev mints are capped to common and uncommon**. when the dev wallet mints the contract skips any rare-or-better slot. the dev cannot pull a rare, a legendary, an epic, or anything shiny from the public drop. it's in the bytecode, not in a promise.

## the king (token id 2001)

robin himself. one 1-of-1, mintable only by the dev wallet, never part of the public 2,000. all six stats at 18, starting rating 2,000, level 10, and the **golden longbow**, the only one in existence. ranged type, so blunt weapons have the edge on him, if you can survive long enough to swing.

if you meet him in the arena, expect an arrow. 🏹

## will my testnet outlaws carry over to mainnet?

assume not. testnet contracts get torn down and redeployed as the game changes, and mainnet will be a fresh deploy with a fresh mint. testnet is for finding the fun (and the bugs) before anything is worth anything.
