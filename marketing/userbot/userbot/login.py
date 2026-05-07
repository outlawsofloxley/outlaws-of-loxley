"""One-time interactive Telethon auth.

Run once via:
    docker compose run --rm userbot python login.py

After it succeeds the session is saved to /app/data/session.session and
the main userbot.py reuses it forever. The container is destroyed after
login (--rm) but the session file persists in the data volume.
"""
import asyncio
import os

from telethon import TelegramClient

API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]


async def main() -> None:
    client = TelegramClient("/app/data/session", API_ID, API_HASH)
    print("=== BASEic Brawlers userbot login ===")
    print("Telethon will prompt for your phone, then a code from the Telegram app")
    print("(NOT SMS — appears in your Telegram in the 'Telegram' service chat),")
    print("and optionally a 2FA password if you have one set.")
    print()
    await client.start()
    me = await client.get_me()
    print()
    print(f"Logged in as @{me.username} (id={me.id})")
    print("Session saved to /app/data/session.session")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
