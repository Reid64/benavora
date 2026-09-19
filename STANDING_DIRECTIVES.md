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

## Governance Update Requirements

Every session that touches any Directive above must update:
- `STATE_OF_THE_BUILD.md` — current completion % per directive
- `SESSION_STATE.md` — what ran, what passed, what's next
- `SCHEMA_REGISTRY.md` — any new tables or column additions
- `BLUEPRINT.md` — any architectural changes

These updates are not optional. They are the last step of every Claude Code run.
