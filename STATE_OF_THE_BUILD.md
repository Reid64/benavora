# BENAVORA — STATE OF THE BUILD
## Last updated: 2026-07-07 (design: purge dark surfaces, fix button visibility, verified via screenshots)
## Method: live codebase audit — every file path, route, agent, and migration counted directly from the filesystem; no assumptions carried from prior docs.

---

## AUDIT COUNTS (live filesystem, 2026-07-06)

| Area | Count |
|---|---|
| Agent files (`src/lib/agents/*.ts`) | 45 root-level |
| Agent files (`src/lib/agents/research/*.ts`) | 12 in research/ subdirectory |
| **Total agent files** | **57** |
| API routes (`src/app/api/**/route.ts`) | **175** |
| Dashboard pages (`src/app/(dashboard)/**/page.tsx`) | **75** |
| Migration files (`supabase/migrations/*.sql`) | **68 files** (61 unique numbers, 7 duplicate-numbered pairs; highest applied: 066) |

Route count increased from 168 (July 3 audit) to 175 because 7 new routes were added that session: 4 autoapply/follow-ups routes, 2 admin/suppression routes, and /api/renewals.

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

**Intelligence Library / Need Statement** — Real fan-out across 9 KB types. Real BLS/CDC/Census/HUD data fetches + Claude narrative. HUD homeless-count fetcher now correctly discovers and parses the real CSV link.

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
~~25. **`src/components/ui/Button.tsx`'s `secondary`/`ghost` variants were near-invisible** (`border-white/15 bg-white/5 text-navy-100` / `text-navy-300 hover:text-white`) — dark-theme leftovers, used 246× across 86 files~~ — Fixed 2026-07-07: `secondary` = `bg-surface text-primary border border-primary/40 hover:bg-primary/5` (always visibly bordered), `ghost` = `text-primary hover:bg-primary/10`. Unused `purple` variant removed.
26. **Pre-existing 400 console errors** observed on `/opportunities`-adjacent client-side calls during Playwright verification (2026-07-07) — no matching entries in the Next.js server log, so likely a direct Supabase client-side query issue. Not investigated; unrelated to any change in this pass (no data-fetching/query code touched).

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
