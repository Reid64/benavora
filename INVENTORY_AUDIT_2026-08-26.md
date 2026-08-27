# Comprehensive Inventory Audit — 2026-08-26

**Method:** Parallel direct code inspection (Glob/Grep/Read, `git log`, a live `vitest run`, migration-file cross-referencing). No live production database access was available in this environment — the connected Supabase MCP session is bound to unrelated projects (`tarritrix`, `tarritrix-audit`, `hail-intel-resurrected`), not `benavora` (linked ref `vbjplpquqxxfbpazyalt`). Every claim below is either sourced from current repo state or explicitly flagged as inferred/unknown. Prior audit docs in this repo (`MIGRATION_AUDIT.md`, `RLS_POLICY_AUDIT.md`, `ANON_GRANT_AUDIT.md`, `AUDIT_2026-08-26_WGR_VERIFICATION.md`) are 2-4 weeks stale relative to today's migration count (166 root / 57 `src/`) and are cited only as historical signal, never as current fact.

**Headline finding:** this codebase is materially more mature than a typical "underbuilt systems" audit expects. TODO/FIXME/stub markers are effectively absent (2 false-positive hits in ~290 API routes + all of `src/`). The real failure mode in this repo is not "stub code" — it's **wiring gaps** (real, tested code that nothing calls automatically) and **doc/reality drift** (commit messages and spec docs claiming more completeness than the code delivers). Both are catalogued below with file:line evidence.

---

## 1. SUMMARY TABLE

| System | Built | Integrated | Complete | Tested | Deployed |
|---|---|---|---|---|---|
| API layer (~290 routes) | ✅ | ✅ (except `/api/grants`) | ✅ | Partial (smoke + integration) | ✅ Vercel |
| `opportunities`/Grant Discovery UI | ✅ | ⚠️ bypasses its own API | ⚠️ hardcoded 1000-row cap, no pagination | ⚠️ | ✅ |
| Draft Composition | ✅ | ✅ | ✅ | ✅ | ✅ |
| AutoApply Automation | ✅ | ✅ (API + Railway worker) | ✅ | ✅ (unit+integration, 1 flaky live test) | ✅ Vercel+Railway |
| Prospect Intelligence (PIL) agents | ✅ 38/48 codes | ✅ (AgentRunner→API→UI) | ⚠️ 10/48 registered codes unimplemented | ✅ 6 dedicated test files | ✅ |
| Email/Outreach (3 engines) | ✅ | ⚠️ 6 of 11 cron routes unregistered | ⚠️ fragmented, one engine skips suppression | Partial | ⚠️ code deployed, jobs don't fire |
| Reporting/Analytics | ✅ | ✅ | ✅ | Partial | ✅ |
| Admin Panel | ✅ | ✅ | ✅ | Partial | ✅ |
| Onboarding | ✅ | ✅ | ✅ | Partial | ✅ |
| Two migrations directories | ✅ both exist | ⚠️ diverged, 14 table-name collisions | ⚠️ unreconciled | n/a | ⚠️ live-apply status inferred, not confirmed |
| `pil_*` schema (32 tables) | ✅ | ✅ 27/32 queried | ⚠️ 5 orphaned (2 intentionally) | Partial | ✅ |
| RLS/anon-exposure | ✅ mostly hardened post-118/120/113 | — | ⚠️ **root `055` creates `sales_campaigns`/`sales_campaign_steps`/`sales_sends`/`suppression_list`/`prospects`/`prospect_lists`/`sending_domains` with zero RLS; fix exists in `src/`-track 118+122 but live-apply status unconfirmed**; ~17 more tables historically flagged, unverified live | ✅ `rls.test.ts`, `storage-rls.test.ts` | ✅ |
| Background jobs (Vercel cron) | ✅ code real | ⚠️ 5/11 registered | ⚠️ | n/a | ⚠️ 6 routes dead-reachable-only-manually |
| Railway worker + scheduler | ✅ | ✅ 13 jobs firing | ✅ | ✅ (with 1 flaky live test) | ✅ Railway |
| External integrations (SAM.gov, Grants.gov, IRS BMF, ProPublica) | ✅ | ✅ | ✅ live-verified 08-21 | Partial | ✅ |
| NewsAPI | N/A — proxied via Claude web_search, no dedicated client | ✅ | ✅ (by design) | — | ✅ |
| LinkedIn | ✅ draft-only, ToS-safe by design | ✅ | ✅ | — | ✅ |
| BMF ingest, `nonprofits` table (`ingest-nonprofit-bmf.ts`) | ✅ code exists | — | ✅ column mapping correct (re-verified this session) | ❌ | Manual script, not cron-wired |
| BMF ingest, `donor_discovery_directory` (`ingest-irs-bmf-full.ts`) | ✅ code exists | — | ❌ scrambled columns + dead status filter, silently ingests ~0 rows (re-confirmed this session) | ❌ | Manual script, not cron-wired |
| Feature flags (`pil_feature_flags`) | ✅ | ✅ read by BEN-SUP-07 | ✅ | ✅ (mocked in test) | ✅ |
| Tests (vitest) | ✅ 51 files, 603 tests | — | 580 pass / 1 fail / 9 skip / 13 todo | — | ✅ CI daily (`daily-tests.yml`) |
| Tests (Playwright) | ✅ 24 spec files, 4+ projects | — | Not run in this session | — | ❌ **not in any CI workflow** |
| CI/CD | ✅ 2 workflows | ✅ | ✅ (no build-error suppression) | — | ✅ |

---

## 2. DETAILED FINDINGS BY SECTION

### Section 1 — API Endpoints

`Glob src/app/api/**/route.ts` → **~290 files**. Largest areas: `intelligence` (~40), `autoapply` (~30), `agents` (~35), `admin` (~25), `email` (~15), `donor-discovery` (~13), `pil` (12), `reports` (10).

A repo-wide grep for TODO/FIXME/mock/hardcoded/placeholder/stub across every `route.ts` returned **10 hits, all false positives** (AI prompt copy containing the word "placeholder"; one documented intentional hardcode in `src/app/api/admin/platform-metrics/route.ts:15-21`). No genuine stub routes found in a representative sample spanning grants, prospects, sales outreach, AutoApply, email, intelligence, integrations, auth, drafts, reports, PIL, and platform metrics — every sampled route does real Supabase work or delegates to a real `lib/` service.

**Confirmed landmine — `/api/grants*` is real but orphaned.** `src/app/api/grants/route.ts` does full filter/pagination over `opportunities` (documented alias, no `grants` table exists) — but a repo-wide grep for `/api/grants` in `.tsx` returns **zero matches**. The actual Grant Discovery page, `src/app/(dashboard)/opportunities/page.tsx:242`, bypasses it entirely with a direct client-side query: `supabase.from("opportunities").select("*").order("created_at",{ascending:false}).limit(1000)` — no pagination UI. This intersects the known PostgREST 1000-row cap: any org with >1000 opportunities silently loses rows with no user-visible signal.

**Sales Outreach UI → real backend, confirmed fixed.** `SalesOutreachClient.tsx` calls `/api/admin/campaigns` (:278,342), `/api/admin/sales-analytics` (:1217,1426-1427), `/api/admin/suppression` + `/import` (:1045,1067,1084) — all real, matching the documented path-mismatch fix. Suppression CRUD is now present in the UI, which **contradicts and supersedes** memory `benavora-sales-outreach-no-score-ops-no-joblist.md`'s "suppression CRUD missing" note.

**AutoApply maturity reconfirmed.** `worker/queue-processor.ts` (2,074 lines) + `/api/autoapply/queue/route.ts` (tier-capped batching, dedup) + `/api/cron/autoapply/route.ts` (schedule-aware) wired into ~20 frontend pages.

**Deployment:** `.vercel/` + `vercel.json` present (Vercel-deployed, confirmed structurally). Per-path `maxDuration` set correctly (`ai/**`=300s matching the known AI-route requirement, `cron/**`=120s). Security headers (`X-Frame-Options`, `X-Content-Type-Options`) + `Cache-Control: no-store` on all `/api/*`.

### Section 2 — Database Tables

Root `supabase/migrations/`: **166 files** (001→164, includes the `pil_*` track). `src/supabase/migrations/`: **57 files** (072→127, a distinct marketplace/personalization track). Confirmed **genuinely diverged, not stale duplicates** — zero `pil_*` migrations exist in `src/`, and `src/` has grown 25 files of its own unrelated work since the last audit.

**14 table-name collisions across the two directories** with different migration numbers (and in at least one documented case, `agent_configurations`, different column shapes — `org_id` vs `organization_id`): `adapter_usage_log`, `agent_configurations`, `agent_registry`, `board_members`, `discovery_matches`, `discovery_runs`, `donor_discovery_geocache`, `donor_discovery_taxonomy_aliases`, `organizational_digital_twins`, `outreach_templates`, `relationship_memory`, `relationship_recommendations`, `reputation_alerts`, `reputation_signals`. Whichever tree's `CREATE TABLE IF NOT EXISTS` executed first against the live DB "wins"; the other tree's version is a silent no-op. `supabase/.temp/linked-project.json` (root only, committed) points at ref `vbjplpquqxxfbpazyalt`. No live DB access in this specific audit, but a **prior session (2026-07-20) has direct empirical evidence, not just inference**: a live query against `platform_learning_patterns` (a `src/supabase/migrations/083`-only table) failed with `Could not find the table 'public.platform_learning_patterns' in the schema cache` — i.e. that fork's migrations are confirmed **not** applied to production, at least not in full. Root's `048_grant_intelligence.sql` table (`intelligence_funded_proposals`) was confirmed live and populated the same session. **Treat root `supabase/migrations/` as the live tree** for any of the 14 colliding table names unless a specific table has separate contrary evidence — see memory `benavora-two-parallel-migrations-directories` for the full trail.

**`pil_*` schema (32 tables, migrations 150-163, root only):** every single one has RLS enabled + explicit `REVOKE ALL ... FROM anon` + org-scoped policies **at creation time** — a materially better security pattern than tables created before migration ~110. 27/32 are actively queried in `src/lib/pil/*` and `src/app/api/pil/*`. **5 orphaned** (zero references anywhere in `src/`): `pil_research_goals`, `pil_agent_run_events`, `pil_delegation_budgets`, `pil_source_provider_credentials`, `pil_human_review_decisions`. Two of the five are self-documented as intentionally unused in code comments (`BEN-SUP-04.ts:13`, `human-review.ts:12`) — not an oversight, a deliberate scope cut.

**Requested tables:**
- `applications` — root migration 001, RLS on, 4 indexes, queried in 115 files. Core, healthy.
- `drafts` (bare table) — **does not exist in either directory.** Not a gap — draft state lives on `applications.draft_content`/`draft_template_type`/`draft_confidence_score` plus the separate `draft_versions` history table (migration 009, RLS on, 5 indexes, 1 trigger, queried in 16 files).
- `donor_discovery_prospects` — migration 067, RLS on since creation, TRUNCATE-hardened by migration 113, queried in 27 files.
- `email_templates` — migration 054, RLS on, queried in 10 files, but **no explicit anon-REVOKE found in any migration** — worth a targeted probe if live access is ever available.
- `email_campaigns` — migration 001, RLS on, queried in 10 files.
- `email_logs` — **does not exist anywhere, in either directory, under any name.** Related concepts live in `email_activity` (018), `synced_email_messages`/`synced_email_threads` (002), `automation_notifications` (036).

**RLS/anon-exposure:** `donor_discovery_directory` and `donor_discovery_taxonomy` had RLS *off* at creation (067), hardened later by dedicated migrations 118 and 120 respectively. Historical snapshot (`ANON_GRANT_AUDIT.md`, ~08-03, **not re-verified live**) lists ~17 tables with no authenticated policy at all (`dd_api_spend`, `dd_robots_cache`, `discovery_runs`, `donor_discovery_geocache`, `donor_discovery_tos_registry`, `impersonation_log`, `system_errors`, several `intelligence_*` tables, etc.) — these rely on `createAdminClient()` at every real call site per that doc, or have zero call sites. Treat as **needs live re-verification**, not confirmed current.

**CORRECTION (post-publication, live re-check):** the finding below understated the picture — a fix exists, but only in the non-canonical migrations track, so its live-apply status is unconfirmed rather than simply "missing." `supabase/migrations/055_admin_sales_outreach.sql` (root) creates `sending_domains`, `prospect_lists`, `prospects`, `sales_campaigns`, `sales_campaign_steps`, `sales_sends`, `suppression_list` with **no RLS, no policy, no REVOKE** — that part is confirmed. But `src/supabase/migrations/118_priority_security_tables_rls_hardening.sql` and `.../122_lockdown_no_authenticated_read_path_rls_hardening.sql` **already contain a thorough, call-site-verified fix for all seven of those tables** (plus `funder_credentials`, `platform_admins`, `submission_queue`, `autoapply_submissions`, `agent_configurations`, `webhook_configs`, and 20+ others) — `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM anon, authenticated` on the service-role-only tables (every real call site for `prospects`/`sales_*`/`suppression_list` was grepped and confirmed to use `createAdminClient()` exclusively, so the lockdown has zero functional risk), plus real org-scoped policies where an authenticated path genuinely exists (`funder_credentials`, `agent_configurations`, `webhook_configs`). This is good, already-done work — it just lives in the track whose production-apply status this audit could not confirm (no live DB access; root is the actively-maintained directory but is not proven to be the complete picture of live schema, per the migration-blend finding in the addendum below).

**Net effect on priority:** this is no longer "build RLS from scratch," it's "port an already-correct fix into the actively-maintained root track so it's live regardless of whether `src/`'s copy ever applied." Given `suppression_list` is the CAN-SPAM opt-out table, treat the porting step as cheap insurance worth doing immediately even if the src-track migration probably already ran — still backlog item 0, but the task and time estimate below are revised accordingly (idempotent port + live verification, not net-new policy design).

### Section 3 — UI Components

| Feature | Wired end-to-end? | Note |
|---|---|---|
| Grant Discovery | **No** | `opportunities/page.tsx` bypasses `/api/grants`, direct client query, hardcoded `.limit(1000)` |
| Draft Composition | Yes | `/api/intelligence/grant-dna`, `/api/ai/draft`, `/api/ai/humanize`, `/api/ai/budget` all real |
| AutoApply | Yes | ~20 pages, all real routes + Railway worker |
| Prospect Intelligence/Dossier | Yes | `/api/pil/*` + `/api/donor-discovery/prospects/[id]`, PIL depth in §7 |
| Email/Mail Merge | Yes (code-level) | `outreach/campaigns/page.tsx` is an **intentional redirect** to `/email/campaigns` (in-code comment explains the consolidation) — not broken, but see §4 for the cron gap that leaves scheduled sends unprocessed |
| Reporting/Analytics | Yes | `/api/reports/*`, `/api/intelligence/trends` |
| Admin Panel | Yes | RSC direct service-role queries + `SalesOutreachClient` fetches |
| Onboarding | Yes | `/api/onboarding/*` |

Table-population status is **unknown** for all rows above — no live DB access this session.

### Section 4 — Background Jobs / Crons

**Vercel cron: 5 registered** in `vercel.json` (`research` 06:00, `grantsgov` 07:00, `reminders` 08:00, `autoapply` 02:00, `domain-warmup` 06:00). **11 route handlers exist** under `src/app/api/cron/*`; **6 are real, working code with zero automatic trigger**:

| Route | Real work | Gap |
|---|---|---|
| `campaigns` | Yes (`EmailCampaignAgent`) | Intentionally retired from vercel.json 08-13 (0 orgs had the flag on); stale header comment still claims "Vercel Cron hits this every 2 hours" |
| `draft-automation` | Yes | Unregistered (P1) — `DraftQueueEngine.processDeadlineApproaching()` unreachable automatically |
| `draft-queue-check` | Yes, but redundant | Same method already fires inline from `/api/cron/research` |
| `email-sequences` | Yes (`sequenceEngine.processScheduledSends()`) | Unregistered (P1) — sole consumer of scheduled sequence sends, no other call site anywhere |
| `follow-ups` | Yes | Two-layer dead end — even the producer `scheduleFollowUps()` has zero call sites, so nothing is ever queued for this to process |
| `sales-sends` | Yes (`SalesCampaignEngine.processQueuedSends()`) | **Highest-confidence live gap**: `PATCH /api/admin/campaigns/[id] {action:'schedule'}` really inserts `sales_sends` rows with `status:'queued'` that then sit forever — nothing ever processes them |

Middleware-level blocker previously flagged (all 11 cron routes 307-redirected to `/login` before their own `CRON_SECRET` check) is **fixed** — commit `031de0b` added a `SECRET_GATED_PATHS` allowlist (`src/middleware.ts:100-119`).

**Railway worker** (`railway.json` → `worker/Dockerfile` → `node worker/dist/worker/index.js`) boots `StreamServer`, heartbeat, `queueProcessor` (AutoApply), `ddRequestProcessor`, `knowledgeIndexerProcessor`, `confirmationMonitor` (Gmail), and `scheduler`. **`worker/scheduler.ts` is a wholly separate mechanism from vercel.json** — plain `setInterval` wall-clock checks, **13 jobs**, all previously confirmed firing live (`test-evidence/pt-08/railway-scheduler-jobs-fired.json`): nightly autonomous pipeline, morning digest, self-improvement, AutoApply overnight orchestrator, weekly learning network, weekly grant-DNA, daily change monitor, disaster-response FEMA poll, weekly foundation/nonprofit enrichment (scraper-gated), relationship-graph incremental, monthly funding forecast, daily board packet.

**`enrichment-processor.ts`** (288 lines) — flagged in a prior audit as DEFINED-NOT-STARTED (WGR-033); not independently re-verified this session.

**BMF ingest — two separate scripts; the earlier draft of this doc had them backwards.** Re-verified both directly this session (previous pass in this doc, and the parallel corroboration addendum below, both mis-assigned which script has the bug):

- **`scripts/ingest-nonprofit-bmf.ts`** (targets the `nonprofits` table) is **correct**. `rowToNonprofit()` (lines 124-144) matches its own header comment exactly: `col(cols,0)`=EIN, `col(cols,1)`=NAME, `col(cols,5)`=STATE, etc. Written 2026-07-18, never modified since (`git log`).
- **`scripts/ingest-irs-bmf-full.ts`** (targets `donor_discovery_directory`, migration 067) **is still broken**, exactly as originally documented in `benavora-bmf-ingest-column-bug.md` (2026-07-17) — its own header comment claims col 0=NAME, col 2=EIN, col 5=CITY, col 6=STATE, col 7=ZIP, and the parsing code (lines 185-192) follows that same wrong mapping. Real layout is col 0=EIN, col 1=NAME, col 4=CITY, col 5=STATE, col 6=ZIP (confirmed by cross-referencing the correct sibling script above). **Compounding bug, also unfixed:** line 100 defines `ACTIVE_STATUS = "O"` and line 304 filters `col(cols,16).toUpperCase() !== ACTIVE_STATUS` — real BMF STATUS values are numeric strings (`"01"`, `"02"`, `"06"`...), never the letter `"O"`, so this condition is always true and every row is silently skipped as inactive. This script has very likely never inserted a real row into `donor_discovery_directory`, consistent with `STANDING_DIRECTIVES.md` Directive 2's note that `ingest:bmf` "exists, never successfully run."

**Not the live donor-discovery code path regardless of either script's state** — `src/lib/donor-discovery/adapters/bmf-directory.ts` reads the already-populated `foundation_directory` table directly, unaffected by either script.

### Section 5 — External Integrations

| Integration | Auth | Called from | Evidence |
|---|---|---|---|
| SAM.gov | `SAM_GOV_API_KEY` | `/api/sources/samgov` + `dd-request-processor.ts` | Live JSON captured 08-21 (`test-evidence/remediation/int-fix/wgr-{139,142,143}-*-live-after.json`) |
| Grants.gov | none (public) | `/api/cron/grantsgov` (registered) | Live JSON captured 08-21, 100 real hits |
| IRS BMF | none (public CSV) | `bmf-directory.ts` adapter reads pre-ingested `foundation_directory` (133,812 rows per adapter comment) | See §4 for the separate broken ingest script |
| ProPublica | none (free) | `/api/sources/propublica` + donor-discovery adapter | Real captured org+filing JSON (`test-evidence/pt-07/data-sources.json`) — the org-detail fetch correctly distinguishes 404 from other errors; the sibling `search.json` call in `propublica-adapter.ts:167` still uses `!response.ok` and was not fully re-derivable as fixed within this audit's scope |
| NewsAPI | N/A | No standalone client exists by design — `src/lib/pil/tools/news-search.ts` explicitly proxies through Claude's `web_search_20250305` tool instead | — |
| LinkedIn | N/A | `POST /api/contacts/[id]/outreach/linkedin` | Deliberately never calls the LinkedIn API — generates a draft note + logs a human task, ToS-safe by design |

### Section 6 — Feature Flags

Only one real feature-flag system exists in this codebase: **`pil_feature_flags`** (migration 163). No `FF_*` env-var convention, no LaunchDarkly/GrowthBook, no `src/lib/features*` module.

| Flag system | Controls | Built | Read in code | Complete |
|---|---|---|---|---|
| `pil_feature_flags` table (`flag_key`, `scope_type: platform/org/agent`, `enabled`) | Platform/org/agent-scoped kill-switches for PIL autonomy | ✅ | ✅ — `src/lib/pil/agents/sup/BEN-SUP-07.ts:219`: `getPilClient().from("pil_feature_flags").select("*").eq("enabled", true)` (the Autonomy Governor agent) | ✅ real, not orphaned, covered by a mock in `pil-sup-agents-2.test.ts:227` |

### Section 7 — Prospect Intelligence Layer (PIL) Agents

**The canonical registry (`supabase/migrations/155_pil_agent_registry.sql`) defines 44 agent codes** across 8 families: DIS×8, INT×10, KNW×4, OPS×1, QLF×5, REL×6, STR×4, SUP×6. **Migrations 163/164 add 4 more** (SUP-07, SUP-08, REL-07, REL-08) — **48 total registered agent codes**.

**The dispatch map (`src/lib/pil/agents/index.ts`, `AGENT_FACTORIES`) implements 38 of the 48.** Any code not in this map falls through to `NotImplementedAgent`, which still records a `pil_agent_runs` row (status `failed`, `notImplemented: true`) rather than crashing — a deliberate graceful-degradation design (`index.ts:59-94`).

**10 registered codes have zero implementation** — confirmed by directory listing, not just the factory map:
- **`BEN-STR-01..04`** (Strategy family, 4 agents) — no `str/` directory exists at all.
- **`BEN-OPS-01`** (Operations, 1 agent) — no `ops/` directory exists at all.
- **`BEN-QLF-01, 02, 03, 05`** (4 of the 5 Qualification agents) — only `BEN-QLF-04.ts` exists.
- **`BEN-KNW-04`** (1 of 4 Knowledge agents) — only `BEN-KNW-01..03.ts` exist.

**The "all 44 PIL agents implemented" claim in commit `ff9beef`'s message is not accurate against current code.** What that commit and its predecessors (`04f3a97`, `9a266c3`, `c54555e`) actually resolved was a documented **task-collision**: the task prompt asked for a `BEN-QUA-01` ("Prospect Qualification Agent") that has no row in the real registry — `src/lib/pil/agents/qua/BEN-QUA-01.ts` is a 28-line re-export stub whose own header (lines 1-25) explains it's a duplicate of the already-implemented `BEN-QLF-04`, deliberately **not** registered under a phantom `BEN-QUA-01` code to avoid an orphaned registry entry. That reconciliation is correct and well-documented — but it left the *actual* QLF-01/02/03/05, KNW-04, STR-01..04, and OPS-01 gaps untouched, and the commit message overstates completeness as a result.

**Implementation is substantive, not stub-shaped**: the 38 implemented agents total **9,651 lines** across `src/lib/pil/agents/{sup,dis,int,rel,qlf,knw}/` — averaging ~254 lines each.

**Integration confirmed live end-to-end**: `AgentRunner.run()` (`src/lib/pil/agent-runner.ts:128`) calls `loadAgentImpl(context.agentCode)`, dispatched from 12 API routes under `src/app/api/pil/*` (`discover`, `research`, `agents`, `review-queue`, `cost/summary`, `monitoring/*`), reachable from the UI at `intelligence/pil/*`. Deployed the same way as every other Vercel route.

**Test coverage**: 6 dedicated files — `pil-workflow.test.ts`, `pil-sup-agents.test.ts`, `pil-sup-agents-2.test.ts`, `pil-tools.test.ts`, `pil-dis-agents.test.ts`, `pil-qlf-knw-agents.test.ts`. No dedicated `pil-int-agents.test.ts` or `pil-rel-agents.test.ts` file was found by name — INT/REL family coverage, if any, is folded into `pil-workflow.test.ts` or untested; not independently confirmed either way this session.

**By family — spec/code/integrated/tested/deployed:**

| Family | Registered | Implemented | Tested (dedicated file) | Deployed |
|---|---|---|---|---|
| SUP (Supervisory) | 8 (6 orig + 2 added) | 8/8 | ✅ ✅ | ✅ |
| DIS (Discovery) | 8 | 8/8 | ✅ | ✅ |
| INT (Intelligence) | 10 | 10/10 | ⚠️ not independently confirmed | ✅ |
| REL (Relationship) | 8 (6 orig + 2 added) | 8/8 | ⚠️ not independently confirmed | ✅ |
| QLF (Qualification) | 5 | **1/5** | ✅ (for QLF-04) | ✅ (for QLF-04 only) |
| KNW (Knowledge) | 4 | **3/4** | ✅ (for 01-03) | ✅ (for 01-03 only) |
| OPS (Operations) | 1 | **0/1** | ❌ | ❌ |
| STR (Strategy) | 4 | **0/4** | ❌ | ❌ |
| **Total** | **48** | **38 (79%)** | — | — |

### Section 8 — TODOs / FIXMEs / Incomplete Markers

Repo-wide grep for `TODO|FIXME|XXX|HACK:` across `src/`: **2 raw hits, both false positives** (`XX-XXXXXXX` EIN-format placeholder strings, not code markers). A broader pass including `placeholder|not implemented|stub` returned 155 files, but manual review shows these are overwhelmingly legitimate UI placeholder text (`<input placeholder="...">`), the `NotImplementedAgent` class name itself (by design, see §7), and doc/comment references — not abandoned code.

**Conclusion: this codebase does not self-report its gaps via comment markers.** The real gap-finding method here is cross-referencing registries/specs against actual dispatch tables and cron config (as done in §4 and §7), not grepping for TODO.

### Section 9 — Environment & Configuration

`.env.local.example` documents ~20 vars (Supabase ×3, Anthropic ×3, OpenAI, site URL, `CRON_SECRET`, Google OAuth ×3, `INTEGRATION_ENCRYPTION_KEY`, Stripe ×7).

**A live `process.env.*` grep across `src/` surfaces ~45 distinct variable names — roughly double what `.env.local.example` documents.** Undocumented-in-example vars actually read by the app: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_DOMAIN`, `RESEND_WEBHOOK_SECRET`, `SAM_GOV_API_KEY`, `GOOGLE_PLACES_API_KEY`, `DD_PLACES_MONTHLY_BUDGET_USD`, `CENSUS_API_KEY`, `BLS_API_KEY`, `CDC_APP_TOKEN`, `HUD_API_KEY`, `TWOCAPTCHA_API_KEY`, `SIMPLER_GRANTS_API_KEY`, `CREDENTIAL_ENCRYPTION_KEY`, `PORTAL_ENCRYPT_SECRET`, `UNSUBSCRIBE_HMAC_SECRET`, `INTEGRATION_KEY_SECRET`, `FAITH_FOUNDATION_ORG_ID`, `GEMINI_API_KEY`/`GOOGLE_GENERATIVE_AI_API_KEY`, `SEARXNG_URL`, `STORAGE_DOCUMENTS_BUCKET`, `STORAGE_REPORTS_BUCKET`, `NEXT_PUBLIC_WORKER_URL`, `NEXT_PUBLIC_APP_URL` (distinct from `NEXT_PUBLIC_SITE_URL`, both referenced), `SUPABASE_URL` (non-public variant, `admin.ts:45`).

**Local dev environment (`.env.local`) has only ~8 unique vars set**: Supabase URL/anon/service-role, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `SAM_GOV_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `FAITH_FOUNDATION_ORG_ID`. Everything else — Resend, Stripe, Google OAuth, all encryption-key vars, HUD/Census/BLS/CDC, 2Captcha, Gemini, SearXNG — is **unset locally**. This tells us nothing definitive about Vercel/Railway production config (not checked this session, no dashboard access), but it does mean any of those integrations cannot be exercised from this dev environment, and `.env.local.example` is a materially incomplete onboarding reference.

**CI secrets**: `deploy-check.yml` explicitly provisions only `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` as GitHub Actions repo secrets (documented as intentionally safe to expose — RLS is the real boundary). `daily-tests.yml` provisions none, meaning any unit test requiring a real API key or live DB would need to gracefully skip in CI — confirmed by the local run's own skip-on-unreachable pattern (see §10).

### Section 10 — Tests

**Vitest — live-executed this session** (`pnpm exec vitest run`, 08-26, 525s):

```
Test Files:  2 failed | 69 passed | 1 skipped (72)
Tests:       1 failed | 580 passed | 9 skipped | 13 todo (603)
```

The single hard test failure (`autoapply-compliance.test.ts`) is a **`ConnectTimeoutError` to `vbjplpquqxxfbpazyalt.supabase.co:443`** — this sandbox genuinely cannot reach the production Supabase project, not a code defect. The second failed suite (`autoapply-mutual-exclusion.test.ts`) times out waiting for the Railway worker to pick up a queue item — also an environment-reachability issue (no live worker reachable from here), not a code defect, and its own error message says as much: *"Is the Railway worker (benavora-worker) running and polling?"*. **580/581 reachable tests pass.** This is strong evidence the unit/integration suite is real and green in an environment with actual connectivity (matches `daily-tests.yml` running `pnpm test:unit` daily against, presumably, real secrets).

**51 vitest files** under `src/__tests__/` (+1 under `src/lib/donor-discovery/scoring.test.ts`) spanning unit (grant scoring, RLS/org-scoping, SSRF guard, cron auth, PIL agents ×6, digital twins, relationship scoring, deadline prediction) and integration (`rls`, `foundation-directory`, `corporate-prospects`, `autoapply-compliance`, `autoapply-risk-scoring`, `platform-config-org-scope`, `storage-rls`, `agent-runs`) plus 2 `integration-live` files that require real infrastructure.

**Playwright — 24 spec files**, 4 real projects (`setup`, `public`, `authed`, `critical-paths`) plus 3 cross-browser variants (chromium/firefox/webkit) for the smoke path — `playwright.config.ts` confirms real auth setup (`tests/e2e/auth.setup.ts`), storage-state reuse, and dev-server auto-start. **This suite was not executed this session** (would require a running dev server + seeded test org) and, more importantly: **`.github/workflows/` contains no Playwright/e2e job at all** — only `daily-tests.yml` (vitest unit, scheduled) and `deploy-check.yml` (build-only, on push to `main`). The mature 24-spec e2e suite exists and (per memory) has passed in prior manual runs, but it is **not part of any automated gate**.

**CI/build gate is real**: `deploy-check.yml` runs `pnpm build` on every push to `main` with no `ignoreBuildErrors`/`ignoreDuringBuilds` escape hatches in `next.config.mjs` — a failing typecheck or lint genuinely fails the build check.

---

## 3. COMPLETE BUILD BACKLOG

Ordered roughly by leverage (small fix, real user-facing impact) to larger effort:

0. **Port `src/supabase/migrations/118_priority_security_tables_rls_hardening.sql` + `122_lockdown_no_authenticated_read_path_rls_hardening.sql`'s fix for `sales_campaigns`/`sales_campaign_steps`/`sales_sends`/`suppression_list`/`prospects`/`prospect_lists`/`sending_domains` into root `supabase/migrations/`** as a new migration, then live-verify with `information_schema.tables`/`pg_policies` — **highest priority in this entire backlog**, ahead of every item below. The fix is already written and well-reasoned (call sites grep-verified); it just isn't confirmed live because it sits in the uncertain-liveness track. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `REVOKE ALL` are both idempotent, so porting it is safe whether or not `src/`'s copy already ran. `suppression_list` is the CAN-SPAM opt-out table — worth closing regardless of probability it's already fixed.
1. **Register the 6 orphaned cron routes in `vercel.json`** (`sales-sends`, `email-sequences`, `draft-automation`, `follow-ups`, `campaigns` [or delete it], `draft-queue-check` [or delete it, redundant with `research`]) — code is done, this is config only. **Highest priority**: `sales-sends` has live user-facing impact (scheduled sends never go out).
2. **Fix or remove the `follow-ups` chain** — the producer (`scheduleFollowUps()`) has zero call sites, so even after registering the cron there's nothing to process. Decide: wire the producer in, or delete both ends as dead code.
3. **Wire `opportunities/page.tsx` to `/api/grants` or add pagination** — either delete the orphaned `/api/grants` route+lib, or switch the UI to use it and get server-side pagination past the 1000-row cap.
4. **Fix `scripts/ingest-irs-bmf-full.ts`'s column mapping (cols 0/2/4/5/6/7 scrambled) and dead `ACTIVE_STATUS = "O"` filter** (real STATUS codes are numeric, never `"O"`) — this is the script that's actually broken; `ingest-nonprofit-bmf.ts` (different file, different target table) was mis-flagged as broken in this doc's own first draft and is fine as-is, no action needed there. Fixing needs: skip nothing extra (header row already skipped correctly), remap `col(cols,0)`→EIN, `col(cols,1)`→NAME (STREET is real col 3, currently unread), `col(cols,4)`→CITY, `col(cols,5)`→STATE, `col(cols,6)`→ZIP, and either drop the status filter or compare against real numeric status codes.
5. **Add a Playwright job to CI** — the suite exists and is mature; running zero of it automatically means UI regressions ship undetected between manual sessions.
6. **Implement `BEN-STR-01..04` (Strategy family, 4 agents)** — entirely unbuilt, no directory exists.
7. **Implement `BEN-OPS-01`** — entirely unbuilt.
8. **Implement `BEN-QLF-01, 02, 03, 05`** — only QLF-04 exists; decide whether the other 4 missions are still wanted or should be formally dropped from the registry (mirroring the REL-family precedent where 2 missions were explicitly reassigned instead of built).
9. **Implement `BEN-KNW-04`**.
10. **Reconcile the two migrations directories** — at minimum, resolve the 14 table-name collisions (pick one tree's definition, drop the other, backfill any missing columns/RLS from the losing tree). This is the single highest-risk unresolved item in the audit: a silent no-op on any of these 14 tables in production is undetectable without a live schema diff.
11. **Update `.env.local.example`** to include the ~25 undocumented vars found in §9 — onboarding risk, not a functional bug.
12. **Re-verify the ~17-table anon-exposure list from `ANON_GRANT_AUDIT.md`** against a live schema pull — that doc is 3+ weeks stale.
13. **Decide the fate of `email_templates`'s missing anon-REVOKE** — likely fine (RLS is on) but not confirmed hardened the way `donor_discovery_*` was.
14. **Clarify ProPublica `search.json`'s error-handling** (`propublica-adapter.ts:167`, `!response.ok`) — confirm whether the zero-result-treated-as-404 bug from memory still applies to this specific call site (the sibling org-detail fetch is confirmed fixed).

---

## 4. DEPENDENCY GRAPH

```
Two migrations directories reconciled
        │
        ▼
Live schema ground-truth established ──► Re-verify anon-exposure list (§9 backlog item 12)
        │                                Re-verify email_templates RLS (item 13)
        ▼
Confident row-count/population claims
possible for any table in future audits


Register 6 orphaned crons (item 1) ──► Wire/delete follow-ups producer (item 2)
        │
        ▼
Email/sales-sends actually fire in prod
        │
        ▼
(then, and only then) meaningful to measure
Outreach engine effectiveness / suppression correctness


PIL registry gaps (items 6-9: STR, OPS, QLF, KNW)
are independent of each other — no ordering constraint,
each can be built standalone against the existing
AgentRunner/AGENT_FACTORIES dispatch pattern in
src/lib/pil/agents/index.ts


Playwright-in-CI (item 5) has no dependency on anything
above — pure config/workflow-file addition, do any time


/api/grants wiring (item 3) and BMF ingest fix (item 4)
are both fully independent, no shared blockers
```

The two migrations-directory reconciliation is the one item that gates confident answers to *other* audit questions (row counts, RLS-live-state) — everything else in this backlog can proceed in parallel.

---

## 5. TIME ESTIMATES

| # | Task | Estimate | Confidence |
|---|---|---|---|
| 0 | Port existing `src/`-track RLS fix (118+122) for sales/suppression tables into root | 1 hr | High |
| 1 | Register 6 crons in `vercel.json` | 30 min | High |
| 2 | Wire/delete `follow-ups` producer | 1-3 hrs (wire) or 15 min (delete) | Medium — depends on whether the feature is still wanted |
| 3 | Fix `/api/grants` UI wiring or pagination | 2-4 hrs | Medium |
| 4 | Fix `ingest-irs-bmf-full.ts` column mapping + status filter | 2 hrs (fix + regression test vs a real state CSV) | High |
| 5 | Add Playwright CI job | 1-2 hrs (workflow file + seeded test-org secrets) | Medium — depends on CI runner cost/flakiness tolerance |
| 6 | Build BEN-STR-01..04 | 2-4 days (4 agents × ~0.5-1 day each, matching ~254 line/agent average) | Low — no spec depth reviewed this audit |
| 7 | Build BEN-OPS-01 | 0.5-1 day | Low |
| 8 | Build/retire BEN-QLF-01,02,03,05 | 2-4 days if building; 1 hr if formally retiring (mirror REL precedent) | Low |
| 9 | Build BEN-KNW-04 | 0.5-1 day | Low |
| 10 | Reconcile two migrations directories | 3-5 days (schema diff, live verification, migration-merge, regression test) | Low — genuinely hard, needs live DB access this audit didn't have |
| 11 | Update `.env.local.example` | 1 hr | High |
| 12 | Re-verify anon-exposure list live | 2-4 hrs (with live DB access) | Medium |
| 13 | Confirm `email_templates` RLS hardening | 30 min (with live DB access) | High |
| 14 | Confirm/fix ProPublica `search.json` error handling | 1-2 hrs | Medium |

**Total estimated backlog: roughly 2.5-4 engineer-weeks**, dominated by items 6-10 (PIL agent-family completion + migration reconciliation). Items 0, 1, 4, 11, 13 are same-day wins — do item 0 first regardless of what else gets picked up.

---

## 6. ADDENDUM — corroboration from independent parallel review

A second, independently-run pass (separate agents covering the same ground) corroborated the findings above and added detail worth preserving:

- **Migration-directory model refined:** root `supabase/migrations/` is not simply "the live tree" — it's the *actively maintained* tree, but production schema is a **blend of both directories built up over time**. Concrete evidence: `supabase/migrations/113_revoke_anon_truncate_batch.sql:21` REVOKEs privileges on `agent_queue`, a table root itself never `CREATE`s — it only exists in `src/supabase/migrations/`. Root's own author treated it as already-live when writing 113. `agent_queue` is queried from 26 files including core autonomous-agent infrastructure (`autonomous-base.ts`, `board-packet-agent.ts`, `budget-builder-agent.ts`) — if a fresh `supabase db push` were ever run from root alone, this table (and up to 35 other `src/`-only tables, several with real production usage: `agent_decisions` ×10 files, `corporate_intent_signals` ×9) would vanish and break live agent code. This raises the risk profile of backlog item 10 (migration reconciliation) beyond what a simple "pick a winner per collision" framing suggests — some `src/`-only tables need to be *ported into* root's track, not discarded.
- **Root migration files themselves have 7 duplicate-numbered pairs** (002, 022, 052, 053, 054, 055, 058 — e.g. two independent `052_*.sql` files), evidence of uncoordinated parallel-agent authorship. Both apply fine under lexical filename sort, so not a correctness bug today, but a latent footgun for any tooling that assumes migration numbers are unique.
- **BMF integration has a third angle beyond the known ingest-script bug:** `src/lib/donor-discovery/adapters/bmf-directory.ts` (the adapter donor-discovery code would call) has **zero production call sites** — it's referenced only by its own unit test. The live path is `foundation_directory` (pre-populated, per §4/§5 above), meaning there are effectively three BMF-related code paths in this repo and only one is both correct and wired.
- **Enrichment connectors `hunter-connector.ts` / `apollo-connector.ts`** (donor-discovery enrichment) take no static env var — they consume each org's own encrypted BYO key via the `ConnectorEnricher` interface, consistent with the platform's BYO-key system. Real code, but platform-wide usage is zero until an individual org configures a key — worth knowing this isn't a global integration the way SAM.gov/Grants.gov are.

None of the above changes any verdict in §1-§5; they sharpen the migration-reconciliation risk assessment and close out the BMF investigation.
