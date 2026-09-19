# BENAVORA — STANDING DIRECTIVES
## Version: 1.0 | Issued: July 16, 2026
## Authority: Founder directive. Supersedes prior scope limitations on these topics.
## Status: PERMANENT — These are not sprint items. They are continuous build obligations.

---

## Directive 1: Foundation Lead Maximum Enrichment

**Objective:** Every record in `foundation_directory` (133,812 records) must be enriched to the highest possible fidelity from every available free and open-source data source. No record left at stub quality. This is a continuous pipeline, not a one-time run.

**Current State:** Infrastructure built (engine, sources, scripts). Never fully executed. IRS 990 parser has confirmed EIN column bug (position 2, parser reads wrong column). ProPublica abandoned at 0% hit rate (incorrect). Web enrichment never run at scale.

**Mandatory Enrichment Sources (waterfall order):**
1. IRS 990 e-file XML — EIN, assets, revenue, grants made, officers, website, fiscal year
2. IRS BMF CSV — NTEE code, ruling date, subsection code, foundation type
3. ProPublica Nonprofit Explorer API — financials, filings history, NTEE, exec compensation
4. Candid/GuideStar public data — mission, programs, focus areas (no auth required on public endpoints)
5. Foundation website scraper — contact pages, emails, phones, officer names, giving priorities
6. OpenCorporates — registered agent, state filing data, incorporation date
7. Wikipedia/Wikidata — for major foundations (assets > $100M)
8. Google Maps Places API (key: AIzaSyA3sJ1vkNp1AvPLfKY_5uaiJK0FBiwjlt0) — address verification, phone
9. SEC EDGAR — foundations with investment portfolios
10. State charity registration filings — CA, NY, TX, FL, IL AG databases (public records)
11. DuckDuckGo / SearXNG web search — fallback name+city+state search for any missing website
12. LinkedIn public company pages — description, headcount, specialties

**Immediate Blocker to Fix First:**
- IRS 990 stream parser: EIN column is position 2 (zero-indexed), parser currently reads position 1. Header lookup returns -1 due to trailing carriage return on column names. Fix: use positional index directly, trim all column headers before lookup.

**Success Criteria:**
- website_url populated: ≥ 80% of records
- contact_email populated: ≥ 40% of records
- total_assets populated: ≥ 70% of records
- giving_focus_areas populated: ≥ 50% of records
- key_people populated: ≥ 35% of records

**Execution:** Railway worker + local CLI scripts. Never Vercel (timeout). Checkpoint every 500 records. Backup enrichment-output/ to DATAOCEAN (D:\) after every run. Do not overwrite without backup.

---

## Directive 2: 1.8M 501(c)(3) Full Import + Enrichment

**Objective:** Import the complete IRS Business Master File (BMF) of all active 501(c)(3) organizations (~1.8M records) into a dedicated `nonprofits` table. Apply tiered enrichment by revenue size. This becomes a prospecting database separate from `foundation_directory`.

**Current State:** `pnpm ingest:bmf` script exists, never successfully run. No `nonprofits` table confirmed in production.

**Implementation Phases:**

Phase A — Full BMF Import:
- Download all 50 state + DC IRS BMF CSV files from `https://www.irs.gov/pub/irs-soi/eo_XX.csv`
- Deduplicate by EIN
- Insert into `nonprofits` table: ein, name, city, state, zip, ntee_code, subsection_code, foundation_type, ruling_date, revenue_amount, asset_amount, status
- Target: 1.8M records, estimated 4–6 hour runtime on local machine
- Required: new migration for `nonprofits` table if not present

Phase B — Tier-1 Enrichment (Revenue > $500K):
- Estimated ~180K records qualify
- ProPublica enrichment pass: financials, exec compensation, program descriptions
- Web search + scraper pass for website and contact info

Phase C — Foundation Cross-Reference:
- Match EINs between `nonprofits` and `foundation_directory`
- Link records, propagate enrichment data bidirectionally

Phase D — 298K Prospect CSV Import:
- Source: D:\dataocean prospect CSV
- Script: `scripts/import-prospects.ts` (exists, never run)
- Dedup against `nonprofits` by EIN, merge if matched

**Ongoing:** Monthly re-pull of IRS BMF to catch new registrations and status changes.

---

## Directive 3: Intelligence Library Corpus Rebuild

**Objective:** The Grant Intelligence Library must contain 2,000+ funded grant proposals across all major federal and foundation funding categories. Currently: 11 NIH proposals with duplicates. Nights 2–7 of the build roadmap were never executed.

**Immediate Fixes Required:**
- Add `WHERE NOT EXISTS` dedup check to all ingestion scripts (cause of duplicate NIH/NIAID entries)
- Truncate `intelligence_funded_proposals` and `intelligence_proposal_sections` before re-running NIH ingestion
- Verify pgvector embeddings are actually being generated and stored (not just inserted as NULL)

**Funded Proposal Sources (all public/free):**
| Source | Method | Est. Proposals |
|--------|--------|---------------|
| NIH NIAID Sample Applications | Scraper + PDF parser | 50–100 |
| NIH RePORTER API | REST API | 500–1,000 |
| NSF Award Search | REST API | 300–500 |
| HRSA Grant Awards | Web scraper | 100–200 |
| HUD CPD Awards | Web scraper | 100–150 |
| SAMHSA Grant Awards | Web scraper | 100–150 |
| DOJ OJP Award Database | Web scraper | 100–200 |
| University grant libraries (Alaska, UCSB, Georgetown, Wisconsin) | Web scraper | 100–200 |
| Community Foundation published examples | Web scraper | 50–100 |
| Robert Wood Johnson Foundation | Web scraper | 50–75 |
| Annie E. Casey Foundation | Web scraper | 25–50 |
| W.K. Kellogg Foundation | Web scraper | 25–50 |
| Federal Register NOFO award announcements | RSS + scraper | 100–200 |
| Gates Foundation project descriptions | Web scraper | 50–100 |
| Wellcome Trust published grants | Web scraper | 25–50 |

**Build Night Schedule (per INTELLIGENCE_BUILD_ROADMAP.md):**
- Night 2: Reviewer Scoring Rubrics + Logic Models — NOT YET RUN
- Night 3: Need Statement Database (Census, HUD, SAMHSA, BLS) — NOT YET RUN
- Night 4: Budget Justification + Evaluation Framework Libraries — NOT YET RUN
- Night 5: Grantmaker Intelligence + Post-Award Reports — NOT YET RUN
- Night 6: Narrative Patterns + Grant DNA Scoring — NOT YET RUN
- Night 7: Cross-Library Integration + Polish — NOT YET RUN

**Data ingestion runs** (local machine, parallel with FORGE):
- All 8 ingestion scripts from INTELLIGENCE_BUILD_ROADMAP.md §Parallel Data Ingestion Runs — none have completed

---

## Directive 4: UI Redesign — Permanent Methodology

**Objective:** Complete the "Elevated Slate" redesign. Every page and component must visually match the confirmed design direction.

**Design Spec (locked):**
- Canvas background: `#D6E4F0`
- Sidebar: `#1A2B3C` (deep navy)
- Primary accent: `#0077B6`
- Secondary accent: `#00B4D8`
- Font: Plus Jakarta Sans
- Aesthetic: Mercury/Ramp fintech — layered cards, visible shadows, depth, variety
- No dark mode

**Stage colors (FlightPathHUD):**
- Onboard: `#0077B6`
- Research: `#0096C7`
- Opportunities: `#6B48CC`
- Grant Narratives: `#10B981`
- AutoApply: `#F59E0B`
- Donor Discovery: `#EF4444`

**The Only Method That Works:**
Inline `style={{}}` props with hex values directly in JSX. No CSS variables. No Tailwind color tokens. No class names for color/background. No FORGE for UI work.

**Permanently Banned Approaches:**
- CSS variable changes in globals.css
- Tailwind config token updates
- FORGE UI queues
- Global find-and-replace scripts
- PowerShell string replacement (causes UTF-8 encoding corruption)
- Node.js one-liner replacement scripts

**Execution Protocol (enforced):**
1. CC reads the target component file completely before writing a single line
2. Rewrites the component from scratch with inline styles
3. Visual verification in browser before moving to next component
4. One component per CC session — no batching
5. Never deploy without visual confirmation

**Remaining Components (priority order):**
1. FlightPathHUD.tsx — 6 stage cards unique colors (next immediate task)
2. MetricCard.tsx — white bg, strong shadow, colored label
3. Dashboard layout shell — canvas background
4. Sidebar — deep navy
5. Each major page shell, one at a time

---

## Directive 5: Research Section Resources — Enterprise Redesign

**Objective:** Replace the current research resources list with a premium enterprise UI. Top 21 resources displayed as a 3×7 card grid (pinned). All remaining resources accessible via search bar + alphabetical dropdown. Every card and entry at maximum data quality — no stubs, no placeholder text, no minimalism.

**Top 21 Pinned Resources (3 rows × 7 cards):**
| # | Name | Category |
|---|------|----------|
| 1 | Grants.gov | Federal Opportunities |
| 2 | SAM.gov | Federal Registry |
| 3 | USASpending.gov | Award Database |
| 4 | NIH RePORTER | Health Research |
| 5 | NSF Award Search | Science & Engineering |
| 6 | HRSA Data Warehouse | Health Services |
| 7 | HUD Exchange | Housing & Community |
| 8 | SAMHSA | Behavioral Health |
| 9 | DOJ OJP | Justice Programs |
| 10 | IRS Tax-Exempt Search | 990 Lookup |
| 11 | ProPublica Nonprofit Explorer | 990 Financials |
| 12 | Candid / GuideStar | Foundation Profiles |
| 13 | Foundation Directory Online | Funder Database |
| 14 | GrantWatch | Aggregated Listings |
| 15 | OpenGrants | Open Source Grant Data |
| 16 | USAFacts | Statistical Data |
| 17 | Census Bureau Data | Demographics |
| 18 | CDC Wonder | Health Statistics |
| 19 | BLS Data Tools | Workforce Statistics |
| 20 | Data.gov | Federal Open Datasets |
| 21 | USASpending Spending Explorer | Contract/Grant Explorer |

**Card Spec per resource:**
- Organization logo
- Full name + category badge
- 2-sentence description
- Direct link (opens new tab)
- Data freshness indicator (last verified date)
- API availability badge (if applicable)
- "Add to Research" quick-action button

**Remaining resources (search + dropdown):**
All state portals, corporate foundations, community foundations, international funders — alphabetically listed, searchable by name and category.

**Standard:** Enterprise quality. No compromise. No shells. Every card fully populated before shipping.

---

## Directive 6: Comprehensive Daily Test Suite

**Objective:** A full test suite runs automatically every day at 11PM CST. Results visible in `/platform/test-results`. All test types implemented and maintained as the codebase grows.

**Test Types Required:**

| Type | Tool | Scope | Trigger |
|------|------|-------|---------|
| Smoke Tests | Playwright | 5 critical API routes return 200 | Daily 11PM |
| Unit Tests | Jest | Enrichment engine, scoring, DNA analysis, parsers | Daily 11PM |
| Integration Tests | Jest + Supabase | DB read/write round-trips per major table | Daily 11PM |
| End-to-End Tests | Playwright | Login → create opp → generate draft → submit | Daily 11PM |
| Visual Regression | Playwright | Screenshots vs baseline, fail on >2% pixel diff | Daily 11PM |
| DB Migration Tests | Custom script | Each migration idempotent + reversible | On migration |
| Soak Tests | Custom CLI | Enrichment engine at 1K records/hour for 30 min | Weekly |
| Cross-Browser Tests | Playwright | Chrome, Firefox, Safari (webkit) | Daily 11PM |
| Dynamic Analysis | Zod + custom | Runtime type checking on all API responses | Always-on |
| Regression Tests | Jest | Any previously fixed bug has a regression test | On fix |

**Automation:** GitHub Actions workflow at `11PM CST` daily (UTC: `05:00`). Results written to Supabase `test_runs` table. Dashboard at `/platform/test-results` shows pass/fail per category, trend chart, and diff viewer for visual regressions.

**Rule:** No FORGE queue ships without test coverage for its outputs. All new features require at least: 1 unit test, 1 integration test, 1 E2E path.

---

## Directive 7: Build Agents Must Land Work Before Reporting

**Objective:** A FORGE build agent's report of "passed" must mean the work is committed AND pushed. Gates that only inspect the working tree cannot tell the difference between "shipped" and "green locally, invisible to everyone else."

**Incident (2026-09-18, 04:59):** `ar-10-3-budget-teeth` passed compile, test, `file_exists` and its own shell gate. Its build agent had ended mid-sentence waiting on a background test. Migration 198 was already applied to PRODUCTION — `cost_budgets.period_start` was live — while the migration file and the code calling its new RPC sat UNCOMMITTED. Production schema was ahead of source control, and the next agent reading the repo would have seen no period logic and quite possibly written a conflicting migration. Four gates green, nothing shipped. Separately, in the same 2026-09-18 run, five of sixteen prompts ended mid-sentence in a wait state instead of finishing.

**Mandatory rules:**
1. A build agent MUST run `git add` + `git commit` + `git push` for every file it changed before reporting a prompt as complete. "Compiles" and "tests pass" are not "done" — pushed is done.
2. A build agent MUST NEVER end its turn with uncommitted or unpushed changes in the tree. If a background process (a long-running test, a deploy, a poll) is still pending, the agent either waits for it synchronously within the same turn or commits/pushes the work already completed and clearly states what remains — it does not end the turn mid-sentence in a wait state.
3. Every queue's final prompt runs `- type: deploy_verify` (per CLAUDE.md Gate 7) AND, as of AR-18.1, `node scripts/audit/forge-gates/work-landed.mjs` (per AR-14 through AR-19) as its last gate — the two are complementary, not redundant: `deploy_verify` proves the pushed SHA is what's live on Vercel; `work-landed.mjs` proves the working tree, git history, and the migration ledger all agree with each other in the first place.
4. If a gate reports drift between what's on disk and what's live (either direction — applied-with-no-file, or file-never-applied), HALT per CLAUDE.md's Tier 3 error recovery. Do not paper over it with a new migration; investigate which side is wrong first.

**Enforcement:** `scripts/audit/forge-gates/work-landed.mjs` (see queue library for wiring across AR-14 through AR-19).

---

## DIRECTIVE-019: Deploy-Drift Verification Gate (Vercel + Railway)

**Note on numbering:** `.githooks/pre-push`, `scripts/verify-deployment.ts`, and several `test-evidence/` audits have cited "DIRECTIVE-019" (and later "DIRECTIVE-020", "DIRECTIVE-021") as if defined in this file since 2026-08-11. As of this update (2026-09-19) none of those numbered entries actually existed here — every prior session that referenced DIRECTIVE-019 was citing a directive nobody had written down. This entry is the first time it's actually been recorded. DIRECTIVE-020 was written on 2026-09-19 (below) and covers migration-ledger read paths, not whatever earlier sessions cited it for. DIRECTIVE-021 remains undocumented here; do not assume its cited content is accurate until someone does the same for it.

**Objective:** A green pre-push build and a pushed `main` do not mean production is running that code. Every production surface this programme deploys to must be checked against local HEAD, and the result must be reported honestly as CONFIRMED, DRIFTED, or INDETERMINATE — never collapsed to a single pass/fail, and never silently skipped.

**Incident 1 (2026-08-11):** an audit found 37 of the last 40 Vercel production deployments in `Error` state, with production serving a build 21 commits stale for 8+ hours before anything in the pipeline noticed. `.githooks/pre-push` (`pnpm run build`) stops a broken build from reaching `main`, but cannot catch a push that succeeds while Vercel's own deploy fails, never fires, or serves an older commit. `scripts/verify-deployment.ts` was built to close this by comparing local HEAD to Vercel's live production commit SHA.

**Incident 2 (2026-09-17 through 2026-09-19):** nine consecutive FORGE queues ended every `deploy_verify` gate with `INDETERMINATE — VERCEL_TOKEN and/or VERCEL_PROJECT_ID are not set`, because that gate had exactly one path to a real answer and nobody had provisioned it. Production drift was not checked once in that window. Separately, this programme discovered — from a screenshot, not from any check it had run — that the Railway worker auto-deploys from GitHub independently of Vercel, and that Railway's own deploy history shows entries marked SKIPPED ("No changes to watched files"). That's `railway.json`'s `build.watchPatterns` working as intended, but nothing had ever distinguished "correctly skipped, worker code unchanged" from "worker is silently behind" — exactly the blind spot that made several past fixes look live when the worker was still running old code.

**Fixed (AR-18.2, 2026-09-19):** `scripts/verify-deployment.ts` now checks both surfaces and prefers each platform's own CLI, already authenticated non-interactively on the build machine, over a hand-provisioned token — `vercel` (confirmed live access to the `reids-projects-b3405b97` team that owns this project; the 2026-09-15 "wrong team" blocker no longer holds) and `railway` (confirmed live, this directory already linked to the real `benavora-worker` project/service). `VERCEL_TOKEN`/`VERCEL_PROJECT_ID`/`VERCEL_TEAM_ID`/`RAILWAY_TOKEN` remain documented in `.env.local.example` as fallbacks for any environment where the CLI isn't already logged in — both CLIs read those variables natively. Railway's check compares against `git log <deployed-sha>..HEAD -- <watchPatterns>`, not raw SHA equality, so a worker correctly sitting on an older commit because nothing it watches has changed reports CONFIRMED, not a false DRIFTED.

**Mandatory rules:**
1. `deploy_verify` gate output MUST name each surface (Vercel, Railway) and its own verdict — CONFIRMED, DRIFTED, or INDETERMINATE — never a single combined pass/fail.
2. INDETERMINATE MUST state the specific missing prerequisite (which credential, which CLI). A queue may not report a clean run while a surface sits at INDETERMINATE without saying so in the same breath.
3. Do not invent, guess, or hardcode a token/credential to make this gate report a pass it hasn't earned. If a surface genuinely requires a human-provisioned credential, say exactly what's needed and leave it INDETERMINATE.
4. When adding a new deployed surface (a third platform, a second Vercel project, etc.), extend this gate rather than standing up a separate, un-cross-referenced check.

**Enforcement:** `scripts/verify-deployment.ts`, run as the `deploy_verify` step per CLAUDE.md Gate 7 (see Directive 7 above).

---

## DIRECTIVE-020: Migration Ledger Read Paths and Matching

**Objective:** `supabase_migrations.schema_migrations` is the only record of what production has actually run. The `work-landed.mjs` check-3 gate depends on reading it and on comparing it correctly to `supabase/migrations/*.sql`. Both halves were broken; both are fixed here.

**Incident (2026-09-17 → 2026-09-19):** check 3 failed on every run with `password authentication failed for user "postgres"` and was never able to make an assertion. Two separate defects sat behind that:

1. **No working read path.** `DATABASE_URL` returns 28P01 — the direct host answers on 5432 (the earlier "port 5432 is blocked from this environment" note in `work-landed.self-test.mjs` was wrong and has been corrected), the credential is simply stale. Both Management API PATs recorded in `BLUEPRINT_v2.md` return 401. The only live credential is `SUPABASE_SERVICE_ROLE_KEY`, and PostgREST exposes only `public` + `graphql_public`.
2. **Matching logic that could never have passed.** The gate compared `version` against "the filename token before the first underscore". This project's ledger uses three conventions at once — `001_initial_schema` (whole stem), `162` (bare number, real name in `name`), and `20260917231636` / `ar64_model_cost_reference` (Supabase timestamp, name recorded under the FORGE task id, file on disk `192_model_cost_reference.sql`). Against the real ledger that rule produces 380 fabricated drift findings — 202 files "unapplied" and 178 rows "orphaned". Because defect 1 always fired first, defect 2 had never been seen.

**Fixed (2026-09-19):** migration 201 adds `public.forge_migration_ledger()` — SECURITY DEFINER, SELECT-only, no arguments, `GRANT EXECUTE` to `service_role` only, `anon`/`authenticated` explicitly revoked (verified live: service_role 200, anon 401). Check 3 tries `DATABASE_URL` first and falls back to that RPC, naming what each path did when both fail. Matching now compares version AND name in two passes — exact labels first, then normalised (leading `NNN_` and `arNN_` prefixes stripped) — with each ledger row consumable by at most one file, so duplicate-stem filenames like `063_white_label.sql` / `086_white_label.sql` still pair with their own rows.

**First real result (2026-09-19):** 24 files on disk had no ledger row. 20 were verified live object-by-object (tables, columns, constraints, policies, enum values, registry rows all present in production) and their ledger rows were repaired, `created_by = 'forge-ar-18.2-ledger-repair-2026-09-19'`. **4 are genuinely not applied to production and remain open:** `147_knowledge_public_wrappers.sql` (the three `knowledge_*` RPCs `src/lib/knowledge/db.ts` calls do not exist live — that code path is broken in production), `170_pil_prospects_auto_research_run_trigger.sql`, `181_email_security_audit_log.sql`, `196_orchestration_logs_authenticated_insert.sql`. Per DIRECTIVE-018 rule 4 these were NOT applied by the session that found them; 170 in particular changes behaviour (auto-creates a `pil_research_runs` row per prospect insert) and is Reid's call.

**Mandatory rules:**
1. Never make check 3 skip, soften, or auto-pass when the ledger is unreadable. An unverifiable ledger is the exact condition the gate exists to catch. Add a read path instead.
2. Never compare migrations on the numeric prefix alone. Match on `version` and `name`, exact before normalised, one ledger row per file.
3. Repairing a ledger row is only permitted after verifying the migration's objects exist live, object by object. Recording an unapplied migration as applied is worse than the drift it hides.
4. Finding drift does not license applying the missing migrations in the same pass. Report them; let a human decide, especially for anything that changes behaviour or costs money.
5. Rules 1 and 4 can deadlock, and the resolution is not to soften either. Check 3 hard-fails on an unapplied file, and 27+ downstream FORGE prompts use `work-landed` as their last gate — so "report it and leave it" means every later queue stays blocked until a human answers. That is the intended pressure, not a bug. When it happens, split the drift by what applying it actually costs: a migration that is purely additive, or that repairs an already-broken production code path, may be applied and recorded by the session that found it (say so explicitly in the commit). A migration that changes runtime behaviour or spends money may not, no matter how red the gate goes.

**Update (AR-16.1 recovery, 2026-09-19):** the four open files above were re-checked object-by-object against production — none of the four was live. Three were applied and recorded under rule 5:
  - `147_knowledge_public_wrappers.sql` — repairs a broken production code path (`src/lib/knowledge/db.ts` calls three RPCs that did not exist). Applying it exposed a defect the file had been hiding for a month: `knowledge_search` opened with `SET LOCAL ivfflat.probes = 20;` inside a `LANGUAGE sql STABLE` body, which Postgres accepts at CREATE time and then rejects on every call with `0A000: SET is not allowed in a non-volatile function`. The wrapper is now plpgsql using `set_config(..., is_local => true)`; the function-level `SET ivfflat.probes` clause was tried first and rejected with `42501: permission denied to set parameter` (the GUC is only a placeholder until pgvector's library loads). All three wrappers verified by live call against the 783-row corpus. **A migration that is never applied is never tested — this one was wrong the whole time.**
  - `181_email_security_audit_log.sql` — two new tables, purely additive, no code reads them yet.
  - `196_orchestration_logs_authenticated_insert.sql` — one additive INSERT policy scoped to `current_org_id()`.

`170_pil_prospects_auto_research_run_trigger.sql` **remains open and is still Reid's call.** It was applied during that pass and then fully reverted (trigger dropped, function dropped, ledger row deleted, confirmed zero `pil_research_runs` rows created in the interim) once rule 4 was re-read: its AFTER INSERT trigger creates a `pil_research_runs` row per new prospect, and `/api/cron/pil-research` polls those every 10 minutes and spends real Anthropic budget on each. Nothing in `src/` or `worker/` depends on the trigger existing, so leaving it unapplied breaks no code — check 3 will keep failing on this one file, by design, until Reid decides. Ledger is at 202 rows.

**Enforcement:** `scripts/audit/forge-gates/work-landed.mjs` check 3; `scripts/audit/forge-gates/work-landed.self-test.mjs` cases 7–9 cover all three ledger conventions and the duplicate-stem case.

---

## Governance Update Requirements

Every session that touches any Directive above must update:
- `STATE_OF_THE_BUILD.md` — current completion % per directive
- `SESSION_STATE.md` — what ran, what passed, what's next
- `SCHEMA_REGISTRY.md` — any new tables or column additions
- `BLUEPRINT.md` — any architectural changes

These updates are not optional. They are the last step of every Claude Code run.
