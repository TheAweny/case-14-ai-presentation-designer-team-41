# NestJS API. Mastra runs inside this process as a library; its state lives in a LibSQL file
# under runs/, so no database service is needed.
FROM node:22.13-bookworm-slim AS builder

ENV YARN_ENABLE_GLOBAL_CACHE=0 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml nx.json tsconfig.base.json ./
COPY apps apps
COPY packages packages

RUN yarn install --immutable

RUN yarn nx run api:build

FROM node:22.13-bookworm-slim AS runtime

ENV NODE_ENV=production \
    API_PORT=3001

WORKDIR /app

COPY --from=builder /app /app

RUN mkdir -p /app/runs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
