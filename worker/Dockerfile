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

# AR-7.1: this repo's chosen architecture is the apt-installed system
# `chromium` binary above, not Playwright's own downloaded browsers -- so we
# keep PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 and point every launch site at the
# system binary via src/lib/browser/launch-chromium.ts. CHROMIUM_EXECUTABLE_PATH
# is NOT a Playwright environment variable (Playwright never reads it); it is
# this repo's own variable, read explicitly by that helper. It was previously
# named PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, which looked like Playwright
# config but silently did nothing outside that one helper -- renamed so it no
# longer impersonates framework behavior it doesn't have.
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
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
