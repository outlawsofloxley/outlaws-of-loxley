FROM python:3.11-slim
WORKDIR /app

# Pin: openai>=1.55.0 (1.51.x crashes on import with httpx 0.28's removed
# `proxies` parameter). cryptg accelerates Telethon's encryption ~3x.
RUN pip install --no-cache-dir \
    telethon==1.36.0 \
    cryptg==0.4.0 \
    "openai>=1.55.0,<2.0"

COPY userbot.py login.py prompt.txt ./
RUN mkdir -p /app/data

CMD ["python", "-u", "userbot.py"]
