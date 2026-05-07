# Discord setup + community bot

Two-part Discord kit for BASEic Brawlers:

1. **`discord-setup`** — one-shot. Applies `template.json` to your guild,
   idempotently. Builds categories, channels, roles, permission overwrites,
   slow-modes, automod rules, pinned messages, seed posts, server icon /
   banner, welcome screen, onboarding, guild pointers (rules / system /
   public-updates channels). Re-runnable; existing pieces are reused, perms
   are reapplied.
2. **`discord-bot`** — long-running. Listens for the ⚔ verification
   reaction in `#verify` and grants the **Verified** role. DMs new joiners
   with how to verify. Restarts itself if it crashes.

Both ship as Docker services in the same compose stack.

## What `discord-setup` builds

- 6 categories: INFO (public), COMMUNITY / ARENA / MARKET / SUPPORT
  (verified-only), ADMIN (mod-only)
- 18 text channels with topics, slow-modes, post-permission overwrites
- 8 roles: Admin, Mod, Founder 50, Founder 100, King Holder, Holder,
  Verified, Bots — each with the right colour and hoist setting
- AutoMod rules: invite-link block, crypto-scam phrase block, mass-mention
  guard, suspicious-keyword alert (routed to #mod-chat)
- Pinned welcome message in #verify with the ⚔ verification reaction
  pre-seeded by the bot
- Pinned rules and links in #rules and #links
- Seed messages on #announcements, #general, #introductions, #strategy
  (only posted if the channel is currently empty — safe to re-run)
- Guild pointers: rules channel = #rules, system channel = #general,
  public updates channel = #announcements
- Server icon / banner / splash uploaded from `art/` if present
- Welcome Screen + Onboarding configured (requires Community feature —
  see post-setup notes)
- Permanent invite URL printed at the end

## Prerequisites

1. **A Discord bot.** https://discord.com/developers/applications →
   New Application → name it (e.g. "BB") → Bot tab → Reset Token → copy.
   Enable both privileged intents: **Server Members Intent** and **Message
   Content Intent**.
2. **An empty Discord server.** Discord disabled bot-driven server
   creation. In your Discord client (signed in as the account you want to
   own the server), click **+** in the server list → **Create My Own** →
   **For me and my friends** → name it.
3. **Invite the bot** to that server with admin perms via:
   ```
   https://discord.com/api/oauth2/authorize?client_id=<APP_ID>&permissions=8&scope=bot%20applications.commands
   ```
   (replace `<APP_ID>` with the app id from the Dev Portal).
4. **Copy the server ID.** User Settings → Advanced → enable Developer
   Mode → right-click the server icon → Copy Server ID.
5. **Docker host.** TrueNAS Scale 24.04+ (Dragonfish, native Docker), or
   any box with Docker + docker compose.

## Configure

```bash
cd marketing/discord
cp .env.example .env
nano .env
```

Set:

```
DISCORD_BOT_TOKEN=<freshly reset token, never paste this in chat>
DISCORD_GUILD_ID=<server id from step 4>
```

(Optional) drop server art into `art/`:

```bash
cp /path/to/icon.png  art/icon.png    # 1024×1024, ≤ 256KB
cp /path/to/banner.png art/banner.png  # 960×540, requires Boost level 2
```

See `art/README.md` for sizing.

## Run the one-shot setup

```bash
# from marketing/discord/
docker compose run --rm discord-setup --guild $DISCORD_GUILD_ID

# Or with the env var already set in .env:
docker compose run --rm discord-setup --guild "$(grep ^DISCORD_GUILD_ID .env | cut -d= -f2)"

# Dry run (changes nothing):
docker compose run --rm discord-setup --guild $DISCORD_GUILD_ID --dry-run
```

Idempotent. Re-running picks up template / message / art edits and
reapplies permissions and slow-modes to existing channels.

## Start the long-running bot

The verification reaction grant only works while this is up. Run it after
the setup container has finished its first pass.

```bash
docker compose up -d discord-bot
docker compose logs -f discord-bot     # watch it boot
```

What it does on first connect:
- Resolves `#verify` channel id, `Verified` role id, `#rules` channel id
  from the live guild.
- Starts listening for `messageReactionAdd` and `guildMemberAdd` events.
- Logs `+ verified <user>` every time someone reacts ⚔ in #verify.
- Logs `+ welcomed <user>` every time a new member joins (sends them a
  DM if their privacy settings allow).

To restart after editing the bot or template:

```bash
docker compose up -d --build discord-bot
```

To stop:

```bash
docker compose stop discord-bot
```

## Want it as a visible TrueNAS App?

The shell-driven flow above works fine, but if you'd rather see start/stop
buttons and live logs in the TrueNAS UI: see **[TRUENAS.md](./TRUENAS.md)**.
Two paths covered:

- **Dockge** (recommended) — install Dockge from the TrueNAS apps catalog,
  it auto-discovers our existing `docker-compose.yml` and gives it a UI.
  No file changes needed.
- **TrueNAS native Custom App** — the bot shows in `Apps → Installed Apps`
  with native styling. Uses `compose.truenas.yml` (one-time `sed` to bake
  in absolute paths).

## Editing the template

`template.json` is the source of truth. Channel topics, role colours,
slow-modes, automod rules, pinned-message paths, art file paths,
welcome-screen content, onboarding prompts — everything in one place.
Pinned and seed message bodies live as separate `messages/*.md` files
so you edit copy without touching JSON.

Bind-mounted into both containers, so an edit + re-run picks up changes
without a rebuild. Code (setup.mjs / bot.mjs) is baked into the image —
those need a rebuild:

```bash
docker compose build
```

## Post-setup notes

After your first run, several Discord features will print as "skipped"
because they require the **Community** feature on your server. Bots can't
flip Community on (it's a multi-step wizard with prerequisites). To
enable:

1. In the Discord client: **Server Settings** → **Enable Community**
   (left sidebar).
2. Step through the wizard. Discord wants:
   - 2FA on the server owner's account
   - Verification level Low or higher (already set)
   - Explicit content filter on (already set)
   - A rules channel and a moderator-updates channel (already set by
     this script)
3. Re-run `discord-setup`. Welcome Screen and Onboarding will apply this
   pass.

## Troubleshooting

- **401 Unauthorized**: token revoked or mistyped. Reset the token in the
  Developer Portal and paste the new one into `.env` *on TrueNAS only*.
  Never paste a fresh token into any chat / commit / share — Discord's
  scanner auto-revokes leaked tokens.
- **20001 "Bots cannot use this endpoint"**: you ran without `--guild`
  and the bot tried to create a server. Bots can't do that anymore.
  Create the server manually and re-run with `--guild <id>`.
- **AutoMod alert rule failed**: the alert action requires a channel id;
  the script resolves it from `alertChannel` in the rule config (defaults
  to `#mod-chat`). If `#mod-chat` doesn't exist yet, the rule is skipped
  with a warning.
- **Welcome Screen / Onboarding skipped**: enable Community (see above).
- **Banner / splash upload failed**: server isn't at the required Boost
  level. Icon will still apply.
- **Bot doesn't grant Verified on reaction**: check `docker compose logs
  discord-bot` for errors. Common causes: privileged intents not
  enabled in Dev Portal, bot's role is below the Verified role in the
  hierarchy (drag the bot's role above Verified in Server Settings →
  Roles).

## Layout

```
marketing/discord/
├── Dockerfile             # one image, two entrypoints
├── docker-compose.yml     # discord-setup (one-shot) + discord-bot (long)
├── compose.truenas.yml    # variant for TrueNAS native Custom App
├── package.json           # discord.js dep for the bot
├── .env.example           # token + guild id template
├── .dockerignore          # keeps secrets and node_modules out of image
├── README.md              # this file
├── TRUENAS.md             # making it a visible TrueNAS app
├── setup.mjs              # idempotent one-shot
├── bot.mjs                # long-running gateway listener
├── template.json          # full server structure
├── art/
│   └── README.md          # what to drop here (icon.png / banner.png)
└── messages/
    ├── rules.md           # pinned in #rules
    ├── welcome.md         # pinned in #verify, seeded with ⚔ reaction
    ├── links.md           # pinned in #links
    ├── seed-announcements.md
    ├── seed-general.md
    ├── seed-introductions.md
    └── seed-strategy.md
```
