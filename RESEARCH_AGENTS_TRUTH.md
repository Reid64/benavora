# Research Agents 12–21 — Ground Truth

**Audit date:** 2026-09-05. **Auditor:** Claude (live code inspection + live production DB/API queries, this session). **Scope:** file existence, standalone compilation, production route wiring, live external-source smoke tests, and a direct query of the live `opportunities` table for every agent numbered 12 through 21.

Every claim below is labeled **VERIFIED** (directly observed this session), **INFERRED** (evidence supports but doesn't prove it), or **CARRIED FORWARD** (a pre-existing finding from `AGENT_VERIFICATION_LOG.md`/`NOT_BUILT_MASTER_INVENTORY.md`, independently re-confirmed this session via source inspection, not silently trusted). No status was upgraded to REAL without a new, specific observation cited inline.

---

## 0. Which "Agent 12–21" this document is about — a numbering collision, resolved

This codebase has **two different, overlapping agent-numbering schemes**, and the task's own checklist (external-source polling, `opportunities` table writes grouped by `source`) only matches one of them:

- **`AGENTS_v2.md`'s `AG-NN` scheme** — AG-12 AutoApply, AG-13 Foundation Enrichment, AG-14 Donor Discovery, AG-15 Grant Probability, AG-16 Digital Twin Builder, AG-17 Opportunity Discovery, AG-18 Reputation Intelligence, AG-19 Relationship Builder, AG-20 Corporate Giving Detector, AG-21 Executive Biography Analyzer. None of these except AG-17 write to `opportunities`; most write to `organizational_digital_twins`, `reputation_signals`, `corporate_prospects.enrichment`, etc. This scheme does not fit the task's method.
- **`governance/AGENTS.md`'s plain `Agent NN` scheme (v2.0, "Tier 6 Agents")** — Agent 15 Grants.gov, Agent 16 SAM.gov, Agent 17 ProPublica 990 Mining, Agent 18 State Portal, Agent 19 Custom API, Agent 20 Custom Scrape, Agent 21 Giving History Extractor. Agents 15/16/18/19/20 all write directly to `opportunities` with a `source` value per their own spec text. **This is the scheme the task's method describes**, and it is independently self-confirmed inside the codebase: every one of these 7 route files carries its own header comment citing "AGENTS.md Agent NN" (e.g. `src/app/api/agents/grants-gov/route.ts:1` → "AGENTS.md Agent 15"), and `src/lib/agents/scheduler.ts:23` literally says "Tier 6 agent scheduler (AGENTS.md Agents 15-20, BEHAVIORAL_CONTRACTS §17-21…)".

**This document uses the `governance/AGENTS.md` numbering.** Agents 15–21 are documented there and mapped to real files below.

**Agents 12, 13, and 14 in this scheme have no discoverable specification anywhere in the repository — this is a confirmed blocker, not an oversight of this audit.** `governance/AGENTS.md:9-11` states verbatim: *"Agents 1-14 remain as defined in AGENTS.md v1.0. This document defines only the new Tier 6 agents [15-29]."* No file named `AGENTS.md v1.0` (or any variant) exists anywhere in the repository (`find . -iname "AGENTS.md"` returns only the FORGE-tooling `AGENTS.md` at repo root — unrelated — and `governance/AGENTS.md`, the v2.0 doc itself). Independently, `governance/BEHAVIORAL_CONTRACTS.md:9` makes the identical claim for contracts 1-16 ("Existing Contracts (1-16) — Unchanged") with the same result: no such content exists in this repo. Two independent documents both reference a "v1" predecessor that cannot be found. **VERIFIED**, via `find`/`grep` across the full repository tree, no hits.

Per the task's explicit instruction to escalate rather than invent a plausible-sounding substitute, this audit does **not** guess which of the ~90 other files under `src/lib/agents/` might retroactively be "Agent 12/13/14" — doing so would fabricate a mapping with no citation behind it.

---

## 1. Summary table

| # | Name | Real file | Route | Status | Opportunities-table evidence (live, 2026-09-05) |
|---|---|---|---|---|---|
| 12 | *(unspecified)* | — | — | **BLOCKED — spec missing** | N/A |
| 13 | *(unspecified)* | — | — | **BLOCKED — spec missing** | N/A |
| 14 | *(unspecified)* | — | — | **BLOCKED — spec missing** | N/A |
| 15 | Grants.gov Research Agent | `src/lib/agents/grants-gov.ts` | `POST /api/agents/grants-gov` | **PARTIAL** | `source='grants.gov'`: 341 rows, max `discovered_at` **2026-08-15** (stale 3 weeks) |
| 16 | SAM.gov Research Agent | `src/lib/agents/sam-gov.ts` | `POST /api/agents/sam-gov` | **PARTIAL** (effectively non-functional) | `source='sam.gov'`: **0 rows, ever** |
| 17 | ProPublica 990 Mining Agent | `src/lib/agents/propublica.ts` | `POST /api/agents/propublica` | **PARTIAL** (read-only; persistence unbuilt) | N/A by design — writes nothing to any table |
| 18 | State Portal Research Agent | `src/lib/agents/state-portal.ts` | `POST /api/agents/state-portals` | **PARTIAL** (effectively non-functional) | `source='texas'` (its only registered portal): **0 rows, ever** |
| 19 | Custom API Research Agent | `src/lib/agents/custom-api.ts` | `POST /api/agents/custom-api` | **BLOCKED** (zero config, cannot run) | `custom_api_connections`: **0 rows** — no connection has ever existed |
| 20 | Custom Scrape Research Agent | `src/lib/agents/custom-scrape.ts` | `POST /api/agents/custom-scrape` | **PARTIAL** (configured, never run) | `scraping_targets`: 1 row, `last_scraped_at`/`last_success_at` both **null** since creation (2026-08-18) |
| 21 | Giving History Extractor | `src/lib/agents/giving-history.ts` | `POST /api/agents/giving-history` | **PARTIAL** (ran once, extracted nothing) | N/A by design — writes to `funders`/`funder_intelligence`, not `opportunities` |

All 7 documented agent files (15–21) exist, are imported by real (non-stub) route handlers, and compile cleanly as part of the full project: **`pnpm tsc --noEmit` exits 0, zero errors** (VERIFIED, run this session, output captured below in §5). All 7 routes are confirmed live and mounted in production (§3).

**None of the pre-existing PARTIAL/BLOCKED flags in `NOT_BUILT_MASTER_INVENTORY.md` / `AGENT_VERIFICATION_LOG.md` for this family were silently dropped** — Agents 15/17/18 had prior documentation (§4 below cites it exactly); Agents 16/19/20/21 had **no prior entry under either numbering scheme** in `AGENT_VERIFICATION_LOG.md` (grep for `AG-16`, `AG-19` there returns only the *different* `AGENTS_v2.md` AG-16/AG-19 entries, e.g. AG-19 Relationship Builder — a different agent entirely). Their statuses here are first-time findings, not upgrades of anything.

---

## 2. The single most important finding: two of seven agents have never written a single row to production, ever

The task's method calls the direct table query "the single most important check in this audit because a silently no-op agent is indistinguishable from a working one without it." That check found exactly this:

- **Agent 16 (SAM.gov)** is real code, compiles, is wired into a live-authenticated route (VERIFIED 405-vs-404 test, §3), and is *also* invoked automatically every day through a separate, already-cron'd pipeline (`src/lib/agents/research/government-grants.ts:570-599`, `runSamGovBranch`, called from the daily `/api/cron/research` sweep). Despite that, a direct query of all 3,262 live `opportunities` rows shows **zero** with `source='sam.gov'** — the exact literal string this class hardcodes at its own insert call (`src/lib/agents/sam-gov.ts:318,328`). VERIFIED via live REST query against production Supabase, this session.
- **Agent 18 (State Portal)** shows the identical pattern: real file, real wired route, but **zero** rows with `source='texas'` (the only portal in its real registry, `src/lib/sources/state-portals/portal-registry.ts:32-37`) despite the underlying vendor page (`egrants.gov.texas.gov/fundingopp`) being live and returning real content (VERIFIED, §3).

In both cases, real-looking data *does* exist in `opportunities` under superficially similar source tags (`sam_gov` underscore, 100 rows, fresh as of today; `ca_grants_portal`/`hcr.ny.gov`/`land_bank`, hundreds of rows, fresh as of today) — but tracing those exact literal strings through the codebase (`grep -rn '"sam_gov"' src/`) shows they are written by **entirely different, unrelated modules** (`src/lib/sources/samgov-client.ts`, `src/lib/sources/federal-grants-poller.ts`, `src/lib/sources/state-portals/ca-grants-portal-sync.ts`, `src/lib/agents/state-scrapers.ts`) that are not part of this numbered roster at all. Without this exact check, both agents would have looked "wired and presumably working" from route/compile inspection alone — which is precisely the false-confidence scenario the task warned about. **VERIFIED.**

Agent 15 shows a milder version of the same thing: its own class (`source='grants.gov'`, dotted) has 341 historical rows but stopped growing on 2026-08-15, while a parallel implementation (`grantsgov-sync.ts`, `source='grants_gov'`, underscore) has 977 rows and is still growing daily. This is **CARRIED FORWARD**, not new — the class's own file header (`grants-gov.ts:19-29`) already documents a live-verified indefinite-hang bug found 2026-08-04, and explicitly says the real cron intentionally avoids this class. The 2026-08-15 stale date is new, directly-observed corroborating evidence for that pre-existing finding, not a fresh discovery.

---

## 3. Route wiring — live production verification (not just source-code inspection)

An unauthenticated probe of these routes is **not a valid test** — `middleware.ts` blanket-redirects every `/api/agents/*` path to `/login` with `307`, including a deliberately-invented nonexistent path used as a negative control. This was discovered and ruled out this session (VERIFIED):

```
POST/GET https://www.benavora.com/api/agents/grants-gov            (unauthenticated) -> 307 → /login
POST/GET https://www.benavora.com/api/agents/totally-fake-xyz-route (unauthenticated) -> 307 → /login   (same result — proves nothing)
```

To get a real signal, this session minted a genuine authenticated session for the real Faith Foundation account (`info@faithfoundationsf.org`, the same documented technique used in `tests/e2e/audit/chunk-a-dashboard-research-opportunities.spec.ts`: `supabase.auth.admin.generateLink({type:"magiclink"})` → follow the redirect → extract tokens → `@supabase/ssr` `setSession` → real `Set-Cookie` values), then sent a **GET** (not POST, to avoid triggering a real write/Claude call against production) to each route plus one fake control path. A real POST-only route answers GET with Next.js's own `405 Method Not Allowed`; a route that doesn't exist answers `404`:

```
agents/grants-gov                        -> HTTP 405
agents/sam-gov                           -> HTTP 405
agents/propublica                        -> HTTP 405
agents/state-portals                     -> HTTP 405
agents/custom-api                        -> HTTP 405
agents/custom-scrape                     -> HTTP 405
agents/giving-history                    -> HTTP 405
agents/totally-fake-xyz-route-control    -> HTTP 404   (negative control — confirms the test discriminates real from fake)
```

**VERIFIED**, live, this session (`scripts/audit/ag15-21-truth/mint-and-test-routes.mjs`). All 7 routes are genuinely deployed and mounted in production — none 404s, none 500s. This deliberately does **not** exercise the POST handlers themselves (which would perform real writes/Claude calls against a real customer's production data) — that would not be a safe, read-only test.

---

## 4. Per-agent detail

### Agent 12 / 13 / 14 — BLOCKED, no specification exists
No file, route, or table can be attributed to these slots without fabricating a mapping. See §0 for the two independent, cross-confirming pieces of evidence (`governance/AGENTS.md`'s and `governance/BEHAVIORAL_CONTRACTS.md`'s references to a missing "v1" predecessor). **Escalating, not guessing.**

### Agent 15 — Grants.gov Research Agent — PARTIAL
- File: `src/lib/agents/grants-gov.ts`, 790 lines. **VERIFIED** exists.
- Route: `POST /api/agents/grants-gov`, confirmed live in production (§3). **VERIFIED.**
- The class's own header comment (lines 19-29) documents a **CARRIED FORWARD** finding: live-invoked directly and confirmed to hang indefinitely (2026-08-04 session), and states the real daily cron (`vercel.json`: `/api/cron/grantsgov`, `0 7 * * *`) deliberately uses a different module (`src/lib/sources/grantsgov-sync.ts`) instead.
- Live `opportunities` query (this session): `source='grants.gov'` (this class's own literal tag) → **341 rows, max(discovered_at) = 2026-08-15T05:43:32Z**. `source='grants_gov'` (the parallel `grantsgov-sync.ts` pipeline) → **977 rows, max(discovered_at) = 2026-09-04T07:01:46Z** (fresh, i.e. actively running daily). **VERIFIED.**
- Live external-source smoke test (this session): `POST https://apply07.grants.gov/grantsws/rest/opportunities/search/` with `{"keyword":"housing","rows":3}` → **HTTP 200**, `hitCount: 198`, sample: *"FAIR HOUSING INITIATIVES PROGRAM PRIVATE ENFORCEMENT INITIATIVE"* (HUD, oppNumber `OFH-2600-DC-021C`). The vendor API itself is fully live; the defect is specific to this class. **VERIFIED.**

### Agent 16 — SAM.gov Research Agent — PARTIAL (effectively non-functional in production)
- File: `src/lib/agents/sam-gov.ts`, 346 lines. **VERIFIED** exists.
- Route: `POST /api/agents/sam-gov`, confirmed live (§3). **VERIFIED.**
- Also reachable via an automated path: `src/lib/agents/research/government-grants.ts:570-599` (`runSamGovBranch`) instantiates this exact class and is itself called by the `government_research` family, which **is** cron'd daily via `/api/cron/research`. This is new evidence this session — not previously documented as "scheduled" anywhere found. **VERIFIED** via source inspection.
- Live `opportunities` query (this session): `source='sam.gov'` (this class's literal insert tag, `sam-gov.ts:318,328`) → **0 rows**, in either the manual or the cron-triggered path. This is a first-time finding — no prior `AGENT_VERIFICATION_LOG.md` entry exists for this agent under either numbering scheme. **VERIFIED.**
- Live external-source smoke test (this session): `GET https://api.sam.gov/prod/opportunities/v2/search` using the real `SAM_GOV_API_KEY` from `.env.local` → **HTTP 200**, `totalRecords: 155`, real live contract/grant data returned. The vendor API and key are both live and functional; the failure is specific to why this class's own insert never lands a row (root cause not diagnosed this session — out of scope for a read-only audit; flagging for a follow-up session). **VERIFIED** (API is live) / **UNKNOWN** (why the insert never succeeds).

### Agent 17 — ProPublica 990 Mining Agent — PARTIAL (read path real; persistence layer per spec entirely unbuilt)
- File: `src/lib/agents/propublica.ts`, 264 lines. **VERIFIED** exists.
- Route: `POST /api/agents/propublica`, confirmed live (§3). **VERIFIED.**
- Full-file grep for `insert|upsert|update(` in `propublica.ts` returns **zero matches** — this agent performs no database writes of any kind. It queries ProPublica live and returns results directly to the HTTP caller. **VERIFIED.**
- This contradicts its own spec (`governance/AGENTS.md:159-169`): "create new funder record... queue for Giving History Extractor" — neither step exists in code. (The spec text itself also misnumbers its own cross-reference, calling the Giving History Extractor "Agent 22" in prose while its own section header two entries later reads "Agent 21" — a pre-existing internal inconsistency in the spec document, noted for completeness, not attributable to the code.)
- The `opportunities`-table check is correctly **not applicable** to this agent — it was never expected to write there per actual code behavior.
- Live external-source smoke test (this session): `GET https://projects.propublica.org/nonprofits/api/v2/search.json?q=faith+foundation&state[id]=CA` → **HTTP 200**, `total_results: 68`, sample: *"Hope & Faith Foundation"*, EIN `46-0643581`, Los Angeles CA. **VERIFIED.**

### Agent 18 — State Portal Research Agent — PARTIAL (effectively non-functional; spec's config source doesn't exist)
- File: `src/lib/agents/state-portal.ts`, 306 lines. **VERIFIED** exists.
- Route: `POST /api/agents/state-portals`, confirmed live (§3). **VERIFIED.**
- Its own spec (`governance/AGENTS.md:193`) says it reads config from a `state_portals` table. Live query: `GET .../rest/v1/state_portals` → **HTTP 404** ("relation not found" — the table does not exist in the live schema at all). **VERIFIED.**
- Real code instead reads a hardcoded, dependency-free registry (`src/lib/sources/state-portals/portal-registry.ts:32-37`) containing **exactly one** entry: Texas (`egrants.gov.texas.gov/fundingopp`).
- Live `opportunities` query (this session): `source='texas'` (this class's literal insert tag, `state-portal.ts:247`) → **0 rows, ever**. **VERIFIED.**
- The superficially similar-looking rows in the data (`ca_grants_portal`: 200 rows; `hcr.ny.gov`: 45 rows; `land_bank`: 30 rows — all fresh through today) trace via `grep` to unrelated modules (`ca-grants-portal-sync.ts`, `state-scrapers.ts`, `land-bank-client.ts`, `housing-specific-scrapers.ts`), not to this agent. **VERIFIED.**
- Live external-source smoke test (this session): `GET https://egrants.gov.texas.gov/fundingopp` → **HTTP 200**, 31,500 bytes, real page titled *"Funding Opportunities | eGrants"*. The one registered vendor portal is fully live; the class has simply never produced output. **VERIFIED.**

### Agent 19 — Custom API Research Agent — BLOCKED (zero configuration; structurally cannot run)
- File: `src/lib/agents/custom-api.ts`, 386 lines. **VERIFIED** exists.
- Route: `POST /api/agents/custom-api`, confirmed live (§3). Its own header comment self-documents: *"Manual-trigger-only… Not wired into any autonomous/scheduled pipeline"* — a disclosed, not hidden, design choice. **VERIFIED.**
- Live query of `custom_api_connections` (this session): **0 rows**. No organization has ever configured one. **VERIFIED.**
- No live external-source smoke test is possible or safe — there is no connection URL/config to test against. Escalating this as a genuine data-side BLOCKED condition rather than fabricating a connection to poll.
- The `opportunities`-table check is trivially "0 rows attributable," consistent with zero possible executions.

### Agent 20 — Custom Scrape Research Agent — PARTIAL (configured exactly once, never actually run)
- File: `src/lib/agents/custom-scrape.ts`, 355 lines. **VERIFIED** exists.
- Route: `POST /api/agents/custom-scrape`, confirmed live (§3). **VERIFIED.**
- Live query of `scraping_targets` (this session): **1 row**, created 2026-08-18T15:25:12Z, `url = "https://simpler.grants.gov/search?utm_source=Grants.gov"`, `last_scraped_at = null`, `last_success_at = null`. This target has never been scraped since it was created 18 days ago. **VERIFIED.**
- Per its own contract (Contracts §21, cited in-code at `custom-scrape.ts`), this class writes `source = "scrape:" + targetURL`. Live `opportunities` query: **zero rows with any `"scrape:"`-prefixed source**, across all 3,262 rows. **VERIFIED.**
- Live external-source smoke test (this session): `GET` the one real target URL → **HTTP 200**, 608,949 bytes, real page titled *"Search | Simpler.Grants.gov"*. The target is fully live and fetchable — the gap is that nothing has ever triggered a real run against it. **VERIFIED.**

### Agent 21 — Giving History Extractor — PARTIAL (ran at least once; extracted nothing)
- File: `src/lib/agents/giving-history.ts`, 204 lines. **VERIFIED** exists.
- Route: `POST /api/agents/giving-history`, confirmed live (§3); independently rate-limited (10/min/org) and tier-gated. **VERIFIED.**
- Writes only to `funders` and `funder_intelligence` (`giving-history.ts:63,114`) — **zero** references to `opportunities` anywhere in the file. The `opportunities`-table check is correctly **not applicable** to this agent, exactly as its spec describes (a data-extraction agent, not an opportunity-discovery agent). **VERIFIED.**
- Live query of `funder_intelligence` (this session): **1 real row** exists (`funder_id 3a0bc27b-30df-4d4d-9d86-1f0738cab85d`, `updated_at = 2026-08-23T06:57:50Z`) — but its `recent_grants` field is `[]`, an empty array. The one real invocation completed but extracted zero giving-history entries. **VERIFIED.**
- Live external-source smoke test (this session): ProPublica's per-organization filing endpoint for a real, well-documented private foundation (Ford Foundation, EIN `13-1684331`) → **HTTP 200**, `filings_with_data.length = 11`, most recent tax year **2023**. The underlying data source has substantial real, extractable filing history; the empty `recent_grants` result on the one real production row is not because ProPublica has nothing to offer for that funder (root cause not diagnosed — out of scope for a read-only audit). **VERIFIED** (source has data) / **UNKNOWN** (why the one real run extracted none).

---

## 5. Acceptance criterion 5 — `pnpm tsc --noEmit`

Run this session, from repo root, after all investigation and before writing this file. Ad hoc investigation scripts live under `scripts/audit/ag15-21-truth/*.mjs` (plain Node ESM, no TS project membership, so they cannot affect this result):

```
$ pnpm tsc --noEmit
(zero output)
$ echo $?
0
```

**VERIFIED — exits 0, zero errors.** This audit introduced no code drift; no application code was written or modified (per this task's own non-goal).

---

## 6. What this audit did *not* do (explicit non-coverage)

- Did not root-cause *why* Agent 16's and Agent 18's inserts never land a row in production (both confirmed live-reachable code paths with a live-reachable vendor API on the other end) — that is a real, open, separately-actionable defect, not resolved here.
- Did not execute any of the 7 routes' real POST handlers against production — doing so would perform real writes and real Claude-API spend against a live customer org (Faith Foundation), which is not a safe read-only smoke test. Route liveness was instead proven via an authenticated GET-vs-404 differential test (§3), and each agent's actual behavior was proven via direct inspection of its insert call plus a live query of the resulting table state.
- Did not attempt to identify Agents 12/13/14 by inference from other source files — see §0.

---

## 7. 2026-09-06 re-check — "Agent 18 Women/Minority-Focused Grants" and "Agent 21 Environmental/Climate Grants" do not exist under either numbering scheme in this repo

**A follow-up task asked this document to re-verify a prior BLOCKED finding for "Agent 18 Women and Minority Focused Grants" and "Agent 21 Environmental and Climate Grants."** No such finding exists anywhere in this file, or anywhere else in the repository. This section documents that mismatch explicitly (escalating per the task's own instruction, rather than silently substituting a plausible-sounding mapping) and then answers the real, checkable substance of the request anyway, since it stands on its own regardless of which agent number it's filed under.

- §1/§4 above establish, under the `governance/AGENTS.md` numbering this document uses: **Agent 18 = State Portal Research Agent**, **Agent 21 = Giving History Extractor**. Neither is a demographic- or environment-focused grant discovery agent, and neither's PARTIAL/BLOCKED status in §1 cites "no free structured public data source" as the reason.
- The other live numbering scheme in this codebase, `AGENTS_v2.md`'s `AG-NN` (see `NOT_BUILT_MASTER_INVENTORY.md`), gives **AG-18 = Reputation Intelligence** and **AG-21 = Executive Biography Analyzer** — also neither a demographic- nor environment-focused grants agent.
- A full-repository, case-insensitive search for `"Women and Minority"`, `"Environmental and Climate"`, `WBENC`, `NMSDC`, `MBDA`, `WMBE`/`MWBE`, and `women.owned`/`minority.owned` (excluding `node_modules`) turns up **zero** matches describing any such agent, spec, or prior BLOCKED finding — including in `NOT_BUILT_MASTER_INVENTORY.md`, `AGENT_VERIFICATION_LOG.md`, `governance/AGENTS.md`, `governance/AGENTS_v2.md`, `governance/Feature_Registry.md`, and `FEATURE_REGISTRY_v2.md`. **VERIFIED**, this session, via repo-wide `grep`.
- **Conclusion: this is a task-premise collision, the same pattern already documented in memory for other tasks in this project** — a task description cites a specific prior finding/agent identity that cannot be located in the codebase it claims to come from. No prior report is being second-guessed here, because no such prior report exists to re-verify.

Rather than fabricate which numbered agent this was "supposed" to be, the two underlying substantive questions the task actually asked — *is there now a free structured data source for (a) women/minority-owned-business-focused grants, and (b) environmental/climate-focused grants* — were re-checked live and directly, since they're independently answerable without needing a matching prior citation.

### 7a. Women/minority-owned-business grants — re-confirmed BLOCKED, no new source, live-checked 2026-09-06

- **WBENC WBENCLink2.0** — `https://www.wbenc.org/wbenclink` **404s**; the real live URL is `https://wbenc.wbenclink.org/` (**HTTP 200**, confirmed via the link on WBENC's own homepage). Its page title is *"WBENCLink - Women's Business Enterprise National Council"* and its body contains only a username/password login form (`grep` for `login|username|password` on the fetched HTML: all four present; no `api`, no public search, no directory listing). This is a certification-management portal for WBE-certified businesses and their corporate sponsors to log in — **not a grants database, and not publicly queryable at all**, gated or otherwise. **VERIFIED**, live fetch this session.
- **NMSDC** (`https://nmsdc.org`) — **HTTP 200**, live and reachable, but it is the same category of organization as WBENC: a minority-business **supplier certification and corporate-matching** body, not a grants-listing service. Its homepage carries a generic WordPress site-search (`?s={term}`), not a grants API or dataset. **VERIFIED**, live fetch this session — no evidence of any grants-data offering was found.
- **MBDA.gov** (`https://www.mbda.gov`) — **HTTP 403**, `Cf-Mitigated: challenge` header present — this is a Cloudflare JS bot-challenge wall, not a true outage (confirmed by inspecting response headers; retried with a browser-like `User-Agent`, same 403/challenge). Separately, and independent of the bot-wall: MBDA has **no Grants.gov agency code of its own** — live queries against `api.grants.gov/v1/api/search2` for both `{agencies:"MBDA"}` and `{agencies:"DOC-MBDA"}` return **0 hits each**, so even if MBDA.gov itself were scrapeable, MBDA's own funding announcements are not independently reachable through Grants.gov's structured agency filter either. **VERIFIED**, live queries this session.
- **Grants.gov's new `fundingCategories`/`agencies` parameters** (added to `searchGrantsGovOpportunities` in `src/lib/sources/grantsgov-client.ts` by a sibling task this session, confirmed via `git diff` — real, present in the working tree) — **do not** carry any women/minority-ownership category or eligibility code. Live-tested this session: a made-up code (`fundingCategories:"ZZINVALID"`) returns 0 hits (proving the server actually validates/filters rather than ignoring the field), and Grants.gov's real published category taxonomy (Agriculture, Arts, Business and Commerce, Community Development, Education, Employment/Labor/Training, Energy, Environment, Health, Housing, Natural Resources, Science and Technology, Transportation, etc.) contains no demographic-ownership category. A bare keyword search for `"minority owned business"` returns 483 hits, but the top results are unrelated NASA/Navy/State-Department programs — the exact keyword false-positive pattern this task's own non-goals explicitly forbid presenting as a real structured match. **VERIFIED**, live queries this session.
- **Conclusion: BLOCKED remains accurate as of 2026-09-06.** No free, structured, non-keyword-hack data source for women/minority-owned-business-focused grants exists among WBENC, NMSDC, MBDA.gov, or Grants.gov's own category/agency taxonomy. Per the task's explicit non-goal, no keyword-based workaround was built or presented as a substitute. **No code was written for this half of the re-check.**

### 7b. Environmental/climate-focused grants — genuinely new real option found via Grants.gov category filtering; minimal implementation built

Unlike the demographic case, Grants.gov's own official funding-category taxonomy **does** include real, agency-assigned categories for this vertical: `ENV` (Environment), `NR` (Natural Resources), and `EN` (Energy). These were live-verified this session to be real server-side filters, not keyword matching:

- `{fundingCategories:"ZZINVALID"}` → 0 hits (server validates the field).
- `{fundingCategories:"ENV"}` alone → 74 hits (down from a 1,025-hit unfiltered baseline).
- `{fundingCategories:"NR"}` alone → 38 hits, including genuinely on-topic results like *"NOAA Great Lakes Fish Habitat Restoration Partnership Grants"*.
- `{agencies:"EPA", fundingCategories:"ENV|NR|EN"}` → 3 hits, all genuinely environmental (Brownfields Job Training, Clean Water Act §319 Nonpoint Source Management, Contaminated Alaska Native Claims Settlement Act Lands) — narrower than `{agencies:"EPA"}` alone (4 hits), confirming the two filters genuinely AND together server-side rather than being decorative.
- The response's live `agencies` facet for `{fundingCategories:"ENV|NR|EN"}` (116 total hits) surfaces real environment/climate-relevant sub-agencies: EPA (3), DOI's Bureau of Land Management/Bureau of Reclamation/Fish & Wildlife Service/USGS/National Park Service (30 combined), USDA Forest Service/NRCS/Rural Business-Cooperative Service (9 combined — the RBCS matches are genuinely energy-relevant, e.g. *"Renewable Energy Systems and Energy Efficiency Improvements Program"*), DOC's NOAA ERA Production office (9), and DOE's Golden Field Office/Headquarters/Idaho Field Office/National Energy Technology Laboratory (14 combined).
- **Deliberately excluded from the new implementation**: `HHS-NIH11`, despite carrying 44 of the 116 raw `ENV|NR|EN` hits — inspection of a sample hit (`PAR-25-144`, CFDA `93.113` "Biological Response to Environmental Health Hazards") shows these are NIH environmental-*health* biomedical research grants, a vertical already covered by the sibling `health-grants.ts` agent, not core environmental/climate grantmaking. Including it would double-count NIH health grants as a second, unrelated category. Also excluded: `AC` (AmeriCorps), `DOD-WHS`, `HUD`, `DOS-AUS`, `DOT-FAA` — each a single incidental hit in the same facet check, not core environment/climate agencies.

**This is a genuinely new, real, structured option** — surfaced by the sibling task's addition of `agencies`/`fundingCategories` support to `searchGrantsGovOpportunities`, not a keyword hack, and not a demographic-targeted database (Grants.gov itself was already a real, verified source in this document, §4 Agent 15). Per the task's instruction to build a minimal real implementation when a genuinely new real option is found, this session added:

- `src/lib/agents/environmental-climate-grants.ts` — `searchEnvironmentalClimateGrants()`, mirroring the exact pattern already established by the sibling `health-grants.ts`/`education-training-grants.ts` agents (same session, same `searchGrantsGovOpportunities` client, same agency-family + funding-category + dedup-by-`externalId` shape). Exports `ENVIRONMENTAL_CLIMATE_AGENCY_CODES` (14 live-verified sub-agency codes) and `ENVIRONMENTAL_CLIMATE_FUNDING_CATEGORIES` (`["ENV","NR","EN"]`).
- `src/lib/agents/environmental-climate-grants.test.ts` — 5 unit tests (mocking `searchGrantsGovOpportunities`), covering: correct agency/category params passed for every default search term, `HHS-NIH11` exclusion, custom search-term passthrough, cross-term dedup, and empty-result handling. **All 5 pass** (`pnpm vitest run src/lib/agents/environmental-climate-grants.test.ts`, this session).
- This is a **new, standalone module** — it is not wired into any route, cron, or the `opportunities` table, matching the "minimal" instruction and the fact that no agent numbered 18/21/or-otherwise in this codebase's registries corresponds to this category (§0 of this section). Persistence/scheduling wiring, if wanted, is a separate follow-up decision, not something to fabricate a registration for here.

### 7c. Acceptance criterion — `pnpm tsc --noEmit`

Run this session, after writing `environmental-climate-grants.ts`/`.test.ts`:

```
$ pnpm tsc --noEmit
(zero output)
$ echo $?
0
```

**VERIFIED — exits 0, zero errors**, confirmed via a separate redirected run (`pnpm tsc --noEmit > out.txt 2>&1; echo $?` → `0`, `out.txt` is 0 lines) to rule out a pipeline-masked exit code.

---

## 8. 2026-09-07 re-check — four additional candidates for women/minority-owned-business grants (§7a); one genuine new source found, three confirmed BLOCKED

A follow-up task flagged §7a's BLOCKED conclusion as resting on an incomplete search (only WBENC, NMSDC, MBDA.gov, and Grants.gov's own taxonomy were checked) and asked for four specific additional real candidates to be live-checked before the BLOCKED status could be trusted: Hello Alice, IFundWomen, SBA's 8(a)/HUBZone programs, and USDA's minority/socially-disadvantaged-farmer programs. All four were checked live this session.

### 8a. Hello Alice — BLOCKED, bot-walled site-wide, no API found

- `https://www.helloalice.com/business-grants`, `https://www.helloalice.com/small-business-grants-and-funding`, `https://app.helloalice.com/grants`, and even `https://www.helloalice.com/robots.txt` — **every path returns HTTP 429** with response header `X-Vercel-Mitigated: challenge` (a Vercel bot-challenge wall, the same category of block as MBDA.gov's Cloudflare challenge in §7a). **VERIFIED**, live `curl` with response headers, this session.
- `https://support.helloalice.com` (a separate Zendesk domain) — **HTTP 403** with `Cf-Mitigated: challenge` (Cloudflare bot wall). **VERIFIED**, live headers.
- A live web search for `Hello Alice API grants developer data feed` surfaced only user-facing FAQ/support pages and `app.helloalice.com/grants` — described everywhere as a login-gated account feature ("view your grant application in my Hello Alice account"), i.e. an internal application-matching portal, not a public dataset. **VERIFIED**, this session — no API/developer documentation exists anywhere indexed.
- **Conclusion: BLOCKED.** Same structural pattern as WBENC's WBENCLink2.0 — a gated, login-only system, and additionally bot-walled against any automated access at all.

### 8b. IFundWomen — BLOCKED, bot-walled, and its "database" is an internal application funnel

- `https://ifundwomen.com/grants` redirects to `https://www.ifundwomen.com/grants/apply-for-grants`, which returns **HTTP 403** with `Cf-Mitigated: challenge`. **VERIFIED**, live headers, this session.
- A live web search found IFundWomen markets a "Universal Grant Application Database": businesses submit one application, and IFundWomen internally matches them against partner grant criteria and notifies them of matches. This is an **application-intake funnel**, not a publicly browsable or queryable list of open opportunities or past winners. **VERIFIED**, this session — no public API or dataset was found anywhere.
- **Conclusion: BLOCKED.** Same structural pattern as §8a/WBENC.

### 8c. SBA 8(a) Business Development / HUBZone — BLOCKED, and root-caused: these are contracting programs, not grant programs

- `https://www.sba.gov/federal-contracting/contracting-assistance-programs/8a-business-development-program` (live-fetched) describes only certification eligibility and sole-source **contracting** access; the only structured-data tool it links is the Procurement Data Hub (`datahub.certify.sba.gov`), which shows aggregate contracting-trend charts, not individual opportunities. **VERIFIED**, live fetch this session.
- `https://www.sba.gov/certifications/#hubzone` (live-fetched, HTTP 200) — same certification-program content; the page's own "Grants" nav link points to `sba.gov/loans/additional-funding-opportunities/grants/`, a generic SBA grants page (Women's Business Center training grants, etc.) with **no mention of 8(a) or HUBZone** anywhere in its content. **VERIFIED**, live fetch this session.
- Cross-checked independently against `api.grants.gov/v1/api/search2`: `{agencies:"SBA"}` returns exactly **one** live posted opportunity ("SBA WBC Modernization Initiative FY26 - Georgia", CFDA 59.043) — a Women's Business Center program, unrelated to 8(a)/HUBZone. **VERIFIED**, live query this session.
- **Root cause, not just absence: 8(a) and HUBZone are federal *contracting* set-aside/certification programs.** They confer eligibility for sole-source or set-aside **contracts**, tracked through SAM.gov procurement — they do not themselves disburse grants. There is no grant feed to find because these specific programs do not fund via grants at all.
- **Conclusion: BLOCKED — categorical mismatch, not a missed source.**

### 8d. USDA minority/socially-disadvantaged farmer & rancher grants — genuinely new real option found; minimal implementation built

- NIFA's own funding-opportunities page (`nifa.usda.gov/grants/funding-opportunities`) is server-rendered Drupal HTML with no backing JSON/API (confirmed via fetch — no `fetch()`/XHR calls, no RSS/CSV links). But its program filter dropdown lists the real program name: **"Outreach and Assistance for Socially Disadvantaged and Veteran Farmers and Ranchers (2501) Program"** — confirming this is a real, currently-administered NIFA program family, not a fabricated one. **VERIFIED**, this session.
- Live-querying `api.grants.gov/v1/api/search2` with `{agencies:"USDA-NIFA"}` (the real sub-agency code, confirmed via the live `agencies` facet) surfaces a **currently posted** NOFO for the veteran half of that program family: *"Outreach and Assistance for Veteran Farmers and Ranchers Program"* (id `363816`, opportunity number `USDA-NIFA-ICGP-012261`, assistance listing 10.443, posted 2026-09-04, closes 2026-09-10, $23.8M estimated total funding, 36 awards). **VERIFIED**, live `search2` + `fetchOpportunity` calls this session.
- Generic multi-word keyword phrases are noisy here, in the same way §7a's "minority owned business" keyword search was: `{keyword:"veteran farmers ranchers", agencies:"USDA-NIFA"}` returns 15 of NIFA's 20 total live postings (unrelated programs like citrus-disease research and tribal-college scholarships also match, apparently via generic/templated eligibility boilerplate). **But** narrow, distinctive phrases are precise: `{keyword:"socially disadvantaged", agencies:"USDA-NIFA"}` and `{keyword:"2501", agencies:"USDA-NIFA"}` each return **exactly the one on-topic hit above and nothing else** — live-verified this session by contrast against a nonsense-keyword control (0 hits) and against the same phrases with no agency restriction (47 and 3 hits respectively, dominated by unrelated NSF/DOD/DOS/HHS programs — proving the agency restriction is what makes the phrase precise). `{keyword:"minority", agencies:"USDA-NIFA"}` returns 0 hits today — the socially-disadvantaged-specific half of the NOFO is not independently posted this cycle, only the veteran half is.
- **This is a genuinely new, real, structured option** — the same live, agency-scoped Grants.gov `search2` mechanism already established for `environmental-climate-grants.ts` (§7b), applied to the one real sub-agency (USDA-NIFA) that administers this program family, using search terms live-verified not to produce false positives. Per the task's instruction, this session added:
  - `src/lib/agents/minority-farmer-grants.ts` — `searchMinorityFarmerGrants()`, exporting `MINORITY_FARMER_AGENCY_CODES` (`["USDA-NIFA"]`) and using the two live-verified-precise default search terms (`"socially disadvantaged"`, `"2501"`).
  - `src/lib/agents/minority-farmer-grants.test.ts` — 5 unit tests (mocking `searchGrantsGovOpportunities`), covering: correct agency/term params for both default terms, the agency-code scope, custom search-term passthrough, cross-term dedup, and empty-result handling. **All 5 pass** (`pnpm vitest run src/lib/agents/minority-farmer-grants.test.ts`, this session).
  - This is a **new, standalone module**, not wired into any route, cron, or the `opportunities` table — same minimal scope as §7b's `environmental-climate-grants.ts`, for the same reason (no agent number in this codebase's registries corresponds to this category).
  - The socially-disadvantaged-specific half of the 2501 program is not live-postable today (0 hits) — this module will surface it automatically the moment USDA posts it, via the same live query, with no code change needed.

### 8e. Overall conclusion for women/minority-owned-business/farmer grants

**BLOCKED remains accurate for the ownership/certification-focused half of this category** (Hello Alice, IFundWomen, WBENC, NMSDC, MBDA.gov, SBA 8(a)/HUBZone — seven sources now checked, all confirmed either gated/bot-walled with no public API, or categorically not a grant program). **A genuinely new real structured source was found and implemented for the USDA farmer/rancher-specific half of this category** (§8d) — this is not a contradiction of the ownership-focused BLOCKED finding, since USDA's 2501 program is a distinct federal program family from business-ownership certification bodies.

### 8f. Acceptance criterion — `pnpm tsc --noEmit`

Run this session, after writing `minority-farmer-grants.ts`/`.test.ts`:

```
$ pnpm tsc --noEmit > out.txt 2>&1; echo $?
0
$ wc -l out.txt
0 out.txt
```

**VERIFIED — exits 0, zero errors**, confirmed via a redirected run to rule out a pipeline-masked exit code.
