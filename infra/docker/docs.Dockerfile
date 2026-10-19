FROM node:22.13-bookworm-slim AS builder

ENV YARN_ENABLE_GLOBAL_CACHE=0 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    NX_DAEMON=false

WORKDIR /app
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml nx.json tsconfig.base.json ./
COPY apps apps
COPY packages packages
COPY scripts scripts
COPY registry registry
COPY configs configs

RUN yarn install --immutable

ARG NEXT_PUBLIC_DOCS_URL=https://docs.lct.aweny.link
ARG NEXT_PUBLIC_APP_URL=https://lct.aweny.link
ENV NEXT_PUBLIC_DOCS_URL=$NEXT_PUBLIC_DOCS_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN yarn nx run docs:build

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03 AS runtime

COPY infra/docker/docs-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/docs/out /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=10 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ && \
      wget -q -O /dev/null http://127.0.0.1:8080/openapi.json

CMD ["nginx", "-g", "daemon off;"]
