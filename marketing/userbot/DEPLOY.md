# BASEic Brawlers TG userbot — deploy

Stack name: `baseic-tg`. Hosted on Darren's TrueNAS via Dockge. Follows
the runbook at `C:\Tools\Claude\runbooks\telethon-userbot-on-truenas.md`.

This file is the BB-specific delta — fill in the variables, follow the
runbook for the generic phases, and you're done.

## Project-specific values

| Variable | Value |
|---|---|
| `<project>` (in runbook) | `baseicbrawlers` |
| Stack name | `baseic-tg` |
| Stack dir on NAS | `/mnt/.ix-apps/app_mounts/dockge/stacks/baseic-tg/` |
| Locked-down NAS user | `claude-baseicbrawlers` |
| SSH key path on Windows | `C:\Users\darre\.ssh\baseicbrawlers_tg` |
| SSH host alias | `baseic-tg` |
| Public TG group username | `baseicbrawlers` (i.e. `https://t.me/baseicbrawlers`) |
| Discord stack already on this NAS | `baseic-discord` (sibling, do not touch) |

## Pre-deploy checklist

- [ ] DeepSeek key in `~/.claude/secrets/secrets.env` (`DEEPSEEK_API_KEY=`)
- [ ] Decided which TG account the bot impersonates (Darren's main, OR a burner — burners are safer per Telegram ToS)
- [ ] Telegram `api_id` + `api_hash` from `https://my.telegram.org` (one app per project, do NOT reuse smarties-tg's)
- [ ] `claude-baseicbrawlers` user created in TrueNAS web UI per runbook §1b
- [ ] SSH config alias `baseic-tg` working: `ssh -o BatchMode=yes baseic-tg whoami` prints `claude-baseicbrawlers`

## Local layout (matches on-NAS 1:1)

```
marketing/userbot/                ← stack root (maps to /mnt/.../baseic-tg/)
├── compose.yaml                  ← service definition
├── .env.example                  ← template (real .env lives ONLY on NAS, mode 600)
├── DEPLOY.md                     ← this file
└── userbot/                      ← build context (./userbot in compose.yaml)
    ├── Dockerfile
    ├── login.py
    ├── userbot.py
    └── prompt.txt
```

## Deploy steps (after the runbook's Phase 1 is done)

```bash
# from Windows, push the whole stack folder onto the NAS in one shot
# (compose.yaml lands at stack root, userbot/* lands in ./userbot/)
scp -r marketing/userbot/userbot/* \
    baseic-tg:/mnt/.ix-apps/app_mounts/dockge/stacks/baseic-tg/userbot/
scp marketing/userbot/compose.yaml \
    baseic-tg:/mnt/.ix-apps/app_mounts/dockge/stacks/baseic-tg/

# ssh in as the locked-down user, copy .env.example to .env, fill it
ssh baseic-tg
cd /mnt/.ix-apps/app_mounts/dockge/stacks/baseic-tg/
cat > .env  # paste from .env.example with values filled in, ^D
chmod 600 .env

# back to a root SSH session (Dockge needs root for docker)
ssh truenas-discord  # or whatever your root alias is
cd /mnt/.ix-apps/app_mounts/dockge/stacks/baseic-tg
docker compose build userbot
docker compose run --rm userbot python login.py
# follow Telethon prompts: phone (+61...), code (in TG service chat),
# optional 2FA password

# bring up long-running service
docker compose up -d userbot
docker logs baseic-tg-userbot 2>&1 | tail -10
# expect: {"level":"info","msg":"userbot_started",...,"listener_only":true,...}
```

## Test before flipping to active

1. Send a DM to the user the bot runs as → expect `incoming` log with `is_private=true`, no reply.
2. Mention the bot user in the BB public TG group → expect `incoming` log with `is_group=true`, `chat=baseicbrawlers`, `is_mention=true`. Still no reply (LISTENER_ONLY).
3. Watch logs for at least an hour. Verify there are no false positives (replies that shouldn't fire), no other-bot mentions, and the `text_preview` looks sane.

## Flip to active

```bash
ssh truenas-discord
cd /mnt/.ix-apps/app_mounts/dockge/stacks/baseic-tg
sed -i 's/USERBOT_LISTENER_ONLY=true/USERBOT_LISTENER_ONLY=false/' .env
docker compose restart userbot
```

The bot now auto-replies to mentions + replies in `baseicbrawlers` group, with 5-25s jitter and a 20/hour cap.

## Pull the brake

```bash
sed -i 's/USERBOT_LISTENER_ONLY=false/USERBOT_LISTENER_ONLY=true/' .env
docker compose restart userbot
```

## Tuning the prompt

`userbot/prompt.txt` is the system prompt — voice + project facts. Edit on Windows, push:

```bash
scp marketing/userbot/userbot/prompt.txt \
    baseic-tg:/mnt/.ix-apps/app_mounts/dockge/stacks/baseic-tg/userbot/
ssh truenas-discord docker compose -f /mnt/.ix-apps/app_mounts/dockge/stacks/baseic-tg/compose.yaml restart userbot
```

The container reads `/app/prompt.txt` at startup (line 53 of userbot.py: `SYSTEM_PROMPT = open("/app/prompt.txt", encoding="utf-8").read()`), so a restart is enough — no rebuild.

## Things that go wrong

See the runbook's "When something goes wrong" table at the bottom — covers `Permission denied (publickey)`, openai SDK version crashes, Telethon listening but never replying, hourly cap hits, account bans.

BB-specific: if Brawler-related questions get bad answers, edit `prompt.txt` PROJECT FACTS section — that's where the bot pulls game mechanics from. The contract specifics (founder discount %, supply caps, etc) are baked into the prompt at write-time, so when contract values change, this file needs the same update.
