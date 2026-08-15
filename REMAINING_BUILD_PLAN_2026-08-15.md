# BENAVORA — Remaining Build Plan
## Generated: August 15, 2026, from a full live read of FEATURE_REGISTRY_v2.md (715 lines, dated August 14/15 2026 on disk)
## Author: CC session per Reid's standing "build without stopping to ask" directive

---

## Method

Every row across every section of `FEATURE_REGISTRY_v2.md` (Phase 1–4, Tier 6, Platform Vision
Pillars 1–18, Autonomous Agent Infrastructure, Autonomous Agents, Autonomous UI, Post-Launch Vision,
Data Pipeline, Scraper, Universal Scraper, Testing, UI Redesign) was read in full, live, off disk —
not recalled from any prior session summary or from the (materially staler, Aug-11-dated) copy of
this doc embedded in this session's CLAUDE.md context. Every row whose status is not a clean
`BUILT` / `BUILT — VERIFIED` with zero qualifier was pulled out. A small number of rows whose status
column literally reads plain `BUILT` were also pulled in when the row's own notes describe the
underlying capability as genuinely orphaned/unwired/never-run-at-scale (e.g. #223's AG-36 aggregator,
which is real code with zero call sites) — these are flagged explicitly as "status says BUILT, notes
say otherwise" so nothing is silently smuggled past the letter of the extraction rule.

Ordering, per instruction:
1. **Tier 1** — items with a concrete fix already identified somewhere in this repo's own history
   (a one-line DDL statement, a code fix already written but not yet re-verified, a deploy that
   hasn't shipped, a retest against a dependency that's since been fixed elsewhere).
2. **Tier 2** — small, well-scoped `PLANNED`/gap items with no real ambiguity.
3. **Tier 3** — larger builds.
4. **Tier 4** — the few items genuinely too vague or too consequential to default on; flagged for
   Reid explicitly, not used as a catch-all.

An **Assumptions Ledger** below states every default this document commits to for an ambiguous item,
so downstream queues can execute against a decision instead of stalling. A short **No Action Needed**
appendix at the end lists rows that technically aren't a clean BUILT but are, on inspection, actually
finished or intentionally out of scope — kept visible rather than silently dropped, per this project's
own no-silent-caps convention.

---

## Assumptions Ledger (defaults for genuinely ambiguous scope, stated up front)

- **#99 Signal Monitoring ("LinkedIn + news + 990 watching")** — no LinkedIn scraping/automation of
  any kind. LinkedIn has no public API for this and automating it violates ToS; this codebase already
  made the identical call for #77 (Multi-Channel Outreach draft-plus-human-task model) and for the
  Corporate Enrichment Agents (public-page fetches only, no login-walled scraping). Default: build
  this as an extension of the existing #96 Change Monitor (AG-42) pattern — poll public news via a
  keyword-scoped RSS/search source and 990 filing deltas (990 half already exists via AG-42's own
  foundation_directory diffing) — never a LinkedIn integration.
- **#38 Email Parsing Agent — Gmail webhook trigger** — build a real Gmail Pub/Sub push-notification
  webhook (`watch()` + `/api/webhooks/gmail`) so `EmailParserAgent.run()` fires automatically instead
  of only when a user pastes text into `EmailParserWidget`. This is genuinely absent per
  `EMAIL_PARSER_VERIFICATION_2026-08-13.md`, not ambiguous in shape, just unbuilt.
- **#38 Email Parsing Agent — auto-reply/respond** — default to **draft-only, never auto-send**.
  Every other AI-authored, funder-facing or donor-facing artifact in this codebase (AutoApply's
  Approval Checkpoint #43, AG-05's `pending_review=true` #197, Multi-Channel Outreach's
  draft-plus-`contact_tasks` model #77) is human-approved before anything leaves the building. Build
  a suggested-reply draft (Gmail Drafts API, not Gmail Send) surfaced next to the parsed
  classification for a human to edit/send — do not build automated sending. This is new,
  undesigned scope per the doc's own note, so the shape is this session's call, not a re-derivation.
- **#92 Corporate Giving DNA** — default to a synthesis view, not new enrichment: one Claude-narrated
  "DNA profile" panel per `corporate_prospects` row combining what's already computed (EA-01/EA-08
  enrichment fields, PS-01–PS-10 propensity scores from row #91, `scores` jsonb) into a single
  readable card, matching the "synthesis layer, not a new agent" pattern already used for #146 Gap
  Recommendations. No new data source.
- **#120 Corporate Outreach UI** — a one-click "Generate Outreach" button on the prospect detail view
  (`/donor-discovery/marketplace` or a prospect drill-down) that calls the already-real
  `POST /api/intelligence/outreach/generate` route (row #118, AG-24) and drops the result into a
  `contact_tasks` row, reusing #77's exact draft-plus-human-task delivery model rather than inventing
  a second one.
- **#125 Donation Receipt Generator** — default to an IRS Publication 1771–compliant acknowledgment
  letter (org name/EIN, donor name, date, amount or description of non-cash gift, goods-or-services
  statement) rendered via the same `@react-pdf/renderer` pattern already built for #77's mail-channel
  PDFs (`src/lib/reports/letter-pdf.tsx`), triggered manually from an approved `marketplace_matches`
  row. Not a full donor-CRM receipting suite — that's out of scope until Reid asks for it.
- **#138 Board Member Portal (real self-service login)** — default to adding `board_member` to the
  live `user_role` enum, reusing the existing invitation flow (#51) rather than building new
  auth, and adding a `board_meeting_attendees` join table so packet visibility can finally be scoped
  per-meeting instead of org-wide. This is a genuine, non-trivial follow-on, sized accordingly below.
- **US2 camoufox-js** — default to **not** debugging the `better-sqlite3`/Node-22 segfault further.
  The fallback stack (`rebrowser-patches` + `ghost-cursor` + Playwright) that US3–US7 already run on
  top of is fully proven against real targets; sinking more time into camoufox specifically has no
  identified benefit over what's already working. Listed in the No Action Needed appendix, not the
  build list.
- **#100/#200 Relationship Builder v2 (flag `feature.relationship_builder_v2`)** — the code is real,
  tested, and wired; the only remaining step is flipping the flag `true` for a specific org. Prior
  sessions already explicitly deferred this exact decision to Reid (documented in the row itself) —
  this document repeats that flag rather than defaulting on it, since "which orgs get a materially
  different, Claude-spending relationship agent" is a product/cost decision, not an engineering one.
- **D4 (298K Prospect CSV)** — confirmed four independent sessions running that the source file isn't
  reachable from this sandbox and no on-disk stand-in exists anywhere in the repo. Not defaulted —
  building an import script against a guessed column schema was explicitly rejected as unsafe
  (mirrors the real, still-live "scrambled columns" bug in the BMF ingest script that resulted from
  exactly that shortcut). Needs Reid to supply the file or its column schema.

---

## Tier 1 — Known concrete fix already identified in repo history

1. **#153 Real-Time Panel Updates (Command Center)** — status: `BUILT — BLOCKED (VERIFIED)`.
   The code (`CommandCenterLive.tsx`'s `postgres_changes` subscriptions) is correct; the
   `supabase_realtime` publication has zero member tables in production, confirmed live via
   `pg_publication_tables`. Fix is a single already-written DDL statement, never applied:
   `ALTER PUBLICATION supabase_realtime ADD TABLE agent_runs, agent_decisions, applications;`
   Run it via the DIRECTIVE-017 `psql "$DATABASE_URL"` path, then re-confirm with a live insert +
   20-second listen window as the prior session did. **Size: trivial.**

2. **#229 Global Feature Search (command palette)** — status: `BUILT — UNVERIFIED (browser-level)`.
   `GlobalSearch.tsx` + `feature-index.ts` are written, role-filtered, and both `tsc`/`build` pass
   clean; the only gap is a blocked Playwright run. Re-run a real browser session (login as
   `beta1@benavora-test.com`, Ctrl+K, search "billing"/"command center" expecting 0 results for a
   non-owner role, search "funders" expecting a real navigation) once dev-server/Playwright access is
   available in-session. **Size: trivial.**

3. **#105 Probability Badges**, **#109 Digital Twin Profile Page**, **#150 Reputation Monitor UI**,
   **#152 Command Center Page**, **#129 Disaster Response Dashboard**, **#165 Knowledge Engine UI** —
   all `BUILT — UNVERIFIED` purely on the browser-render step; every underlying route/query was
   already confirmed real by direct code read. Batch these into one Playwright session: authenticated
   load of `/opportunities`, `/intelligence/twin`, `/intelligence/reputation`, `/command-center`,
   `/intelligence/disaster`, `/intelligence/knowledge`, screenshot each, confirm no client error and
   that rendered numbers match a direct DB read. **Size: small (one batched verification pass).**

4. **S2 Foundation Enrichment Scraper / US6 Foundation-990 template — shared pagination bug** — the
   `.range()`-based `loadEinsMissingWebsite()` PostgREST-1000-row-cap bug (silently scoping the EIN
   index to 1,000 of 114,037+ candidates) was already fixed 2026-08-14/15 in `foundation-scraper.ts`
   (stable `.order("id")` + advance `from` by actual `data.length`, loop to `data.length === 0`).
   `tsc` is clean but no live confirmation run has completed — twice blocked by a tool-permission
   gate on live network+secret calls. Re-run `pnpm scrape:foundations-v2` (exercises both S2's and
   US6's shared code path) once that gate is clear, and confirm enrichment counts move off zero for a
   real sample. **Size: small (verification run only, code is done).**

5. **#66 990-PF Giving History — Schedule I positive-extraction case** — the streaming/positional-read
   rewrite of `downloadBatchZip()` (`node:stream/promises` `pipeline()`, `FileHandle.read()`-based
   ZIP64 parsing) is already implemented and `tsc`-clean as of 2026-08-15, and got measurably further
   than the prior buffered attempt (~100MB streamed) before the session ended mid-download. This has
   now failed to complete for four distinct reasons across four sessions (small-sample luck, unzipper
   corruption, outright fetch failure, and now an incomplete stream + a blocked retry) — the code
   itself is not the remaining blocker, wall-clock/session-continuity is. Run
   `scripts/investigate-990-schedule-i.ts` from a session with a longer timeout budget or as a
   detached/background process against 1–2 of the largest already-matched EINs (Gates Foundation,
   Ford Foundation) so the download has time to finish once instead of restarting. **Size: small
   (code done; needs an uninterrupted execution window).**

6. **D2 IRS 990 Stream Parser** — the EIN/OBJECT_ID/XML_BATCH_ID off-by-one column-index bug is fixed
   and regression-tested (5,000/5,000 real rows) as of 2026-08-14. The remaining `PARTIAL` gap is
   `scripts/enrich-foundations-990.ts` still constructing a dead `s3.amazonaws.com/irs-form-990`
   fallback URL instead of using the already-working batch-ZIP mechanism
   (`foundation-scraper.ts`'s exported `buildEinIndex`/`tryIrs990`/`EnginePool`, the same functions
   #66's investigation script now reuses). Swap the fetch step to call those exported functions
   instead of building its own dead URL, then run against a real sample. Related, not its own row:
   the `'foundation-990-enrichment'` chain target that AG-42 (#96) queues into fails 100% of the time
   on a Railway env-var-naming mismatch — worth fixing in the same pass since it's the same
   enrichment surface. **Size: small (swap one fetch mechanism for an already-proven one).**

7. **#133 Forecast Dashboard**, **#134 Market Trend Intelligence** — both are `BUILT (code)` sitting
   behind a `404` in production purely because `main` hasn't been shipped with `vercel --prod` — not
   a code defect (confirmed via `x-matched-path: /404` under a real authenticated session while
   sibling pages 200). Run the DEPLOYMENT PROTOCOL from CLAUDE.md (`tsc` → `build` → `vercel --prod`
   → `deploy_verify` against `git rev-parse HEAD`), then re-check both routes' `x-matched-path` and,
   for #133, click "Run Forecast" for real. **Size: trivial (one deploy + two page-load checks).**

8. **#132 Forecast Agent (AG-26) — narrative-synthesis truncation** — root-caused, not fixed:
   `generateNarratives()`'s Claude call hits `stopReason: "max_tokens"` because
   `NARRATIVE_MAX_TOKENS = 900` in `funding-forecast-agent.ts` is too small for this org's now-larger
   real pipeline (77–79 open opportunities), truncating the JSON response mid-string and silently
   producing the same "(narrative synthesis unavailable this run.)" fallback the dead-key bug used to
   produce — making the two failure modes indistinguishable from the stored row alone. Fix: raise
   `NARRATIVE_MAX_TOKENS` (e.g. to 2000) or trim the per-period opportunity slice in
   `buildNarrativePrompt()`; also consider logging the raw `stopReason` onto the row so this and a
   real key failure are distinguishable going forward. **Size: small.**

9. **#145 Geographic Gap Detection — confirmed false positive** — `NATIONAL_KEYWORDS` in
   `src/lib/intelligence/geographic-gap-analysis.ts` doesn't cover "50 states" (without "all") or
   "domestic," so a plainly-nationwide funder ("Domestic (50 states, DC, and US territories)") gets
   incorrectly flagged as a geographic mismatch. Add both phrasings (and audit for a couple of other
   common nationwide phrasings — "all 50 states," "coast to coast") to the allowlist. **Size:
   trivial.**

10. **#171 RAG Integration in Draft Generator** — both 2026-08-07 blockers (missing call site,
    missing `applications.knowledge_patterns_applied` column) are confirmed closed as of 2026-08-14;
    `generateDraft()` genuinely calls `queryKnowledgeEngine()` and the migration is live. The only
    remaining gap is that no live `generateDraft()` call has actually been made to observe a
    populated `knowledge_patterns_applied` row end-to-end. Trigger one real draft generation against
    a real opportunity and confirm the row. **Size: trivial.**

11. **#196 AG-15 Autonomous Probability Scoring**, **#118 Personalized Outreach Generator (AG-24)**,
    **#137 Board Packet Agent (Claude discussion items)**, **#217 Fundability Intelligence Score**,
    (and, same session, cross-check AG-30's downstream per-signal Claude calls noted in row #218) —
    all were blocked purely by the pre-rotation dead `ANTHROPIC_API_KEY` or the (now separately
    fixed) `corporate_prospects` 404, and none have been individually retested since DIRECTIVE-018's
    key consolidation (2026-08-06) or row #87's `corporate_prospects` creation (2026-08-03). High
    confidence these already work; batch a single retest session: run each agent's real `run()` (or
    manual-trigger route) once against the real Faith Foundation org and confirm a completed
    `agent_runs` row with real Claude output. **Size: small (one batched retest session, no code
    change expected).**

12. **#60 Custom Scraping Targets (Claude-extraction path)** — the shared `safe-fetch.ts` SSRF layer
    is already live-verified (row #59); only `CustomScrapeResearchAgent`'s own Claude-extraction
    execution path has never been independently exercised end-to-end. Run one real scrape against an
    allowlisted target via `/api/agents/custom-scrape` and confirm a real extracted+stored result.
    **Size: small.**

13. **#82 Path Finder — UI unreachable for this org today** — the Dijkstra algorithm itself is
    live-verified correct; the gap is that `RelationshipGraphViz.tsx`'s node-picker only ever
    populates from board-member-sourced edges, and this org's real 20 `pig_edges` are all org-level
    `asset_compatible` — so the picker never renders any options. Extend the node-picker's source
    query to include `asset_compatible`-typed edges alongside board-member-sourced ones so the
    already-working Find Path controls actually become reachable for orgs like Faith Foundation.
    **Size: small.**

14. **#90 Corporate Enrichment Agents (EA-01–EA-10) — accuracy defect** — both blockers (missing
    table, dead key) are resolved; the real remaining defect is `StealthEngine.isPlausibleResponse()`
    not distinguishing a branded 404 from real content, combined with a too-narrow hardcoded
    candidate-path list, causing EA-01/EA-08 to miss real content on 2 of 3 test companies. Fix:
    tighten `isPlausibleResponse()`'s content-length/keyword heuristic and broaden the candidate-path
    list (try `/about-us`, `/company`, `/leadership` subdomains, not just 2–3 fixed guesses) — same
    accuracy-class fix already proven for the byline-misattribution bug on US4/US7. Then run
    EA-02 through EA-07/EA-09/EA-10 for the first time, none of which have ever been individually
    exercised. **Size: medium (real extraction-quality fix, not just a retest).**

15. **T5 Visual Regression Tests** — `e2e/visual-regression.spec.ts` is committed and passes
    compile/build/test gates, but has never actually been executed against a baseline by any session.
    Run it for real, establish the baseline screenshots, and report a real pass/fail count. **Size:
    small.**

16. **T8 Cross-Browser Tests — WebKit navigation race** — root-caused, not fixed: WebKit fails all 5
    tests on a reproducible race where `page.goto()` immediately after login is interrupted by a
    still-in-flight `router.refresh()` redirect to `/dashboard`. Fix: have the test wait for the
    post-login redirect to settle (`page.waitForURL("**/dashboard")` or equivalent) before the next
    navigation, matching the pattern already used elsewhere in the suite. Separately, investigate the
    still-unresolved cross-browser flakiness in test 3 ("creating an application adds a row to
    `/applications/list`"), which fails on both Chromium and Firefox with different symptoms.
    **Size: small-medium.**

17. **Sidebar — "active state needs confirmation"** (UI Redesign table) — purely a verification gap
    against the already-built deep-navy `#1A2B3C` sidebar; load the app, click through nav items, and
    confirm the active-state styling actually renders per Directive 4's inline-hex rule. **Size:
    trivial.**

---

## Tier 2 — Small, well-scoped items

18. **#106 Factor Breakdown UI** — expandable per-opportunity explanation of the probability score
    already computed and stored by AG-15 (`opportunity_probability_scores`, row #102). Add an
    expand/collapse panel on `/opportunities` (or the opportunity detail view) that reads the same
    row's factor-level fields already being written and renders them as a labeled breakdown —
    no new agent, no new table, purely a read-side UI addition on data that already exists. **Size:
    small.**

19. **#160 Agent Log Viewer** — per-agent run history/output. Straightforward read view over the
    already-real `agent_runs`/`agent_decisions` tables (already populated by every live autonomous
    agent), filterable by `agent_type`, matching the existing Decision Log UI's (#214) pagination
    pattern. Natural home: a detail drill-down from the already-built Agent Marketplace (#159) card
    for a given agent. **Size: small.**

20. **#99 Signal Monitoring** — per the Assumptions Ledger default (no LinkedIn automation), build as
    a thin extension of AG-42's existing change-detection pattern (`change-monitor-agent.ts`) plus a
    simple keyword-scoped news/RSS poll (reuse the same RSS-parsing approach just proven for #56's CA
    Grants Portal parser) writing into `reputation_signals` alongside the existing reputation
    pipeline. **Size: small-medium.**

21. **Dashboard — "illustration positioning needs refinement"** (UI Redesign table) — a real, scoped
    visual polish task on the already-BUILT hero banner; needs a live browser check of current
    illustration placement against the Directive 4 spec and a CSS/inline-style adjustment. **Size:
    small.**

22. **#221 Donor Personalization Engine — template card doesn't reflect the active variant** — the
    toggle persists correctly and the underlying `outreach_template_variants` data is real, but
    `/outreach/templates`'s own card always renders the base template's `subject`/`body` regardless
    of which variant is active — only a hover tooltip shows the variant text. Wire the card's main
    display to render the currently-active variant's content (falling back to base when none is
    active). **Size: small.**

23. **#148 Reputation Agent — orphaned `ReputationIntelligenceAgent` nightly path** — `#151` already
    gave this class one real caller (the funder-scoped enroll-on-add path); the nightly sweep
    (`runReputationStep()`) still calls the plain `checkEntityReputation()` function directly rather
    than the class, so nightly runs still don't produce `agent_decisions`/`relationship_memory` rows.
    Optional consistency cleanup: route the nightly sweep through the same class method the enroll
    path now uses. Low priority — the nightly path works correctly today, this is about audit-trail
    parity, not a functional gap. **Size: small.**

24. **#125 Donation Receipt Generator** — per the Assumptions Ledger default, build the IRS Pub
    1771 acknowledgment-letter PDF flow off the existing `@react-pdf/renderer` pattern
    (`src/lib/reports/letter-pdf.tsx`, proven in #77), triggered from an approved
    `marketplace_matches` row. No new table needed beyond a `receipt_generated_at`/`receipt_url`
    pair on `marketplace_matches` or a small new `donation_receipts` table if Reid wants a
    reusable/re-downloadable history. **Size: small-medium.**

25. **#120 Corporate Outreach UI** — per the Assumptions Ledger default, a single "Generate Outreach"
    action on the prospect detail view calling the already-real `POST /api/intelligence/outreach/generate`
    (#118) and writing a `contact_tasks` row, mirroring #77's exact UX. **Size: small.**

---

## Tier 3 — Larger builds

26. **#92 Corporate Giving DNA** — per the Assumptions Ledger default, a synthesis panel (not new
    enrichment) combining EA-01/EA-08 fields and PS-01–PS-10 scores (`corporate_prospects.scores`)
    into one Claude-narrated profile card per prospect, in the style of #146's Gap Recommendations
    synthesis layer. Genuinely blocked on #90's accuracy fix landing first (garbage-in-garbage-out
    otherwise), so sequence after item #14 above. **Size: medium.**

27. **#123 AI Match Engine — Claude-scored half** — the rule-based half (`src/lib/marketplace/matcher.ts`,
    category + geographic-text overlap) is live-verified; the AI/Claude-scored half with a real
    confidence score has never been started. Extend `matcher.ts` (or add a parallel scorer called
    from the same route) with a Claude call that takes the rule-based candidates and produces a
    ranked confidence score + rationale, written alongside the existing match record. **Size:
    medium.**

28. **#223 Global Learning Network (AG-36) — wire the orphaned aggregator** — `learning-network-aggregator-agent.ts`
    (905 lines, `LearningNetworkAggregatorAgent`) is real, complete code with zero call sites anywhere
    in `src/` or `worker/` — confirmed by repo-wide grep. The consumer side (draft-generation-agent.ts
    reading `platform_learning_patterns`) already works; only the producer never runs. Add a
    scheduled call site in `worker/autonomous-orchestrator.ts` (weekly, matching the cadence of
    similar cross-org aggregation agents like AG-26/AG-39) and confirm a real run populates
    `platform_learning_patterns` for the first time. **Size: medium.**

29. **#56 State Portal Framework — remaining state coverage** — the CA Grants Portal RSS parser
    (`ca-grants-portal-client.ts`/`ca-grants-portal-sync.ts`) is live-verified with 200 real rows and
    established a proven pattern (RSS-first, cross-check a second source for the nonprofit-eligibility
    signal, dedup by URL matching the `grantsgov-sync.ts` convention). `STATE_PORTAL_SCOPING_2026-08-13.md`'s
    live sweep found only 2 of 17 tested state portal URLs return real, structured, non-blocked
    listings — start with whichever of those 2 isn't CA, then work down the remaining ~48 states by
    priority (population/grant-volume), reconciling or retiring the four existing broken
    implementations (`state-scrapers.ts`, `tdhca-scraper.ts`, `portal-scraper.ts`/`portal-config.ts`)
    rather than layering a fifth pattern on top indefinitely. **Size: large, ongoing (one state at a
    time).**

30. **T6 — Migration idempotency remediation** — `check-migration-idempotency.ts`'s 2026-08-08 run
    found 377 non-idempotent DDL statements across 51 files in the root `supabase/migrations/` tree
    and 76 across 9 files in `src/supabase/migrations/` (mostly bare `CREATE POLICY`/`CREATE
    INDEX`/`CREATE TYPE ... AS ENUM` with no existence guard). The live spot-check found these fail
    cleanly rather than corrupting data, so this isn't an active-incident fix, but it's real technical
    debt against DIRECTIVE-017's re-runnable-migration expectation. Systematically wrap each flagged
    statement class in its standard idempotent form (`CREATE POLICY IF NOT EXISTS` doesn't exist in
    Postgres — use `DROP POLICY IF EXISTS ... ; CREATE POLICY ...`; `CREATE INDEX IF NOT EXISTS`;
    `DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` for enums), file
    by file, starting with whichever files back currently-live, frequently-reapplied tables. **Size:
    large (60 files, mechanical but numerous).**

31. **#38 Email Parsing Agent — Gmail webhook trigger** — per the Assumptions Ledger default, a real
    Gmail Pub/Sub push-notification integration: call Gmail's `users.watch()` API on the org's
    connected account (reusing the existing Google OAuth wiring already present for Calendar/Gmail
    integrations), stand up `/api/webhooks/gmail` to receive Pub/Sub push notifications, and call
    `EmailParserAgent.run()` automatically for new mail instead of only on manual paste into
    `EmailParserWidget`. Needs a Google Cloud Pub/Sub topic + subscription provisioned alongside the
    existing `integration_keys`-based credential model. **Size: large.**

32. **#38 Email Parsing Agent — draft-only auto-reply suggestion** — per the Assumptions Ledger
    default (draft-only, never auto-send), build a suggested-reply generator that runs after
    classification and drafts via the Gmail Drafts API (not Send), surfaced next to the parsed
    classification in the existing dashboard widget for human edit/send. Sequence after item #31
    since it's most useful once triggering is automatic, though it can be built standalone against
    the existing manual-paste path first if preferred. **Size: medium.**

33. **#138 Board Member Portal — real self-service login** — per the Assumptions Ledger default: add
    `board_member` to the live `user_role` enum, extend the existing invitation flow (#51) to support
    inviting a `board_members` row's real person by email, link the resulting `profiles` row back to
    `board_members` (new `board_members.profile_id` FK), and add a `board_meeting_attendees` join
    table so `/board/[id]` can finally scope packet visibility per-meeting instead of showing every
    packet the org has ever generated. **Size: large.**

34. **UI Redesign — "All other pages"** — Directive 4's methodology (inline `style={{}}` hex values,
    one component per session, visual verification before moving on, no FORGE/global find-replace) is
    already locked and proven on Dashboard/FlightPathHUD/Sidebar/Opportunities. What remains is
    systematic execution across the ~90+ other reachable routes indexed by #229's own
    `feature-index.ts` — treat that index as the literal punch list, working top-down by traffic/
    importance (funder detail, applications pipeline, knowledge base, settings before long-tail admin
    pages). **Size: large, ongoing (one page per session per Directive 4's own rule).**

35. **D3 ProPublica Batch Enrichment — run at scale** — `propublica-990-client.ts` + its batch script
    exist and have never been run against the full 133,812-record `foundation_directory`. Per
    Directive 1's mandatory-enrichment-waterfall, run it as a checkpointed batch job (matching the
    existing 500-record checkpoint convention used elsewhere in this pipeline). **Size: medium (code
    exists; this is an execution/monitoring task, watch for rate limits at this volume).**

36. **D5 Intelligence Library Corpus — remaining ingestion sources** — real total is already ~3,376
    sourced rows (past Directive 3's 2,000+ target), but concentrated in only 3 of 15 mandated
    sources (NIH RePORTER, NSF, USASpending/SAMHSA-HRSA); 9–11 sources (HRSA Grant Awards scraper,
    HUD CPD Awards, DOJ OJP, university grant libraries, RWJF/Casey/Kellogg foundation scrapers,
    Gates/Wellcome published-grants scrapers) have zero ingestion code at all. Build one source's
    scraper per session per `INTELLIGENCE_LIBRARY_NIGHTS_SCOPE_2026-08-13.md`'s own recommended
    pacing, reusing the RSS/Claude-extraction pattern already proven across #56 and the Universal
    Scraper templates rather than a bespoke scraper per source. Nights 2–7's *application-feature*
    work (rubrics, need-statement DB, budget/eval libraries, narrative/DNA scoring per
    `INTELLIGENCE_BUILD_ROADMAP.md`) is separate, larger downstream work once corpus volume across
    more sources is real. **Size: large, ongoing.**

37. **D6 Foundation Website Scraper — run at full 133,812-record scale** — the scraper itself is BUILT
    and its pagination bug is now fixed (item #4 above); once that fix is live-confirmed, this
    becomes a pure execution/monitoring task — let the existing weekly `foundation-enrichment-weekly`
    Railway job (S2/S4) run to completion across the full table rather than a manual one-off, and
    track progress via the existing `/api/scraper/status` route (S5). **Size: medium (execution +
    monitoring, contingent on item #4).**

---

## Tier 4 — Flagged for Reid (no safe default exists)

38. **#100/#200 Relationship Builder v2 — enable for a specific org?** The code (`RelationshipBuilderAgent`,
    Phase A scoring + Phase B multi-hop warm-intro pathfinding) is fully built, tested, and wired
    behind `platform_config.key = 'feature.relationship_builder_v2'`, default OFF for every org
    including Faith Foundation. This is a live, Claude-spending change to production behavior for
    whichever org it's flipped on for — genuinely a product/cost decision, not an engineering one,
    and prior sessions already explicitly declined to default on it. **Ask Reid:** should this be
    enabled for Faith Foundation (or any other specific org) now that it's fully tested, or left OFF
    platform-wide until there's a rollout plan?

39. **D4 — 298K Prospect CSV Import.** Confirmed four independent sessions running that the source
    file doesn't exist anywhere reachable from this sandbox (`D:\` isn't mounted at all — verified via
    a direct multi-drive-letter `fs.readdirSync()` sweep with sandboxing explicitly disabled) and no
    existing table or file in the repo holds an equivalent dataset. Building `scripts/import-prospects.ts`
    against a guessed column schema was deliberately rejected — the live, still-broken "scrambled
    columns" bug in `scripts/ingest-irs-bmf-full.ts` is the concrete cautionary precedent for what
    happens when that shortcut is taken. **Ask Reid:** either place the real CSV somewhere this
    sandbox can reach (a repo-relative path, or confirm `D:\` should actually be mounted), or supply
    the real column schema so the import script can be written and tested against real shape before
    any row is trusted.

---

## No Action Needed (technically not a clean BUILT, but genuinely finished or intentionally out of scope)

- **#36 Cold Outreach Sequences** — `BUILT — DEPRECATED, CONSOLIDATION COMPLETE`. UI redirected to
  `/email/campaigns`, the dead cron entry removed from `vercel.json`, source tables preserved
  (not dropped) per Reid's own consolidation decision. Nothing remains to build.
- **D7 DATAOCEAN Backup** — `MOOT`. Reid confirmed directly (2026-08-14) the `enrichment-output/`
  data this script protects is already scraped once and already ingested into the live app, so a
  fresh D:\ backup isn't operationally needed. Script stays in place, wired, harmless.
- **US2 camoufox-js** — `PARTIAL`, but per the Assumptions Ledger, not worth further engineering time:
  the proven fallback stack already underpins US3–US7's real, live-verified results.
- **#141 Simulation Agent (AG-41) — manual-trigger only, no schedule** — this mirrors AG-25's
  Disaster Response half's identical, deliberate manual-trigger-only design in this same codebase.
  Treat as intentional unless Reid specifically asks for a scheduled/autonomous impact-simulation
  sweep.
- **T7 Soak Tests** — `BUILT — VERIFIED (genuinely partial run)`. The AutoApply queue soak test's
  "0/50 drained in 130 minutes" result is fully root-caused (an intentional 60–120s
  per-item rate limiter, not a defect) — the test did its job and found nothing broken. No fix
  needed unless Reid wants the rate limiter itself tuned, which is a deliberate anti-detection
  choice, not a bug.

---

## Summary

- **Tier 1 (known fix, ready to apply/verify):** 17 items, almost entirely trivial-to-small —
  the single highest-leverage next session is a batched deploy + verification pass covering items
  1–3, 7, 10–13, 15, 17 (all either a DDL statement, a `vercel --prod`, or a browser check with zero
  code risk).
- **Tier 2 (small, unambiguous):** 8 items.
- **Tier 3 (larger builds):** 12 items, several explicitly "ongoing" (state portal coverage,
  UI redesign rollout, intelligence corpus sources) rather than one-and-done.
- **Tier 4 (needs Reid):** 2 items, both already-known blockers restated with their exact concrete
  asks, not new discoveries.
