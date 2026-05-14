# House fighters

day one of any pvp game has the same problem: nobody's online yet, so nobody can fight. boring. dead arena. people leave.

we solved that by minting **10 house brawlers** at deploy time. they're owned by the dev wallet (well, the dev treasury, see the **trust** chapter for the wallet split). they sit in the duel pool permanently and they're always available as opponents.

## what they are

regular brawlers. token ids in the founder range (1-100), randomly rolled rarity from the c/u pool (the dev rarity cap means they can't be rare or better), normal stats, normal weapons, normal art.

the difference: they carry an **on-chain `isHouseBrawler` flag**. that flag does two things:

1. **they get NO founder perks.** even though their token id falls in the 1-100 founder range, the contract specifically checks `isHouseBrawler` and skips the discount, the bonus brawl airdrop, the free first resurrect, and the founder badge. they pay full stake, get the standard 50 brawl on mint, and pay full eth for resurrection.
2. **the keeper bot auto-resurrects them.** if a house brawler dies, a keeper service (running off the dev wallet's eth) resurrects them within seconds. the pool never thins out from human attrition.

## why this matters

day-one minters open the site, queue up a duel, and **always have an opponent**. even at 3am sunday with zero other humans around. without house brawlers, the early arena would be a ghost town until critical mass.

it's a known pattern from other on-chain games. we're not pretending we invented it.

## why they're flagged

the founder discount, the brawl bonus airdrop, the free resurrection, those exist as a perk for early human players. if 10 brawlers from the dev wallet got those perks too, the dev would be effectively double-dipping (already paying $0 for them, also taking 25% off every fight, also getting the brawl airdrop on each).

the `isHouseBrawler` flag explicitly carves them out. on-chain, you can verify any house brawler against its token id and confirm the discount and airdrop logic skips them.

## how you can tell a house fighter

- **HOUSE** badge on their card on every page (browse, marketplace, duel matchmaking, individual detail page).
- their owner is the dev / keeper wallet (you can verify via basescan).
- they don't carry the gold or cyan founder badge even though their id is in the 1-100 range.

if a brawler shows founder badge AND `isHouseBrawler=true`, that's a contract bug, raise it in #help.

## can house fighters lose?

yes. all the time. they're not buffed. their stats are uniform-distributed like any other roll. some house brawlers will be terrible. that's fine, that's the point.

their rating moves like every other brawler's. if you beat one, your rating climbs. if you lose to one, you drop. they're not punching bags, they're not boss fights.

## why 10?

ten is a sweet spot. fewer than that and a single bad night could thin the pool. more than that and the founder range starts feeling crowded. we picked 10 after looking at how often duels actually happen on similar games and how long resurrections take.

it can change. if it does, the change will be obvious (different number of brawlers tagged HOUSE in browse).
