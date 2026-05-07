FROM node:20-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
RUN npm install --omit=dev --no-fund --no-audit \
 && chown -R node:node /app/node_modules
USER node
COPY --chown=node:node fight-cost-keeper.mjs ./
ENTRYPOINT ["node", "fight-cost-keeper.mjs"]
