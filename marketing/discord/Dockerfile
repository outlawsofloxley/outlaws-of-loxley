# BASEic Brawlers — Discord image.
# Used for both the one-shot setup container and the long-running bot
# container. Same code, different entry-point.
FROM node:20-alpine

WORKDIR /app

# Install deps first so layer caching helps subsequent builds.
COPY --chown=node:node package.json ./
RUN npm install --omit=dev --no-fund --no-audit \
 && chown -R node:node /app/node_modules

USER node

# Code + declarative config + content. art/ may be empty (just README.md
# placeholder) but the directory must exist for the COPY to succeed.
COPY --chown=node:node setup.mjs bot.mjs template.json ./
COPY --chown=node:node messages/ ./messages/
COPY --chown=node:node art/ ./art/

# Default entrypoint runs the one-shot setup. The bot service overrides
# this with `entrypoint: ["node", "bot.mjs"]` in compose.
# Anything passed after the image name on `docker compose run` (e.g.
# `--guild <id>` or `--dry-run`) is appended to setup.mjs's argv.
ENTRYPOINT ["node", "setup.mjs"]
CMD []
