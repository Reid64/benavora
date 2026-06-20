# Session State

## Current Session — 2026-06-18

### Completed This Session
- **opportunity-documents-ui**: Added Documents section to opportunity detail page and Parse NOFA button.
  - `src/components/opportunities/OpportunityDetail.tsx` modified:
    - Added `Sparkles` import from lucide-react
    - Added `parseLoading` / `parseError` state
    - Added `handleParseNofa()` async handler (POST /api/agents/nofa-parser, refresh on success, inline error on failure)
    - Added Parse NOFA button in header (variant="secondary", isLoading, next to Edit/Delete)
    - Added inline error alert below header buttons when parseError is set
    - Added `getFilenameFromUrl()` helper (extracts filename from URL pathname)
    - Added NOFA Documents card in OverviewTab (full-width, below Keywords card): lists PDFs from opportunity_documents as teal links with FileText + ExternalLink icons; shows "No NOFA documents available" when empty

- **autoapply-dashboard-ui**: Built full AutoApply dashboard at `/autoapply` with Queue, Submissions, and Templates sections.
  - `src/app/(dashboard)/autoapply/page.tsx` replaced entirely
  - Queue: bulk checkboxes + "Analyze Forms" + "Run Selected" actions; fetches `submission_queue` joined with `funders`
  - Submissions: expandable rows with screenshot thumbnails; color-coded status badges; fetches `autoapply_submissions` joined with `funders`
  - Templates: field count from `field_mapping` JSON; per-row "Re-analyze" button; fetches `form_templates` joined with `funders`
  - "Add to Queue" modal: lists funders where `giving_portal_url` is not null, bulk insert into `submission_queue`

- **lead-scraper-nonprofits**: Created `src/scripts/scrape-nonprofit-leads.ts`.
  - Queries `foundation_directory` via Supabase admin client (service role, bypasses RLS): NTEE prefix filter (L/P/K/F/J/S/X), revenue $100K–$10M, limit 500
  - For each org: Google search → first non-aggregator URL → Playwright page visit → Claude Haiku contact extraction (email, phone, executiveDirector, grantStaff, website)
  - Updates `foundation_directory` rows with discovered website/email/phone (non-destructive: only fills null fields)
  - Exports enriched results to `exports/nonprofit-leads.csv` (ein, name, city, state, ntee_code, revenue_amount, website, email, phone, executive_director, grant_staff)
  - Progress logged every 50 records; results appended incrementally (crash-safe)
  - 3s delay between Google searches, 2s delay between page visits
  - Run overnight: `npx tsx src/scripts/scrape-nonprofit-leads.ts`

### Next Steps
- Execute `npx tsx src/scripts/scrape-nonprofit-leads.ts` overnight — expected 3-4 hours for 500 records
- Run `pnpm tsc --noEmit` then `pnpm run build` before running the scraper to verify clean compile

## Session Verification — 2026-06-19

### Verified This Session
- **lead-scraper-nonprofits**: `src/scripts/scrape-nonprofit-leads.ts` confirmed complete and correct.
  - All ICP filter requirements verified in code: NTEE prefixes L/P/K/F/J/S/X (line 76), revenue $100K–$10M (lines 77–78), limit 500 (line 79)
  - Google search query pattern matches spec: `{name} {city} {state} nonprofit` (line 147)
  - First non-aggregator result taken as website URL (lines 184–198, skips 18 known aggregator domains)
  - Page text sent to claude-haiku-4-5-20251001 for contact extraction (lines 224–277)
  - DB update is non-destructive — only fills null website/email/phone fields (lines 408–424)
  - CSV export to `exports/nonprofit-leads.csv` with all required columns (lines 301–311, 427–439)
  - Rate limiting: 3s between Google searches (line 366), 2s between page visits (line 393)
  - Progress logged every 50 records (lines 386–388, 445–447)
  - STATE_OF_THE_BUILD.md entry confirmed present (line 16)
- **Build gate**: `pnpm tsc --noEmit` and `pnpm run build` require user approval of pnpm commands in terminal — pending execution

## Session — 2026-06-19 (evening, Claude Code)

### Snapshot
- **Vercel:** live at benavora.vercel.app. Build green (143 routes). Latest code commit `eec485e` (landing footer); docs commits follow.
- **Marketing site:** root landing (full v15 conversion) + /privacy + /terms + /for-consultants all deployed and functional.
- **AutoApply proof of concept: PROVEN** — FormAnalyzer + FormFiller + StealthBrowser; live submission to Meade Tractor (status=submitted).

### Verified against PROD (Supabase Management API, 2026-06-19)
- `foundation_directory` = **133,812** rows ✓ (matches the reported IRS BMF import).
- AutoApply tables present = **4/4** (`form_templates`, `autoapply_submissions`, `submission_queue`, `foundation_directory`) → **migrations 045 + 046 applied** ✓.
- `form_templates` = 12 rows; the Meade template **`32b2ee99-616c-49e3-80f2-f0f670f27825` exists** ✓.
- `autoapply_submissions` = 1 row, **status=submitted** ✓ (the live Meade Tractor submission).

### Completed this session (code-verified by me)
- FormAnalyzer stabilization fix — 11/11 fields on 4 consecutive runs vs Meade Tractor.
- StealthBrowser utility (fingerprint randomization + human-behavior helpers); form-analyzer/filler use it; filler uses humanType/humanClick.
- Marketing site converted + deployed; logo nav; footer link labels.
- tsconfig excludes `run-*.ts` so scratch harnesses no longer break the build.

### Reported by user, NOT independently verified by me
- The 54,216 foundation-website and 298,365 nonprofit-lead CSV exports on the external drive (files are off-machine; I only verified the DB-side counts above).
- The exact "~43s" filler duration and the IRS-990 ZIP64 batch failures.

### Doc-duplication note
There are TWO tracked copies of each governance doc: **this repo-root pair** (the living log you watch) and **`governance/STATE_OF_THE_BUILD.md` + `governance/SESSION_STATE.md`** (a parallel set in a different format). Earlier today the governance/ pair was updated (commit `d46b036`) — which is why this root file's timestamp didn't change. RECOMMEND picking one canonical location and removing the other to stop the divergence.

## Session — 2026-06-20

### Completed This Session

#### Phase 3C Worker Infrastructure (code-complete, NOT yet deployed)
All worker source files are written and live in the repo. Nothing is deployed to Railway yet.

**Files built:**
- `worker/index.ts` — entry point: env validation, Supabase service-role client, worker_status registration, heartbeat start, queue processor loop, SIGTERM/SIGINT graceful shutdown
- `worker/queue-processor.ts` — poll loop with `SELECT FOR UPDATE SKIP LOCKED`; processing pipeline (fetch funder → check/reuse form_template → StealthBrowser → FormAnalyzerAgent → FormFillerAgent → screenshot upload to Supabase Storage → autoapply_submissions record creation → queue item status update); error classification and retry routing
- `worker/heartbeat.ts` — 30s interval updating `worker_status.last_heartbeat_at`; registers on boot; sets `status=offline` on shutdown
- `worker/rate-limiter.ts` — 60–120s randomized inter-submission delay; per-domain 24-hour throttle; exponential backoff for `site_error`/`timeout` retries
- `worker/Dockerfile` — `node:20-slim`, system Chromium, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
- `railway.json` — `dockerfilePath: worker/Dockerfile`, `restartPolicyType: ON_FAILURE`
- `supabase/migrations/047_worker_status.sql` — `worker_status` table + `idx_submission_queue_pending` + `idx_autoapply_submissions_domain`
- AutoApply dashboard: `WorkerStatus` component (online/stale/offline badge, heartbeat age, items counts), `QueuePanel` (real-time Supabase subscription, drag-to-reorder, remove/clear), `SubmissionHistory` (status color-coding, screenshot thumbnails, confirmation numbers)
- Funders page: checkbox column for funders with `giving_portal_url`, "Queue Selected (N)" batch button → `POST /api/autoapply/queue`

#### Grant Intelligence Library MVP (code-complete, no data ingested yet)
All tables, ingestion pipeline, RAG retrieval, and UI are written. No data has been inserted.

**Files built:**
- `supabase/migrations/048_grant_intelligence.sql` — enables `pgvector`; creates 11 intelligence tables including `intelligence_proposal_sections` with `vector(1536)` embedding column
- `src/lib/intelligence/embeddings.ts` — OpenAI `text-embedding-3-small` integration; `generateEmbedding()` and `batchGenerateEmbeddings()`
- `src/lib/intelligence/retrieval.ts` — `retrieveIntelligenceContext()`: embeds opportunity description, runs cosine similarity via `match_intelligence_sections` RPC, returns top-5 funded sections + rubric + logic model + need data + patterns + budget templates + evaluation frameworks
- `src/lib/intelligence/section-extractor.ts` — Claude `claude-sonnet-4-6` classifies raw proposal text into typed sections with quality scores
- `src/scripts/ingest-nih-proposals.ts` — fetches NIH Reporter funded applications, extracts sections, generates embeddings, inserts into intelligence tables
- `src/app/api/agents/draft-generator/route.ts` — enhanced to call `retrieveIntelligenceContext()` before building Claude prompt; injects funded examples, rubric, evidence data, pattern guidance
- `src/app/(dashboard)/intelligence-library/page.tsx` — stats cards, tabbed view (Proposals/Rubrics/Logic Models/Need Data), search/filter by category, manual ingestion modal (paste text or URL → `POST /api/intelligence/ingest`)

### Manual Steps Remaining (BLOCKING before features are live)

| Step | Reason |
|------|--------|
| Apply migration 047 (`047_worker_status.sql`) via Supabase dashboard SQL editor | `worker_status` table does not exist in prod yet |
| Apply migration 048 (`048_grant_intelligence.sql`) via Supabase dashboard SQL editor | All intelligence tables + pgvector extension not yet in prod |
| Add `OPENAI_API_KEY` to Vercel environment variables | Embeddings and RAG retrieval will 500 without it |
| Create Railway project and link to `benavora` repo | Worker has no deployment target yet |
| Set Railway env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `WORKER_ID`, `NODE_ENV=production`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` | Worker will fail to start without these |
| Deploy worker to Railway (push triggers auto-deploy once project linked) | Worker process is not running |
| Run `npx tsx src/scripts/ingest-nih-proposals.ts` from project root | Intelligence library has zero proposals; RAG retrieval returns empty context until populated |

### Next Build
Phase 3D (Full Autonomous Mode) or Night 2 of Grant Intelligence Library (reviewer rubrics + logic models) — depending on priority.
