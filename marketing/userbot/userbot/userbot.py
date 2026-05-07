"""BASEic Brawlers Telegram userbot.

Logs in as Darren's TG account (or a burner) via MTProto, listens to the
public group, optionally auto-replies via DeepSeek with project knowledge.

Defaults to LISTENER_ONLY mode (logs incoming, never replies) until the
USERBOT_LISTENER_ONLY=false flag is flipped in .env on the NAS host.

Safeguards baked in:
  - Listener-only by default
  - Skip own messages (paranoid double-check via me_id)
  - Skip other bots (no bot-to-bot loops)
  - Group whitelist (only specified groups via USERBOT_AUTO_REPLY_GROUPS)
  - DMs off by default
  - 5-25s jitter delay (looks human)
  - Typing action + simulated typing duration
  - Hourly reply cap (default 30 — Telegram spam-detection threshold)
  - All decisions logged as structured JSON
"""
from __future__ import annotations

import asyncio
import json
import os
import random
from datetime import datetime, timedelta, timezone

from openai import OpenAI
from telethon import TelegramClient, events

API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]

LISTENER_ONLY = os.environ.get("USERBOT_LISTENER_ONLY", "true").lower() == "true"
DELAY_MIN = int(os.environ.get("USERBOT_REPLY_DELAY_MIN_SECONDS", "5"))
DELAY_MAX = int(os.environ.get("USERBOT_REPLY_DELAY_MAX_SECONDS", "25"))
HOURLY_CAP = int(os.environ.get("USERBOT_HOURLY_REPLY_CAP", "30"))
AUTO_REPLY_DMS = os.environ.get("USERBOT_AUTO_REPLY_DMS", "false").lower() == "true"
AUTO_REPLY_GROUPS = {
    g.strip().lstrip("@").lower()
    for g in os.environ.get("USERBOT_AUTO_REPLY_GROUPS", "").split(",")
    if g.strip()
}

DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

client = TelegramClient("/app/data/session", API_ID, API_HASH)
llm = OpenAI(
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
)
SYSTEM_PROMPT = open("/app/prompt.txt", encoding="utf-8").read()

reply_history: list[datetime] = []
me_id: int | None = None


def log(level: str, msg: str, **kwargs) -> None:
    payload = {
        "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "level": level,
        "msg": msg,
        **kwargs,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def under_hourly_cap() -> bool:
    global reply_history
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    reply_history = [t for t in reply_history if t > cutoff]
    return len(reply_history) < HOURLY_CAP


async def ask_llm(text: str) -> str:
    response = await asyncio.to_thread(
        llm.chat.completions.create,
        model=DEEPSEEK_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        max_tokens=500,
        temperature=0.6,
    )
    content = response.choices[0].message.content or ""
    return content.strip()


@client.on(events.NewMessage(incoming=True))
async def on_message(event):
    if event.out:
        return  # never reply to our own messages

    sender = await event.get_sender()
    sender_id = getattr(sender, "id", None)
    sender_username = getattr(sender, "username", None)
    sender_is_bot = getattr(sender, "bot", False)

    chat = await event.get_chat()
    chat_username = getattr(chat, "username", None)
    chat_username_lower = chat_username.lower() if chat_username else None
    is_private = bool(event.is_private)
    is_group = bool(event.is_group or event.is_channel)

    text = event.message.text or ""

    log(
        "info", "incoming",
        sender=sender_username,
        sender_id=sender_id,
        sender_is_bot=sender_is_bot,
        chat=chat_username,
        chat_id=event.chat_id,
        is_private=is_private,
        is_group=is_group,
        text_preview=text[:120],
    )

    if LISTENER_ONLY:
        return

    if me_id is not None and sender_id == me_id:
        return  # paranoia: never reply to ourselves
    if sender_is_bot:
        return  # don't bot-loop with other bots

    should_reply = False
    if is_private and AUTO_REPLY_DMS:
        should_reply = True
    elif is_group and chat_username_lower and chat_username_lower in AUTO_REPLY_GROUPS:
        is_mention = bool(event.message.mentioned)
        is_reply_to_me = False
        if event.is_reply:
            replied = await event.get_reply_message()
            if replied is not None and me_id is not None and replied.sender_id == me_id:
                is_reply_to_me = True
        if is_mention or is_reply_to_me:
            should_reply = True

    if not should_reply:
        return

    if not under_hourly_cap():
        log("warn", "hourly_cap_skip", sender=sender_username)
        return

    delay = random.uniform(DELAY_MIN, DELAY_MAX)
    log("info", "replying_after_delay", sender=sender_username, delay_seconds=round(delay, 2))
    await asyncio.sleep(delay)

    try:
        reply_text = await ask_llm(text)
        async with client.action(event.chat_id, "typing"):
            type_seconds = min(len(reply_text) / 30, 8.0)
            await asyncio.sleep(type_seconds)
        await event.reply(reply_text)
        reply_history.append(datetime.now(timezone.utc))
        log("info", "replied", sender=sender_username, length=len(reply_text))
    except Exception as exc:
        log("error", "reply_failed", sender=sender_username, error=str(exc))


async def main() -> None:
    global me_id
    await client.start()
    me = await client.get_me()
    me_id = me.id
    log(
        "info", "userbot_started",
        username=me.username,
        id=me.id,
        listener_only=LISTENER_ONLY,
        auto_reply_groups=sorted(AUTO_REPLY_GROUPS),
        auto_reply_dms=AUTO_REPLY_DMS,
        hourly_cap=HOURLY_CAP,
        jitter_seconds=[DELAY_MIN, DELAY_MAX],
        provider="deepseek",
        model=DEEPSEEK_MODEL,
    )
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
