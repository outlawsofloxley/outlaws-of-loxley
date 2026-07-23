# Outlaws

every outlaw is one ERC-721 NFT on robinhood chain testnet. transferable, sellable, sendable. the on-chain data has everything: stats, weapon, rating, status, name. the art renders deterministically from the token id, so even if every server in the world went down tomorrow, your outlaw would still look like your outlaw.

## the stats

six values, rolled on mint, locked for life:

- **strength (str)**: damage bonus.
- **dexterity (dex)**: to-hit chance, armour class, who shoots first.
- **constitution (con)**: starting hp.
- **intelligence (int)**: reserved for future content.
- **wisdom (wis)**: reserved.
- **charisma (cha)**: reserved.

int / wis / cha don't affect combat right now. that may change as the game grows, but today str / dex / con are the fighting stats.

## the weapons

twelve weapons in the sherwood catalogue. your weapon decides damage range, speed, and type. weapon and rarity move together: rarer outlaws carry rarer steel.

| weapon | type | rarity | damage | speed |
|---|---|---|---|---|
| dagger | blade | common | 6-11 | 9 |
| quarterstaff | blunt | common | 8-13 | 6 |
| mace | blunt | common | 8-13 | 5 |
| sword | blade | uncommon | 10-15 | 6 |
| hunting bow | ranged | uncommon | 11-16 | 7 |
| crossbow | ranged | rare | 14-22 | 4 |
| flail | blunt | rare | 14-24 | 3 |
| flaming sword | blade | legendary | 15-22 | 6 |
| war axe | blade | legendary | 16-24 | 5 |
| longbow | ranged | epic | 22-35 | 2 |
| arbalest | ranged | epic | 25-40 | 6 |
| golden longbow | ranged | king only | robin's problem, not yours | |

drop weights run from dagger (most common) down to arbalest (1-in-100). the golden longbow never drops: it's welded to token id 2001.

## the type triangle ⚔️

every weapon is blade, blunt, or ranged, and there's an advantage triangle:

- **blade beats blunt**
- **blunt beats ranged**
- **ranged beats blade**

having the advantage multiplies your damage by **1.15×**. it won't save a terrible outlaw, but in a close fight it's the thumb on the scale. check your opponent's weapon before you commit.

## the rarity ladder

| rarity | count |
|---|---|
| common | 1,240 |
| uncommon | 500 |
| rare | 200 |
| legendary | 40 |
| epic | 20 |
| king | 1 |

epic sits above legendary in this drop: 20 epics, 40 legendaries. the rarity order everywhere in the ui runs common → uncommon → rare → legendary → epic → king.

## elo rating

every outlaw starts at **1,000**. rating moves after every duel using a standard elo formula. beat someone above you, climb fast. lose to someone below you, drop hard. rating is the only thing the leaderboard cares about. wins and losses show on each outlaw's page but they don't compute the standing.

## status: alive, at the gallows, listed

an outlaw is in one of these states:

- **alive**: can fight, can be listed, can be transferred.
- **at the gallows**: dead. cannot fight until someone pays to cut them down. can still be listed, transferred, browsed. the **gallows** chapter has the full rules. 💀
- **listed**: on the marketplace. cannot duel while listed (the contract refuses). cancel the listing if you want to fight.

## names

every outlaw gets an on-chain name rolled at mint: a medieval first name plus a byname. "Bandit of Blyth", "something Oakheart", "someone o'the Glen". 50 firsts times 50 bynames, 2,500 combinations. same token id, same name forever. no renaming: the name is part of the roll.

## the art

32 wide by 44 tall, rendered deterministically from the token id and traits. hooded archers with drawn bows and nocked arrows, cloaks, layered forest backgrounds that get fancier as rarity climbs. the king gets the full robin treatment: green hood, gold trim, golden longbow.

it's intentionally simple pixel art. if you wanted polished 3d you'd be somewhere else. these outlaws look like they were carved into a tavern table, which is the vibe.

## the king (recap)

one 1/1, token id 2001, robin of loxley himself. all stats 18, rating starts at 2,000, golden longbow. covered in the **minting** chapter.
