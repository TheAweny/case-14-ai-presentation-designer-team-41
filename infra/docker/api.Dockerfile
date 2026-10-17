# NestJS API. PostgreSQL stores run metadata; generated artifacts and Mastra workflow state use
# the mounted runs directory.
FROM node:22.13-bookworm-slim AS builder

ENV YARN_ENABLE_GLOBAL_CACHE=0 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml nx.json tsconfig.base.json ./
COPY apps apps
COPY packages packages
COPY scripts scripts
# Agent prompts, recorded answers and the model catalogue are read at run time.
COPY registry registry
COPY configs configs

RUN yarn install --immutable

# The CLI too: `lct generate` on the host runs it here, where the engine is reachable.
RUN yarn nx run-many -t build -p api cli

FROM node:22.13-bookworm-slim AS runtime

ENV NODE_ENV=production \
    API_PORT=3001

WORKDIR /app

COPY --from=builder /app /app
COPY registry /app/registry
COPY configs /app/configs

RUN mkdir -p /app/runs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
