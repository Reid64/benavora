FROM node:20-slim

RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY scripts/ ./scripts/
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build:worker

# rootDir is repo root (..) so worker/index.ts compiles to worker/dist/worker/index.js
CMD ["node", "worker/dist/worker/index.js"]

# cache-bust 2026-07-09
