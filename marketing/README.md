# BASEic Brawlers, Marketing Kit

Pre-launch + launch + week-1 content + Telegram bots. Everything you need to
go from "domain live" to "trading on Aerodrome with a real community" without
improvising.

## Layout

```
marketing/
├── content/
│   ├── telegram-pinned.md      Pinned messages for the public group + announce channel
│   ├── x-launch-thread.md      The 12-tweet launch thread for @BASEicBrawlers
│   ├── x-content-calendar.md   Day-by-day post schedule, week 1
│   ├── kol-outreach.md         DM templates for KOL / influencer outreach
│   ├── shill-pack.md           Copy snippets for community shillers + hashtags
│   └── art-prompts.md          gpt-image-1 / Pollinations prompts for art batches
├── bots/
│   ├── package.json            grammy + dotenv (JSON file persistence)
│   ├── .env.example            Bot tokens + group IDs
│   ├── db.js                   JSON file store (raid scores, leaderboard, KOL log)
│   ├── run-all.js              Boots all 3 bots in one process
│   ├── welcome-bot/            Greets new joiners + anti-CA-impersonation guard
│   ├── raid-bot/               Coordinates X raids on key tweets
│   └── leaderboard-bot/        Weekly top-shiller leaderboard
└── art/
    ├── samples/                One sprite per (archetype, rarity) combo (126 SVGs)
    ├── videos/                 Kling animations (king/spartan-epic/knight-epic/mafia-leg/mongol-rare)
    ├── render_svg.py           SVG → PNG renderer (24×32 pixel grids)
    ├── gen_samples.mjs         Generate sprite samples via local brawlerArt module
    ├── compose.py              Compose marketing graphics from real sprites
    ├── contact_sheet.py        Build contact sheet of all sample SVGs
    ├── zoom_check.py           Render zoom-in sheet of recently-fixed combos
    ├── gen.py                  Pollinations art gen (deprecated, use compose.py)
    ├── main-pfp.png            1024² King PFP for X + TG profile
    ├── x-banner.png            1500×500 5-card banner for X header
    ├── tg-cover.png            1024×576 5-brawler cover for TG group
    ├── rarity-showcase.png     1500×750 1-of-each-tier with labels
    ├── founder-{1,50,100}.png  1080² founder spotlight cards
    ├── death-scene.png         1080² R.I.P. graphic for "brawler died" posts
    └── contact_sheet.png       126-sprite mouth-position audit grid
```

## Order of operations (canonical)

### T-7 days (pre-launch)

1. **Set up channels**, public TG (`@baseicbrawlers`), announce TG channel
   (`@baseicbrawlers_announce` if not yet created), X account (`@BASEicBrawlers`).
2. **Pin messages**, paste the templates from `content/telegram-pinned.md`
   into both TG channels. Replace `[CONTRACT_ADDR]` and `[PAIR_ADDR]` placeholders
   on launch day.
3. **Stand up bots**, see `bots/README.md`. Welcome bot can run immediately;
   raid + leaderboard go live on launch day.
4. **Generate art**, use prompts from `content/art-prompts.md`. Output goes
   into `marketing/art/` (created when needed). Keep best 5-10 PFPs + 3 banner
   variants + 2 launch-day announce graphics.
5. **KOL outreach**, start the 7-day warm-up DM sequence in `content/kol-outreach.md`.

### T-24h (day before launch)

6. **Schedule X launch thread**, use `content/x-launch-thread.md`. Schedule
   the first tweet for T-0 minute (mainnet contract goes live + LP seeded);
   subsequent tweets fire 30 min apart auto.
7. **Pin "soon" tweet**, short teaser tweet pinned 24h prior with countdown.
8. **Brief moderators**, share `content/shill-pack.md` so community shillers
   have approved copy + hashtags + the do-not-say list.

### T-0 (launch day)

9. Mainnet deploy → mint King → seed LP → enable trading → liftLimits()
   (per the LaunchChecklist in the dash).
10. Post launch thread tweet 1 the moment trading opens.
11. Update both TG pinned messages with real `[CONTRACT_ADDR]` and `[PAIR_ADDR]`.
12. Switch raid bot ON; first raid target = the launch thread tweet.

### T+24h to T+7d (week one)

13. Daily X posts from `content/x-content-calendar.md`.
14. First leaderboard post Sunday (week-1 wrap).
15. Watch DexScreener / Discord for issues. Resist tweaking.

## Hard rules (carry over from NUMA)

- **Never DM users first.** Every official communication is via the pinned
  channels. Welcome bot enforces this, if anyone DMs claiming to be the dev,
  block + report.
- **Only one CA.** The bot's `/ca` command is the single source of truth.
- **No price-talk in main TG.** Push to a separate `@baseicbrawlers_chart`
  group if you want to allow it.
- **Founder badges (1-100) are the lifetime perk**, use this in every shill.
  Scarcity sells.
