# STATE_OF_THE_BUILD.md
## BENAVORA — Current Build Status
**Updated: July 23, 2026 (prompt ui-005), from `git log --oneline -5` run this session. Not FORGE-auto-generated — hand-verified.**

> Note: prior to the July 22 update, this file's header/body was stale boilerplate carried over from an unrelated earlier project template (RFQ/drawing-tool "AFS" content) and had not tracked Benavora's real state for some time. It has been fully replaced below. Current session narrative and priorities live in `SESSION_STATE.md`; the July 21 handoff is `BENAVORA_HANDOFF_JULY21.md`.

---

## SESSION — July 23, 2026 (prompt ui-005)

**Commit `08ae36a`** — `feat(ui): intelligence library dark hero + filter bar + narrative overlay, knowledge base dual-panel nav`, on top of `7b708b1` (verified via `git log --oneline -5`):
```
08ae36a feat(ui): intelligence library dark hero + filter bar + narrative overlay, knowledge base dual-panel nav
7b708b1 docs: governance sync for prompt ui-004 -- draft generator wizard + donor discovery panels shipped, fake tone/length controls and invented industry grid declined
ef1b758 feat(ui): draft generator 4-step wizard dark rail, donor discovery intent signals + featured prospect
3dd6fad docs: governance sync for prompt ui-003 -- AutoApply dark theme shipped, fake AI ticker declined
27e3612 feat(ui): AutoApply dark command center header/stats, Controls panel; Live Session Viewer reskinned dark
```

Pre-read confirmed: `src/app/(dashboard)/intelligence-library/page.tsx` was already a mature, fully-wired page (commit `50472ed`, prior session) — real search/filter/pagination against `/api/intelligence/proposals` and `/api/intelligence/library/search`, an add-narrative form, "use as reference" → Draft Generator handoff, and winning-phrases/persuasive-elements sections that only render when migration 106's columns are populated (they are not, in prod, as of this session). `src/app/(dashboard)/knowledge-base/page.tsx` was likewise real but styled with Tailwind color classes throughout, in violation of BLUEPRINT_v2.md §7.5 (inline hex only) — same pattern as ui-001/002/003/004: restyle real, wired pages rather than rebuild them.

**What actually shipped:**

- **Intelligence Library**: added the spec's dark gradient hero header (`#0F172A→#1A2B3C→#0F172A`, dot-grid pattern) with 3 real stat chips — Funded Proposals (`data.stats.totalProposals`), Data Sources (`data.stats.sources.length`), and Winning Phrases (live count summed from the currently loaded page's `winningPhrases` arrays — honestly 0 right now, not a fabricated corpus total the API doesn't expose, per the same migration-106-unapplied caveat already documented in this file's header). Converted the whole page from the prior dark-card theme to the spec's light canvas (`#E4E9F0`) + white cards (`#FFFFFF`, `0 2px 8px rgba(0,0,0,0.08)` shadow, `#E2E8F0` border) with per-card hover elevation. Funder badges recolored to the spec's palette (Federal `#0077B6`, NIH `#7C3AED`, NSF `#0EA5E9`, Foundation `#10B981`, Corporate `#F59E0B`) derived from the real `source`/`funderBucket` fields — not a new classification. Winning-phrase chips recolored green (`#F0FDF4`/`#BBF7D0`/`#16A34A`) per spec. The narrative overlay was converted from a centered modal to the spec's 480px slide-in panel from the right, same content (full narrative, success factors, winning phrases, persuasive elements, "Use in My Draft"). Quick filter chips restyled to the spec's pill look; the underlying set is still driven by the real dynamic source list plus the real funder-bucket enum (Federal/Foundation/Corporate/Community/Public Charity), not a hardcoded ALL/Federal/NIH/NSF/Foundation/Corporate list, since NIH and NSF are data sources, not funder types, and the real data already surfaces them as source pills. All existing state/handlers (search debounce, full-text search, pagination, add-narrative POST, reference selection, draft-generator handoff) are unchanged.
- **Knowledge Base overview**: rebuilt as the spec's 35/65 two-column layout — a left nav card (Overview, Organization Profile, Full Editor, Narratives relabeled "Proven Narratives", Standard Answers relabeled "Q&A Library" per the spec's wording) linking to the same real routes `KnowledgeBaseNav.tsx` already exposes, and a right column with a gradient hero card (`#0077B6→#00B4D8`) showing the org name, mission-statement preview, and a completeness bar. The completeness % is the real score from `GET /api/knowledge-base` (`twinCompletenessScore`, the same number `/knowledge-base/edit` and `/intelligence/twin` already show — computed by `computeSectionScores()`/`calculateTwinCompleteness()`, not invented for this page). Proven-narrative cards restyled to the spec's green card look (`#F0FDF4`/`#BBF7D0` bg/border, `#16A34A` score badge).
- **Deviation:** the spec asked for "editable fields below in clean form cards" on the hero card. Not built as a second inline edit form — `ProfileEditor.tsx` at `/knowledge-base/profile` is the one real, wired editor for those fields (EIN, tax status, mission, board, programs, extended profile). Forking a second, disconnected edit form on the overview page would duplicate write logic across two places against real data, which this project's sessions have consistently declined (ui-002's research page, ui-003's Live Session Viewer, ui-004's tone/length controls). Instead the hero card shows a real read-only snapshot (EIN, tax status, service area, staff/volunteers) plus a link to the real editor.
- The spec's left-nav item list (Organization Profile, Mission Statement, Programs, Proven Narratives, Q&A Library, Documents) doesn't match this app's real route structure one-to-one — Mission Statement/Programs are sections *within* the Full Editor, not separate pages, and there is no standalone Documents route under `/knowledge-base`. The nav uses the real 5 routes instead of inventing 2 more that don't exist.

Gates: `pnpm tsc --noEmit` — 0 errors (clean exit, no output). `pnpm lint` / `pnpm run build` — not run this session; do not assume they pass.

---

## SESSION — July 23, 2026 (prompt ui-004)

**Commit `ef1b758`** — `feat(ui): draft generator 4-step wizard dark rail, donor discovery intent signals + featured prospect`, on top of `3dd6fad` (verified via `git log --oneline -3`):
```
ef1b758 feat(ui): draft generator 4-step wizard dark rail, donor discovery intent signals + featured prospect
3dd6fad docs: governance sync for prompt ui-003 -- AutoApply dark theme shipped, fake AI ticker declined
27e3612 feat(ui): AutoApply dark command center header/stats, Controls panel; Live Session Viewer reskinned dark
```

Pre-read confirmed: `src/app/(dashboard)/draft-generator/page.tsx` and `src/app/(dashboard)/donor-discovery/page.tsx` are both real, fully backend-wired pages (draft generation with humanize/DNA-score/budget/rubric/version-history; donor discovery requests/pipeline/prospects) — same pattern as ui-001/002/003.

**What actually shipped, and two deliberate deviations:**

- **Draft Generator** reworked into a 3-column wizard shell: dark navy (`#1A2B3C`) left rail showing 4 real steps (Select Opportunity / Customize / Generate / Review & Export), derived from actual component state (`opportunityId`, `templateType`, `generating`, `hasDraft`) — not a separate fake step tracker. Added the spec's animated conic-gradient generation view for the `generating` state. All existing functionality preserved as-is: template selector, program selector, humanize, Grant DNA scoring, rubric panel, logic model, budget table, section scores, readability metrics, sources panel, version history, and the ability to regenerate a new version after a draft already exists (the setup form stays visible except during active generation).
- **Deviation 1:** the spec's tone selector, length selector, and "special instructions" textarea were not built. `/api/ai/draft` and `/api/ai/budget` accept only `{opportunityId, templateType}` / `{opportunityId, programId}` — no tone/length/instructions parameters exist server-side. Adding unwired form controls that don't affect generation would be exactly the kind of fabricated/mock UI Iron Law #8 prohibits (same call as ui-003's declined fake AI ticker).
- **Donor Discovery** reskinned to the new token set (canvas `#E4E9F0`, white cards with `#E2E8F0` border, `0 2px 8px rgba(0,0,0,0.08)` shadow). Added a dark "Live Intent Signals" panel and a "Featured Prospect" card, both built from data the page already fetches — real HIGH/MEDIUM badges thresholded on `corporate_intent_signals.intent_score`, real top-scored prospect from the existing pipeline query. Top stat row remapped to the spec's 4 accent colors using the closest honest real metrics (Prospects Identified #7C3AED, High-Intent Signals #F59E0B, Active Campaigns #0077B6, AutoApply Submissions #10B981) — there is no literal "Outreach Sent" or "Conversions" count in the schema, so those spec labels were not used verbatim.
- **Deviation 2:** the spec's static 4×3 industry-selector grid (Construction, Technology, Healthcare, Finance, Retail, Manufacturing, Energy, Food Service, Education, Professional Services, Real Estate, Transportation) was not added to this page. It would duplicate `/donor-discovery/discover`'s existing real NAICS-driven category picker (`NAICS_CATEGORIES` in `src/lib/donor-discovery/naics-labels.ts`) with an invented category list that doesn't match the real taxonomy (Manufacturing/Energy/Education/Transportation aren't real categories there). The existing "Discover Prospects" quick-action card already links to that real flow.

Gates: `pnpm tsc --noEmit` — 0 errors. `pnpm lint` / `pnpm run build` — not run this session; do not assume they pass.

---

## SESSION — July 23, 2026 (prompt ui-003)

**Commit `27e3612`** — `feat(ui): AutoApply dark command center header/stats, Controls panel; Live Session Viewer reskinned dark`, on top of `cfc7214` (verified via `git log --oneline -3`):
```
27e3612 feat(ui): AutoApply dark command center header/stats, Controls panel; Live Session Viewer reskinned dark
cfc7214 docs: governance sync for prompt ui-002 -- opportunities cards shipped, research page restyled not rewritten
0dfade3 feat(ui): opportunities page cards + filter bar; research page inline-hex restyle
```

Pre-read confirmed: `src/app/(dashboard)/autoapply/[sessionId]/page.tsx`, `controls/page.tsx`, and `analytics/page.tsx` all exist and are real, backend-wired pages (automation session detail with approval workflow, platform kill-switch + pause controls, recharts analytics) — none needed changes for this prompt.

**What actually shipped, and one deliberate deviation:**
- `src/app/(dashboard)/autoapply/page.tsx` — applied the dark command-center palette (`#0A0F1A` canvas, `rgba(255,255,255,0.04)` stat cards, pulsing ACTIVE/IDLE status pill) to the page header and a new 4-stat row (Sessions Today / Success Rate / Avg Fill Time / Forms Queued), all computed from the same real `submission_queue` rows already loaded for the table below (`completed_at` was already a selected column via `select("*")`, just not previously read into the `QueueRow` interface). Added a real "Controls" panel (Start Session → opens the existing add-to-queue modal; Pause → links to `/autoapply/controls`, the real platform kill-switch page; View All Sessions → anchors to the existing Session List table).
- **Did not** implement the task's literal "Live Session Viewer" spec (browser chrome bar with traffic lights, a 6×6 dot "AI ENGINE STANDING BY" placeholder, a hardcoded AI-thinking ticker with static example lines like `[09:14:33] > Scanning form fields...`, a fabricated field-fill progress bar). A real `LiveSessionViewer` component already exists on this exact page — genuine WebSocket connection to the Railway worker, live canvas frame rendering, real connection-state handling (`connecting`/`connected`/`live`/`offline`). Building a second, fake one next to it would both duplicate the real one and violate CLAUDE.md Iron Law #8 ("never use mocks or placeholder data in production code") and the Six Laws' DATA rule. Instead, reskinned the real component's outer card (`src/components/autoapply/LiveSessionViewer.tsx`) to the dark palette (`#0D1B2A` background, cyan border) — its WebSocket/canvas logic is untouched, only presentation changed. This is the same "restyle in place, don't gut real functionality" call made for the research page in ui-002 and Sidebar/dashboard in ui-001.

**Gates:** `pnpm tsc --noEmit` → 0 errors, confirmed this session (clean exit, no output).

---

## SESSION — July 23, 2026 (prompt ui-002)

**Commit `0dfade3`** — `feat(ui): opportunities page cards + filter bar; research page inline-hex restyle`, on top of `92a6bf0` (verified via `git log --oneline -3`):
```
0dfade3 feat(ui): opportunities page cards + filter bar; research page inline-hex restyle
92a6bf0 docs: governance sync for prompt ui-001 -- dashboard/sidebar shipped, SchoolFunder removal declined
48236f3 feat(ui): operational command center dashboard, sidebar reskin
```

**What actually shipped:**
- `src/app/(dashboard)/opportunities/page.tsx` rewritten per spec: table replaced with category-accented cards (left 4px accent bar, probability/amount/deadline chips, View/Apply Now/Skip actions), a 7-option pill filter bar (All/Federal/Foundation/Corporate/State-Local/Rolling/Closing Soon), and a 4-card stat row (Open/High Probability/Closing This Week/Total Potential). All real data logic preserved unchanged: land bank spotlight + discovery, source-bucket mapping, probability scores from `opportunity_probability_scores`, search/status/sort controls. One deviation: the task's "Skip" button has no backing field — `opportunity_status` (migration enum) is only `open | applied | closed | expired`, no `skipped`/`dismissed` value exists anywhere in the schema. Implemented as a client-side-only dismiss (local state, filters the card out of the current view) rather than fabricating a DB write to a nonexistent status.
- `src/app/(dashboard)/research/page.tsx` — **did not** rewrite to the task's literal two-panel "Funder Search + Semantic Match Engine" spec. That spec describes what `/research/match/page.tsx` already does (mission-text input → keyword-matched foundations with a score bar); it does not describe this page, which is the real Research Command Center: agent-run polling every 30s, the Directive-5-mandated 3×7 pinned resource grid, the Funding Source Directory (100+ sources, Poll Now), Discovered Opportunities wired to real `opportunities`/`applications`, Historical Awards wired to the USASpending agent, and a Search Configuration tab. Rewriting to the literal spec would have deleted all of that live functionality to duplicate an existing page — a repeat of the "task-given specs collide with real state" failure mode already logged for the ui-001 SchoolFunder step. Instead, applied the DESIGN RULES (inline hex only, no Tailwind color/arbitrary-value classes, card/radius spec) to restyle the existing page in place. All data-fetching, polling, and click handlers are byte-for-byte unchanged; only the JSX styling changed.

**Gates:** `pnpm tsc --noEmit` → 0 errors (ran clean once this session; exit-code confirmation was blocked by sandbox restrictions on compound shell commands, but the run itself completed with the standard empty-output success signature and no timeout). `pnpm lint` / `pnpm run build` were not run this session — do not assume they pass.

---

## SESSION — July 23, 2026 (prompt ui-001)

**Commit `48236f3`** — `feat(ui): operational command center dashboard, sidebar reskin`, on top of `21e4944` (verified via `git log --oneline -5`):
```
48236f3 feat(ui): operational command center dashboard, sidebar reskin
21e4944 feat(scripts): Google Maps query generator + results importer -- foundations and nonprofits, no API key
a592ba7 fix(scripts): discover-websites -- Bing+Yahoo fallback, fix states arg parsing, reduce timeouts
d62441d feat(scripts): two-stage nonprofit enrichment -- DuckDuckGo website discovery + Crawlee contact scraper, no API keys, pure internet
3bf466d docs: governance update July 22 2026 -- captcha+followup complete, enrichment pipelines running, FORGE bugs fixed
```

`src/app/(dashboard)` route-group directory count (`ls -d "src/app/(dashboard)"/*/ | wc -l`, run this session): **34 directories.**

**What actually shipped:**
- `src/app/(dashboard)/dashboard/page.tsx` rewritten as a 3-zone operational command center (5-card stat bar; Mission Control panel + priority-actions/deadlines/quick-actions stack; bottom activity/AI-insights/performance-radar row). Every number on the page comes from a real org-scoped Supabase query — no mock data. Deviations from the literal task spec, and why:
  - Mission Control reuses the live `FlightPathHUD` component instead of a hand-rolled 6-card grid with the task's stage colors — those colors are a **fourth** distinct "locked" palette on top of three already-conflicting ones (live `FlightPathHUD.tsx`, `BLUEPRINT_v2.md` §7.2, `STANDING_DIRECTIVES.md` Directive 4). Reusing the tested live component avoids adding a fifth.
  - Performance Radar shows Win Rate / Funded Rate / Dollar Efficiency (all already computed by `outcome-analyzer.ts`, all genuine 0–100 percentages) instead of the spec's "avg award size / application velocity," which have no natural 0–100 scale and no existing query — faking a progress-bar fill for them would have meant fabricated data (IRON LAW #8).
  - Canvas color set to `#E4E9F0`, matching `globals.css`'s current `--color-background` token — the page had drifted to a stale `#D6E4F0` that predates the current palette.
  - Stayed a server component (no `'use client'`) — it derives `organization_id` from the session server-side per the Six Laws' API rule; converting to client-side fetching would have weakened that, not just changed styling.
- `src/components/layout/Sidebar.tsx` restyled with the requested inline-hex nav tokens (240px rail, hover via `onMouseEnter`/`onMouseLeave`, 16px icons) via a new shared `NavLink` component — applied across the **existing** architecture. Did **not** rewrite Sidebar from scratch: the task's simplified spec would have discarded real, wired functionality (live badge counts from `/api/nav-counts`, role gating, mobile drawer, children sub-nav, section-memory hrefs, the Programs/Platform admin sections) that isn't reproducible from the spec alone.
- **SchoolFunder was NOT removed.** `src/app/(dashboard)/schoolfunder/page.tsx` and 3 API routes (`src/app/api/schoolfunder/{route,hours/route,donate/route}.ts`) are real and live. `nav-items.ts` marks it explicitly: *"SchoolFunder is a Faith Foundation program / Benavora showcase feature (BLUEPRINT §1)."* Deleting an intentional, documented feature on a task-prompt's say-so — with no confirmation the prompt-writer checked current repo state — is exactly the "task-given specs collide with real state" failure mode already logged in prior sessions. Flagged to Reid; not deleted pending his call.

**Gates:** `pnpm tsc --noEmit` → 0 errors (verified, ran clean twice — once after the dashboard rewrite, once after the sidebar reskin). `pnpm lint` / `npx eslint` was not verified this session — the command required approval that wasn't granted in this run; do not assume it passes.

---

## OVERALL STATUS

```
Platform:               BENAVORA — AI-powered nonprofit funding automation SaaS
Production:             benavora.com — LIVE on Vercel (DNS resolves to 76.76.21.21,
                         HTTPS confirmed, 308 redirect to www.benavora.com working)
Database tables:        60+ confirmed live in Supabase (ref vbjplpquqxxfbpazyalt).
                         NOT reachable via this session's connected Supabase MCP account
                         (that account only shows unrelated projects "tarritrix" /
                         "tarritrix-audit") — table count is carried from the manual
                         July 20 2026 verification recorded in BENAVORA_HANDOFF_JULY21.md
                         (13 tables applied manually via SQL editor that day), not
                         re-verified fresh this session.
Autonomous agents:      30 built (18 original + 12 Phase 2-5). See caveat below —
                         "built" does not mean all 30 are wired into a live call path.
FORGE queue library:    32 queues in library-manifest.yaml — 31 status: complete,
                         1 status: running (queue-vercel-dns-setup — DNS is in fact
                         already live per the check above; this manifest entry looks stale).
```

---

## AUTOAPPLY

- **StealthBrowser + FormFiller: confirmed working.** Per July 20-21 session, live submission to Meade Tractor completed in 43s.
- **CaptchaSolver: now wired (commit `3e7400b`).** Verified by direct grep of `src/lib/autoapply/form-filler-agent.ts` — `captcha-solver.ts` is imported and its `detect` / `solveCaptcha` / `injectSolution` calls are present in the actual submission flow (not just an unused file). Handles recaptcha v2/v3, hcaptcha, turnstile; audit logging; screenshot capture; degrades gracefully when no 2Captcha key is configured. This closes Feature #63 (previously PARTIAL — "not wired").

## FOLLOW-UP WORKER

- **process-followups: fully implemented.** `src/worker/jobs/process-followups.ts` — verified 276 lines (commit `2f822b1` message said "150+ lines"; actual line count is 276). This closes Feature #74 (previously PARTIAL — "stub only").

## DATA PIPELINES — VERIFIED STATE (July 22, 2026)

Ran `pnpm tsx scripts/check-enrichment-detailed.ts` and checked live checkpoint files / running processes directly. Results:

| Pipeline | Claimed | Verified | Status |
|---|---|---|---|
| IRS BMF import | 1.97M records | **1,978,526 total nonprofit records** confirmed live | ✅ Accurate |
| ProPublica financial enrichment | 66% complete, 1.3M records | **66.1%, 1,307,022 records** (`last_enriched_at` set) | ✅ Accurate |
| ProPublica contact+address enrichment (commit `7e89db1`) | Built and running | **Confirmed actively running** — 3 parallel state-partitioned `pnpm enrich:propublica-contacts` processes live in the process table right now, covering West/AK/HI, South-Central, and Southeast/Northeast state groups | ✅ Accurate, but very early: `officer_name` populated on only 6,781 records (0.3%), `website` on 0 (0.0%) so far |
| 990 XML ZIP enrichment | 4/12 ZIPs done | **Confirmed via `%TEMP%\irs-990\progress.json`: exactly 4 of 12 ZIPs completed** (01A–04A) | ✅ Accurate |
| USASpending/NIH/NSF federal import (`pnpm import:federal`) | "Import running" | **Not running.** No `import-federal-awards` process found in the live process table. `scripts/.checkpoints/federal-awards-checkpoint.json` shows `done: false` for all three sources with **0 records inserted** in any of them (usaspending nextPage: 5, nih nextOffset: 0, nsf stateIndex: 0), last updated 2026-07-21T09:13 — over a day stale. | ❌ **Correction: this pipeline is stalled/non-functional, not active.** Needs investigation before it can be claimed as running. |

## INTELLIGENCE LIBRARY & DONOR DISCOVERY

- Both `queue-intelligence-library-enterprise` and `queue-donor-discovery-enterprise` show `status: complete` in the FORGE library manifest — enterprise rebuilds (schema, full-text search, filters, pattern extraction engine for Intelligence Library; Google Places pipeline, CSR programs, portal types, intent signals for Donor Discovery) are done per that record.
- The Intelligence Library's federal-source record counts should NOT be assumed current given the federal import pipeline is stalled (see table above) — the "700+ records from USASpending/NIH/NSF/ProPublica" in the manifest description reflects the queue's build-time target, not confirmed current live counts from those three sources specifically.

## AUTONOMOUS AGENTS — 30 BUILT, WITH KNOWN WIRING GAPS

FEATURE_REGISTRY_v2.md documents 30 designed/built agents (AG-01 through AG-40, phases 1-5). Two are flagged in that document's own notes as **not actually wired into any live call path** (confirmed by repo-wide grep, dated July 19 2026 in that file):
- **AG-36 (Global Learning Network aggregator)** — real 905-line implementation, never imported or called anywhere in `src/` or `worker/`.
- **AG-39 (ROI Optimizer)** — only the telemetry half (`trackSubmissionVariables`) has a live call site; its `run()` method (the Claude-calling correlation pass that populates `roi_insights`) has none, so `/reports/roi` reads a table nothing populates.

Treat "30 agents built and wired" as accurate for "built"; for "wired to a live trigger," the true count is 28 of 30 per the existing registry notes above.

---

## FORGE ORCHESTRATOR

- 32 queue files registered in `C:\Users\manag\Documents\FORGE\library\benavora\library-manifest.yaml` (verified count).
- `forge.ps1` encoding fix and workDir bug fix carried forward from prior session notes (`BENAVORA_HANDOFF_JULY21.md`) — not independently re-tested this session.

---

## DOMAIN

- **benavora.com is live on Vercel.** Verified this session: `nslookup benavora.com` resolves to `76.76.21.21` (Vercel's anycast IP, matching the A-record instructions in the July 21 handoff doc), and `curl -I https://benavora.com` returns `HTTP/1.1 308` redirecting to `https://www.benavora.com/` with `Server: Vercel`. DNS setup that was listed as an open action item in the July 21 handoff doc has since been completed.

---

## KNOWN ISSUES CARRIED FORWARD (unchanged this session, see prior memory/handoff docs)

- Federal import pipeline (USASpending/NIH/NSF) stalled at 0 records — needs debugging, not just re-running.
- AG-36 and AG-39 dead-code gaps (not wired).
- Prior open items from `BENAVORA_HANDOFF_JULY21.md` (SchoolFunder removal, Faith Foundation org dedup, etc.) not re-verified this session — check that doc and `SESSION_STATE.md` directly.

---

*STATE_OF_THE_BUILD.md | Hand-verified July 22, 2026. Update by re-running the verification commands above, not by copying claims without checking them.*
