# Brawlers

every brawler is one ERC-721 NFT on base. transferable, sellable, sendable. the on-chain data has everything you need: stats, weapon, rating, status, name. art is rendered procedurally from the token id, so even if every metadata server in the world went down tomorrow, the brawlers would still look right on chain.

## the stats

six values, rolled on mint, locked for life:

- **strength (str)**: damage bonus, minimum damage floor.
- **dexterity (dex)**: to-hit chance, armour class, who attacks first.
- **constitution (con)**: starting hp, armour class.
- **intelligence (int)**: reserved for future content (spellcasting maybe).
- **wisdom (wis)**: reserved (crits, taunts).
- **charisma (cha)**: reserved (matchmaking weight, social stuff).

int / wis / cha don't affect combat right now. safe to dump if you're farming for the perfect fighter. that may change as the game evolves.

stats roll from a uniform distribution. higher rarity weapons don't raise stats and high stats don't push your weapon rarity. they're independent rolls.

## the weapons

your weapon decides damage range and combat speed. weapon and rarity move together.

**common (1,240 brawlers)**
- knife, baseball bat, crowbar, fast, low-damage, reliable.

**uncommon (500)**
- machete, pistol, middle ground.

**rare (200)**
- shotgun, sledgehammer, heavy hitters with longer wind-up.

**legendary (40)**
- flaming sword, electric axe, high damage, dramatic animations, narrower hit windows.

**epic (20)**
- bazooka, rail gun, biggest swings in the drop. yes, more rare than legendary.

**king (1/1)**
- kingsblade, 50 to 100 damage, speed 10. don't think about it.

## elo rating

every brawler starts at **1,000**. rating moves after every duel using a standard elo formula. beat someone above you, climb fast. lose to someone below you, drop hard.

rating is the only thing the leaderboard cares about. wins and losses are tracked separately on each brawler's detail page but they don't directly compute the standing.

## status: alive, dead, listed

a brawler is in one of these states:

- **alive**: can fight, can be listed, can be transferred.
- **dead**: cannot fight until resurrected. can still be listed, transferred, browsed. the **graveyard** chapter has the full death rules.
- **listed**: actively listed on the marketplace. cannot be sent into a duel while listed (the duel contract refuses). cancel the listing if you want to fight.

## name

every brawler gets a procedurally generated first + last name on mint. they're real-people-shaped, not "warrior of the seventh dawn" type. some examples: knox tanaka, gwap watanabe, rocky vlahakis, buster costello.

names are derived from the token id and a name pool baked into the contract. same id, same name forever. you can't rename them, that would break art determinism.

## the art

32 wide × 24 tall, rendered procedurally from the token id and the brawler's traits. the renderer is deterministic: same input, same output, every time, on every device.

it's intentionally crayon-simple. if you wanted polished 3d, you'd be playing something else. brawlers look like they were drawn by a kid who has a lot of opinions and no patience.

## the king (recap)

one 1/1, token id 2001, dev-wallet only, sits above all rarity tiers. covered in detail in the **minting** chapter under "the king".
