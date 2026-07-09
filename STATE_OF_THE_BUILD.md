# BENAVORA — STATE OF THE BUILD
## Last updated: 2026-07-09 (Donor Discovery Phases 2+3 + Foundation Enrichment Pipeline + Onboarding soft-gate)
## Method: live codebase audit — every file path, route, agent, and migration counted directly from the filesystem; no assumptions carried from prior docs.

---

## Donor Discovery Phases 2+3: BUILT (engine + dashboard)

Phase 1 (enumeration only, Google Places adapter) shipped in `0d065eb`. This pass adds the
scoring/linkage engine and the full dashboard UI on top of it.

**Scoring engine** — `src/lib/donor-discovery/scoring.ts`. Pure function, no I/O:
`scoreProspect(directoryRecord, requestContext, weights?) → { score: 0-100, rationale }`.
Six weighted signals (giving program 25 / donation form 20 / in-kind keyword match 15 /
linked-foundation confidence 15 / geo match 15 / size-appropriateness 10, sums to 100,
overridable per-org via `organizations.donor_discovery_scoring_weights` jsonb). 27 unit
tests in `scoring.test.ts` cover every signal, all three geography modes (national/radius/
states), and weight-override parsing/validation.

**Foundation linkage** — `src/lib/donor-discovery/foundation-linkage.ts`. Matches a company
in `donor_discovery_directory` to its likely giving vehicle in `foundation_directory` (IRS
BMF) by generating candidate names (strip corporate suffix, append "Foundation"/"Charitable
Trust"/etc.) and trigram-matching via the `donor_discovery_match_foundations` RPC (migration
074, `pg_trgm`, min similarity 0.55), with a +0.35 confidence boost on matching website
domain. Name-heuristic only, not verified ownership — no dedicated test file yet (unlike
scoring.ts).

**Worker pipeline** — `worker/dd-request-processor.ts` grew from enumeration-only to a full
4-stage `processItem()`: enumerate → enrich (concurrency 5, `extractFromWebsite` on each
prospect's site, 180-day staleness TTL) → link foundations (concurrency 5) → score (writes
`score`/`score_rationale` onto `donor_discovery_prospects`). Per-row failures in enrichment
and linkage are logged and swallowed, never thrown — a request only lands in `status=failed`
on a structural error (bad taxonomy, DB failure), not one bad website or one missed match.

**Dashboard UI** — new `/donor-discovery` route tree:
- `/donor-discovery` — overview: live-polling active requests, pipeline-stage bar chart, top-scored new prospects.
- `/donor-discovery/new` — 3-step launch wizard (taxonomy tree from `donor_discovery_taxonomy` → geography: radius/states/national → review & launch).
- `/donor-discovery/prospects` — filterable/sortable full list, bulk stage-move.
- `/donor-discovery/prospects/[id]` — detail view with score rationale, enrichment fields, linked-foundation card, and a "Queue in AutoApply" action.
- No map/geo-visualization component exists — `/api/donor-discovery/geocode` (Places API "New", server-only key) resolves an address to lat/lng for the radius-search step's text summary only, nothing is rendered on a map.
- Known schema gap: "already queued in AutoApply" detection on the prospect detail page is a best-effort `funders.website`-then-`funders.name` match — there is no persisted FK between `donor_discovery_prospects` and `funders`.
- Civic/association taxonomy nodes (land banks, community foundations, municipal surplus, trade associations) are seeded but not yet enumerable — the worker explicitly skips non-NAICS taxonomy nodes; that's scoped as a future phase.

## Foundation Enrichment Pipeline — BUILT, NOT YET RUN

Three new/changed scripts + two shared libs enrich `foundation_directory` (IRS BMF, migration
046) with financials, contact info, and web-derived giving-program data. **None of this has
been executed against production data yet** — see "Reid's morning actions" below.

- `pnpm seed:dd-taxonomy` (`scripts/seed-dd-taxonomy.ts`) — downloads the full 2022 Census NAICS code list live from census.gov (~1,057 six-digit codes) plus 5 flat civic entity types into `donor_discovery_taxonomy`; refuses to seed on a short/malformed download (`MIN_SIX_DIGIT_CODES = 900` floor), no hardcoded fallback. Idempotent upsert.
- `pnpm enrich:990` (`scripts/enrich-foundations-990.ts`) — streams the current-year IRS 990 e-file index CSV, matches by EIN, parses each filing's XML (`IRS990Source.enrichFromRemoteXml`, new method) for assets/giving total/phone/website/address/grant-count/typical-grant-range. Resumable via checkpoint file + `enriched_990_at` skip. In-code warning: the hardcoded IRS index URL may have moved by run time.
- `pnpm enrich:web --limit 2000` (`scripts/enrich-foundations-web.ts`) — for rows still missing web enrichment (ordered by assets desc), discovers a website via SearXNG search if none is on file, then runs one Claude extraction call per site (`web-extractor.ts`, schema `"foundation"`) for giving-program/donation-form/focus-area signals. Concurrency 8, default `--limit 500` (Reid should pass `--limit 2000` per the run plan below). Requires `SEARXNG_URL` and `ANTHROPIC_API_KEY`.
- Both enrichment scripts write to `./enrichment-output/` (checkpoint JSON + raw CSV extract) for resumability and audit trail.
- Backing migrations (all **unapplied to production as of 2026-07-09**): `072_foundation_directory_990_enrichment.sql` (adds `enrichment` jsonb + `enriched_990_at`/`enriched_web_at`/`website_discovered_via` to `foundation_directory`), `073_onboarding_progress.sql` (adds `organizations.onboarding_progress` jsonb), `074_donor_discovery_foundation_linkage_and_scoring.sql` (explicitly marked in-file as not-yet-applied: adds `linked_foundation_id`/`linkage_confidence` to `donor_discovery_directory`, `pg_trgm` + trigram index on `foundation_directory.name`, the `donor_discovery_match_foundations` RPC, and `organizations.donor_discovery_scoring_weights`). **The scoring/linkage worker stages and the enrichment scripts will fail without these applied first.**

## Onboarding soft-gate: LIVE

Despite the name, this is a hard redirect with a per-browser-session opt-out, not a pure
banner. `src/middleware.ts` (full-file replacement, per governance rule #4) redirects any
authenticated, org-attached user to `/onboarding` when `organizations.onboarding_completed`
is false — unless a `benavora_onboarding_skip` session cookie is present (set by the
"Explore the platform first" link on the onboarding page; expires with the browser session,
so a fresh login re-triggers the redirect). Once a user has skipped past the redirect,
`OnboardingBanner.tsx` (new) renders on every dashboard page showing "{n} of {total} steps
complete" + a resume link; dismissal is `sessionStorage`-based, so it reappears each new
session. `organizations.onboarding_progress` (migration 073) tracks per-step completion for
the banner and the new read-only `/settings/organization-setup` review page; the pre-existing
`onboarding_completed` column remains the sole flag middleware actually gates on.

## Reid's morning actions (in order)

1. Apply migrations 072, 073, 074 to production via the Management API pattern (`sbp_` PAT, ASCII SQL only, same path used since migration 011). Migration 074 is explicitly marked in-file as not yet applied; verify 072/073 too before assuming either is live.
2. `pnpm seed:dd-taxonomy`
3. `pnpm enrich:990`
4. `pnpm enrich:web --limit 2000`
5. Back up `./enrichment-output/` to DATAOCEAN.
6. Launch a discovery request from the new `/donor-discovery/new` UI as a smoke test.

---

## Intelligence Library Nights 3-7: BUILT

Verified 2026-07-07 by direct file/grep audit against `src/`, not against the BLUEPRINT.md spec text — see the "Intelligence Library KB4-9" entry further below for the original file-level walkthrough. Where a spec-promised piece doesn't exist in code, it's called out as a gap rather than marked built.

### KB 4: Need Statement Database
- Census Bureau ACS5, HUD (PIT counts + Fair Market Rents), BLS, and CDC API clients — `src/lib/intelligence/sources/{census,hud,bls,cdc}-api.ts`, real `fetch()` calls with real parsing, not stubs
- Need statement auto-generator with inline citations, refuses to fabricate when no data exists — `need-statement-engine.ts`
- Geographic matching engine: **county → state fallback only** — corrected 2026-07-08. `need-statement-engine.ts:41-42` and `census-api.ts` are explicit in-code that zip and national levels are not implemented ("zip and national not currently supported by APIs — county and state are used"); the spec's full zip→county→state→national chain does not exist yet
- **CDC/SAMHSA labeling correction (2026-07-08):** there is no separate SAMHSA API integration. `cdc-api.ts:169-180`'s `fetchSubstanceAbuseData()` comment claims "SAMHSA NSDUH state estimates" but the actual call hits a CDC Socrata BRFSS (Behavioral Risk Factor Surveillance System, alcohol module) dataset — a different survey than SAMHSA's National Survey on Drug Use and Health. The in-code comment itself is mislabeled, not just prior docs.
- Ingestion scripts: `scripts/ingest-census-data.ts`, `scripts/ingest-hud-data.ts`
- Backing table: `intelligence_need_data` (migration 048)

### KB 5: Budget Pattern Library
- Budget templates by program category with line items — `budget-patterns.ts`, backed by `intelligence_budget_templates` (048) + `intelligence_budget_patterns` (059)
- Federal cost principles (2 CFR 200) references baked into template content
- Budget narrative auto-generator wired into `src/lib/drafts/generator.ts`

### KB 6: Compliance Requirements
- Federal (2 CFR 200, OMB, SAM.gov, UEI), HUD-specific (environmental review, Davis-Bacon, Section 3), and state/foundation requirements — `compliance-library.ts` + `data/compliance-requirements.ts` (22 entries), code-defined, no DB table
- Compliance pre-check wired into draft output and unified search
- Carried-over known bug: `omb-a133-threshold` check has a dead branch that always returns `'pass'` (see gap #11 below) — not fixed by this pass, scope was gates + docs only

### KB 7: Evaluation Framework Library
- Evaluation templates for 7 program categories, ~91 named KPIs (exceeds the spec's "50+" target) — `evaluation-library.ts` + `data/evaluation-templates.ts`
- Data collection method suggestions per KPI
- Evaluation plan auto-generator wired into the draft pipeline
- Gap: `intelligence_evaluation_frameworks` table (048) exists but nothing writes to it — the live KPI data is a static TypeScript file, not DB rows

### KB 8: Grantmaker Intelligence
- Grantmaker profile builder (`scripts/build-grantmaker-profiles.ts`) — builds from `foundation_directory` plus prior website-enrichment fields (`found_programs`, `found_giving`, `found_revenue`); it consumes previously-scraped enrichment data rather than performing its own fresh scrape
- Funder recommendation engine — real weighted score (geo 30% / program match 30% / amount fit 20% / giving-activity proxy 20%) with human-readable reasons — `funder-recommender.ts`
- `explainMatch()` Claude narrative explanation exposed via `/api/intelligence/recommendations/explain`; rendered at `/intelligence/recommendations`
- Post-award outcome benchmarks — real comparison logic in `outcome-benchmarks.ts`, but against a static hardcoded lookup table (`data/outcome-benchmarks.ts`), not yet DB-backed

### KB 9: Grant DNA Scoring
- 8-dimension Claude-based scoring — clarity, evidence density, outcome specificity, funder alignment, innovation, sustainability, feasibility, impact scope — category-weighted (default/federal/corporate) — `grant-dna.ts`
- `GrantDNACard.tsx` — real Recharts radar chart + expandable improvement suggestions per dimension
- Draft benchmarking is against hardcoded category-average scores, not a live funded-proposal corpus comparison
- **Not built, despite spec language implying otherwise:** narrative pattern extraction from funded proposals and post-award-report mining. Confirmed this pass — `intelligence_narrative_patterns` and `intelligence_post_award_reports` (both migration 048) have zero references anywhere in `src/`
- Scores are computed live per-request and never persisted to `intelligence_grant_dna_scores` (048) — no scoring history exists across draft revisions

### Cross-Library Integration
- Unified search across all 9 KBs — `unified-search.ts` (vector RPC for proposals/rubrics, direct table queries for grantmakers, static-data lookups for budget/eval/compliance/benchmarks)
- Intelligence briefing API (`/api/intelligence/briefing`) — one-call intelligence bundle per opportunity, real tier-gating (free/starter/professional/enterprise/consultant)
- Intelligence briefing panel confirmed mounted on the opportunity detail page — `OpportunityDetail.tsx` imports and renders `IntelligenceBriefingPanel.tsx`
- Intelligence library analytics dashboard with a real coverage heat map (not a placeholder) — `intelligence-library/dashboard/page.tsx`
- Tier-gated access enforced server-side in the briefing route

### Gate results for this pass
`pnpm run typecheck` (tsc --noEmit) — 0 errors. `pnpm run build` — clean, 235/235 static pages generated, no route conflicts (261 route files: 85 pages + 176 API routes). `pnpm run lint` — 0 warnings/errors.

**2026-07-08 re-verification:** all three gates re-run clean with identical counts (176 API routes, 85 pages, no conflicts) — no drift since 07-07. Rather than transcribing this session's requested "BUILT" bullet list verbatim, re-read the actual source for two specific claims first: the geo-matching fallback chain and the CDC/SAMHSA data source. Both needed correction (see KB4 above) — the code itself was more limited/mislabeled than the existing doc text implied. Everything else in the Nights 3-7 section held up against a fresh independent audit and is unchanged.

---

## AUDIT COUNTS (live filesystem, 2026-07-06)

| Area | Count |
|---|---|
| Agent files (`src/lib/agents/*.ts`) | 45 root-level |
| Agent files (`src/lib/agents/research/*.ts`) | 12 in research/ subdirectory |
| **Total agent files** | **57** |
| API routes (`src/app/api/**/route.ts`) | **176** |
| Dashboard pages (`src/app/(dashboard)/**/page.tsx`) | **75** |
| Migration files (`supabase/migrations/*.sql`) | **68 files** (61 unique numbers, 7 duplicate-numbered pairs; highest applied: 066) |

Route count increased from 168 (July 3 audit) to 175 (July 6/7 session: 4 autoapply/follow-ups routes, 2 admin/suppression routes, /api/renewals) to **176** (07-07 pass: new `api/intelligence/recommendations/explain` route). Reconfirmed unchanged at 176 API routes / 85 pages on 2026-07-08. `pnpm tsc --noEmit` clean, `pnpm run build` clean (235/235 pages generated), `pnpm run lint` clean, no route conflicts.

---

## MIGRATIONS — FULL LIST

001 initial_schema · 002 phases_2_5 / register_organization · 003 onboarding · 004 research_cron · 005 browser_automation_agent_type · 006 email_matching_agent_type · 007 email_campaign_agent · 008 stripe_billing · 009 draft_versions · 010 opportunity_source_type · 011 search_profile_configuration · 012 opportunity_match_percentage · 013 alerts · 014 validations · 015 funder_intelligence · 016 renewals · 017 success_patterns · 018 email_activity · *(019 absent)* · 020 automation_sessions · 021 billing_tables · 022 fix_model_name / usage_tracking · 023 onboarding_step · 024 audit_logs · 025 fix_alerts · 026 fix_alerts_schema · 027 missing_columns · 028 increase_tokens · *(029–032 absent)* · 033 integration_keys · 034 custom_connections · 035 automation_queue · 036 automation_notifications · 037 giving_history · 038 intelligence_tables · 039 funder_relationship_agent · 040 competitor_intel_agent · 041 scraping_targets · 042 historical_awards · 043 opportunity_documents · 044 nofa_pdfs_bucket · 045 autoapply_tables · 046 foundation_directory · 047 worker_status · 048 grant_intelligence · 049 auto_queue_config · 050 funder_credentials · 051 submission_intelligence · 052 governance_layer / webhook_configs · 053 autoapply_missing_columns / multichannel_analytics · 054 email_calendar_integration / funders_contact_email · 055 admin_sales_outreach / sequence_enrollment_variables · 056 four_tier_admin_system · 057 draft_automation_pipeline · 058 backfill_opportunity_deadlines / lead_enrichment_system · 059 budget_patterns · 060 grantmaker_profiles · 061 corporate_giving_targets · 062 community_foundations · 063 white_label · 064 drop_orphaned_email_tables · 065 autoapply_follow_ups · 066 fix_autoapply_rls_policies

All migrations through 066 confirmed applied to production (ref vbjplpquqxxfbpazyalt). Live schema: 105 tables.

---

## AGENTS — FULL LIST WITH STATUS

### Root agents (src/lib/agents/, 45 files)

| File | Status | Notes |
|---|---|---|
| application-cloner.ts | REAL | Claude-backed clone; maxDuration=300 |
| automation-worker.ts | REAL | Queue worker; stale-item reaping, tier caps, optimistic-lock claim |
| base-agent.ts | REAL | Shared run/log/timeout infra |
| browser-automation.ts | REAL | Full Playwright orchestration; approval-gated before submit |
| budget-agent.ts | REAL | KB-grounded Claude budget generation + humanizer + persistence |
| budget-builder.ts | REAL | Simpler predecessor to budget-agent; real Claude call |
| cold-outreach.ts | REAL | fetch + Claude extraction + outreach_contacts insert |
| competitor-intel.ts | REAL | funder_giving_history read + Claude similarity analysis |
| compliance-checker.ts | REAL | Deterministic doc/profile checks + advisory Claude review |
| consensus-validator.ts | REAL | Dual-provider (Claude+Gemini) validation via Promise.allSettled |
| corporate-scraper.ts | PARTIAL | Real fetch+Claude+insert; target list is 5 hardcoded corporate URLs |
| custom-api.ts | REAL | Per-connection fetch/auth/mapping/dedupe; auto-pause after 3 failures |
| custom-scrape.ts | REAL | fetch + Claude extraction; auto-pause after 5 failures |
| deadline-extractor.ts | REAL | Deterministic, no AI; idempotent deadline/follow-up/renewal creation |
| deadline-prediction.ts | REAL | Annual/quarterly pattern detection over historical opportunities |
| eligibility-scorer.ts | REAL | Real Claude scoring; maxDuration=300 |
| email-campaign.ts | REAL | Full drip-campaign engine; tier/day caps; real Gmail send |
| email-parser.ts | REAL | Claude classification; real funder match; email_activity insert |
| final-assembly.ts | REAL | Document ordering, checklist, optional Claude cover letter |
| follow-up-generator.ts | REAL | 3-step Claude sequence; persisted as prefixed JSON in notes (no dedicated follow-ups table for this agent's output — separate from autoapply_follow_ups) |
| form-analyzer.ts | REAL | Playwright+Claude form/field mapping; broken on Vercel serverless |
| form-filler.ts | REAL | Playwright fill/submit/screenshot; broken on Vercel serverless |
| foundation-finder.ts | PARTIAL | Real fetch+Claude+insert; scrapes 2 hardcoded unverified-authority URLs |
| funder-intel.ts | REAL | Website fetch + Claude extraction + upsert into funder_intelligence |
| funder-relationship.ts | REAL | Deterministic scoring (no Claude); real DB read/upsert with decay math |
| giving-history.ts | REAL | ProPublica API call + upsert into funder_intelligence |
| grant-summary.ts | REAL | Optional page fetch + Claude extraction; never overwrites existing fields |
| grants-gov.ts | REAL | Legacy apply07.grants.gov REST API; real paginated search+detail |
| housing-specific-scrapers.ts | REAL | Real fetch of 3 named housing-funder URLs + Claude extraction |
| hud-monitor.ts | REAL | fetch of hud.gov funding-opps + Claude extraction + dedup insert |
| humanizer-agent.ts | REAL | One Claude call + deterministic regex-based style enforcement |
| nofa-parser.ts | REAL | PDF/HTML download + pdf-parse + Storage upload + Claude extraction |
| playwright-agent.ts | REAL | Full Playwright automation + Claude field detection; approval gate before submit |
| propublica.ts | REAL | ProPublica org-lookup/search; rate-limited; no API key needed |
| recursive-learning.ts | REAL | Claude extraction, proven_narratives upsert, effectiveness rescoring |
| review-agent.ts | REAL | DB reads + Claude review call + persisted note |
| sam-gov.ts | REAL | Paginated SAM.gov calls; caller-supplied API key |
| scheduler.ts | REAL | Deterministic cadence helpers + real agent_runs/search_profiles read/write |
| semantic-matching.ts | REAL | DB reads + Claude ranking call; maxDuration=300 |
| simpler-grants.ts | REAL | POST to Simpler Grants API + insert with dedup |
| state-portal.ts | PARTIAL | Real pipeline; PORTAL_REGISTRY is Texas-only — all other states throw "unsupported_state" |
| state-scrapers.ts | REAL | Real fetch of 5 named state housing-agency URLs + Claude extraction |
| success-probability.ts | REAL | Deterministic 6-factor scoring from real DB joins; no Claude |
| tdhca-scraper.ts | REAL | Real fetch of 2 tdhca.state.tx.us pages + Claude extraction |
| usaspending.ts | REAL | POST to USAspending API + upsert into historical_awards |

### Research subagents (src/lib/agents/research/, 12 files)

| File | Status | Notes |
|---|---|---|
| agent-configs.ts | REAL | Registry wiring 8 real research lanes to real agent classes |
| corporate-giving.ts | REAL | Full search→fetch→Claude→dedupe→insert→eligibility-score pipeline |
| deduplicator.ts | REAL | Two real dedup passes (exact URL + fuzzy Jaccard name/funder) |
| focus.ts | REAL | Types + query-suffix helper |
| foundation-grants.ts | REAL | Same real pipeline; LOI/cycle notes regex-detected from page text |
| government-grants.ts | REAL | Same pipeline + real CFDA/NOFO regex extraction |
| local-sponsorship.ts | REAL | Real pipeline + ColdOutreachAgent integration |
| orchestrator.ts | REAL | Promise.allSettled across 8 lanes, cross-lane DB dedup, Gemini consensus pass — no mock data |
| result-parser.ts | REAL | Claude extraction with strict never-fabricate prompt + confidence scoring |
| scheduler.ts | REAL | Real reads/writes of search_profiles (active selection, exclusions, last_run_at) |
| search-engine.ts | REAL | Grants.gov REST call genuine; Google/"Foundation Directory" HTML scrape is bot-blockable |
| web-fetcher.ts | REAL | fetch with timeout/backoff/retry, per-domain rate limit, real research_cache |

---

## API ROUTES — FULL LIST

### agents/ (42 routes)
`agents/application-cloner` · `agents/automation` · `agents/automation/[sessionId]` · `agents/automation/[sessionId]/approve` · `agents/campaigns` · `agents/campaigns/[campaignId]` · `agents/competitor-intel` · `agents/corporate-research` · `agents/custom-api` · `agents/custom-scrape` · `agents/deadline-prediction` · `agents/eligibility` · `agents/email-parser` · `agents/follow-up` · `agents/form-analyzer` · `agents/form-filler` · `agents/foundation-finder` · `agents/funder-intel` · `agents/funder-relationship` · `agents/giving-history` · `agents/grants-gov` · `agents/housing-specific` · `agents/hud-monitor` · `agents/keyword-expansion` · `agents/learning` · `agents/nofa-parser` · `agents/outreach` · `agents/playwright` · `agents/propublica` · `agents/research` · `agents/research/quality` · `agents/research/status` · `agents/research-config` · `agents/sam-gov` · `agents/semantic-matching` · `agents/simpler-grants` · `agents/state-portals` · `agents/state-scrapers` · `agents/success-probability` · `agents/tdhca` · `agents/usaspending`

### ai/ (8 routes)
`ai/budget` · `ai/draft` · `ai/draft/rescore` · `ai/fit-analysis` · `ai/humanize` · `ai/review` · `ai/summarize` · `ai/validate`

### autoapply/ (21 routes)
`autoapply/ab-tests` · `autoapply/agreements` · `autoapply/agreements/[id]` · `autoapply/config` · `autoapply/controls` · `autoapply/documents` · `autoapply/documents/readiness` · `autoapply/follow-ups` · `autoapply/follow-ups/[id]` · `autoapply/follow-ups/cancel-all/[funderId]` · `autoapply/follow-ups/stats` · `autoapply/profiles` · `autoapply/profiles/[id]` · `autoapply/queue` · `autoapply/templates/test` · `autoapply/usage` · `autoapply/usage/keys` · `autoapply/webhooks`

### automation/ (4 routes)
`automation/portal-credentials` · `automation/process` · `automation/queue` · `automation/stats`

### admin/ (15 routes)
`admin/audit-log` · `admin/autoapply-ops` · `admin/campaigns` · `admin/campaigns/[id]` · `admin/domains` · `admin/domains/[id]` · `admin/prospects` · `admin/prospects/[id]` · `admin/prospects/stats` · `admin/sales-analytics` · `admin/sales-analytics/export` · `admin/suppression` · `admin/suppression/import` · `admin/usage` · `admin/webhooks/email-events` · `admin/webhooks/email-reply`

### intelligence/ (12 routes)
`intelligence/benchmarks` · `intelligence/briefing` · `intelligence/budget-patterns` · `intelligence/compliance` · `intelligence/evaluation` · `intelligence/grant-dna` · `intelligence/ingest` · `intelligence/logic-model` · `intelligence/need-data` · `intelligence/recommendations` · `intelligence/search` · `intelligence/stats`

### email/ (15 routes)
`email/analytics` · `email/auth` · `email/callback` · `email/contacts` · `email/link` · `email/send` · `email/sequences` · `email/sequences/[id]` · `email/sequences/[id]/analytics` · `email/sequences/[id]/enroll` · `email/summarize` · `email/sync` · `email/templates` · `email/templates/generate` · `email/threads`

### integrations/ (11 routes)
`integrations/custom-api` · `integrations/custom-api/[id]` · `integrations/custom-api/test` · `integrations/google` · `integrations/google/callback` · `integrations/google/calendar` · `integrations/google/calendar/sync` · `integrations/google/sync` · `integrations/keys` · `integrations/scraping-targets` · `integrations/scraping-targets/[id]`

### calendar/ (3 routes)
`calendar/auth` · `calendar/callback` · `calendar/sync`

### cron/ (10 routes)
`cron/autoapply` · `cron/campaigns` · `cron/domain-warmup` · `cron/draft-automation` · `cron/draft-queue-check` · `cron/email-sequences` · `cron/follow-ups` · `cron/reminders` · `cron/research` · `cron/sales-sends`

### drafts/ (5 routes)
`drafts/queue` · `drafts/queue/[id]` · `drafts/queue/config` · `drafts/queue/stats` · `drafts/queue/trigger`

### billing/ (3 routes)
`billing` · `billing/check-gate` · `billing/usage`

### grants/ (3 routes)
`grants` · `grants/[id]` · `grants/[id]/rescore`

### webhooks/ (2 routes)
`webhooks/resend` · `webhooks/stripe`

### Remaining (21 routes)
`alerts` · `audit` · `auth/callback` · `auth/log-event` · `autoapply/agreements` *(see above)* · `compliance` · `compliance/check` · `deadlines/check` · `documents/assemble` · `documents/quota` · `funders/import` · `nav-counts` · `notifications` · `onboarding` · `onboarding/generate-narratives` · `outreach/humanize-step` · `outreach/send` · `platform/bootstrap` · `renewals` · `reports/board` · `settings/integrations/status` · `unsubscribe` · `users` · `users/accept` · `users/invite`

---

## DASHBOARD PAGES — FULL LIST (75 pages)

**Admin (3):** admin/audit-log · admin/autoapply-ops · admin/sales-outreach

**AutoApply (15):** autoapply/ · autoapply/[sessionId] · autoapply/agreements · autoapply/analytics · autoapply/automation-settings · autoapply/compliance · autoapply/controls · autoapply/documents · autoapply/follow-ups · autoapply/profiles · autoapply/recordings · autoapply/settings · autoapply/templates · autoapply/usage · autoapply/webhooks

**Draft Generator (3):** draft-generator/ · draft-generator/[id] · draft-generator/queue

**Applications (4):** applications/ · applications/[id] · applications/list · applications/new

**Opportunities (3):** opportunities/ · opportunities/[id] · opportunities/new

**Funders (4):** funders/ · funders/[id] · funders/import · funders/new

**Email (4):** email/ · email/campaigns/ · email/campaigns/[id] · email/templates

**Contacts (3):** contacts/ · contacts/[id] · contacts/new

**Outreach (3):** outreach/ · outreach/campaigns/ · outreach/campaigns/[id]

**Intelligence (7):** intelligence/ · intelligence/competitors · intelligence/matches · intelligence/recommendations · intelligence-library/ · intelligence-library/dashboard

**Knowledge Base (5):** knowledge-base/ · knowledge-base/answers · knowledge-base/narratives/ · knowledge-base/narratives/[id] · knowledge-base/profile

**Settings (5):** settings/ · settings/branding · settings/custom-apis · settings/integrations · settings/scraping

**Search Profiles (2):** search-profiles/ · search-profiles/configure

**Remaining (17):** alerts · billing · dashboard · deadlines · documents · financials · follow-ups · foundations · notifications · onboarding · outcomes/ · outcomes/analytics · renewals · reports · research

---

## FEATURE READINESS

### READY

**Research Agents** — Real multi-lane orchestrator runs 8 lanes in parallel via Promise.allSettled, real dedup, real Gemini consensus pass. External API clients for grants.gov, SAM.gov, ProPublica, USAspending, Simpler Grants are all live. Caveats: Google-HTML-scraped search fallback is bot-blockable; corporate-scraper/foundation-finder/state-scrapers use small hardcoded target-URL lists; state-portal only supports Texas.

**Draft Generator** — Real Claude Sonnet calls with RAG/rubric/logic-model/budget augmentation. Real rule-based template selection. Real queue engine. All AI routes have maxDuration=300.

**AutoApply (core path)** — Core approval-gated browser automation (StealthBrowser, BrowserAutomationAgent, AutomationSessionManager) is real and correctly gates human approval before submit via `api/automation/process`. Follow-Ups page is fully functional (routes + migration 065 table). Worker (queue-processor.ts) correctly creates and approves a real automation_sessions row per submission before calling fillAndSubmit(). form_templates/autoapply_submissions/submission_queue RLS policies fixed (migration 066).

**Email Hub** — Real Gmail OAuth + incremental sync engine, real Resend/Gmail sending, real thread linking and AI summarization. Thread "Link" button auto-links via a real API call.

**Sales Outreach** — Frontend calls real `/api/admin/*` paths with correctly reconciled response shapes. New Campaign form collects all required fields. Multi-step campaign sequences advance past step 1. Admin suppression list management (GET/POST /api/admin/suppression + import) is live. Gap: no prospect-list picker endpoint (list ID is manual text entry). Per-domain reply-rate analytics not available from the real endpoint (bounce rate shown instead).

**Platform Admin** — Bootstrap endpoint self-disables (403) once a platform_owner exists. Admin pages (autoapply-ops, audit-log, sales-outreach) are real and working.

**Email Sequences / Campaigns** — Real Resend-based drip engine; real tier/day caps; reply and unsubscribe detection wired.

**Billing/Stripe** — Real checkout sessions, billing portal, webhook signature verification, idempotent webhook processing, owner-only access enforcement. Tier-limit tables are now consistent (usage-limiter.ts derives from constants.ts). Gap: no Stripe Price IDs are set in Vercel production yet — tier resolution is structurally correct but unconfigured.

**Calendar Integration** — Two independent, both-functional Google Calendar OAuth flows (org-level and per-user). HMAC state-signing extracted into shared oauth-state.ts. Real bidirectional Calendar sync. Real 14/30/60-day reminder engine.

**Onboarding** — Full 7-step wizard, real Claude-generated narratives with placeholder fallback on parse failure, idempotent dedup logic, real table writes throughout.

**Intelligence Library / Need Statement** — Real fan-out across 9 KB types. Real BLS/CDC/Census/HUD data fetches + Claude narrative. HUD homeless-count fetcher now correctly discovers and parses the real CSV link. Full KB4-9 breakdown verified this pass — see below.

**Intelligence Library KB4-9 (verified 2026-07-07, file-level audit)**

- **KB4 Need Statement Database** — `src/lib/intelligence/sources/{census,hud,bls,cdc}-api.ts` (170-239 lines each) make real `fetch()` calls to Census ACS5, HUD FMR/CHAS/PIT CSV, BLS, and CDC endpoints with real parsing and citation generation, not stubs. `need-statement-engine.ts` does geo fallback but only **county→state**, not the full zip→county→state→national chain the spec describes — confirmed 2026-07-08 by reading the code directly, which admits this in its own comment. Also confirmed 2026-07-08: the "SAMHSA" data point is really a CDC BRFSS alcohol-module dataset, not a SAMHSA NSDUH source — no true SAMHSA integration exists. `scripts/ingest-census-data.ts` and `scripts/ingest-hud-data.ts` are real ingestion scripts. Backing table `intelligence_need_data` (migration 048).
- **KB5 Budget Pattern Library** — `budget-patterns.ts` (367 lines) is real, backed by `intelligence_budget_templates` (048) + `intelligence_budget_patterns` (059). Confirmed wired into `src/lib/drafts/generator.ts`.
- **Compliance Requirements** — `compliance-library.ts` (251 lines) + `data/compliance-requirements.ts` (352 lines, 22 entries covering SAM.gov/UEI/2 CFR 200/OMB, HUD CDBG/HOME/ESG/HOPWA/CoC). Real document/data/attestation checks, wired into the draft generator and unified search. This KB is code-defined (static data file), not DB-backed — no `intelligence_compliance_*` table exists or is needed. Known bug: `omb-a133-threshold` check has a dead branch that always returns 'pass' (existing gap #11 below).
- **KB7 Evaluation Framework Library** — `evaluation-library.ts` (269 lines) + `data/evaluation-templates.ts` (975 lines, ~91 named KPIs across 7 program categories) — exceeds the "50+ KPI" target. Wired into the draft generator. Table `intelligence_evaluation_frameworks` (048) exists but is not written to by any ingestion script — the live KPI data is a static TypeScript file, not DB rows.
- **KB8 Grantmaker Intelligence** — `funder-recommender.ts` (165 lines): `recommend()` queries real `intelligence_grantmaker_profiles` rows and computes a genuine weighted score (geo 30% / program match 30% / amount fit 20% / giving-activity proxy 20%) with human-readable match reasons — not hardcoded. `explainMatch()` calls Claude for narrative explanation, exposed via the new `api/intelligence/recommendations/explain` route. `intelligence/recommendations` page renders it. `outcome-benchmarks.ts` uses a static lookup table (`data/outcome-benchmarks.ts`), not yet DB-backed, but with real comparison logic. `scripts/build-grantmaker-profiles.ts` (168 lines) is real. Table extended by migration 060.
- **KB9 Grant DNA Scoring** — `grant-dna.ts` (188 lines): real 8-dimension Claude-based scoring (clarity, evidence density, outcome specificity, funder alignment, innovation, sustainability, feasibility, impact scope), category-weighted (default/federal/corporate), benchmarked against hardcoded category averages. `GrantDNACard.tsx` has a real Recharts radar chart + expandable improvement suggestions. **Gap:** `intelligence_grant_dna_scores` (048) is never referenced in `src/` — scores are computed live per-request via `/api/intelligence/grant-dna` and not persisted. The spec's "score every ingested proposal" batch pipeline does not exist.
- **Cross-Library Integration** — `unified-search.ts` (421 lines) genuinely queries all 9 KB types (vector RPC for proposals/rubrics, direct table queries for grantmakers, static-data lookups for budget/eval/compliance/benchmarks). `api/intelligence/briefing` implements real tier-gating (free/starter/professional/enterprise/consultant → different `RelatedIntelligence` sections), rendered by `IntelligenceBriefingPanel.tsx` with upgrade messaging. Coverage heat map is real (`intelligence-library/dashboard/page.tsx`, "Coverage by Program Category" chart), not a placeholder.
- **Not implemented despite schema existing** — `intelligence_narrative_patterns` and `intelligence_post_award_reports` (both defined in migration 048) have zero references anywhere in `src/`: no ingestion script writes to them, no read path queries them. No foundation-website-scraping ingestion script and no IRS-990-grants-made extraction script exist for the intelligence library specifically (an unrelated `src/lib/enrichment/sources/irs990.ts` serves a different, non-intelligence feature).

**Encryption** — Every credential/token store uses AES-256-GCM (Google OAuth tokens, portal automation credentials, funder credentials, custom API keys, BYO Anthropic/OpenAI keys). All four hardcoded fallback secrets removed (throw if env var missing). All four guard env vars set in Vercel production.

**Resend Webhook** — Real Svix-format HMAC-SHA256 verification; fails closed (500 if RESEND_WEBHOOK_SECRET unset, 401 on bad signature).

**Role / Auth Model** — middleware.ts protects every route (public allowlist: `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/api/auth/*`, `/invite*`, `/api/users/accept`). requireRole() in lib/auth/role-gate.ts re-derives profile per request (defense in depth). Platform roles: owner / admin / writer / viewer (not the contracts' admin/member/viewer — live model is the authoritative one).

**Grants API** — /api/grants* routes operate on the `opportunities` table via a documented field-mapping layer (lib/grants/grants-service.ts). No `grants` table exists.

**Source Type** — Physical `opportunities.source_type` (migration 010) drives UI tabs/badges/agents. The grants API's `category` alias is a separate concept. These two enums are not interchangeable.

### PARTIALLY READY

**AutoApply Playwright Routes** — `api/agents/form-analyzer`, `api/agents/form-filler`, and `api/autoapply/templates/test` require a Chromium binary unavailable on Vercel serverless. These routes only work against a separate worker process. That worker process is not deployed to Railway. The `form-analyzer-agent.ts` stub was replaced with real Claude-based logic in the July 3 session; the Vercel/Chromium constraint is a deployment issue, not a code issue.

**BYO API Keys** — Keys are encrypted at rest; shouldUseOwnKeys() reads the correct table and decrypts. The AutoApply usage page still shows a fixed masked placeholder rather than the real `****last4` hint. Functional but display is cosmetically incomplete.

**Custom API Integration** — `api/agents/custom-api` queues a pending row; it relies on an unverified separate poller to execute. The poller is not confirmed deployed.

**Enrichment Sources** — `irs990.ts` depends on a local-only XML directory (`IRS_990_XML_DIR`) — dead on Vercel. SearXNG throws if `SEARXNG_URL` unset (DuckDuckGo fallback functional). `website-scraper.ts` Playwright fallback silently no-ops if Chromium unavailable.

**Data Freshness** — Census/BLS data sources use hardcoded 2022-2023 vintage years. `FUNDED_BENCHMARKS`/`FRINGE_RATES` tables are self-labeled approximations.

### NOT READY / BLOCKED

**Resend Outbound Email** — Neither `RESEND_WEBHOOK_SECRET` nor `RESEND_API_KEY` are set in Vercel production. Outbound email sending and the inbound webhook are likely non-functional in production until these are configured.

**Stripe Tier Resolution** — No Stripe Price ID vars (`STRIPE_STARTER_PRICE_ID`, `STRIPE_PROFESSIONAL_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`, `STRIPE_CONSULTANT_PRICE_ID`) set in Vercel. Tier plan resolution is structurally correct but non-functional.

~~**NIH Proposals Ingestion**~~ — Fully implemented 2026-07-06. Real NIH Reporter API v2 integration: rotates 7 search terms by day-of-year, POSTs to `https://api.reporter.nih.gov/v2/projects/search`, deduplicates by `nih:{appl_id}` source key, calls `extractSections()` + `generateEmbedding()`, inserts into `intelligence_funded_proposals` + `intelligence_proposal_sections`.

---

## KNOWN GAPS AND OPEN ITEMS

### Operational (production-blocking)
1. **RESEND_API_KEY** not set in Vercel production — outbound email (campaigns, follow-ups, digests) non-functional.
2. **RESEND_WEBHOOK_SECRET** not set in Vercel production — inbound webhook 500s on every real Resend event.
3. **Stripe Price ID vars** not set in Vercel — billing tier selection unconfigured.
4. **Railway worker not deployed** — AutoApply Playwright routes (form-analyzer, form-filler, templates/test) require a Chromium worker process that isn't running anywhere in production.

### Code (non-blocking but should be fixed)
~~5. **`session-manager.ts` markAutoSubmitted()**~~ — Fixed 2026-07-06: `approved_by` is now set to `null` (valid for uuid); automation level recorded in `notes: auto_submitted:<level>` instead.
6. **Local `.env.local`** missing the 4 encryption vars added to Vercel on 2026-07-03 (`INTEGRATION_KEY_SECRET`, `PORTAL_ENCRYPT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `UNSUBSCRIBE_HMAC_SECRET`). Local dev throws on Google OAuth connect, portal-credential save, custom API key add, and unsubscribe-link generation until pulled (`vercel env pull .env.local`).
7. **`NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL`** used interchangeably in different files — should be consolidated to one variable.
~~8. **`api/agents/campaigns`**~~ — Fixed 2026-07-06: `maxDuration=300` added.
~~9. **`api/agents/custom-scrape`**~~ — Fixed 2026-07-06: `maxDuration=300` added.
10. **`api/integrations/custom-api/test`** is an SSRF-adjacent surface — unrestricted server-side fetch to admin-supplied URL with no allowlist.
11. **`compliance-library.ts`** has a dead branch: `omb-a133-threshold` check always returns 'pass' due to a logic error.
~~12. **`ingest-nih-proposals.ts`**~~ — Fully implemented 2026-07-06 (real NIH Reporter API v2).
13. **Visual: elongated input/textarea boxes** reported across the platform — UI polish queue passed compile but visual results unverified.
~~19. **`scripts/seed-beta-users.ts` broke Vercel production builds**~~ — Fixed 2026-07-07: `ws` transport cast tightened (`as unknown as typeof WebSocket`) and `scripts/` added to `tsconfig.json` exclude so one-off utility scripts can never again fail the app type-check.

### Architecture / maintenance
14. **Two Grants.gov clients** (`grants-gov.ts` using legacy `apply07.grants.gov` REST API, and `simpler-grants.ts` using the newer `api.simpler.grants.gov/v1`) both live side-by-side — confirm the legacy endpoint hasn't been deprecated upstream.
15. **Hardcoded target-URL lists** in corporate-scraper, foundation-finder, state-scrapers, housing-specific-scrapers — will go stale without monitoring.
16. **state-portal.ts** — PORTAL_REGISTRY is Texas-only; all other states throw "unsupported_state" despite the agent being framed as general.
17. **Prospect-list picker endpoint missing** — New Campaign form in Sales Outreach requires a `list_id`, but there's no endpoint to browse available lists; list ID is a manual text field.
18. **research/page.tsx** uses a manual `SOURCE_ROUTE_MAP` — same fragile pattern that produced the sales-outreach routing bug; worth linting.
20. **`teal-*` Tailwind classes** (508 occurrences, 129 files) intentionally left untouched in the 2026-07-07 design-system pass — `teal-500`/`600` numerically equal the new `accent`/`accent-hover` tokens and `globals.css`'s compat layer already coerces `text-teal-600/700` to WCAG-safe hex, so it's low-severity, but it's real debt: those files reference Tailwind's hue scale instead of the semantic tokens directly, and a future Tailwind theme change could silently break them.
21. **`src/app/(dashboard)/intelligence/recommendations/page.tsx`** has an in-progress, uncommitted org-summary-card + geography-filter feature (found already in the working tree, unrelated to the design-system pass — only color classes were touched, not that feature's structure/logic). ~~The whole page was also still on the old dark theme~~ — fully converted to light tokens 2026-07-07 (was a separate finding from the feature-code issue).
~~22. **Opportunities table/card/detail `Category` and `Source` badges** collapsed to indistinguishable colors after the first design-system pass~~ — Fixed 2026-07-07: `Category`→`neutral`, `Source`→always `info` (was 8 colors for a nominal field). Two genuinely-missed raw pills (`autoapply/settings` geo chip, `research/page.tsx` stage pill) also converted.
~~23. **`DashboardShell.tsx`'s `<main>` had no background class**, inheriting the shell's `bg-surface` (white) — every dashboard page's content area rendered on white instead of the `#EEF2F7` page background~~ — Fixed 2026-07-07, one-line fix at the layout level (`bg-background` on the shell + `<main>`), applies to every page automatically.
~~24. **`src/components/ui/Card.tsx` and `Modal.tsx` still had `bg-ink-700/60`/`bg-ink-800` (a genuinely dark legacy scale), `glow-border`, `backdrop-blur-md`, and dark-tuned `shadow-card`**~~ — Fixed 2026-07-07. This was the actual root cause behind "Details/Funding panels still look dark" reports — `Card` alone has 72 call sites across the app. Neither of the two prior design passes' greps covered this codebase's custom `ink-*` scale (they checked Tailwind's default gray/slate/zinc/neutral + literal hex only). Also fixed the same copy-pasted pattern in `RubricPanel.tsx`, `AnalyticsDashboard.tsx`'s `StatCard`, `GrantDNACard.tsx` (fully rewritten, was designed for the dark `ink-700` bg that no longer exists), `LogicModelView.tsx` (fully rewritten, same reason), and a `bg-navy-900` wrapper in `draft-generator/page.tsx` around `LogicModelView`.
~~25. **`src/components/ui/Button.tsx`'s `secondary`/`ghost` variants were near-invisible** (`border-white/15 bg-white/5 text-navy-100` / `text-navy-300 hover:text-white`) — dark-theme leftovers, used 246× across 86 files~~ — Fixed 2026-07-07: `secondary` initially became `bg-surface text-primary border border-primary/40 hover:bg-primary/5`, then rebuilt again same day (intensity pass) to `bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200` — a genuinely distinct gray chip rather than a primary-tinted outline. `ghost` = `text-primary hover:bg-primary/10`. Unused `purple` variant removed.
26. **Pre-existing 400 console errors** observed on `/opportunities`-adjacent client-side calls during Playwright verification (2026-07-07) — no matching entries in the Next.js server log, so likely a direct Supabase client-side query issue. Not investigated; unrelated to any change in this pass (no data-fetching/query code touched).
27. **No shared page-header component existed before 2026-07-07** — ~70 dashboard pages each hand-roll their own `<h1>`/`<p>`/action-button block. `src/components/layout/PageHeader.tsx` created and applied to the 5 pages verified in the intensity pass (`dashboard`, `research`, `opportunities`, `intelligence-library`, `autoapply`); the remaining ~65 pages still use the old bare-`<div>` header with no white band — not a regression, just not yet migrated. Good candidate for a future dedicated sweep, same pattern as the Button/Card fixes.
28. **Research and Intelligence Library pages hand-roll their own `<table>` markup** instead of using the shared `Table` component (`src/components/ui/Table.tsx`) — discovered during the intensity pass audit. Each had drifted to a different ad-hoc class convention (gray-\* vs navy-\*, `px-4 py-3` vs `py-3 pr-4`, thead-text-on-`<tr>` vs on-`<th>`). Brought all 5 hand-rolled tables in line with the shared component's header/divider/hover convention, but they remain separate implementations — a true refactor to the shared `Table` component (which would also gain sorting/pagination for free) is future work.
29. **`intelligence_grant_dna_scores` table is defined (migration 048) but never written to** — Grant DNA scores are computed live per API call and shown in the UI, but nothing persists them, so there is no "benchmark your draft against every scored proposal" history and no way to track a draft's score over successive revisions.
30. **`intelligence_narrative_patterns` and `intelligence_post_award_reports` tables are defined (migration 048) but have zero code references** — no ingestion script populates them, no route or component reads them. The corresponding spec features (winning-pattern extraction, post-award outcome mining) do not exist yet, only their schema.
31. **No foundation-website-scraping or IRS-990-grants-made ingestion scripts exist for the intelligence library** — `intelligence_grantmaker_profiles` is populated by `scripts/build-grantmaker-profiles.ts` from `foundation_directory` data already in the DB, not from a dedicated website-scrape or 990 grants-made extraction pipeline as described in GRANT_INTELLIGENCE_ARCHITECTURE.md §3.6/§8.
~~32. **`src/app/globals.css`'s global `textarea { max-height: 120px }` base style silently clamped the draft-generator's main editor** — the textarea had `rows={20}` in the JSX (a hint, not a hard height) but the CSS `max-height` won regardless, rendering ~5 visible rows with dead space below on a card that visually should have filled the viewport~~ — Fixed 2026-07-07: the draft editor's textarea gets an explicit `max-h-none` override (Tailwind class beats the element-selector base rule on specificity) plus `min-h-[55vh] flex-1`; `Card.tsx`'s body wrapper made unconditionally `flex-1` (inert elsewhere) so a `flex flex-col` `Card` genuinely stretches to match its CSS Grid row's height. The global 120px clamp itself was left in place — other small textareas (Mission Statement, etc.) still want it; this was a single-component override, not a global rule change.
33a. **Need-statement geo fallback is county→state only, not zip→county→state→national** (found 2026-07-08) — `need-statement-engine.ts:41-42` documents this itself in a code comment; no zip-level or national-level fallback exists in `census-api.ts`/`hud-api.ts`/`bls-api.ts`/`cdc-api.ts`.
33b. **CDC/SAMHSA labeling is wrong in `cdc-api.ts`** (found 2026-07-08) — `fetchSubstanceAbuseData()`'s comment claims "SAMHSA NSDUH state estimates" but the query hits CDC's own BRFSS alcohol-module Socrata dataset (`dttw-5yxu`), not any SAMHSA source. No real SAMHSA API integration exists anywhere in the codebase.
33. **`ColorIcon` categorical hue system added** (`src/components/ui/ColorIcon.tsx`) — cyan/emerald/blue/amber/violet/indigo/rose, one per function (opportunities, money, documents, deadlines, analytics, applications, alerts). Uses raw Tailwind hue classes including violet/rose, a deliberate, documented exception to the intensity pass's "no purple/violet brand accents" rule — these are nominal/categorical colors for icon-chip scanning, not brand accents. Applied to dashboard `MetricCard`s (+ matching `border-l-4`), `TemplateSelector`'s 6 template cards, Research's 9 source cards, and Intelligence Library's 5 stat tiles. Not yet applied anywhere else in the app — a future consistency sweep could extend it, but wasn't asked for beyond these four surfaces.

---

## ENVIRONMENT

- **Stack:** Next.js 14, Supabase, Vercel Pro, TypeScript 5.6, pnpm 9.0
- **Key dependencies:** `@anthropic-ai/sdk ^0.30.1`, `openai ^6.44.0` (Gemini), `@supabase/supabase-js ^2.45.4`, `stripe ^22.2.0`, `resend ^6.12.4`, `googleapis ^173.0.0`, `playwright ^1.60.0`, `@react-pdf/renderer ^4.1.1`
- **Supabase project:** vbjplpquqxxfbpazyalt (105 tables, migrations 001–066 applied)
- **Vercel:** benavora.vercel.app (Pro), 5 configured crons
- **Platform owner:** info@faithfoundation.org (bootstrapped, bootstrap endpoint now self-disabled)
- **Auth model:** profiles + owner/admin/writer/viewer roles (contracts reference admin/member/viewer — that is aspirational, not the live model)
- **Tests (2026-07-06):** Vitest passing (`.env.test` added for secrets; compliance + logic-model tests fixed). tsc --noEmit 0 errors. pnpm build clean. Playwright: 27 passing before this session's selector fixes; ~40+ additional fixes applied (dashboard labels, deadlines Month button, documents upload zone, pipeline kanban switch, onboarding wizard text, automation autoapply page, research Command Center, ui-redesign sidebar items). Security page added at `/security` with marketing nav link.
- **New files (2026-07-06):** `.env.test` (Vitest secrets), `src/app/(marketing)/security/page.tsx`
- **Brand tokens (2026-07-07):** `tailwind.config.ts`'s own color/gradient/shadow definitions (previously still the old dark purple/emerald/teal-green theme underneath the `globals.css` compat layer) rewritten to the live navy `#0077B6` / cyan `#00B4D8` brand — `accent`/`cta` tokens, the legacy `teal` and `plum` 50–950 scales, `gradient-accent`/`gradient-brand`/`gradient-cta`/`gradient-purple`, and `shadow-glow`/`glow-accent`/`glow-blue`. Root layout: dropped `className="dark"` from `<html>`, `themeColor` `#0a0a1a→#0077B6`. tsc --noEmit clean; pnpm build clean.
- **Self-hosted fonts (2026-07-07):** `next/font/google` fetches Inter/JetBrains Mono from `fonts.googleapis.com` at build time, which times out in this environment. Replaced with `next/font/local` in `src/app/layout.tsx`, sourcing latin variable-weight woff2 files copied from the `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` packages into `public/fonts/`. Same `--font-sans`/`--font-mono` CSS variables and weight ranges preserved — no other file changed. `pnpm run build` now completes with zero external font network requests.

## VERCEL CRON SCHEDULE

| Route | Schedule |
|---|---|
| /api/cron/research | 0 6 * * * (daily 6am) |
| /api/cron/reminders | 0 8 * * * (daily 8am) |
| /api/cron/campaigns | 0 */2 * * * (every 2h) |
| /api/cron/autoapply | 0 2 * * * (daily 2am) |
| /api/cron/domain-warmup | 0 6 * * * (daily 6am) |

Note: vercel.json applies a global maxDuration=60 to `api/agents/**` — individual routes that need 300s override this with `export const maxDuration = 300`. All AI-calling routes have been verified to set 300s. `api/ai/**` routes get 300s from the global config. `api/cron/**` routes get 120s from the global config.

## Production Sync 2026-07-09 14:19
- Migrations 067-074 ALL applied to production Supabase (vbjplpquqxxfbpazyalt) via Management API
- Commit 03cb3ab pushed: DD Phases 2+3, enrichment pipeline, onboarding soft-gate (11/11 FORGE gates)
- NOT YET RUN: pnpm seed:dd-taxonomy, pnpm enrich:990, pnpm enrich:web, DATAOCEAN backup, DD smoke test
- Railway status of 03cb3ab UNVERIFIED; RESEND_API_KEY still unset on both platforms

