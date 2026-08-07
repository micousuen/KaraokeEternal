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

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/assets ./assets
COPY --from=build /app/build ./build
COPY --from=production-deps /app/node_modules ./node_modules
COPY package.json ./

ENV NODE_ENV=production \
  KES_PATH_DATA=/config \
  KES_PATH_TRANSCODE=/transcode \
  KES_PORT=8080

EXPOSE 8080
CMD ["node", "build/server/main.js"]
