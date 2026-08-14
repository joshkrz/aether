ARG NODE_VERSION=24.19.0
ARG DEBIAN_RELEASE=bookworm

FROM node:${NODE_VERSION}-${DEBIAN_RELEASE}-slim AS build

ENV HUSKY=0
WORKDIR /build

COPY package.json package-lock.json .npmrc ./
COPY apps/engine/package.json apps/engine/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json

RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.base.json ./
COPY apps/engine apps/engine
COPY apps/web apps/web
COPY packages/core packages/core

RUN npm run build --workspace @aether/engine \
    && npm run build --workspace @aether/web \
    && find apps/engine/dist packages/core/dist -type f ! -name '*.js' -delete

FROM node:${NODE_VERSION}-${DEBIAN_RELEASE}-slim AS production-dependencies

WORKDIR /runtime

COPY package.json package-lock.json .npmrc ./
COPY apps/engine/package.json apps/engine/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json

RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --omit=dev \
      --workspace @aether/core \
      --workspace @aether/engine

FROM debian:${DEBIAN_RELEASE}-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir --parents /app /config \
    && chown 99:100 /app /config

WORKDIR /app

ENV NODE_ENV=production \
    HOME=/config \
    AETHER_DATABASE_PATH=/config/aether.sqlite \
    AETHER_ENGINE_HOST=0.0.0.0 \
    AETHER_ENGINE_PORT=3001 \
    AETHER_WEB_ROOT=/app/apps/web/public

COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=production-dependencies --chown=99:100 /runtime/node_modules ./node_modules
COPY --from=build --chown=99:100 /build/apps/engine/dist ./apps/engine/dist
COPY --from=build --chown=99:100 /build/packages/core/package.json ./packages/core/package.json
COPY --from=build --chown=99:100 /build/packages/core/dist ./packages/core/dist
COPY --from=build --chown=99:100 /build/apps/web/.output/public ./apps/web/public

USER 99:100

EXPOSE 3001
VOLUME ["/config"]
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "const port = process.env.AETHER_ENGINE_PORT || '3001'; fetch('http://127.0.0.1:' + port + '/api/v1/installation/overview').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "apps/engine/dist/main.js"]
