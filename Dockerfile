# syntax=docker/dockerfile:1

FROM node:25-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:25-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
# Applies pending migrations, then starts the API (workers included unless RUN_WORKERS=false).
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]
