# BENAVORA — Worker Architecture (Phase 3C)

## Version: 1.0
## Date: June 20, 2026
## Status: CANONICAL — Governs all AutoApply worker implementation. References AUTOAPPLY_ARCHITECTURE.md for schema and flow definitions.

---

## 1. Overview

The AutoApply Worker is a persistent Node.js process deployed on Railway that polls the `submission_queue` table in Supabase, processes items sequentially using Playwright + Claude AI, and writes results back. It runs independently of the Vercel-hosted Next.js application.

**Why not Vercel:** Vercel serverless functions have a 300-second hard ceiling and cannot maintain persistent browser sessions. AutoApply requires long-running Playwright instances with Chromium, stealth plugins, and sequential multi-minute form interactions.

---

## 2. Repository Structure

The worker lives inside the existing `benavora` repo — NOT a separate repository. This avoids duplicating shared code (StealthBrowser, agents, Supabase client, types).

```
benavora/
├── src/                          # Existing Next.js app
│   └── lib/
│       └── autoapply/
│           ├── stealth-browser.ts
│           ├── form-analyzer-agent.ts
│           └── form-filler-agent.ts
├── worker/                       # NEW — Railway worker
│   ├── Dockerfile
│   ├── index.ts                  # Entry point
│   ├── queue-processor.ts        # Poll loop + dequeue logic
│   ├── heartbeat.ts              # Health reporting
│   ├── rate-limiter.ts           # Randomized delay engine
│   └── tsconfig.json             # Worker-specific TS config
├── railway.json                  # Railway deployment config
└── package.json                  # Shared dependencies
```

### Why monorepo, not separate repo:
- `StealthBrowser`, `FormAnalyzerAgent`, `FormFillerAgent` already exist in `src/lib/autoapply/`
- Supabase client config, types, and constants are shared
- Single `package.json` avoids dependency drift
- Railway supports deploying from a subdirectory via `railway.json`

---

## 3. Worker Entry Point (`worker/index.ts`)

```
Boot sequence:
1. Validate environment variables (fail fast if missing)
2. Initialize Supabase client (service role — no RLS)
3. Register worker in worker_status table (heartbeat = now)
4. Start heartbeat interval (every 30 seconds)
5. Start queue processor loop
6. Handle SIGTERM/SIGINT for graceful shutdown
```

### Graceful Shutdown
On SIGTERM (Railway sends this on redeploy):
- Stop accepting new queue items
- Wait for current submission to complete (up to 5 min timeout)
- Close Playwright browser
- Update worker_status to `offline`
- Exit process

---

## 4. Queue Processor (`worker/queue-processor.ts`)

### Poll Loop
```
Loop:
1. SELECT from submission_queue WHERE status = 'pending'
   AND (scheduled_for IS NULL OR scheduled_for <= NOW())
   ORDER BY priority ASC, created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED
2. If no item: sleep 15 seconds, continue loop
3. UPDATE status = 'processing', started_at = NOW()
4. Process item (see Processing Pipeline below)
5. UPDATE status = 'completed' or 'failed', completed_at = NOW()
6. Apply rate limit delay (randomized 60-120 seconds)
7. Continue loop
```

### `FOR UPDATE SKIP LOCKED`
Critical for future multi-worker scaling. Prevents two workers from grabbing the same item. Single worker today, but the architecture must not preclude horizontal scaling.

### Processing Pipeline (per queue item)
```
1. Fetch funder record (giving_portal_url, name, category)
2. Check for existing form_template for this funder
   a. If exists AND last_verified_at > 7 days ago: re-analyze
   b. If exists AND recent: use cached template
   c. If not exists: run FormAnalyzerAgent first
3. Launch StealthBrowser
4. Run FormAnalyzerAgent (if needed) → store template
5. Run FormFillerAgent using template + KB data
6. Capture screenshots (pre-submit, post-submit, confirmation)
7. Upload screenshots to Supabase Storage (autoapply-screenshots bucket)
8. Create autoapply_submissions record with full audit trail
9. Link submission_id back to queue item
10. Close browser
```

---

## 5. Heartbeat System (`worker/heartbeat.ts`)

### New Table: `worker_status`

```sql
CREATE TABLE worker_status (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'online',
  last_heartbeat_at timestamptz NOT NULL DEFAULT NOW(),
  started_at timestamptz NOT NULL DEFAULT NOW(),
  current_item_id uuid REFERENCES submission_queue(id),
  items_processed integer NOT NULL DEFAULT 0,
  items_failed integer NOT NULL DEFAULT 0,
  version text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
```

- `worker_id`: hostname or UUID assigned at boot
- `status`: `online`, `processing`, `idle`, `offline`, `stale`
- Heartbeat fires every 30 seconds, updates `last_heartbeat_at`
- Dashboard marks worker as `stale` if `last_heartbeat_at` > 2 minutes ago

### Dashboard Integration
The existing `/autoapply` dashboard reads `worker_status` to display:
- Worker online/offline indicator
- Items processed / failed counts
- Current item being processed
- Time since last heartbeat

---

## 6. Rate Limiting (`worker/rate-limiter.ts`)

### Between Submissions
- Base delay: 60 seconds
- Random jitter: +0 to +60 seconds (total 60-120 seconds)
- Configurable per org via `platform_config` or org settings
- Purpose: avoid pattern detection by target sites

### Per-Domain Throttle
- Track last submission time per domain
- Minimum 24 hours between submissions to the same domain
- Prevents submitting to the same corporate portal twice in one run

### Backoff on Errors
- `site_error` or `timeout`: retry after 1 hour, then 4 hours, then 24 hours
- `captcha_blocked`: do not auto-retry (queue for Phase 3E CAPTCHA handling)
- `account_required`: do not auto-retry (queue for Phase 3E credential handling)
- `form_changed`: auto-retry once after re-analyzing form template

---

## 7. Railway Deployment

### `railway.json`
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "dockerfilePath": "worker/Dockerfile"
  },
  "deploy": {
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### `worker/Dockerfile`
```dockerfile
FROM node:20-slim

# Install Chromium dependencies
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

# Set Playwright to use system Chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

# Build worker TypeScript
RUN npx tsc -p worker/tsconfig.json

CMD ["node", "worker/dist/index.js"]
```

### Environment Variables (set in Railway dashboard)
```
SUPABASE_URL=https://vbjplpquqxxfbpazyalt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ANTHROPIC_API_KEY=<claude api key>
WORKER_ID=railway-worker-1
NODE_ENV=production
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
```

---

## 8. Database Migration (047)

```sql
-- Worker status table
CREATE TABLE IF NOT EXISTS worker_status (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'online',
  last_heartbeat_at timestamptz NOT NULL DEFAULT NOW(),
  started_at timestamptz NOT NULL DEFAULT NOW(),
  current_item_id uuid REFERENCES submission_queue(id),
  items_processed integer NOT NULL DEFAULT 0,
  items_failed integer NOT NULL DEFAULT 0,
  version text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Supabase Storage bucket for screenshots
-- (Create via Supabase dashboard: autoapply-screenshots, public = false)

-- Index for queue polling performance
CREATE INDEX IF NOT EXISTS idx_submission_queue_pending
  ON submission_queue (priority ASC, created_at ASC)
  WHERE status = 'pending';

-- Index for per-domain throttling
CREATE INDEX IF NOT EXISTS idx_autoapply_submissions_domain
  ON autoapply_submissions (funder_id, submitted_at DESC);
```

---

## 9. Batch Selection UI (Dashboard Changes)

### Funder List Enhancements
- Checkbox column on funders table (only funders with `giving_portal_url`)
- "Select All Visible" / "Select All Matching Filter" buttons
- "Queue Selected" button → creates `submission_queue` records for each selected funder
- Queue count badge next to "Queue Selected" button

### Queue Management Panel
- Table showing all queued items: funder name, status, priority, scheduled time
- Drag to reorder (updates priority)
- Remove from queue button per item
- "Clear Queue" button (removes all pending items)
- "Start Processing" button (changes worker mode from idle to active — future: for now, worker auto-processes)

### Real-time Updates
- Supabase Realtime subscription on `submission_queue` and `autoapply_submissions`
- Live status transitions: pending → processing → completed/failed
- Toast notifications on completion/failure
- Auto-refresh queue depth and processing rate

---

## 10. Monitoring & Observability

### Worker Logs
- Structured JSON logging (timestamp, level, message, metadata)
- Log every: queue poll, item pickup, analysis start/end, fill start/end, submission result, error
- Railway provides log aggregation out of the box

### Dashboard Metrics
- Queue depth (pending items count)
- Processing rate (items/hour over last 24h)
- Success rate (completed / total)
- Estimated completion time (queue depth / processing rate)
- Failure breakdown by error type (pie chart)

---

## 11. Build Sequence

This document is built via FORGE 1.x in the following prompt order:

1. Migration 047: `worker_status` table + indexes
2. `worker/tsconfig.json` + `worker/Dockerfile` + `railway.json`
3. `worker/index.ts` — entry point with boot sequence and graceful shutdown
4. `worker/heartbeat.ts` — heartbeat interval, worker registration
5. `worker/rate-limiter.ts` — delay engine with jitter and per-domain throttle
6. `worker/queue-processor.ts` — poll loop, processing pipeline, error handling
7. Dashboard: worker status indicator component
8. Dashboard: batch selection UI (checkboxes, queue button)
9. Dashboard: queue management panel with real-time updates
10. Supabase Storage: create `autoapply-screenshots` bucket
11. Integration test: end-to-end queue → process → submit flow
12. Railway deployment and environment variable configuration

---

## Document Authority

This document is CANONICAL for the AutoApply Worker architecture. It is subordinate to AUTOAPPLY_ARCHITECTURE.md for schema definitions and flow descriptions, but authoritative for all worker implementation details, Railway deployment, and queue processing logic.
