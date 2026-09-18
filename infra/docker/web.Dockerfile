# Next.js front end, built in standalone mode so the runtime image carries only what it needs.
FROM node:22.13-bookworm-slim AS builder

ENV YARN_ENABLE_GLOBAL_CACHE=0 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml nx.json tsconfig.base.json ./
COPY apps apps
COPY packages packages

RUN yarn install --immutable

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN yarn nx run web:build

FROM node:22.13-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
