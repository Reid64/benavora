# BENAVORA — Worker Architecture v2.0
## Supersedes: WORKER_ARCHITECTURE.md v1.0
## Date: July 17, 2026
## Status: CANONICAL — Governs all Railway worker implementation.
## Railway Service ID: bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127

---

## 1. Overview

The Benavora Railway worker is a persistent Node.js process that handles everything Vercel cannot: long-running jobs, browser automation, nightly agent pipelines, enrichment queues, and continuous monitoring. It runs 24/7 independently of the Next.js application.

**Why not Vercel for these jobs:**
- Vercel has a 300-second hard ceiling on function execution
- Vercel cannot maintain persistent browser sessions
- Vercel cannot run scheduled jobs (no cron)
- Vercel cannot process enrichment queues of 100K+ records
- Vercel cannot sustain Playwright + Chromium instances

**Railway handles:**
- AutoApply stealth browser automation (Playwright + Chromium)
- Nightly agent pipeline (2AM-7AM CST, 30 agents)
- Foundation enrichment (133K+ records)
- Corporate prospect enrichment (eventually 10M+ records)
- FEMA disaster declaration polling (every 6 hours)
- Knowledge Engine indexing (nightly)
- Reputation intelligence monitoring (nightly)
- Opportunity discovery (nightly)

---

## 2. Repository Structure

Worker lives inside the `benavora` monorepo — not a separate repo.

```
benavora/
├── src/                              # Next.js application
│   └── lib/
│       ├── autoapply/
│       │   ├── stealth-browser.ts
│       │   ├── form-analyzer-agent.ts
│       │   └── form-filler-agent.ts
│       ├── intelligence/             # All intelligence engines
│       │   ├── grant-probability-engine.ts
│       │   ├── digital-twin-builder.ts
│       │   ├── reputation-agent.ts
│       │   ├── knowledge-engine.ts
│       │   └── ...
│       ├── agents/                   # Agent implementations
│       │   ├── opportunity-discovery-agent.ts
│       │   ├── morning-digest.ts
│       │   └── disaster-response-agent.ts
│       └── sources/                  # Data source adapters
│           ├── grantsgov-client.ts
│           ├── samgov-client.ts
│           └── propublica-990-client.ts
├── worker/                           # Railway worker
│   ├── Dockerfile
│   ├── index.ts                      # Entry point + boot sequence
│   ├── scheduler.ts                  # Nightly pipeline scheduler
│   ├── queue-processor.ts            # AutoApply queue poll loop
│   ├── enrichment-processor.ts       # Foundation + corporate enrichment
│   ├── agent-runner.ts               # Nightly agent execution engine
│   ├── heartbeat.ts                  # Health reporting
│   ├── rate-limiter.ts               # Delay engine
│   └── tsconfig.json
├── scripts/                          # CLI enrichment and ingestion scripts
│   ├── enrich-foundations-990.ts
│   ├── enrich-propublica-batch.ts
│   ├── ingest-nih-reporter.ts
│   ├── ingest-nsf-awards.ts
│   ├── ingest-federal-register.ts
│   ├── ingest-samhsa-hrsa.ts
│   ├── batch-score-opportunities.ts
│   └── import-prospects.ts
├── railway.json
└── package.json
```

---

## 3. Entry Point (`worker/index.ts`)

```
Boot sequence:
1. Validate all required environment variables — fail fast if any missing
2. Initialize Supabase client (service role — bypasses RLS)
3. Register/update worker_status record (worker_id = hostname)
4. Start heartbeat interval (every 30 seconds)
5. Start AutoApply queue processor loop (continuous)
6. Start enrichment processor loop (continuous, lower priority)
7. Start scheduler (nightly pipeline trigger)
8. Start FEMA polling (every 6 hours)
9. Handle SIGTERM/SIGINT for graceful shutdown
```

### Graceful Shutdown
On SIGTERM (Railway sends before redeploy):
1. Stop accepting new queue items from all processors
2. Wait for current AutoApply submission to complete (5 min max)
3. Wait for current enrichment batch to checkpoint (saves progress)
4. Close all Playwright browsers
5. Update worker_status to `offline`
6. Exit with code 0

---

## 4. Scheduler (`worker/scheduler.ts`)

Controls the nightly agent pipeline. Uses node-cron for scheduling.

### Nightly Schedule (CST)

```
2:00 AM  — Autonomous Orchestrator: runs the full per-org agent pipeline below for
           every org with autonomous_mode_enabled (see Section 11)
2:00 AM  — runOpportunityDiscovery() for all active orgs
2:30 AM  — batchScoreOpportunities() for all active opps
3:00 AM  — runCorporateEnrichmentBatch() (500 records)
3:30 AM  — runPropensityScoringBatch() (newly enriched)
4:00 AM  — runReputationIntelligence() for all orgs
4:30 AM  — runRelationshipBuilder() for all orgs
5:00 AM  — pollFEMADeclarations()
5:30 AM  — runRelationshipMapper() (incremental graph)
6:00 AM  — runKnowledgeEngineIndexer() (embed new proposals)
6:30 AM  — runFundingForecast() (monthly only, skip if not first of month)
7:00 AM  — sendMorningDigest() for all active orgs
7:00 AM  — Autonomous Digest Agent: morning summary of auto-actions taken overnight
           and items awaiting review (see Section 11)
```

### Schedule Configuration
```typescript
import cron from 'node-cron';

cron.schedule('0 8 * * *',  () => runAutonomousOrchestrator(), { timezone: 'America/Chicago' });
cron.schedule('0 8 * * *',  () => runOpportunityDiscovery(), { timezone: 'America/Chicago' });
cron.schedule('30 8 * * *', () => batchScoreOpportunities(), { timezone: 'America/Chicago' });
cron.schedule('0 9 * * *',  () => runCorporateEnrichmentBatch(), { timezone: 'America/Chicago' });
cron.schedule('30 9 * * *', () => runPropensityScoringBatch(), { timezone: 'America/Chicago' });
cron.schedule('0 10 * * *', () => runReputationIntelligence(), { timezone: 'America/Chicago' });
cron.schedule('30 10 * * *',() => runRelationshipBuilder(), { timezone: 'America/Chicago' });
cron.schedule('0 11 * * *', () => pollFEMADeclarations(), { timezone: 'America/Chicago' });
cron.schedule('30 11 * * *',() => runRelationshipMapper(), { timezone: 'America/Chicago' });
cron.schedule('0 12 * * *', () => runKnowledgeEngineIndexer(), { timezone: 'America/Chicago' });
cron.schedule('0 13 * * *', () => sendMorningDigest(), { timezone: 'America/Chicago' });
cron.schedule('0 13 * * *', () => runAutonomousDigestAgent(), { timezone: 'America/Chicago' });
cron.schedule('0 11 * * 0', () => runWeeklyChangeMonitor(), { timezone: 'America/Chicago' });
cron.schedule('0 */6 * * *',() => pollFEMADeclarations(), { timezone: 'America/Chicago' });
```

---

## 5. AutoApply Queue Processor (`worker/queue-processor.ts`)

Unchanged from v1.0 architecture. Polls `submission_queue`, runs Playwright sessions.

### Poll Loop
```
Loop (continuous):
1. SELECT from submission_queue WHERE status='pending'
   AND (scheduled_for IS NULL OR scheduled_for <= NOW())
   ORDER BY priority ASC, created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED
2. If no item: sleep 15 seconds, continue
3. UPDATE status='processing', started_at=NOW()
4. Check requires_human_approval — if true, pause and notify
5. Run FormAnalyzerAgent (cached template if < 7 days old)
6. Run FormFillerAgent with humanType() character-by-character filling
7. Capture screenshots (pre/post/confirmation)
8. Upload to Supabase Storage (autoapply-screenshots bucket)
9. UPDATE status='completed' or 'failed'
10. Rate limit delay (randomized 60-120 seconds)
11. Continue loop
```

### Human Approval Gate
When `requires_human_approval=true`:
1. Set status = 'needs_review'
2. Create alert for org users
3. Pause — do not proceed
4. Resume only when PATCH /api/agents/automation/[sessionId]/approve received
5. Set status = 'processing', continue from step 5 above

---

## 6. Enrichment Processor (`worker/enrichment-processor.ts`)

Handles all background enrichment jobs. Runs at lower priority than AutoApply.

### Foundation Enrichment Queue
```
Poll Loop (runs when AutoApply queue is empty):
1. SELECT from foundation_directory WHERE enrichment_completed_at IS NULL
   AND ein IS NOT NULL
   LIMIT 500
2. For each foundation:
   a. Call ProPublica API: GET /nonprofits/api/v2/organizations/EIN.json
   b. Parse: totrevenue, totassetsend, ntee_code, fiscal_period
   c. Merge into enrichment jsonb (never overwrite existing fields)
   d. Set enrichment.propublica_enriched_at = now()
   e. Await 350ms (rate limit)
3. Checkpoint: update enrichment_completed_at for batch
4. Log progress every 50 records
5. Sleep 5 minutes, continue loop
```

### Corporate Enrichment Queue
```
Poll Loop (runs continuously at lower priority):
1. SELECT from corporate_prospects WHERE enrichment_completed_at IS NULL
   LIMIT 100
2. For each prospect:
   a. Run EA-01: Corporate Giving Detector (fetch website, detect giving program)
   b. Run EA-08: Executive Bio Analyzer (fetch leadership page)
   c. Run EA-09: Contact Extractor (fetch contact page)
   d. Merge all results into enrichment jsonb
   e. Queue for propensity scoring
   f. Await 3 seconds between companies
3. Checkpoint every 10 records
4. Sleep 60 seconds, continue loop
```

### Propensity Scoring Queue
```
Triggered: After corporate enrichment completes per prospect
1. Read full enrichment jsonb for prospect
2. Call AG-22: Propensity Scoring Agent
   - Compute PS-01 through PS-10 via Claude
   - Write all 10 scores to scores jsonb
3. Compute Giving DNA profile
4. Write giving_dna jsonb
5. Set scores_computed_at = now()
```

---

## 7. Agent Runner (`worker/agent-runner.ts`)

Executes nightly intelligence agents across all active organizations.

### Organization Scope
Active organizations = organizations where:
- `onboarding_completed = true`
- `stripe_subscription_status IN ('active', 'trialing')`
- `status != 'suspended'`

### Per-Agent Execution Pattern
```typescript
async function runAgentForAllOrgs(
  agentFn: (orgId: string, supabase: SupabaseClient) => Promise<void>,
  agentId: string
): Promise<void> {
  const orgs = await getActiveOrgs(supabase);
  
  for (const org of orgs) {
    // Check if agent is enabled for this org
    const config = await getAgentConfig(org.id, agentId);
    if (!config?.enabled) continue;
    
    // Log agent run start
    const runId = await startAgentRun(org.id, agentId);
    
    try {
      await agentFn(org.id, supabase);
      await completeAgentRun(runId, 'completed');
    } catch (err) {
      await completeAgentRun(runId, 'failed', err.message);
      // Continue to next org — never abort full pipeline on one org failure
    }
    
    // Delay between orgs to avoid hammering external APIs
    await sleep(1000);
  }
}
```

### Agent Run Logging
Every agent execution writes to `agent_runs` table:
- `agent_type` — ag-15, ag-17, ag-18, etc.
- `status` — pending/running/completed/failed
- `input_params` — org_id, run parameters
- `output_summary` — human-readable result
- `items_found` / `items_processed` — counts
- `tokens_used` — Anthropic token consumption
- `duration_ms` — execution time
- `started_at` / `completed_at`

---

## 8. FEMA Polling (`worker/fema-poller.ts`)

Runs every 6 hours. Checks for new disaster declarations.

```typescript
async function pollFEMADeclarations(): Promise<void> {
  // Get last checked timestamp
  const lastCheck = await getLastFEMACheck(supabase);
  
  // Fetch new declarations since last check
  const url = `https://www.fema.gov/api/open/v2/disasterDeclarationsSummaries?$orderby=declarationDate desc&$top=20&$format=json`;
  const response = await fetch(url);
  const data = await response.json();
  
  for (const decl of data.DisasterDeclarationsSummaries) {
    // Check if already in database
    const exists = await supabase
      .from('disaster_declarations')
      .select('id')
      .eq('fema_disaster_number', decl.disasterNumber)
      .single();
    
    if (exists.data) continue;
    
    // Insert new declaration
    await supabase.from('disaster_declarations').insert({
      fema_disaster_number: decl.disasterNumber,
      disaster_type: decl.declarationTitle,
      incident_type: decl.incidentType,
      affected_states: [decl.state],
      declaration_date: decl.declarationDate,
      incident_begin_date: decl.incidentBeginDate
    });
    
    // Find affected orgs and notify
    await notifyAffectedOrgs(decl, supabase);
  }
  
  await updateLastFEMACheck(supabase);
}
```

---

## 9. Heartbeat System (`worker/heartbeat.ts`)

### worker_status Table
```sql
CREATE TABLE IF NOT EXISTS worker_status (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'online',
  last_heartbeat_at timestamptz NOT NULL DEFAULT NOW(),
  started_at timestamptz NOT NULL DEFAULT NOW(),
  current_job text,
  current_item_id uuid,
  items_processed integer NOT NULL DEFAULT 0,
  items_failed integer NOT NULL DEFAULT 0,
  agents_run_today integer NOT NULL DEFAULT 0,
  enrichment_processed_today integer NOT NULL DEFAULT 0,
  version text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
```

### Heartbeat Payload (every 30 seconds)
```typescript
await supabase.from('worker_status').upsert({
  worker_id: process.env.WORKER_ID || os.hostname(),
  status: currentStatus,   // online/processing/idle
  last_heartbeat_at: new Date().toISOString(),
  current_job: currentJobName,
  items_processed: totalProcessed,
  items_failed: totalFailed,
  agents_run_today: agentsRunToday,
  enrichment_processed_today: enrichmentToday,
  version: process.env.npm_package_version
});
```

### Stale Detection
The `/admin/monitor` dashboard marks worker as `stale` if `last_heartbeat_at` > 2 minutes ago. Alert fires at > 5 minutes (worker likely crashed).

---

## 10. Rate Limiting (`worker/rate-limiter.ts`)

### AutoApply Rate Limits
- Between submissions: 60-120 seconds (randomized)
- Per-domain throttle: minimum 24 hours between same domain
- On site_error/timeout: retry after 1h → 4h → 24h
- On captcha_blocked: pause, notify user
- On form_changed: re-analyze template, retry once

### Enrichment Rate Limits
| Source | Delay | Daily Limit |
|---|---|---|
| ProPublica Nonprofit Explorer | 350ms between calls | ~10,000 |
| IRS 990 XML stream | 1s between files | Unlimited |
| Google Places API | 100ms between calls | 25,000/day (paid) |
| DuckDuckGo search | 2s between queries | ~5,000 |
| Foundation website scraper | 3s between sites | ~3,000 |
| Anthropic Claude (enrichment) | No forced delay | API rate limit |

### Agent Rate Limits
- Between orgs within same agent: 1 second
- Between agents in pipeline: no forced delay (sequential)
- External API calls within agents: per-source rate limits above

---

## 11. Autonomous Pipeline Architecture

Enables benavora agents to act without a human initiating each step: one agent's output can enqueue the next agent's input, culminating either in an autonomous action (e.g. an AI-generated draft application) or a `pending_review` item surfaced on the dashboard. Governed per-org by `org_autonomous_config` and per-agent by `agent_configurations`; every step is logged to `agent_decisions`.

### Autonomous Orchestrator (`worker/autonomous-orchestrator.ts`)

**Purpose:** Single entry point for the nightly autonomous pipeline. Replaces ad-hoc scheduling of individual agent functions with a per-org, config-driven execution loop.

**Per-org execution order** (an org is skipped entirely if `org_autonomous_config.autonomous_mode_enabled = false`):
1. Read `org_autonomous_config` and `agent_configurations` for the org — skip any agent not `enabled`
2. AG-17 Opportunity Discovery — discovers new opportunities, writes `discovery_matches`
3. AG-15 Grant Probability (batch) — scores discovered and existing open opportunities
4. AG-02 Eligibility Scoring — re-scores any opportunity missing a current `eligibility_score`
5. AG-05 Research / AG-06 Draft Generator — for opportunities scoring above the org's `confidence_threshold`, auto-creates an `applications` row (`auto_generated = true`) and a draft (`draft_source = 'ai_generated'`)
6. AG-04 Fit Analysis — writes `fit_analysis` onto the new application
7. Compliance Pre-Check — writes `compliance_check_result` onto the new application
8. Decision gate — if `confidence_score >= confidence_threshold` AND (`requested_amount <= require_review_above_amount` or no ceiling is set): leave `pending_review = false` and proceed toward the AutoApply queue. Otherwise set `pending_review = true` and create an alert.
9. Every step writes an `agent_decisions` row with `confidence_score` and `reasoning`, whether or not it acted autonomously

**Failure isolation:** identical pattern to `runAgentForAllOrgs` in Section 7 (Agent Runner) — one org's step failure is logged to `agent_runs`/`agent_decisions` with `error_message`, and the orchestrator moves to the next org. A failure inside one org's pipeline (e.g. step 5 throws) halts only that org's remaining steps for the night; it never aborts other orgs or the overall run.

**Timing:** triggered by the scheduler at 2:00 AM CST, the same slot as `runOpportunityDiscovery()`. Sequences steps 2-9 per org before moving to the next org, so wall-clock time scales with (orgs × steps) rather than the fixed flat cron slots used elsewhere. A max per-org budget (default 10 minutes) prevents one org's pipeline from consuming the whole nightly window — if exceeded, the org's remaining steps are handed off to `agent_queue` for pickup by the Agent Queue Processor instead of running inline.

### Agent Queue Processor (`worker/agent-queue-processor.ts`)

**Purpose:** Drains `agent_queue`, the table that lets one agent's completion enqueue the next agent's invocation (chaining) independent of fixed nightly cron slots. Used both by the Autonomous Orchestrator (to hand off overflow work) and by any agent that wants to trigger a follow-on agent outside its own scheduled slot.

- **Polling interval:** every 15 seconds — matches the AutoApply queue-processor cadence in Section 5; `agent_queue` is lower-volume than `submission_queue`
- **Priority ordering:** `ORDER BY priority ASC, created_at ASC` (1 = highest priority, 10 = lowest), the same convention as `submission_queue`
- **Claim pattern:** `SELECT ... WHERE status='pending' AND scheduled_for <= NOW() ... FOR UPDATE SKIP LOCKED`, identical locking strategy to the AutoApply processor, so multiple workers can safely drain the queue concurrently
- **Retry logic:** increments `attempts` on failure; retries while `attempts < max_attempts` (default 3) using the same backoff as Section 13's Failed Job Retry Logic (5 min → 30 min → `permanently_failed`)
- **Chain handling:** when an agent run completes and its output should trigger another agent, it writes `next_action` and increments `items_queued` on its own `agent_runs` row, then inserts one row per queued item into `agent_queue` with `chained_from_run_id` set to the parent `agent_runs.id` and `trigger_source = 'chain'`. The processor reads `agent_queue.agent_id`, invokes the matching handler from the Section 12 registry, and creates a new `agent_runs` row with `trigger_source = 'chain'` and `chained_from_run_id` pointing back to the parent run.

### Chain Diagram

```
AG-17 (Opportunity Discovery)
  -> writes discovery_matches, enqueues agent_queue row(s) for AG-15

AG-15 (Grant Probability)
  -> scores opportunity; if score >= org confidence_threshold,
     enqueues agent_queue row for AG-05

AG-05 (Research / Draft Generator)
  -> auto-generates application + draft
     (auto_generated=true, draft_source='ai_generated')
  -> if confidence_score < org_autonomous_config.confidence_threshold:
     sets pending_review=true

pending_review notification
  -> writes an alerts row + an agent_decisions row (requires_review=true)

dashboard
  -> surfaces the item on /draft-generator/autonomous review queue
     and the 24h activity feed
```

---

## 12. Job Handler Architecture

The worker exposes job handlers that can be triggered both by the scheduler AND by Vercel API routes (for on-demand execution).

### Handler Registry (`worker/handlers/`)

```
worker/handlers/
├── enrich-foundation.ts         # Enrich single foundation record
├── enrich-corporate.ts          # Enrich single corporate prospect
├── score-opportunity.ts         # Score single opportunity
├── run-discovery.ts             # Opportunity discovery for org
├── run-reputation.ts            # Reputation check for entity
├── run-relationship.ts          # Relationship recommendations for org
├── run-disaster.ts              # Disaster response for declaration
├── run-morning-digest.ts        # Morning digest for org
├── run-knowledge-index.ts       # Knowledge Engine indexing batch
├── run-board-packet.ts          # Board packet for meeting
└── run-simulation.ts            # Impact simulation for org
```

### Handler Interface
```typescript
interface JobHandler {
  name: string;
  execute(params: JobParams, supabase: SupabaseClient): Promise<JobResult>;
  timeout: number;  // ms before marking as failed
}

interface JobResult {
  success: boolean;
  itemsProcessed?: number;
  summary?: string;
  error?: string;
}
```

### On-Demand Trigger
Vercel API routes call worker handlers by inserting into an `agent_job_queue` table:
```sql
CREATE TABLE IF NOT EXISTS agent_job_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handler_name text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  org_id uuid,
  status text DEFAULT 'pending',
  priority integer DEFAULT 5,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb
);
```

Worker polls this table every 5 seconds and executes pending jobs immediately (higher priority than nightly scheduled jobs).

---

## 13. Error Handling and Recovery

### Never Abort the Pipeline
One org failing an agent never stops the pipeline. Every agent run catches errors per-org and continues.

### Failed Job Retry Logic
```
First failure:  retry after 5 minutes
Second failure: retry after 30 minutes
Third failure:  mark as permanently_failed, alert admin
```

### Enrichment Checkpointing
Enrichment batches checkpoint every 50 records. If the worker crashes mid-batch:
- Records with `enrichment_completed_at` set are skipped on restart
- Records without it are re-processed
- No data loss, some records may be enriched twice (idempotent writes)

### Circuit Breaker
If an external API returns errors on 5 consecutive calls:
- Stop calling that API
- Mark source as `circuit_open`
- Retry after 1 hour
- Alert admin if circuit stays open > 4 hours

---

## 14. Railway Deployment

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

RUN apt-get update && apt-get install -y \
  chromium fonts-liberation libasound2 libatk-bridge2.0-0 \
  libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 \
  libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 \
  libxdamage1 libxrandr2 xdg-utils \
  --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod

COPY . .
RUN pnpm exec tsc -p worker/tsconfig.json

CMD ["node", "worker/dist/index.js"]
```

### Environment Variables (Railway dashboard)
```
SUPABASE_URL=https://vbjplpquqxxfbpazyalt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ANTHROPIC_API_KEY=<claude api key>
WORKER_ID=railway-worker-1
NODE_ENV=production
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
GOOGLE_PLACES_API_KEY=AIzaSyA3sJ1vkNp1AvPLfKY_5uaiJK0FBiwjlt0
SAM_GOV_API_KEY=SAM-ca328c91-250e-4b51-a4cc-ab90ef5aab7a
```

### Deployment Monitoring
- Railway dashboard: `https://railway.app/project/1d79d4e6-f529-4903-9577-7085b3ab126b`
- Service ID: `bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127`
- Failed deploys visible in Deploy Logs tab
- Build errors: check Build Logs tab
- Runtime errors: check Deploy Logs tab (structured JSON output)

### tsc-alias Path Fix
Committed at `fbcc1d0`. Required for TypeScript path aliases (`@/lib/...`) to resolve correctly in the compiled worker output. Do not remove or modify this fix.

---

## 15. Monitoring Dashboard (`/admin/monitor`)

### Live Panels
- **Worker Status:** Online/Offline/Stale indicator with last heartbeat timestamp
- **Current Job:** What the worker is doing right now
- **Today's Stats:** Agents run, enrichment processed, AutoApply submissions
- **Queue Depth:** Pending AutoApply items + enrichment backlog
- **Agent Pipeline:** Last run time for each of the 16 nightly agents
- **Error Log:** Last 20 failed jobs with error messages
- **Rate Limit Status:** Circuit breaker state per external API

### Real-Time Updates
Supabase Realtime subscriptions on:
- `worker_status` — live status updates
- `submission_queue` — AutoApply queue depth changes
- `agent_runs` — agent completion events

---

## 16. Known Issues and Fixes Applied

| Issue | Fix | Commit |
|---|---|---|
| tsc-alias path resolution failing in compiled output | Added tsc-alias post-compilation step | fbcc1d0 |
| Worker crashes on Railway redeploy without graceful shutdown | Added SIGTERM handler with 5-minute drain | Applied |
| Chromium not found in Docker | Added PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var | Applied |
| Enrichment overwrites existing data on re-run | Changed to jsonb merge pattern (never overwrite) | Applied |
| Railway build fails with pnpm lockfile mismatch | Pin pnpm version in Dockerfile | Applied |

---

## 17. Build Sequence for New Agent Handlers

When adding a new agent to the nightly pipeline:

1. Create handler file at `worker/handlers/[agent-name].ts`
2. Implement `JobHandler` interface
3. Register in `worker/agent-runner.ts` handler registry
4. Add cron entry in `worker/scheduler.ts`
5. Insert agent definition into `agent_registry` table
6. Add agent to `AGENTS_v2.md`
7. Run `pnpm tsc -p worker/tsconfig.json` — verify zero errors
8. Commit and push — Railway auto-deploys worker on push to main
9. Verify in Railway deploy logs that new build succeeded
10. Test via on-demand trigger: insert record into `agent_job_queue`
