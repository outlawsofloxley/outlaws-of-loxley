FROM node:20-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
RUN npm install --omit=dev --no-fund --no-audit \
 && chown -R node:node /app/node_modules
USER node
COPY --chown=node:node fight-cost-keeper.mjs ./
COPY --chown=node:node resurrection-cost-keeper.mjs ./
COPY --chown=node:node mint-cost-keeper.mjs ./
# No ENTRYPOINT — compose sets `command:` per service so one image runs
# three different keepers.
