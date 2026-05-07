# KOL outreach, DM templates

7-day warm-up sequence. Don't cold-pitch. Engage authentically for 3-4 days
first, then drop the ask. NEVER pay for shills upfront, only after they post
and only with a brawler airdrop, never cash.

## Tier 1, Base ecosystem KOLs (day 0-3 warm-up)

Target: anyone with 5k+ X followers actively posting about Base, Aerodrome,
on-chain games, NFTs on Base.

**Day 0-3 actions (no DM yet):**
- Reply to their tweets with substance (not "GM")
- Quote-tweet 1-2 of their best posts with our angle
- Like + RT genuinely

**Day 4 DM (only after 3+ meaningful interactions):**

```
Hey [handle], been enjoying your posts on [specific topic, e.g. "the Aerodrome v2 fee tier shift"].

I'm building BASEic Brawlers, an on-chain pixel-art combat game launching on Base this week. Brawlers fight for $BRAWL, three losses kills them, resurrect with ETH. Real combat sim on-chain (110+ tests, full TS↔Solidity parity).

Not asking for a shill, just wondering if I could mint you a brawler so you can try the arena. If you like it, share it. If you hate it, no worries.

Want a wallet to send to?
```

If they reply yes → airdrop a brawler (founder slot if still available; that's the carrot).
If they reply no → "Totally fair, appreciate the time. Holler if you change your mind."

## Tier 2, Game / NFT KOLs (broader)

Same pattern, but adjust the hook:

```
[handle], saw your take on [their recent take on web3 games / NFT utility / whatever fits].

Building BASEic Brawlers, 2,000 brawlers + 1 King on Base, on-chain duels with permadeath. Mechanically the most game I've seen ship out of NFTs in a while (might be biased).

Open to send you a founder slot to try? No ask attached.
```

## Tier 3, Memecoin / degen accounts

Different angle, these accounts care about chart + early-in:

```
[handle], not a meme but might be your speed:

Just launched BASEic Brawlers on Base, 2,000 NFTs + utility token ($BRAWL), LP locked 90d on Unicrypt, 0% tax, anti-sniper hardened. First 100 mints are the cheapest tier ($20 for IDs 1-50, $25 for 51-100) + permanent founder perks (25% off fights, free first resurrect, gold/cyan badge). Tiers escalate to $50 by the final 500.

Probably under your radar but the early-in is right now. CA + chart in pinned at @BASEicBrawlers.
```

## Track outreach

Keep a spreadsheet (or use the included `bots/db.js` schema, table `kol_outreach`):

| handle | tier | day0-3 interactions | DM sent | reply | airdropped tokenId | posted | notes |
|--------|------|---------------------|---------|-------|--------------------|--------|-------|

Re-engage non-responders weekly with substance, never DM-spam.

## Hard nos

- ❌ Paying influencers cash for posts. Token-only, brawler-only.
- ❌ DMing without prior public engagement.
- ❌ Sending the same DM to 50 accounts. Each one is custom or skip them.
- ❌ Asking them to disclose paid shills (because we're not paying).
- ❌ Pretending to be a fan to slip in an ask.

## When a KOL posts

- Quote-tweet within 5 min with a thank-you that adds substance
- Pin their post in TG announce for 24h
- Add them to a "supporters" highlight reel for week-1 wrap thread
