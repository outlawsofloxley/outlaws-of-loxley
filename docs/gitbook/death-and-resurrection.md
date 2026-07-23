# The gallows 💀 🪦

three losses in a row and your outlaw hangs. not a euphemism, not a debuff. dead. can't fight, can't earn. they swing at [/gallows](https://outlaws-of-loxley.vercel.app/gallows) until somebody pays to cut them down.

and it doesn't have to be you. **anyone can pay the cut-down price on any hanged outlaw.** rescue a mate's fighter, rescue a stranger's, or leave yours up there as a warning to the others.

## when does the hanging happen

after the third consecutive loss is confirmed on-chain, the duel contract flips the outlaw's dead flag. the streak only counts consecutive losses:

- l, l, l → gallows
- l, l, w, l → alive (the win reset the streak)
- l, l, t, l → alive (a tie resets the streak too)
- l, l → alive, but one bad afternoon away

## the cut-down cost

paid in testnet eth (so, free in any real sense, grab it from the faucet). the formula scales with rarity tier and win record:

```
cost = base × tierMult × (10 + wins) / 100
```

where:

- **base** is the dev-set base cost. on testnet it's a micro amount, the live number for your outlaw shows before you click.
- **tierMult** by rarity: common 1×, uncommon 1.5×, rare 2.5×, legendary 4×, epic 7×, king 15×.
- **wins** is the outlaw's career wins. every win adds 10% of the tier cost. proven fighters cost more to save, which is how it should be.

there's also a dev-set **cap** on any single cut-down, so a many-win epic can't compound into something absurd.

## cutting down

open the hanged outlaw's page, or click their card at the gallows, hit **resurrect**. one wallet popup, testnet eth deducted, the dead flag flips off, and they walk again.

## what carries over

- **rating**: stays where it was. dying doesn't reset elo, but the three losses already dragged it down.
- **wins / losses / ties**: stay on the record. nothing is erased.
- **the loss streak**: resets to zero. next loss is a fresh first, not a fourth.
- **stats, weapon, name, art**: unchanged. a cut-down is not a re-roll.

it's the same outlaw, back from the rope, owing a favour to whoever paid.

## mainnet note

at mainnet, cut-down costs will be real money, usd-pegged by keeper bots, and the first 100 minted outlaws are planned to carry one free cut-down as a founder perk. none of that is live yet: see the **roadmap**.

## why this exists

permadeath-unless-rescued is the difference between "tap to fight" and "decide whether to fight". if losing cost nothing, the rating ladder would mean nothing. mortality makes the leaderboard real, and the gallows makes for a better story than a respawn button.

on testnet, though? die freely. that's what it's for.
