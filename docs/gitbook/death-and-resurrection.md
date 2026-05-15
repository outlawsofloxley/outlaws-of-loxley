# Death and resurrection 💀 🪦

three losses in a row, your brawler dies. not a euphemism, not a debuff. dead. can't fight, can't earn brawl. shows up in the [/graveyard](https://baseicbrawlers.com/graveyard) until you pay to bring them back.

if you don't want to pay, you don't have to. the brawler stays dead forever. you can sell, transfer, or just leave them in your wallet as a tombstone.

## when does the death happen

after the third consecutive loss is confirmed on-chain, the duel contract flips your brawler's `isDead` flag to true and emits a `BrawlerDied` event. the discord bot sees the event and posts a death notice in **#graveyard** within seconds.

a tie does not break a loss streak. it also doesn't count as a loss. so:

- l, l, l → dead
- l, l, t, l → dead (3 losses with a tie in the middle)
- l, l, w, l → not dead (the win reset the streak)
- l, l, t → not dead (no third loss yet)

## the resurrection cost formula

paid in eth. scales by rarity tier and how many wins your brawler has racked up:

```
cost = base × tierMult / 10 × (10 + wins) / 10
```

where:
- **base** is the dev-set base cost in eth, calibrated to $100 USD. a keeper bot watches chainlink eth/usd and repegs the base every 5 minutes via `setResurrectionCost`, so $100 stays $100 regardless of eth price.
- **tierMult** is:
  - common: 1×
  - uncommon: 1.5×
  - rare: 2.5×
  - legendary: 4×
  - epic: 7×
  - king: 15×
- **wins** is your brawler's total recorded wins.

a few worked examples (the duel page shows the live number for your specific brawler before you click):

- a fresh common at 0 wins: ~$100
- an uncommon with 3 wins: ~$200
- a legendary with 5 wins: **$500** (cap)
- an epic with 10 wins: **$500** (cap)
- a king at any wins: **$500** (cap)

**hard cap: $500 per revive.** every cost the formula above produces is clamped at $500 (=`Graveyard.resurrectionCap`). the resurrect-cost-keeper bot mirrors this cap to USD as eth/usd drifts, so it stays at $500 regardless of ETH price. the dev can adjust the cap from the dashboard. so even a maxed-out king with twenty wins still costs $500, not the formula's three-grand worst case. it keeps the late game survivable.

founders (slots 1-100) get **the first resurrection free.** doesn't matter when it happens, doesn't expire. the second one onward costs full price (capped).

## resurrecting

go to your brawler's detail page (or the graveyard, click their card), hit **resurrect**. one wallet popup, eth deducted, the `isDead` flag flips back to false, the brawler is alive again.

resurrection eth goes to the dev treasury. it doesn't go back into the LP, it doesn't get burned, it doesn't get auto-converted. it sits as eth.

## what carries over after resurrection

- **rating**: stays exactly where it was. dying doesn't reset the elo, but the three losses already dragged it down.
- **wins / losses / ties**: stay on record. losses are not erased.
- **the loss streak counter**: this resets to zero. so the next loss is a fresh start, not the fourth.
- **stats, weapon, level**: unchanged. resurrection is not a re-roll.
- **founder perks**: still active. founders only get one free resurrect though, used or unused on the first death.

## what doesn't carry over

nothing else, really. it's the same brawler, just walked back from the dead with a debt to whoever paid.

## why this exists

the death rule is the difference between "tap to fight" and "decide whether to fight". if you could lose forever and just keep trying, brawl would be worth nothing and rating would be meaningless. mortality makes the rating ladder real.

it also forces a question every player has to answer at some point: **is my brawler good enough to keep gambling on, or am i throwing eth into a hole?**

if the answer's the second one, the kindest thing you can do is let them rest. or sell them as a graveyard brawler to someone who wants the project.
