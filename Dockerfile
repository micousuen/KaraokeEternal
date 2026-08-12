FROM node:24-bookworm-slim AS build-deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Keep production dependencies in a source-independent stage. This replaces
# `npm prune` after Webpack, which previously reran for every source change.
FROM node:24-bookworm-slim AS production-deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM build-deps AS build

COPY assets ./assets
COPY config ./config
COPY server ./server
COPY shared ./shared
COPY src ./src
COPY tsconfig.json ./
COPY LICENSE ./
COPY CHANGELOG.md ./
COPY docs/assets/fonts ./docs/assets/fonts
RUN npm run build

FROM node:24-bookworm-slim

ARG PIXI_VERSION=0.75.0
COPY python/processing/pixi.toml python/processing/pixi.lock /opt/processing/

RUN apt-get update \
  && apt-get install --yes --no-install-recommends build-essential ca-certificates curl ffmpeg python3-dev \
  && arch="$(dpkg --print-architecture)" \
  && case "$arch" in \
       amd64) pixi_arch=x86_64 ;; \
       arm64) pixi_arch=aarch64 ;; \
       *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
     esac \
  && curl --fail --location --silent --show-error \
       "https://github.com/prefix-dev/pixi/releases/download/v${PIXI_VERSION}/pixi-${pixi_arch}-unknown-linux-musl.tar.gz" \
       | tar --extract --gzip --directory /usr/local/bin pixi \
  && PIXI_HOME=/opt/pixi pixi install --locked --manifest-path /opt/processing/pixi.toml \
  && apt-get purge --yes --auto-remove build-essential curl python3-dev \
  && pixi clean cache --yes \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/assets ./assets
COPY --from=build /app/build ./build
COPY --from=production-deps /app/node_modules ./node_modules
COPY package.json ./

ENV NODE_ENV=production \
  PATH=/opt/processing/.pixi/envs/default/bin:$PATH \
  KES_PATH_DATA=/config \
  KES_PATH_DOWNLOADS=/media/downloads \
  KES_PATH_TRANSCODE=/transcode \
  KES_PORT=8080

EXPOSE 8080
CMD ["node", "build/server/main.js"]
