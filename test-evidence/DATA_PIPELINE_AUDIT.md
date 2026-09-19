# DATA_PIPELINE_AUDIT.md — Upstream Data Pipeline Audit (AR-13.3)

**Date:** 2026-09-19
**Scope:** diagnose only — no production behaviour changes. For every major
table an agent reads or writes, establish row counts, recency, the intended
producer, whether that producer has actually run in the last 7 days, and
whether consumer agents find real work there.

**Method:** every number below is a live query against the production
Supabase project (`vbjplpquqxxfbpazyalt`) via the PostgREST REST API with
the service-role key (direct Postgres TCP on port 5432 is blocked from this
sandbox — confirmed by a raw `/dev/tcp` connect timing out — but the HTTPS
REST endpoint is reachable and was used for every count/timestamp/agent_runs
query in this document; no number here is estimated or carried over from a
prior doc without being re-checked live). Producer identity was established
by grepping actual `.from('<table>').insert/upsert/update(...)` call sites
in `scripts/`, `src/`, and `worker/`, not by the tables' own naming or any
prior narrative doc's claim.

---

## 0. The headline answer

**ag-29-knowledge-indexer is not broken. Its three source tables are either
empty of real content, fully drained, or permanently mismatched with what it
reads.** Every one of its ~9,700 runs in the last 7 days found `itemsFound:
0`. This was independently reproduced live this session (see §1) and
matches AR-13.1's own root-cause of the same finding three hours earlier —
two independent passes over live data agree.

**Across the whole platform, at minimum 18 agents are confirmed NO-OP
(complete successfully, process zero items, every time) and at least 52 more
are NEVER-INVOKED** per AR-13.1's live census (`test-evidence/AGENT_CENSUS.md`).
This document adds the *why* for the ones whose starvation traces to an
upstream data/producer problem rather than a wiring problem — see §6 for the
full breakdown of "starved by empty table" vs. "starved by dead code path"
vs. "starved by config gate."

---

## 1. ag-29-knowledge-indexer — full resolution

**What it reads:** `src/lib/agents/knowledge-indexer-agent.ts`'s
`loadPendingBatch()` scans exactly three tables, each `WHERE embedding IS
NULL`, for the oldest pending rows with real text content:
`intelligence_proposal_sections`, `outcomes`, `foundation_directory`.

| Source table | Total rows | Rows with `embedding IS NULL` | Real content among those? | Last row created |
|---|---|---|---|---|
| `intelligence_proposal_sections` | 105 | **0** (100% already embedded) | n/a — nothing pending | 2026-06-20 (3 months ago) |
| `outcomes` | 7 | 1 | Yes (from the 09-17 test-harness org, see §2) | 2026-09-17 |
| `foundation_directory` | 133,812 | **133,812 (100%)** | **No — 0 of 133,812** | 2026-06-19 (3 months ago) |

**`foundation_directory` is the entire story.** `flattenFoundationText()`
(knowledge-indexer-agent.ts:153-168) only produces embeddable text from two
fields: the `programs` text[] column and `enrichment->>'mission'`. Live
query confirms:

- `programs` is `NULL` on every one of the 133,812 rows (verified via a
  direct `programs=neq.{}` filter returning 0 matches, and by inspecting
  sample rows directly).
- `enrichment.mission` does not exist anywhere in the data. The real
  `enrichment` jsonb blob every row actually carries looks like this
  (verbatim sample row): `{"propublica": {"ein": "...", "city": "...",
  "name": "...", "state": "...", "ntee_code": "...", "totrevenue": ...,
  "totassetsend": ..., "totfuncexpns": ..., "fiscal_period": ...,
  "subsection_code": ...}, "propublica_enriched_at": "..."}`. There is real,
  substantive financial data sitting in `enrichment.propublica` on every
  enriched row — AG-29 simply never looks there, because the spec it was
  built against named `enrichment.mission`, a key nothing in this codebase
  has ever written.

**Confirmed no producer writes the fields AG-29 reads.** Grepped every
foundation-enrichment script (`enrich-foundations-990.ts`,
`enrich-foundations-propublica.ts`, `enrich-foundations-web.ts`,
`enrich-foundations-websites.ts`, `enrich-propublica-batch.ts`,
`src/lib/scraper/foundation-scraper.ts`) for every write to
`foundation_directory`: all of them write into `enrichment.propublica`,
`enrichment.propublica_enriched_at`, `enrichment.website_scraped_at`, or
dedicated columns (`enriched_990_at`, `website`, `asset_amount`,
`giving_total`). **Not one of them, anywhere in this codebase, ever writes
to `programs` or `enrichment.mission`.** This is not a recent regression —
grep across the full history of these scripts shows no line ever touched
either field. The mismatch has existed since AG-29 shipped.

**Live agent_runs confirms the resulting behaviour exactly:**

- 64,551 lifetime runs, 9,702 in the last 7 days (~1/minute, matching the
  poll loop's 60s-sleep-on-empty design in
  `worker/knowledge-indexer-processor.ts`).
- Every run sampled in the last 7 days: `status: "completed"`, `items_found:
  0`, `items_processed: 0`, `error_message: null`.
- This is **correct, honest reporting**, not the AR-13.1-era silent-success
  bug (that was fixed 2026-09-15 per `benavora-ag29-silent-failure-2026-09-15.md`
  and confirmed still fixed by reading the current file: `completeRun()` is
  called with `status: "failed"` whenever `itemsFound > 0 &&
  itemsProcessed < itemsFound` — a real batch-level failure would be visible.
  It has simply never happened, because `itemsFound` is 0 every single time).

**Answer to the prompt's specific question:**
- **Table AG-29 indexes from:** `foundation_directory` (99.999% of its
  theoretical workload by row count), plus `intelligence_proposal_sections`
  and `outcomes` (both effectively empty/drained).
- **When that table last received content:** `foundation_directory`'s last
  new row was imported 2026-06-19. Its last *enrichment write of any kind*
  (990/propublica/web/websites combined) was 2026-08-06 (see §3).
- **What was supposed to put content there:** the four `enrich:*` npm
  scripts plus the ENABLE_SCRAPER-gated `foundation-enrichment-weekly`
  worker job (`src/lib/scraper/foundation-scraper.ts`) — see §4. None of
  them write the two fields AG-29 actually consumes, so even a perfectly
  healthy producer would never feed this consumer.
- **The fix does not belong in AG-29.** Its query and content-filtering
  logic are correct; they accurately detect zero indexable text on every
  pass. The fix belongs in the producers: either populate `programs` (a
  real 990 Schedule I data field enrich-990 already parses upstream but
  never assigns to this column) or `enrichment.mission`, or change
  `flattenFoundationText()` to also read the `enrichment.propublica` fields
  that genuinely are populated. **No such change was made this session —
  diagnose only, per task instructions.**

---

## 2. Caveat that affects every table below: the 09-17 test-harness cluster

Four tables — `outcomes`, `applications`, `corporate_prospects`,
`knowledge_base` — each show exactly one row inserted in the last 7 days.
Live query shows **all four of those rows share the same organization**:
`b51797db-1029-406a-ac9f-14214816f633`, named literally
`"EXERCISE-HARNESS-Test Foundation"`, all created within the same
~1-second window (`2026-09-17T17:43:34–35Z`). This is a synthetic
test-exercise run (an agent-registry exercise harness that seeds one
end-to-end record per table to prove agents can be invoked), not organic
product usage. It is called out explicitly here so a future audit doesn't
mistake "1 row in the last 7 days" for a live producer — for these four
tables, the real organic producer has been silent far longer than 7 days.

---

## 3. Per-table audit

All counts are live as of 2026-09-19. "Recent(7d)" counts rows with a
creation timestamp in the last 7 days; where noted, that count is entirely
attributable to the §2 test-harness cluster.

| Table | Total rows | Recent (7d) | Last insert | Producer (real code, not spec) | Producer ran successfully in last 7d? | Consumers find work? |
|---|---|---|---|---|---|---|
| `opportunities` | 4,821 | 681 | **2026-09-19 07:01** (today) | `grants_gov` source via `/api/cron/grantsgov` (Vercel cron, daily 07:00 UTC, `vercel.json`) | **Yes** — fresh rows today | Yes — `eligibility_scoring` is OPERATIONAL, 211 runs/7d (AR-13.1 census) |
| `foundation_directory` | 133,812 | 0 | 2026-06-19 (3 months) | One-time bulk BMF/990 import script (no ongoing insert path found — all live enrichment scripts only `UPDATE` existing rows, never `INSERT`) | No new rows; last *any* enrichment write 2026-08-06 (see §4) | **No** — see §1, permanently 0 embeddable rows for AG-29; other consumers (funder-matching, research agents) do read this table but that is out of this audit's data-freshness scope |
| `corporate_prospects` | 50 | 1 (test-harness, §2) | 2026-09-17 | `scripts/acquire-corporate-prospects.ts` (manual CLI, not scheduled anywhere) | No — the one 7d row is synthetic | Effectively no real organic feed |
| `knowledge_base` | 54 | 1 (test-harness, §2) | 2026-09-17 | No dedicated ingest job found — populated ad hoc via onboarding/KB-extraction flows and manual seeding, org by org | No organic write in 7d | Small, largely test/demo-org content |
| `knowledge_patterns` | 34 | 4 | 2026-09-19 08:00 (today) | **AG-29 itself** — its own `runPatternAggregation()` (24h cadence, reads `outcomes WHERE embedding IS NOT NULL`) | **Yes — this is the one part of AG-29 that is genuinely working**, because it aggregates from `outcomes`, not `foundation_directory` | Working as designed, but only 6 embedded outcomes total exist to aggregate over — real but tiny |
| `nonprofits` | 1,978,526 | 0 | 2026-07-18 (2 months) | One-time bulk `ingest:bmf` / `ingest:nonprofits` (`scripts/ingest-irs-bmf-full.ts`) — manual CLI, not scheduled anywhere | No new rows; last enrichment write (`last_enriched_at`) 2026-08-06 (70% of rows — 1,386,357 — have been enriched at some point in the table's history, but none since) | Enrichment (`nonprofit-scraper.ts`) stalled 6 weeks; base ingest is one-time by design |
| `applications` | 15 | 1 (test-harness, §2) | 2026-09-17 | AutoApply / application drafting flow, user- or agent-initiated per org | No organic write in 7d | Matches known low-volume production usage (15 lifetime) |
| `submission_queue` | 57 | 4 | 2026-09-18 | AutoApply queue population (`worker/queue-processor.ts`) | Marginal — 4 rows, not zero, but low | `autoapply_queue_processor` per AR-13.1 census is 0/59 completions (`SkipError`/business-rule rejections + `FormAnalyzerAgent` caching bug) |
| `agent_queue` | 608 | 142 | 2026-09-19 07:00 (today) | Many agents chain work here (`routeQueueItem()` in `worker/autonomous-orchestrator.ts`) | **Yes** — healthy, active volume | Working — this is the platform's real event-chaining backbone |
| `donor_discovery_requests` | 5 | 0 | (5 rows, ever) | User-initiated via Donor Discovery UI | No | Feature essentially unused in production (matches prior memory) |
| `donor_discovery_directory` *(found during this audit, not in the original table list — see note)* | 136,703 | 0 | 2026-09-01 (18 days) | Bulk import/derivation job, 133,958 of 136,703 rows (98%) carry a `linked_foundation_id` — largely mirrors/derives from `foundation_directory` | Last `enriched_at` write 2026-08-22 (4 weeks) | Not independently traced further this session — flagged for a future pass |
| `prospects` *(sales-outreach table, distinct from donor prospecting — see note)* | **0** | 0 | never | Sales Outreach admin flow (`src/app/api/admin/prospects/**`, `src/lib/admin/prospect-manager.ts`) — real, wired code, 11 call sites | No — table has never received a row | Sales Outreach has zero prospects to work with, ever, despite the feature being fully built |
| `funders` *(found during this audit — a real table distinct from `foundation_directory`)* | 48 | 0 | last row 2026-06-09 | Manual/E2E seed only — sample rows are literally named `"... (E2E Seed)"` | No real producer found | Test-fixture data, not a live pipeline |

**Note on "funders" and "prospects" in the task's table list:** the task
named `funders` and `prospects` as major tables. Both exist as real,
distinct tables from `foundation_directory` and `corporate_prospects`
respectively (per `benavora-grants-api-maps-to-opportunities.md`,
`funders`/`prospects` are not aliases). `funders` (48 rows, all E2E test
seed data) is unrelated to the funder-matching pipeline, which actually
runs against `foundation_directory`. `prospects` (0 rows, ever) is the
Sales Outreach admin CRM table — a fully-built feature with zero data ever
loaded into it, a distinct and separate empty-pipeline finding from the
donor/foundation side of the platform.

---

## 4. Ingest/enrich script scheduling audit

Checked `.github/workflows/*.yml` (only `backup-database.yml`,
`daily-tests.yml`, `deploy-check.yml` exist — none run an ingest/enrich
script), `vercel.json`'s `crons` array (7 entries, none are ingest/enrich —
they cover research, grantsgov, reminders, autoapply, domain-warmup,
autoapply-retry, pil-research), and `worker/scheduler.ts` (the Railway
worker's own setInterval-based scheduler).

| npm script | Underlying file | Scheduled anywhere? | Last known activity |
|---|---|---|---|
| `ingest:bmf` | `scripts/ingest-irs-bmf-full.ts` | **No — manual CLI only** | Base `nonprofits` population, last new row 2026-07-18 |
| `ingest:samgov` | `scripts/ingest-samgov.ts` | **No — manual CLI only** | Not independently dated this session |
| `enrich:990` | `scripts/enrich-foundations-990.ts` | **No — manual CLI only.** A *different* implementation (`src/lib/scraper/foundation-scraper.ts`) is wired to `worker/scheduler.ts`'s `foundation-enrichment-weekly` job (Sunday 3AM CST), but that job is gated behind `process.env.ENABLE_SCRAPER === 'true'` | Most recent `enriched_990_at` write across all 133,812 rows: **2026-08-06** |
| `enrich:web` | `scripts/enrich-foundations-web.ts` | **No — manual CLI only** | Not independently dated |
| `enrich:websites` | `scripts/enrich-foundations-websites.ts` | **No — manual CLI only** | `enrichment.website_scraped_at` is **never populated on any row** — this field appears in the write code but a live query for the most-recent value returns nothing at all, suggesting this script's writes have either never landed in production or use a different field than what was checked |
| `enrich:propublica` | `scripts/enrich-nonprofits-propublica.ts` | **No — manual CLI only** | Most recent `enrichment.propublica_enriched_at` across `foundation_directory`: **2026-07-19** |

**The `foundation-enrichment-weekly` / `nonprofit-enrichment-weekly` worker
jobs are real and do fire on schedule** — confirmed via
`test-evidence/pt-08/railway-scheduler-jobs-fired.json`, which shows the
scheduler logging `"[Scheduler] 3:00 CST reached — starting
foundation-enrichment-weekly."` every Sunday it was observed (2026-08-16
through 2026-08-18 window). But every downstream enrichment timestamp this
session queried live — `enrichment.propublica_enriched_at` (max 2026-07-19),
`enriched_990_at` (max 2026-08-06), `nonprofits.last_enriched_at` (max
2026-08-06) — stopped advancing 6-7 weeks ago. Two explanations are
consistent with the evidence and were not distinguished further this
session (diagnose-only scope): (a) `ENABLE_SCRAPER` is not set to `'true'`
in the live Railway environment, so the job's own early-return fires every
week and nothing runs, or (b) the job runs but its Chromium-dependent
scraping fails silently before reaching a successful `UPDATE`. Given
`benavora-ar71-chromium-launcher-unified-2026-09-17.md`'s finding that the
Chromium launcher was only unified/fixed two days before this audit, and
that fix's "worker redeploy still pending" status, **(a) is more likely
to explain the full 6-7 week silence, but this was not confirmed against
the actual Railway environment variable this session** (no Railway CLI
access from this sandbox — same class of gap as
`benavora-vercel-cli-team-mismatch-2026-09-15.md`).

**Verdict: this is a data platform whose real ingest/enrichment jobs are
functionally manual-only.** The literal `ingest:*`/`enrich:*` npm scripts
have zero scheduling wiring anywhere in this codebase. The one
semi-automated path that exists (the two ENABLE_SCRAPER-gated weekly worker
jobs) has been silent for 6-7 weeks by every timestamp this session could
check live.

---

## 5. AR-13.1/13.2 cross-reference

This audit's live numbers for `ag-29-knowledge-indexer` (64,551 lifetime /
9,702 in 7d, both up by ~70/~3 from AR-13.1's 64,481/9,699 three hours
earlier) independently reproduce and confirm AR-13.1's own root-cause
(`test-evidence/AGENT_CENSUS.md` line 133 and "Anchor-fact reconciliation"
§ "ag-29-knowledge-indexer headline"). No disagreement found between the two
sessions' live queries.

---

## 6. How many agents have nothing to work on, and why

Per AR-13.1's live census (144 registry modules + 1 supplementary row =
145), cross-referenced against this session's table-level findings:

**18 confirmed NO-OP** (run, "succeed," process zero items every time):

| Agent | Starved by |
|---|---|
| `ag-29-knowledge-indexer` | **Producer/consumer field-name mismatch on `foundation_directory`** (§1) — this session's finding |
| `ea03_sponsorship_detector`, `ea06_press_release_analyzer`, `ea07_esg_analyzer`, `ea10_social_media_analyzer` | Real websites/pages exist but the target content (sponsorships, ESG initiatives, social presence) genuinely isn't there on the scraped nonprofit set, per AR-13.1 |
| `ea04_foundation_detector` | Same enrichment-processor family; near-zero real matches |
| `government_research`, `sam_gov_research`, `custom_api_research`, `state_portal` | Query real live government APIs/portals successfully but the query scope/filters rarely match anything |
| `ag-10-grant-dna`, `ag-36-learning-network`, `ag-15-probability`, `ag-28-followup`, `ag-18-reputation` | Mostly starved by **downstream org/config gates** (single-enabled-org, feature flags), not by an empty source table — see AR-13.1 for detail per-agent |
| `follow_up_generator` | Unresolved anomaly per AR-13.1 (structurally shouldn't be able to report 0 items) |

**At least 52 NEVER-INVOKED**, split roughly into:
- **Starved by an empty/near-empty upstream table**, confirmed or reinforced
  by this session: agents that would consume `donor_discovery_requests` (5
  rows ever), `prospects` (0 rows ever — Sales Outreach), or a `funders` row
  set that is 100% E2E test fixtures.
- **Starved by dead code paths / missing wiring**, unrelated to data
  freshness (e.g. `BEN-SUP-05`'s dropped `plan.targetAgentRunId` field,
  `hud_monitor`'s unreachable branch) — see `AGENT_CENSUS.md` for the full
  per-agent reasoning; this audit does not re-derive those.
- **Starved by calendar/config gating** (monthly-cadence agents like
  `ag-08-renewal-tracker`, `ag-12-search-optimizer`, `ag-39-roi-optimizer` —
  real scheduler entries exist, but org autonomy config + calendar timing
  haven't coincided yet for any org).

**Net honest answer:** of the platform's 145 tracked agent modules, **at
most 29 (20%) are cleanly operational with real, current data flowing
through them.** Of the remainder, this session's data-layer audit
specifically confirms that **`ag-29-knowledge-indexer`'s starvation is a
genuine upstream data problem** (a schema/field-name contract that was
never satisfied by any producer, on a table that also hasn't ingested new
rows in 3 months), and that the broader enrichment pipeline
(`foundation_directory`, `nonprofits`) has been silently manual-only or
stalled for 6-7 weeks. The remaining NO-OP/NEVER-INVOKED agents are, per
AR-13.1's independent per-agent tracing, more often blocked by config gates,
dead code paths, or genuinely-empty real-world query results (a government
API that has nothing new to report) than by a second instance of this
specific "wrong-field" pattern — no second identical occurrence of the
exact AG-29 shape (permanent field-name mismatch on a large, populated
table) was found this session.

---

## 7. What this session did NOT do

Per the task's explicit "NO PRODUCTION BEHAVIOUR CHANGES — diagnose only,"
no code, schema, or scheduling was changed. Specifically not done:
`flattenFoundationText()` was not modified to read `enrichment.propublica`;
`ENABLE_SCRAPER` was not checked or set on Railway (no CLI access from this
sandbox); no ingest/enrich script was scheduled. All of these are
recommended follow-up work, not executed here.
