FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY assets ./assets
COPY config ./config
COPY server ./server
COPY shared ./shared
COPY src ./src
COPY tsconfig.json ./
COPY LICENSE ./
COPY CHANGELOG.md ./
COPY docs/assets/fonts ./docs/assets/fonts
RUN npm run build \
  && npm prune --omit=dev

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/assets ./assets
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./

ENV NODE_ENV=production \
  KES_PATH_DATA=/config \
  KES_PATH_TRANSCODE=/transcode \
  KES_PORT=8080

EXPOSE 8080
CMD ["node", "build/server/main.js"]
