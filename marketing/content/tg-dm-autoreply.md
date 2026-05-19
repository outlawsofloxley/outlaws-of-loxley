# TG DM auto-reply — promo/shill cold-DMs

Triggered only on the FIRST DM from a stranger (no prior convo with you) when
the message contains any of: `promo`, `promotion`, `shill`, `shilling`,
`advertise`, `marketing`, `pump`, `boost`, `package`, `placement`, `feature`.

Fires ONCE per sender, then mutes itself for that contact. If they reply with
substance you see it in your DMs and engage as normal. If they ghost, you've
wasted zero seconds.

## Reply text

```
appreciate the reach out mate. we're sorted for promo right now, but if you want to be considered drop your business case below:

- exact pricing
- what's included in the package
- 3 recent campaigns you've run with results (impressions / engagement / on-chain mint or buy data)

i'll pass it to the team and someone will get back if it fits. cheers
```

## Why this works

- Polite enough to not burn a real opportunity
- Asks for proof + numbers (90% of cold-DM shill services have neither, they ghost)
- "the team" framing softens the rejection if the answer is no
- One-shot per sender means we don't spam if they keep messaging
- No project link in the reply — we're being asked, not selling

## Edge cases to consider

- Real friends saying "hey i can shill you" → they're not a "first DM stranger", filter shouldn't fire
- Existing chat with a known KOL → same, shouldn't fire (filter is `first message AND keyword match`)
- People who DM "hey i love the project" with no keyword → no auto-reply (good — those want a real chat)
- People who keyword-match but are actually a journalist asking about your "promo strategy" → false positive, but the reply is mild enough to not blow the relationship

## When to TURN IT OFF

- During an actual PR push when you want to talk to people warmly
- When you're hiring a KOL agency and DMs are part of the funnel
- Sundays (joke, leave it on always)
