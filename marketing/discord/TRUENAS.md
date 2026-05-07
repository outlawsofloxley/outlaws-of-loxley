# Running on TrueNAS Scale as a visible "App"

You're already running the stack via `docker compose run` from the shell.
Two paths to also surface it in the TrueNAS Apps UI so you get start/stop
buttons and live log views without SSHing in:

- **Path A — Dockge** (recommended): a lightweight compose-stack manager
  installable from the TrueNAS apps catalog. It picks up our existing
  `docker-compose.yml` with zero changes and shows the stack with
  start/stop/restart buttons + live logs. ~5 min one-time setup, then
  every compose stack on the box is in one UI.
- **Path B — TrueNAS native Custom App**: paste a YAML, the stack shows
  in **Apps → Installed Apps** with native TrueNAS UI styling. Slightly
  fiddlier because Custom App doesn't read `.env` files and needs absolute
  paths.

You can run both — Dockge for general compose management, Custom App for
official-feel apps.

---

## Path A — Dockge (cleanest)

Dockge is by the same author as Uptime Kuma. It auto-discovers compose
stacks on disk and gives them a UI.

### One-time install

1. **TrueNAS Apps** → **Discover Apps** → search for **Dockge**.
2. Install it. The defaults are fine. Note these two settings:
   - **Stacks Directory**: a host path Dockge watches for compose stacks.
     The default is something like `/mnt/.ix-apps/app-data/dockge/stacks`,
     which is fine, but if you'd rather keep stacks alongside the rest of
     your data, set it to `/mnt/<pool>/<dataset>/dockge-stacks` and create
     that directory first.
   - **WebUI Port**: default 5001. Open in your browser via the TrueNAS
     IP / VPN once it's running.
3. Open the Dockge WebUI, set an admin password.

### Add the BASEic Brawlers stack

Two ways:

**Option 1 — symlink the existing dir into the stacks directory:**

```bash
ssh truenas
ln -s /mnt/<pool>/<dataset>/baseicbrawlers/marketing/discord \
       /mnt/.ix-apps/app-data/dockge/stacks/baseic-discord
```

Refresh Dockge's WebUI; the stack appears.

**Option 2 — copy / move the dir into the Dockge stacks directory:**

```bash
mv /mnt/<pool>/<dataset>/baseicbrawlers/marketing/discord \
   /mnt/.ix-apps/app-data/dockge/stacks/baseic-discord
```

Either way, Dockge sees the `docker-compose.yml`. Click the stack →
**Deploy** to start `discord-bot`. The one-shot `discord-setup` shows up
in the same UI; you can run it manually from the **Service** dropdown
(Run > one-shot).

`.env` lives next to the compose file as before — Dockge respects
`env_file` directives, so the bot picks up your `DISCORD_BOT_TOKEN` and
`DISCORD_GUILD_ID` automatically. **The token never leaves disk.**

### Day-to-day

- **Watch logs**: click stack → **Logs** tab. Live tail of both services.
- **Restart bot**: click stack → **Restart**.
- **Edit template**: edit `template.json` on disk, click stack → run the
  setup service. Idempotent.
- **Update bot code**: edit `bot.mjs`, click stack → **Build & Deploy**
  rebuilds the image and restarts.

---

## Path B — TrueNAS native Custom App

Shows up in **Apps → Installed Apps** with TrueNAS styling. A bit more
clicking up front because the Custom App YAML editor doesn't read
`.env` files and uses absolute paths.

### One-time prep on TrueNAS shell

```bash
# 1. SSH in and cd to wherever you put the kit.
ssh truenas
cd /mnt/<pool>/<dataset>/baseicbrawlers/marketing/discord

# 2. Build the image once; both services will reference it by tag.
docker compose build
docker images | grep baseicbrawlers/discord
# baseicbrawlers/discord   latest   <hash>   ...

# 3. Bake the absolute path into compose.truenas.yml.
sed -i "s|__BASE_PATH__|$(pwd)|g" compose.truenas.yml

# 4. Print the result so you can paste it.
cat compose.truenas.yml
```

### Add as a TrueNAS Custom App

1. **Apps** → **Discover Apps** → top-right **Custom App** button.
2. **Application Name**: `baseic-discord` (lowercase, hyphens; no spaces).
3. **Custom Config** tab → switch to YAML view → paste the printed
   `compose.truenas.yml`.
4. Add **Environment Variables** (the `Add` button under environment):
   - Name: `DISCORD_BOT_TOKEN` Value: *(your bot token)*
   - Name: `DISCORD_GUILD_ID` Value: *(your server id)*
5. **Install**. The app provisions; the bot service auto-starts.

The `discord-setup` service is `restart: "no"`, so it'll launch once,
finish, and show as **Stopped** in the app — that's expected. To re-run
it (e.g., after editing `template.json`):

- Apps → click `baseic-discord` → **Stop** → **Start**.

The bot service runs continuously; if it crashes Docker restarts it.

### Logs and status

- Apps → click `baseic-discord` → **Containers** tab → click a container
  → **Logs**.
- For tailing in real time, the TrueNAS shell is still faster:
  `docker logs -f baseic-discord-bot`

### Editing template / messages / art

The YAML bind-mounts `__BASE_PATH__/template.json`, `messages/`, and
`art/` into the container read-only. So:

```bash
ssh truenas
cd /mnt/<pool>/<dataset>/baseicbrawlers/marketing/discord
nano template.json   # edit
# Then in the TrueNAS UI: Apps → baseic-discord → Stop → Start
```

(Re-run picks up the edits because of the bind mounts; no rebuild
required for content-only changes.)

If you change `setup.mjs` or `bot.mjs` (code, not data), you need to
rebuild the image:

```bash
ssh truenas
cd /mnt/<pool>/<dataset>/baseicbrawlers/marketing/discord
docker compose build
# Then restart the app via TrueNAS UI.
```

---

## Which should you use?

- **Dockge** if you'll have multiple compose stacks (Telegram bots, future
  services). One UI, zero per-stack setup, lighter overall.
- **Custom App** if you want everything to live under TrueNAS's own
  Apps view, even at the cost of a slightly more involved first install.

Both leave `.env` on disk under your control; tokens never round-trip
through TrueNAS metadata or our chat.
