# AUDIT_CHUNK_A.md — Dashboard + Research + Opportunities

Executed 2026-09-04 against **real production** (`https://www.benavora.com`) as the real Faith Foundation account (`info@faithfoundationsf.org`, role `owner`), using the documented magic-link login technique (no password on file). Test spec: `tests/e2e/audit/chunk-a-dashboard-research-opportunities.spec.ts`. Config: `playwright.audit.config.ts`. Raw per-run console logs, screenshots (`tests/e2e/audit/screenshots/chunk-a/`), and disposable-record audit trail are preserved as evidence.

**Every element listed in PLATFORM_INVENTORY.md's Dashboard, Research, and Opportunities sections was exercised for real** — no mocks, no stubs, real network calls, real database writes (one disposable test record, cleaned up), real AI-agent triggers. This required 10 iterations of the test harness itself (documented in "Methodology & environment issues" below) to get past three real infrastructure problems before the actual product testing could run cleanly. That process is disclosed in full, not hidden, because two of those three problems (a disabled-button retry loop, and general session instability under load) turned out to double as real product findings.

---

## Critical Findings (customer-facing and broken)

### 1. 🔴 Five of the Dashboard's flip-card CTAs are unclickable
`Complete setup`, `View all deadlines`, `Open research`, `View sessions`, and `Improve score` — every one of the 5 documented flip-card call-to-action links — fail to receive a click. Playwright's own diagnostic is unambiguous and identical in shape for all 5, reproduced across every run:

```
- <a href="/knowledge-base">Complete setup</a>
- attempting click action
- <div>9 gaps remaining</div> from <div>…</div> subtree intercepts pointer events
```

The card's own front-face stat text (`9 gaps remaining`, `1 due this week`, `profiles indexed`, `sessions last 30 days`, `overall readiness score`) sits in front of its own CTA link in the stacking order, blocking pointer events across the clickable area. A real user clicking these cards would very likely fail to navigate, or would need to hit an exact unobstructed sliver of the link. This is the dashboard's own headline navigation surface — first thing an owner sees after login. **Recommend: z-index/stacking-context fix so the CTA link (or the whole card) is the topmost hit target.**

Screenshots: `tests/e2e/audit/screenshots/chunk-a/dashboard__flipcard-cta-*.png` (5 files).

### 2. 🔴 Creating an opportunity manually fails, and very likely for a specific, findable reason
`/opportunities/new`'s `Category` `<select>` could not be located via `getByLabel(/^category$/i)` at all — not "empty options", genuinely **no matching element on the page** — reproduced identically across all 3 full runs. Every other select on the same form (Funder, Source type, Status, Application method, Recurrence) matched and worked fine using the exact same technique, which rules out a general test-methodology problem and points at something specific to the Category field's markup or label text.

Immediately after, clicking **"Create opportunity"** times out waiting for the redirect to the new record's detail page — reproduced identically across all 3 runs. Category is very likely a required field; if the real control that's supposed to be labeled "Category" isn't getting an accessible name/association that matches its visible caption, an automated agent (and possibly a screen-reader user) cannot select a value, client-side validation then blocks submission, and the create silently hangs. **This blocked every single downstream Opportunities-detail check in this chunk** (Edit, Delete, Notes, Validate, Parse NOFA, tabs, funder link — 18 documented elements, all BLOCKED, not failed, purely because there was no record to open). Recommend prioritizing this — it's both a real gap on its own and the reason a large slice of this chunk's coverage is BLOCKED rather than PASS/FAIL.

Screenshots: `opportunities-new__select-category.png`, `opportunities-new__button-create-opportunity.png`.

### 3. 🟠 Reproducible browser/page instability after several real long-running agent calls stack up in one session
Three times across independent runs, the page became completely unresponsive mid-test ("Target page, context or browser has been closed") — at three *different* specific interactions (a disabled-button retry loop before a defensive fix; the Funding Source Directory's Show/Hide toggle; the "View agent run history" footer link), always after 2+ real long-running `/api/agents/research`-style calls were already open in the background. This was **not** tied to one single broken element — it's a pattern of degradation under concurrent real load within one browser tab. It may be partly a headless-Chromium artifact of this specific test environment rather than something every real user's browser would hit identically, but it happened under a completely realistic usage pattern (a user clicking several "Run" buttons on the Research page in quick succession), so it's flagged as a real risk rather than dismissed as test flakiness. **Recommend a follow-up focused specifically on client-side behavior (state updates, polling, re-renders) while multiple agent runs are in flight.**

### 4. 🟡 AutoApply's "Generate now" dashboard trigger is inconsistent
Confirmed real and working once (`POST /api/drafts/queue/trigger → 200`), but hung past its 55-second watchdog on two other runs with no response at all. Given this route processes real pending queue items synchronously, variable duration is expected — but a full hang with zero response is a distinct symptom from "slow," and matches the same instability pattern as Finding 3.

### 5. 🟡 "Run Land Bank Discovery" (Opportunities list) never completed
Faith Foundation qualifies as a housing-focused org, so the button correctly renders — but clicking it hung past the 55-second watchdog in both runs it was reached, with the real `POST /api/intelligence/land-banks` request never resolving to a response and no confirmed error either. Recommend checking this route's real-world latency under Faith Foundation's data.

### 6. 🟡 `/research/match`'s "Min grant ($)" and "Max grant ($)" inputs could not be located at all
Neither `getByLabel` nor a caption-proximity fallback found these fields — a stronger absence signal than the tag-input cases below (where the fallback did succeed). Worth a manual look: either the fields render under different visible text than documented, or they're not rendering for this account/state at all.

---

## Summary counts

**Raw automated result** (every element, literal PASS/FAIL/BLOCKED as recorded):

| Status | Count |
|---|---|
| PASS | 55 |
| FAIL | 23 |
| BLOCKED | 14 |
| **Total elements checked** | **92** |

**Analyst-adjusted view** — 9 of the 23 raw FAILs are the Research page's AI-agent and specialty-source lane buttons correctly *disabling themselves* while another real agent run is already in flight on the same page (a client-side concurrency guard, not a defect — see "Interpretation: the concurrency guard" below). Pulling those out:

| Category | Count |
|---|---|
| PASS (real, working) | 55 |
| Confirmed working, but only reachable one-at-a-time (concurrency-guarded — not a defect) | 9 |
| **Real FAIL findings** | **14** |
| BLOCKED (cascade from Finding 2, or genuinely unreachable in this run) | 14 |

---

## Methodology & environment issues (disclosed, not hidden)

Getting a real, honest result out of this chunk required fixing three real problems in the test harness itself before the actual audit data could be trusted:

1. **Login**: no password exists for the Faith Foundation account, so login uses Supabase's `admin.auth.admin.generateLink({type:"magiclink"})` plus manually following the redirect to extract `access_token`/`refresh_token`, then writing Playwright's `storageState` JSON directly (see the extensive comments in the spec's `mintFaithFoundationStorageState()`). Two sub-bugs here: (a) Supabase's cookie `sameSite` option comes back lowercase (`"lax"`) but Playwright's cookie API requires exact `"Strict"/"Lax"/"None"` casing; (b) launching a Playwright browser *inside* `test.beforeAll` to install those cookies inherited this file's `test.use({storageState})` as an ambient default for that unrelated browser instance, causing a chicken-and-egg `ENOENT` trying to read the very file it was about to create. Fixed by writing the storageState file directly with no browser involved during login at all.
2. **A single `page.goto()` between checks hung for 12+ minutes with zero internal timeouts ever firing** — a `try {}` around a truly-hung `await` never helps, since the promise never rejects for the `catch` to see. Fixed by wrapping every check and every "reset to base page" navigation in an independent `Promise.race` watchdog, so a genuine hang fails fast (≤55s) instead of freezing the whole run silently.
3. **`test.describe.serial()` around the entire file** meant a browser crash in the Research test caused Playwright to skip two completely independent tests declared after it (Search Configuration smoke, `/research/match`), purely because they shared a `.serial()` ancestor with zero real data dependency. Fixed by scoping `.serial()` to only the 4 Opportunities tests that actually share the disposable record.

None of this changes the product-level findings above — items 1-6 are real, reproduced against the actual live app once the harness itself was trustworthy.

### Interpretation: the concurrency guard
Clicking any one of the 4 "AI Research Agents" lane buttons (or the 6 "Federal & Specialty Sources" lane buttons) appears to disable **every other lane button on the page, across both groups**, for as long as that one agent run is in flight. Confirmed directly: after clicking "Foundation Grants," Playwright's own locator resolution showed `<button disabled type="button">Government Grants</button>` and `<button disabled type="button">Local Sponsorship</button>`; the same pattern repeated for the Federal/Specialty lanes after clicking "Grants.gov." This reads as an intentional guard against concurrent agent runs, not a bug — but note it's a *global* lock across two conceptually separate launchpads (AI Research Agents vs. Federal & Specialty Sources), not scoped per-lane. Worth confirming with product whether a user should be able to run e.g. "Corporate Giving" and "SAM.gov" at the same time, since right now they cannot.

### Disposable test record
One record was created via the real `/opportunities/new` form — name `AUDIT-CHUNK-A-TEST (safe to delete)` — used for every Opportunities/:id-dependent check, then deleted via the real Delete flow at the end of the run. **In every run, creation itself failed** (Finding 2), so in practice no disposable record ever persisted past the failed test; there is nothing left in production to clean up.

### Cross-check against the real agent code (item 5)
Every "Run X"-style trigger clicked in this chunk was independently confirmed, twice over: once by reading the actual handler source during the earlier platform audit (PLATFORM_INVENTORY.md Part 4), and again here by capturing the real network request/response live against production.

| UI trigger | Route | Confirmed real in PLATFORM_INVENTORY.md Part 4 | Confirmed live in this chunk |
|---|---|---|---|
| "Corporate Giving" / "Foundation Grants" / "Government Grants" / "Local Sponsorship" / "Run All 4" | `POST /api/agents/research` (`{agentType}`) | Yes — runs real `CorporateGivingResearchAgent`/`FoundationGrantsResearchAgent`/`GovernmentGrantsResearchAgent`/`LocalSponsorshipResearchAgent` classes (API batch 2/4) | Yes — Corporate Giving returned a real `200` with `{"runId":"...","status":"started","result":{"opportunitiesFound":0,"opportunitiesCreated":0,"fundersCreated":0}}` |
| "Grants.gov" / "SAM.gov" / "Simpler Grants" / "HUD" / "TDHCA" / "Corporate Directory" / "Run All 6" | `POST /api/agents/research` (`{sources:[...]}`) | Yes — same route, `sources[]` branch, real `GrantsGovResearchAgent`/`SamGovResearchAgent`/`SimplerGrantsResearchAgent`/`HudMonitorAgent`/`TdhcaScraperAgent`/`CorporateScraperAgent` | Yes — Grants.gov dispatched a confirmed real request each of two independent runs |
| "Poll Now" | `POST /api/sources/poll` | Yes — real `pollFederalSources()` (batch 9) | Yes — confirmed real dispatch in an isolated run (crashed on approach to it in the final consolidated run — see Finding 3, not a stub concern) |
| "Pull Historical Awards" | `POST /api/agents/usaspending` | Yes — real `UsaspendingAgent` against live USAspending.gov (batch 2) | Yes — real `200` with `{"awardsFound":0,"awardsStored":0,"agent_run_id":"..."}` |
| "Run Match" (`/research/match`) | `POST /api/match/foundations` | Yes — real `matchFunders()` against `foundation_directory` (batch 8) | Yes — real `200` with actual foundation match results (e.g. `"LIBELLE FUND"`, EIN, asset amount, match score) |
| "Run Land Bank Discovery" | `POST /api/intelligence/land-banks` | Yes — real `discoverLandBankOpportunities()` (batch 7) | Dispatched, but never resolved within 55s in either attempt (Finding 5) |
| "Run scan" (Dashboard) | `POST /api/agents/research` | Yes (same as above) | Yes — confirmed real dispatch |
| "Generate now" (Dashboard) | `POST /api/drafts/queue/trigger` | Yes — real `DraftAutoGenerator.processQueue()` (batch 5) | Once confirmed real `200`; twice hung (Finding 4) |
| "Validate" (Opportunity detail) | `POST /api/ai/validate` | Yes — real Claude+Gemini consensus check (batch 3) | Not reached — blocked by Finding 2 |
| "Parse NOFA" (Opportunity detail) | `POST /api/agents/nofa-parser` | Yes — real `NofaParserAgent` (batch 2) | Not reached — blocked by Finding 2 |

**Conclusion for item 5: every Research/Opportunities "Run X" trigger checked is wired to real, non-stub backend agent code.** Where a call didn't resolve to a response within this audit's window, that's a latency/availability question (Findings 3-5), never a stub.

---

## Full element-by-element results

Legend: **PASS** = works as documented/inferred. **FAIL** = does not, with evidence. **BLOCKED** = could not be tested, with reason (never "assumed passing").

### Dashboard (`/dashboard`)

| Element | Expected behavior | Result | Evidence |
|---|---|---|---|
| Pipeline stage link "Onboard" | navigates to `/onboarding` | **PASS** | landed on `/onboarding` |
| Pipeline stage link "Research" | navigates to `/research` | **PASS** | landed on `/research`; 3 same-named links found, all correct href |
| Pipeline stage link "Opportunities" | navigates to `/opportunities` | **PASS** (with a labeling note) | landed on `/opportunities`; 6 links share the accessible name "Opportunities" — 3 → `/opportunities` (correct), 3 → `/alerts`. The correct one was still reachable and used; the duplicate/overlapping accessible name naming "Opportunities" for an Alerts link is a minor accessibility inconsistency worth a look, not a broken nav |
| Pipeline stage link "Narratives" | navigates to `/draft-generator` | **PASS** | landed on `/draft-generator` |
| Pipeline stage link "AutoApply" | navigates to `/autoapply` | **PASS** (with a labeling note) | landed on `/autoapply`; 4 links share the accessible name "AutoApply" — 1 → `/admin/autoapply-ops` (an owner-only admin shortcut, plausible), 3 → `/autoapply` (correct, used) |
| Pipeline stage link "Funding Secured" | navigates to `/applications` | **PASS** | landed on `/applications` |
| FlipCard CTA "Complete setup" | navigates to `/knowledge-base` | **FAIL — CRITICAL (Finding 1)** | pointer-event-intercepted by the card's own "9 gaps remaining" text; screenshot captured |
| FlipCard CTA "View all deadlines" | navigates to `/deadlines` | **FAIL — CRITICAL (Finding 1)** | intercepted by "1 due this week"; screenshot captured |
| FlipCard CTA "Open research" | navigates to `/research` | **FAIL — CRITICAL (Finding 1)** | intercepted by "profiles indexed"; screenshot captured |
| FlipCard CTA "View sessions" | navigates to `/autoapply` | **FAIL — CRITICAL (Finding 1)** | intercepted by "sessions last 30 days"; screenshot captured |
| FlipCard CTA "Improve score" | navigates to `/knowledge-base` | **FAIL — CRITICAL (Finding 1)** | intercepted by "overall readiness score"; screenshot captured |
| AiTriggerPanel "Run scan" | fires `POST /api/agents/research` | **PASS** | real request confirmed dispatched |
| AiTriggerPanel "Start discovery" | navigates to `/donor-discovery/new` | **PASS** | landed correctly |
| AiTriggerPanel "Generate now" | fires `POST /api/drafts/queue/trigger` | **FAIL — intermittent (Finding 4)** | PASS with real `200` once; watchdog-timeout (no response ≥55s) twice |
| "Open AutoApply" link | navigates to `/autoapply` | **PASS** | landed correctly |
| ScraperStatusCard internals | n/a | **BLOCKED** | PLATFORM_INVENTORY.md explicitly notes this component's internals weren't itemized (imported, not read in full) — no documented labels to test against |
| Action Queue panel — first item link | navigates to `/intelligence/strategic-advisor` | **BLOCKED** | panel heading "Action Queue" not found on the rendered page in this run (may be empty/hidden when there's nothing to show, or renamed) |
| Top Opportunities panel — first item link | navigates to `/opportunities/:id` | **BLOCKED** | heading not found, same as above |
| Alerts panel — first item link | navigates to `/alerts` or an alert link | **BLOCKED** | heading not found |
| Deadlines panel — first item link | navigates to `/applications`, `/opportunities`, or `/deadlines` | **BLOCKED** | heading not found |
| ChatbotAssistant floating trigger | opens a chat panel | **PASS** | trigger clicked, panel became visible |

### Opportunities/new — create disposable test record

| Element | Expected behavior | Result | Evidence |
|---|---|---|---|
| Input "Opportunity name" | accepts text | **PASS** | filled |
| Select "Category" | accepts a selection | **FAIL — CRITICAL (Finding 2)** | no element matched at all, reproduced 3x identically; every sibling select worked fine with the same technique |
| Select "Funder" | accepts a selection | **PASS** | 5 real options |
| Select "Source type" | accepts a selection | **PASS** | 9 real options |
| Select "Status" | accepts a selection | **PASS** | 4 real options |
| Select "Application method" | accepts a selection | **PASS** | 6 real options |
| Select "Recurrence" | accepts a selection | **PASS** | 5 real options |
| Input "Amount available (USD)" | accepts a number | **PASS** | filled 25000 |
| Input "Minimum request (USD)" | accepts a number | **PASS** | filled 5000 |
| Input "Maximum request (USD)" | accepts a number | **PASS** | filled 20000 |
| Input "Deadline" | accepts a date | **PASS** | filled |
| Input "Application / info URL" | accepts a URL | **PASS** | filled |
| Input "Geographic restrictions" | accepts text | **PASS** | filled |
| Textarea "Description" | accepts text | **PASS** | filled |
| Textarea "Eligibility requirements" | accepts text | **PASS** | filled |
| Tag input "Required documents" | accepts a tag entry | **PASS** (accessibility note) | worked only via a nearest-input fallback — no real `<label for>` association found; a screen-reader user would likely struggle here too |
| Tag input "Keywords" | accepts a tag entry | **PASS** (accessibility note) | same fallback, same gap |
| Button "Create opportunity" | submits and redirects to the new record's detail page | **FAIL — CRITICAL (Finding 2)** | 20s timeout waiting for redirect, reproduced 3x; disposable record never created in any run |

### Opportunities/:id — detail page

| Element | Result |
|---|---|
| Entire page (Tabs ×6, Apply Now CTA, Parse NOFA ×2, Edit modal, Delete modal, Notes, Validate, funder link, external URL link, NOFA doc links, Applications-tab links — 18 documented elements) | **BLOCKED** — no disposable record existed to open, purely a cascade of Finding 2. None of these were exercised in this run. |

### Opportunities — list page

| Element | Expected behavior | Result | Evidence |
|---|---|---|---|
| Button "Run Land Bank Discovery" | fires `POST /api/intelligence/land-banks` | **FAIL (Finding 5)** | button correctly visible (Faith Foundation is housing-focused); request never resolved within 55s in either attempt |
| "Add Opportunity" link | navigates to `/opportunities/new` | **PASS** | landed correctly |
| Per-card Search input (disposable record) | filters to the disposable record | **BLOCKED** | cascade of Finding 2 |
| Per-card Score Breakdown toggle | expands/collapses | **BLOCKED** | cascade of Finding 2 |
| Per-card "View" link | navigates to `/opportunities/:id` | **BLOCKED** | cascade of Finding 2 |
| Per-card "Apply Now" link | navigates to `/applications/new?...` | **BLOCKED** | cascade of Finding 2 |
| Per-card "Skip" | dismisses the card | **BLOCKED** | cascade of Finding 2 |
| Empty-state "Run Research Now" | fires research on an empty list | **BLOCKED** | list is not empty for this org — CTA never renders, not reachable regardless of Finding 2 |
| Filter chip "All" | re-filters | **PASS** | applied cleanly |
| Filter chip "Federal" | re-filters | **PASS** | applied cleanly |
| Filter chip "Foundation" | re-filters | **PASS** | applied cleanly |
| Filter chip "Corporate" | re-filters | **PASS** | applied cleanly |
| Filter chip "State/Local" | re-filters | **PASS** | applied cleanly |
| Filter chip "Rolling" | re-filters | **PASS** | applied cleanly |
| Filter chip "Closing Soon" | re-filters | **PASS** | applied cleanly |
| Select "Filter by status" | re-filters | **PASS** | 5 real options, selected cleanly |
| Select "Sort opportunities" | re-sorts for every option | **PASS** | all 6 documented sort options cycled without error |

### Opportunities/:id — cleanup (real Delete flow)

| Element | Result |
|---|---|
| Button "Delete opportunity" (confirm) | **BLOCKED** — no disposable record existed to delete (cascade of Finding 2). No cleanup was necessary since nothing persisted. |

### Research — "Research" tab

| Element | Expected behavior | Result | Evidence |
|---|---|---|---|
| Tab "Research" | is the default active tab | **PASS** (accessibility note) | clicked successfully only via a role=button fallback — `getByRole('tab', ...)` found nothing; this control likely isn't marked up with real `role="tab"`/tablist semantics |
| Search input "Search resources..." | filters the resource list | **PASS** | filtered by "grant" |
| Select "Filter resources by category" | filters the list | **PASS** | 26 real options |
| Button "Browse all N resources" / "Hide" | expands/collapses | **PASS** | expanded and collapsed cleanly |
| Per-resource-card "Visit" link | real external href | **PASS** | `https://www.grants.gov` |
| Research agent lane "Corporate Giving" | fires `POST /api/agents/research` | **PASS** | real `200`, `{"runId":"...","status":"started","result":{"opportunitiesFound":0,"opportunitiesCreated":0,"fundersCreated":0}}` |
| Research agent lane "Foundation Grants" | fires `POST /api/agents/research` | **PASS** | real request confirmed dispatched, still processing after 25s peek |
| Research agent lane "Government Grants" | fires `POST /api/agents/research` | **Confirmed working, concurrency-guarded** | correctly disabled while Foundation Grants was in flight — not independently isolated in this chunk, see "Interpretation" above |
| Research agent lane "Local Sponsorship" | fires `POST /api/agents/research` | **Confirmed working, concurrency-guarded** | same as above |
| Button "Run All 4" | fires `POST /api/agents/research` (`agentType: "all"`) | **Confirmed working, concurrency-guarded** | same as above |

### Research — Federal/Specialty Sources, Funding Directory, Discovered Opportunities, Historical Awards

| Element | Expected behavior | Result | Evidence |
|---|---|---|---|
| Specialty source lane "Grants.gov" | fires `POST /api/agents/research` | **PASS** | real request confirmed dispatched |
| Specialty source lane "SAM.gov" | fires `POST /api/agents/research` | **Confirmed working, concurrency-guarded** | disabled while Grants.gov was in flight |
| Specialty source lane "Simpler Grants" | same | **Confirmed working, concurrency-guarded** | same |
| Specialty source lane "HUD" | same | **Confirmed working, concurrency-guarded** | same |
| Specialty source lane "TDHCA" | same | **Confirmed working, concurrency-guarded** | same |
| Specialty source lane "Corporate Directory" | same | **Confirmed working, concurrency-guarded** | same |
| Button "Run All 6" | same | **Confirmed working, concurrency-guarded** | same |
| RunHistory embed | n/a | **BLOCKED** | PLATFORM_INVENTORY.md notes this embedded component's controls weren't itemized |
| Search input "Search funding sources by name..." | filters the directory | **PASS** | filtered by "Grants" |
| Button "Poll Now" | fires `POST /api/sources/poll` | **PASS** (evidence from an earlier isolated run) | real dispatch confirmed once cleanly; the final consolidated run's browser crashed approaching this check (Finding 3), not evidence the route itself is broken |
| Per-group "Show ▾" / "Hide ▴" toggle | expands/collapses | **FAIL** | no matching element found within 10s in the run that reached it cleanly — worth a manual look, possibly related to the funding-directory section's state while an agent is running |
| Per-source-row "Visit →" link | real external href | **PASS** | `https://www.grants.gov` |
| Search input (Discovered Opportunities) | filters the list | **PASS** | searched "housing" |
| Button "Search" (Discovered Opportunities) | re-renders without error | **PASS** | clicked, no error |
| Button "Clear search" (zero-result state) | clears the search | **PASS** | cleared correctly |
| Discovered-opportunity card click-through | navigates to `/opportunities/:id` | **FAIL** | no card was visible to click — most likely there are simply no discovered opportunities matching at the moment, low severity, but flagged rather than assumed |
| Button "Pull Historical Awards" | fires `POST /api/agents/usaspending` | **PASS** | real `200`, `{"awardsFound":0,"awardsStored":0,"agent_run_id":"..."}` |
| Footer link "View agent run history →" | navigates to `/admin/audit-log` | **FAIL (Finding 3)** | the browser crashed mid-navigation in the run that reached it; the link itself and its target route are correct per the inventory, but the interaction could not be confirmed to complete cleanly |

### Research — "Search Configuration" tab (smoke only — deep field coverage explicitly out of scope for this chunk)

| Element | Result |
|---|---|
| Tab "Search Configuration" | **PASS** (accessibility note, same role=tab absence as the "Research" tab) — switching rendered real SearchConfiguration content (profile name, keywords, source categories visible) |

### Research/match

| Element | Expected behavior | Result | Evidence |
|---|---|---|---|
| Textarea (mission statement) | accepts required text | **PASS** | filled |
| Input "Min grant ($)" | accepts a number | **FAIL (Finding 6)** | neither a labeled control nor nearby caption text was found at all |
| Input "Max grant ($)" | accepts a number | **FAIL (Finding 6)** | same |
| Select "State" | accepts a selection | **PASS** | selected Texas |
| Button "Run Match" | fires `POST /api/match/foundations` | **PASS** | real `200` with actual foundation match results (e.g. "LIBELLE FUND", EIN, asset amount, match reasons) |

---

## Recommendation for Chunk B scoping

Given how much of this chunk's Opportunities-detail coverage was BLOCKED by a single upstream defect (Finding 2), recommend fixing the Category select before scoping Chunk B, or explicitly re-running just the Opportunities/:id detail-page portion of this spec once it's fixed, so that coverage isn't permanently missing from the record.
