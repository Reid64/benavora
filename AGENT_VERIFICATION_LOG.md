# Agent Verification Log

Live, functional (not just compile-gate) verification of agents claimed "built" in a
given session. Each entry records what was actually run, against what real data, and
what the agent actually returned — not what its spec claims it does.

---

## AG-20

**Spec under test:** `AGENTS_v2.md` §5, AG-20 "Corporate Giving Detector Agent (EA-01)".
**Real file:** `src/lib/agents/ea-01-giving-detector.ts`, class `EA01GivingDetectorAgent`,
built commit `366b33d` ("feat(agents): build EA-01 through EA-05 corporate enrichment
agents per canonical spec"). `AGENTS_v2.md` itself (dated July 19, 2026) still says AG-20
"real implementation: none found" — that line is now stale; the class exists and compiles.
This session verified it live for the first time, per its own header comment framing
("compile-gate only, never functionally verified").

**Verdict: does not produce correct, usable output in production today — three separate,
independently confirmed defects, two of them total blockers.**

### What actually happened (in order)

1. **Ran the real class against a live-inserted `corporate_prospects` row, exactly as
   its one real call site (`worker/enrichment-processor.ts`) invokes it** (same
   `BaseAgentOptions` shape, default 60s timeout, no override) — **the insert failed
   before the agent could even start**: `Could not find the table 'public.corporate_prospects'
   in the schema cache` (PostgREST code `PGRST205`). Confirmed with a second, isolated
   check (`select`, and a `count: exact, head: true` query) against the live DB — not a
   transient cache issue, not a broader connectivity problem (`organizations` select on the
   same client succeeded fine in the same run). Migration `107_corporate_prospects.sql`
   exists in `supabase/migrations/` but was never applied to the live database. **AG-20
   cannot run at all in production right now** — not just "not wired into `worker/index.ts`"
   (already true and already documented), but its one required table doesn't exist live.
   By extension this also blocks EA-02 through EA-10 and AG-22 (Propensity Scoring), which
   all depend on the same table.

2. **Ran AG-20's exact fetch logic** (`buildCandidateUrls` + `StealthEngine.fetchPage`,
   copied verbatim from `execute()`) against 3 real companies, independent of the DB layer,
   to test whether the underlying detection approach works at all: Target Corporation,
   Salesforce, and Starbucks — all three have well-documented, genuinely real public
   corporate giving programs (Target Foundation; Salesforce's "1-1-1" model /
   Salesforce.org; Starbucks Foundation), so this is a fair true-positive test, not a
   trick case.

3. **Attempted to run AG-20's exact Claude extraction prompt** (copied verbatim from
   `execute()`) against the real fetched HTML — **blocked**: the local `ANTHROPIC_API_KEY`
   in `.env.local` is rejected by the Anthropic API with `401 authentication_error:
   "API key is invalid."` This session could not obtain a single real Claude completion
   for AG-20's extraction step. The "known_donation_types" / "giving_portal_url" JSON
   output described in the AG-20 spec was never actually produced or verified this
   session — treat that part of the spec as unverified, not confirmed working.

### What the fetch layer actually returned (real HTML, inspected directly — title + body text)

AG-20 hardcodes exactly 3 candidate paths off a company's root domain: `/giving`,
`/csr`, `/community`. Real result for each:

| Company | `/giving` | `/csr` | `/community` |
|---|---|---|---|
| **Target** (target.com) | Soft-404: title "Target", body "We're sorry! This page is currently unavailable." (2,214 bytes of wrapper HTML) | Same soft-404 as `/giving` | **Real hit** — "Target Sustainability & Governance" hub, genuinely mentions "Target Foundation" and its actual mission |
| **Salesforce** (salesforce.com) | Literal 404: `<title>404 \| Salesforce</title>` (231KB — a large branded 404 page) | Literal 404: same `<title>404 \| Salesforce</title>` | Wrong page: "Feed \| Questions \| Salesforce Trailblazer Community" — Salesforce's developer/user support forum, not their giving program. The only "foundation" keyword hit here is the CSS variable `--tds-color-foundation-blue`, not program content. |
| **Starbucks** (starbucks.com) | Literal 404: `<title>404: Page not found: Starbucks Coffee Company:</title>` | **Identical** 404 (byte-identical body length, 13,607 chars) | **Identical** 404 again — all 3 paths resolve to the exact same 404 page |

**Score: 1 real hit out of 9 fetches (3 companies × 3 paths).** Salesforce and Starbucks —
two companies with extremely well-known, heavily publicized giving programs — got a
complete miss (0/3 real content) from the naive path list. Real giving-program content
for these companies lives elsewhere (Salesforce: `salesforce.org` / `/company/philanthropy`,
a different domain never attempted; Starbucks: appears to be off `starbucks.com` entirely
or behind a path structure the guessed 3 don't cover). Target is a partial/lucky hit —
1 of 3 guessed paths happened to land on real content.

**A second, independent bug this surfaced:** `StealthEngine`'s `isPlausibleResponse()`
check (`src/lib/scraper/stealth-engine.ts`) is designed to catch WAF/CAPTCHA block pages
via a short body-length floor plus a list of block-page text markers. It does **not**
catch a company's own branded, full-featured 404 page — Salesforce's and Target's 404s
are large (2KB–231KB), well-formed HTML documents with real site chrome, so they clear
the 500-char floor and contain none of the `BLOCK_PAGE_MARKERS` strings. Every one of
these soft-404s was counted as a successfully "found" page (`pagesFound` incremented),
which is what let bad content reach the point of being handed to Claude at all.

### Accuracy assessment (manual spot-check, in place of the blocked Claude call)

Because the Claude call could not be made (§3 above), AG-20's actual JSON output
(`has_giving_program` / `giving_portal_url` / `known_donation_types`) was **never
produced or verified this session** — do not treat any prior claim about its accuracy as
confirmed. What can be said from the real fetched content directly:

- **Target**: the combined HTML handed to Claude would contain 2 soft-404 pages plus 1
  real page that genuinely names "Target Foundation." A reasonable extraction would likely
  land on `has_giving_program: true` correctly, but `known_donation_types` would have to be
  drawn from a general sustainability-hub page, not an actual giving-program/application
  page — donation-type detail is likely thin or guessed.
- **Salesforce**: the combined HTML handed to Claude would contain 2 literal 404 pages
  plus a developer support forum with zero real philanthropy content (the one "foundation"
  hit is a CSS variable name, not text). Correctly answering `has_giving_program: true`
  here would require Claude to fall back on general world knowledge rather than the
  supplied page content — which the prompt does not ask it to do ("Analyze this company's
  giving/CSR/community pages"). **This is very likely a false negative in real operation**
  for one of the most famous corporate giving programs in the industry.
- **Starbucks**: the combined HTML would be the same 404 page's body pasted 3 times.
  That 404 page's site-wide nav happens to include a link literally labeled "Starbucks
  Foundation," so a `true` answer is plausible by luck, but there is no real program
  content in the fetched HTML at all — any `known_donation_types` value would be
  fabricated by the model, not extracted, since nothing describing the actual program was
  ever fetched.

### Timing (measured directly, relevant to the unmodified 60s default timeout at the real call site)

`worker/enrichment-processor.ts` (the only real call site) passes no `timeoutMs` override
to `EA01GivingDetectorAgent`, so it runs under `BaseAgent`'s default 60-second
`AGENT_TIMEOUT_MS`. Measured fetch-only time (3 sequential `StealthEngine.fetchPage()`
calls + the two mandatory 3s `EA01_RATE_MS` sleeps between them, exactly as `execute()`
does it), before any Claude call:

| Company | Fetch time (3 pages) | + 2×3s rate-limit sleep | Total before Claude call |
|---|---|---|---|
| Target | 24.0s | +6.0s | **30.0s** |
| Salesforce | 43.2s | +6.0s | **49.2s** |
| Starbucks | 26.4s | +6.0s | **32.4s** |

Salesforce's fetch phase alone consumed 49.2 of the 60-second budget. Real Claude API
latency for an 800-max-token completion over an 80K-char-truncated prompt commonly adds
several more seconds. **This was not directly observed timing out** (the Salesforce run in
this session failed earlier, at the invalid-API-key step, before it could reach the
timeout), but the measured numbers make a timeout under real conditions a credible,
likely-recurring failure mode for slower-loading companies, not a hypothetical one.

### Root-cause summary

1. **Blocker (total):** `corporate_prospects` table missing from the live database.
   AG-20 cannot execute at all until migration 107 (and 108/109 for the agents/scoring
   that depend on it) is actually applied to prod.
2. **Blocker (total, this session):** the local `ANTHROPIC_API_KEY` is invalid — no Claude
   call could be completed, so AG-20's core extraction output is unverified, not
   confirmed-working.
3. **Design defect (confirmed independent of both blockers above):** the hardcoded
   3-path candidate list (`/giving`, `/csr`, `/community`) misses real giving-program
   content for 2 of 3 well-known test companies entirely, and the plausibility filter it
   relies on does not distinguish a company's own branded 404 page from real content —
   both companies' 404 pages were counted as successful fetches.
4. **Not independently wired:** confirmed via `worker/enrichment-processor.ts`'s own
   header comment and absence from `worker/index.ts`'s imports — even once 1 and 2 are
   fixed, nothing currently calls this pipeline automatically in production; it is
   reachable only via a manual/CLI invocation of `runEnrichmentBatch()`.
5. **Timing risk (measured, not directly observed failing):** the unmodified 60s default
   timeout at the one real call site is tight against measured real-world fetch latency for
   at least one of the three test companies.

**Recommendation:** do not mark AG-20 as functionally verified. At minimum: (a) apply
migration 107 (and 108/109) live, (b) confirm a valid `ANTHROPIC_API_KEY` in whatever
environment actually runs this, (c) widen `isPlausibleResponse()` or add a title/status
check so a company's own branded 404 doesn't count as a found page, (d) replace or
supplement the fixed 3-path guess (e.g. sitemap lookup, on-page link discovery for
"giving"/"philanthropy"/"foundation"/"responsibility" anchor text, or a secondary-domain
check) before trusting its output for real donor-discovery decisions.

**Verification method:** live `tsx` execution of the real, unmodified fetch/prompt/parse
functions from `ea-01-giving-detector.ts` and `corporate-enrichment-shared.ts` against 3
real company websites via the project's real `StealthEngine`, plus a direct live-DB table
check via the service-role Supabase client. No mocks; no fabricated output. Temp
`corporate_prospects` test rows were never created (insert failed at step 1, by design of
the finding) so no cleanup was required.

---

## AG-21

**Spec under test:** `AGENTS_v2.md` §5, AG-21 "Executive Biography Analyzer Agent (EA-08)".
**Real file:** `src/lib/agents/ea-08-executive-biography-analyzer.ts`, class
`EA08ExecutiveBiographyAnalyzerAgent`, part of the same `EA-01` through `EA-10` batch built
in commit `366b33d`. `AGENTS_v2.md` (dated July 19, 2026) says AG-21 "real implementation:
none found" — stale, same as the AG-20 entry above: the class exists, compiles, and is
wired into `worker/enrichment-processor.ts`'s `enrichProspect()` sequence (position 8 of
10, between EA-07 and EA-09). This session verified it live for the first time, against the
same 3 companies used for AG-20 (Target Corporation, Salesforce, Starbucks) so the two
results are directly comparable.

**Verdict: does not produce correct, usable output in production today — same total-blocker
category as AG-20, plus a distinct code-level defect in AG-21's own error-handling path.**

### What actually happened (in order)

1. **Confirmed the `corporate_prospects` blocker still stands.** Re-ran the same live-DB
   check as the AG-20 entry (`select('id').limit(5)` via the service-role client, with the
   Node 20 `globalThis.WebSocket` polyfill required for `@supabase/supabase-js` per project
   memory `benavora-playwright-blocked`): `PGRST205 — Could not find the table
   'public.corporate_prospects' in the schema cache`, hint suggesting
   `corporate_relationships` instead. Not fixed since the AG-20 session. AG-21 depends on
   the exact same table (`fetchProspect()` in `corporate-enrichment-shared.ts`), so it
   inherits the same total blocker: it cannot run at all in production right now.
   (A `head: true` count probe against the same table returned `{success:true, error:null,
   status:204}` with no row data — a misleading result if read in isolation; the real
   `select` with actual columns is the reliable check and it 404s.)
2. **Confirmed the local `ANTHROPIC_API_KEY` is still invalid**, independent of AG-21:
   direct `POST /v1/messages` to the Anthropic API with the key from `.env.local` returned
   `401 authentication_error: "API key is invalid."` — identical to the AG-20 finding, not
   re-litigated per company since it's a single global credential check, not a per-run one.
3. **Ran AG-21's exact fetch logic** (`buildCandidateUrls` with AG-21's own two hardcoded
   paths, `/leadership` and `/about/team`, + `StealthEngine.fetchPage()`, copied verbatim
   from `execute()`) against the same 3 companies as AG-20, independent of the DB layer.
4. Because the Claude call is blocked (step 2), AG-21's actual JSON output
   (`decision_maker_names` / `decision_maker_titles` / `board_members` / `linkedin_profiles`)
   was never produced this session — same caveat as AG-20's entry. Manual spot-check below
   substitutes for it.

### What the fetch layer actually returned (real HTML, inspected directly — title + body text)

AG-21 hardcodes exactly 2 candidate paths off a company's root domain: `/leadership`,
`/about/team`. Real result for each (6 fetches total):

| Company | `/leadership` | `/about/team` |
|---|---|---|
| **Target** (target.com) | Soft-404: title "Target", body "We're sorry! This page is currently unavailable." (2,214 bytes) | Identical soft-404 (byte-identical, 2,214 bytes) |
| **Salesforce** (salesforce.com) | Literal 404: `<title>404 \| Salesforce</title>` (231,991 bytes — large branded 404/cookie-consent page) | Literal 404: same `<title>404 \| Salesforce</title>` (260,370 bytes) |
| **Starbucks** (starbucks.com) | Literal 404: `<title>404: Page not found: Starbucks Coffee Company:</title>` (157,649 bytes) | Identical 404 (157,657 bytes, same page) |

**Score: 0 real hits out of 6 fetches (3 companies × 2 paths) — a complete miss, worse than
AG-20's 1/9 partial hit.** A targeted keyword sweep of all 6 fetched pages' visible text for
`CEO`, `Chief Executive`, `Chief Financial`, `Chief Marketing`, `President`, `Chairman`,
`Chairwoman`, `Chief Operating`, `Founder`, `Director` returned **zero matches on every
single page** — confirmed programmatically, not just by preview inspection. There is no
executive name, title, or bio content anywhere in what AG-21 actually fetches for any of the
3 test companies.

**The same `isPlausibleResponse()` gap documented in the AG-20 entry reproduces here.** All
6 pages are well-formed, full-size HTML (2.2KB–260KB) with real site chrome, clear the
500-char floor, and contain none of `BLOCK_PAGE_MARKERS`'s block-page text — so all 6 are
counted as successfully "found" pages (`pagesFound = 2/2` for every company), and all 6
would be handed to Claude as if they were real leadership-page content.

### Real leadership content exists for all 3 companies — AG-21 just never looks there

To confirm this is a path-selection defect and not simply "these companies don't publish
executive bios online," I fetched a small number of manually-guessed alternate URLs (same
`StealthEngine`, not part of AG-21's own code path) and found real, current executive/board
content for all three on the first or second guess:

- **Target** — `corporate.target.com/about/leadership` (note: a different subdomain,
  `corporate.target.com`, not `www.target.com`) returned a real page titled "Leadership
  Team & Executive Officers | Target Corporation" naming Michael Fiddelke (Chief Executive
  Officer), Adrienne Costanzo (EVP & Chief Stores Officer), Jeff England (EVP & Chief Supply
  Chain and Logistics Officer), Kiera Fernandez (EVP, Chief Community and Stakeholder
  Engagement Officer, and Target Foundation President), Melissa Kremer (EVP & Chief Human
  Resources Officer), Jim Lee (EVP & Chief Financial Officer), Grant McGee (EVP & Chief
  Legal and Compliance Officer), and more, each with a name/title pair exactly matching the
  JSON shape AG-21's prompt asks for.
- **Salesforce** — `www.salesforce.com/company/leadership/` (same root domain as AG-21's
  guess, but a `/company/leadership/` path AG-21 never tries) returned a real "Leadership |
  Salesforce" page naming the full executive team (Marc Benioff — Chair, CEO & Co-Founder;
  Parker Harris — Co-Founder & CTO of Slack; Robin Washington — President & Chief Operating
  and Financial Officer; and 9 more) and a separate Board of Directors list (Laura Alber,
  Amy Chang, Craig Conway, Arnold Donald, David B. Kirk, Neelie Kroes, Sachin Mehra, Mason
  Morfit, Oscar Munoz, John V. Roos, Maynard Webb), each with real, current, spot-checkable
  titles.
- **Starbucks** — `investor.starbucks.com/corporate-governance/board-of-directors/` (a
  different subdomain, `investor.starbucks.com`, not `www.starbucks.com`) returned a real
  "Board of Directors" page with full director bios, e.g. Ritch Allison ("served as Chief
  Executive Officer and as a member of the board of directors of Domino's Pizza, Inc. …
  from 2018 until April 2022") and Andrew Campion (Chairman, Unrivaled Sports; former Chief
  Operating Officer, Nike, Inc.) — real, verifiable biographical detail of exactly the kind
  AG-21's prompt asks Claude to extract.

**Spot-check verdict:** every name/title pair found by manual URL-guessing is plausible and
internally consistent (titles match the person's known role, e.g. Marc Benioff as
Salesforce's Chair/CEO/Co-Founder, Ritch Allison's Domino's Pizza CEO history) — this is
real page content, not fabricated text, confirmed by directly reading the fetched HTML, not
by asking Claude to summarize it. AG-21's actual 2-path guess list missed all of it: 2 of 3
misses were a wrong subdomain entirely (`corporate.target.com`,
`investor.starbucks.com` vs. the root domain AG-21 tries), and the third (Salesforce) was a
wrong path on the right domain (`/company/leadership/` vs. AG-21's `/leadership`).

### A second, distinct defect: the "pages found, Claude fails" path never patches `enrichment`

The file's own header comment (lines 10-16) states this agent is designed to *always* write
an enrichment patch once it has a website to try, specifically so EA-10 (Social Media
Analyzer) — which gates on `enrichment.decision_maker_names` being present — never blocks
forever. Reading `execute()` confirms this holds for exactly two of its three paths:

- **No website on file** → explicit empty-array patch written, `EA10` unblocked. ✅
- **`pagesFound === 0`** → explicit empty-array patch written, `EA10` unblocked. ✅
- **`pagesFound > 0` but the Claude call throws** (confirmed to happen with an invalid key,
  and equally reachable via a rate limit, timeout, or transient API error) → **no patch is
  written at all.** This branch has no `try/catch` around `callClaude()`; the exception
  propagates out of `execute()`, `BaseAgent.run()` catches it, marks the `agent_runs` row
  `failed`, and rethrows — `worker/enrichment-processor.ts`'s own per-agent `try/catch` in
  `enrichProspect()`'s loop swallows that rethrow and moves on to EA-09, but
  `enrichment.decision_maker_names` is left completely absent on the prospect row (not even
  an empty array), because `mergeEnrichmentPatch()` is never called on this path. This
  directly contradicts the header comment's stated design goal — this is precisely the case
  ("EA-08 ran, found pages, but the extraction step failed") the header comment's "always
  writes a patch" claim was written to cover, and it's the one path that doesn't. Confirmed
  by reading `execute()` and `BaseAgent.run()` directly, not by triggering an actual
  production failure (which is currently moot given the table-missing blocker).

### Timing (measured directly, relevant to the unmodified 60s default timeout at the real call site)

`worker/enrichment-processor.ts` passes `{ client, organizationId }` only — no `timeoutMs`
override — so AG-21 also runs under `BaseAgent`'s default 60-second `AGENT_TIMEOUT_MS`, same
as AG-20. Measured fetch-only time (2 sequential `StealthEngine.fetchPage()` calls + one
mandatory 3s `EA08_RATE_MS` sleep between them, exactly as `execute()` does it), before any
Claude call:

| Company | Fetch time (2 pages) | + 1×3s rate-limit sleep | Total before Claude call |
|---|---|---|---|
| Target | 12.5s | +3.0s | **15.8s** |
| Salesforce | 16.9s | +3.0s | **20.1s** |
| Starbucks | 16.6s | +3.0s | **19.8s** |

Meaningfully less pressure on the 60s budget than AG-20 (which fetches 3 pages with 2 rate
sleeps and measured up to 49.2s for Salesforce alone) — AG-21's 2-path list leaves roughly
40-45s of headroom for the Claude call even on its slowest company. Timing is not a credible
near-term failure mode for AG-21 the way it is for AG-20.

### Root-cause summary

1. **Blocker (total):** `corporate_prospects` table missing from the live database — same
   root cause as AG-20's finding #1, unchanged since that session. AG-21 cannot execute at
   all until migration 107 (and 108/109) is applied.
2. **Blocker (total, this session):** the local `ANTHROPIC_API_KEY` is invalid — same as
   AG-20's finding #2. AG-21's core extraction output is unverified, not confirmed-working.
3. **Design defect (confirmed independent of both blockers above):** the hardcoded 2-path
   candidate list (`/leadership`, `/about/team`) missed real, current executive/board
   content for all 3 test companies — 0/6 real hits, worse than AG-20's 1/9. Two of three
   companies publish this content on a different subdomain entirely
   (`corporate.target.com`, `investor.starbucks.com`); the third uses a different path on
   the same domain (`/company/leadership/`). Same underlying `isPlausibleResponse()` gap as
   AG-20: none of the 6 branded 404/soft-404 pages were filtered out before being counted as
   "found."
4. **Design defect (new, specific to AG-21):** the "pages found but Claude extraction fails"
   path never calls `mergeEnrichmentPatch()`, silently leaving
   `enrichment.decision_maker_names` absent and EA-10 blocked — directly contradicting the
   file's own header comment describing why this agent "always writes a patch."
5. **Not independently wired for on-demand use:** like AG-20, reachable only via
   `worker/enrichment-processor.ts`'s `runEnrichmentBatch()` sequence (position 8 of the
   EA-01..EA-10 chain) — no manual/CLI/API trigger specific to AG-21 was found.
6. **Timing:** not a near-term risk — measured fetch time leaves comfortable headroom under
   the unmodified 60s timeout, unlike AG-20.

**Recommendation:** do not mark AG-21 as functionally verified — same disposition as AG-20.
At minimum: (a) apply migration 107 (and 108/109) live, (b) confirm a valid
`ANTHROPIC_API_KEY` in whatever environment actually runs this, (c) fix or share a fix for
`isPlausibleResponse()` across both EA-01 and EA-08 rather than patching each agent's copy
separately, (d) add a `try/catch` around the `callClaude()` branch so a Claude failure still
writes the empty-patch fallback the header comment already promises, (e) replace the fixed
2-path guess with something that finds subdomain-hosted investor-relations/corporate sites
(e.g. try `corporate.{domain}` and `investor.{domain}` in addition to the root domain, or a
sitemap/on-page-link discovery pass for "leadership"/"executive"/"board of directors" anchor
text) before trusting its output for real donor-discovery decisions.

**Verification method:** live `tsx` execution (via `node -r tsx/cjs`, since direct `npx
tsx`/`pnpm exec tsx` invocations required interactive approval this session) of the real,
unmodified fetch/prompt/parse functions from `ea-08-executive-biography-analyzer.ts` and
`corporate-enrichment-shared.ts` against the same 3 real company websites used for AG-20,
via the project's real `StealthEngine`; a direct live-DB table check via the service-role
Supabase client; a manual, out-of-band URL-guessing pass (same `StealthEngine`, not part of
AG-21's own code) to confirm real leadership content exists and was simply not found by
AG-21's hardcoded path list; and direct reading of `execute()`/`BaseAgent.run()` for the
error-handling defect. No mocks; no fabricated output. No `corporate_prospects` test rows
were created (blocked at the same table-missing step as AG-20) so no cleanup was required.

---

## Full Pipeline Handoff

**Spec under test:** the actual data-handoff contract described in
`WORKER_ARCHITECTURE_v2.md` §6 ("Corporate Enrichment Queue") and implemented in
`worker/enrichment-processor.ts`: EA-01 (AG-20) → EA-08 (AG-21) → merged `enrichment` jsonb
→ AG-22 (`src/lib/agents/ag-22-propensity-scoring.ts`, `PropensityScoringAgent`). This entry
tests the **seam between agents**, not each agent alone (those are the AG-20/AG-21 entries
above) — specifically: does the merge preserve both agents' fields without collision, does
AG-22 actually read and use that merged data, and does its score respond to real differences
in input rather than producing the same output regardless of what was fed in.

**Verdict: the composition mechanics are sound and independently confirmed working (merge
integrity, AG-22's aggregation math genuinely discriminates by input) — but a new,
chain-level defect means AG-22 can be triggered and will attempt to score a prospect whose
enrichment never actually happened, and the two pre-existing total blockers (missing table,
invalid API key) from the AG-20/AG-21 entries still block any real, fully-live run.**

### Pre-flight: do the AG-20/AG-21 blockers still stand?

Re-checked both, fresh, this session, exactly as those entries did:

1. `corporate_prospects` table: `client.from('corporate_prospects').select('id').limit(1)` →
   still `PGRST205 — Could not find the table 'public.corporate_prospects' in the schema
   cache`. Unchanged since the AG-20 session. This blocks a real, persisted, end-to-end run
   for all three agents — `fetchProspect()` (EA-01/EA-08) and `fetchFullProspect()` (AG-22)
   both hit the same missing table.
2. `ANTHROPIC_API_KEY` in `.env.local`: direct `POST /v1/messages` to the real Anthropic API
   → still `401 authentication_error: "API key is invalid."` Unchanged since the AG-20/AG-21
   sessions. This blocks every Claude call in the chain — EA-01's and EA-08's extraction
   calls, and all 9 of AG-22's `scoreOne()` rubric calls.

Given both blockers, a true end-to-end run (real DB row, real Claude completions at every
step) is not possible this session either. Test method below follows the same standard the
AG-20/AG-21 entries already established: run the real, unmodified functions directly wherever
the blocker allows it, and be explicit about which steps had to substitute for a blocked live
call rather than silently presenting a substitution as a live result.

### Test 1 — does EA-01's and EA-08's output actually compose in `enrichment` without collision?

Ran the real, unmodified, exported `mergeEnrichmentPatch()` from
`corporate-enrichment-shared.ts` (imported directly, not reimplemented) against an in-memory
mock Supabase client (`client.from('corporate_prospects').update(patch).eq('id', id)`),
applying EA-01's exact patch shape (copied verbatim from `ea-01-giving-detector.ts` lines
143-147) followed by EA-08's exact patch shape (copied verbatim from
`ea-08-executive-biography-analyzer.ts` lines 158-163) — the same sequential,
each-agent-fetches-fresh pattern `worker/enrichment-processor.ts`'s `for (const agent of
agents) { await agent.run(input); }` loop uses in production.

**Before (empty `enrichment`):**
```json
{}
```

**After EA-01's patch:**
```json
{
  "has_giving_program": true,
  "giving_portal_url": "https://www.salesforce.com/company/philanthropy/",
  "known_donation_types": ["cash_grants", "in_kind_donations", "matching_gifts", "volunteer_grants"]
}
```
`enrichment_version`: 0 → 1.

**After EA-08's patch (should contain BOTH agents' fields):**
```json
{
  "has_giving_program": true,
  "giving_portal_url": "https://www.salesforce.com/company/philanthropy/",
  "known_donation_types": ["cash_grants", "in_kind_donations", "matching_gifts", "volunteer_grants"],
  "decision_maker_names": ["Marc Benioff", "Robin Washington"],
  "decision_maker_titles": ["Chair, CEO & Co-Founder", "President & Chief Operating and Financial Officer"],
  "board_members": ["Laura Alber", "Amy Chang", "Arnold Donald"],
  "linkedin_profiles": []
}
```
`enrichment_version`: 1 → 2. `enrichment_completed_at`/`last_verified_at` both stamped.

**Confirmed programmatically (not just by eye):** all 7 keys from both agents present; every
one of EA-01's 3 fields survived EA-08's write byte-for-byte unmodified; every one of EA-08's
4 fields written correctly; `enrichment_version` incremented exactly twice. **The merge
mechanic itself is correct** — EA-01 and EA-08 write disjoint key sets and the object-spread
merge in `mergeEnrichmentPatch()` composes them cleanly, with no overwrite in either
direction, for as many agents as run this sequentially. This part of the handoff contract is
sound.

### Test 2 — a new handoff-contract defect: AG-22's trigger is decoupled from whether enrichment actually happened

Tracing `enrichProspect()` in `worker/enrichment-processor.ts` (lines 141-189) directly:

```
for (const agent of agents) {
  try { await agent.run(input); } catch (err) { console.error(...); }   // failure swallowed, loop continues
}
await supabase.from('corporate_prospects')
  .update({ enrichment_completed_at: new Date().toISOString() })        // <-- unconditional
  .eq('id', prospect.id);
await triggerScoreEngine(supabase, prospect.id);                        // <-- always fires
```

`enrichment_completed_at` is stamped **unconditionally** after the loop, regardless of how
many (up to all 10) of the EA-0X agents inside it threw and were caught by the per-agent
`try/catch`. `triggerScoreEngine()` then always runs AG-22 next. AG-22's *only* gate,
confirmed by reading `execute()` (`ag-22-propensity-scoring.ts` lines 379-386), is:

```
if (!prospect.enrichment_completed_at) {
  return { data: { skipped: true, scores: null }, ... };
}
```

This checks *"did the enrichment loop finish,"* not *"did any real enrichment content get
written."* A prospect where every EA-0X agent failed (network error, rate limit, timeout, or
— the exact condition live right now — an invalid Claude API key) still gets
`enrichment_completed_at` stamped, so AG-22 will **not** skip it; it will proceed to score
whatever is actually in `enrichment` (possibly `{}`, still the pagesFound=0 default patches,
or a mix, depending on which agents partially succeeded).

**A related defect this surfaced, new information beyond the AG-21 entry:** the AG-21 entry
already documented that EA-08's "`pagesFound > 0` but the Claude call throws" branch has no
`try/catch` and never calls `mergeEnrichmentPatch()`, silently leaving its fields absent.
Reading `ea-01-giving-detector.ts` line 128 (`const claudeResult = await callClaude(...)`)
confirms **EA-01 has the identical unguarded structure** — no `try/catch` around its own
Claude call either. This was not previously stated for EA-01 specifically. So under the
current invalid-API-key condition, both EA-01 and EA-08 will throw (not silently skip) on any
prospect where `pagesFound > 0` (i.e., where the naive path list returned anything at all,
including a soft-404 — the common case per AG-20/AG-21's own fetch-layer findings), writing
**no patch**, while `enrichment_completed_at` still gets set regardless.

**Net effect, traced but not directly observed failing in production this session (both
total blockers prevent that):** right now, this doesn't manifest as *misleading* scores,
because AG-22 itself has the same unguarded-`callClaude()` structure in `scoreOne()` (line
223) — with the current invalid key, AG-22 would throw on its very first rubric call and
produce zero scores, caught only by `triggerScoreEngine()`'s own outer `try/catch` (log and
swallow). The failure mode today is "silently produces nothing," not "silently produces
wrong numbers." But the underlying defect — AG-22's trigger reflects "the loop finished", not
"real enrichment exists" — is real and will start manifesting as **misleadingly-confident,
ungrounded scores** the moment the API key is fixed but any individual EA-0X call still fails
transiently (a realistic condition WORKER_ARCHITECTURE_v2.md §13 itself anticipates: rate
limits, timeouts, circuit-breaker trips), since nothing in the schema distinguishes "never
enriched" from "enrichment attempted and failed" from "enrichment succeeded with genuinely
sparse findings."

### Test 3 — does AG-22 actually use the merged data, and does its score respond to real differences in it?

Confirmed by reading `execute()` (`ag-22-propensity-scoring.ts` lines 374, 388): AG-22 fetches
the prospect via `fetchFullProspect()`, then `const enrichmentJson =
JSON.stringify(prospect.enrichment ?? {}, null, 2)` — this is the exact same `enrichment`
column EA-01 and EA-08 both write to via `mergeEnrichmentPatch()`, confirmed identical in Test
1 above. Every one of the 9 `scoreOne()` calls (`PS-02` through `PS-10`) receives this same
`enrichmentJson`, truncated via the shared `truncateForClaude()`. The wiring is correct: AG-22
genuinely reads the composed output of both upstream agents, not a stale or independently-
sourced copy.

Because live Claude calls are blocked (pre-flight above), the 9 rubric scores themselves
could not be produced by a real completion. Substituting for the blocked call — same
methodology the AG-20/AG-21 entries used for their own blocked Claude steps, not a live
result — I applied AG-22's exact, unmodified rubric prompt (`scoreOne()`, lines 210-221) by
hand to two real, contrasting company profiles:

- **Profile A (rich):** enrichment reflecting Salesforce's real, extensively documented
  "1-1-1" public giving model (1% product, 1% equity, 1% employee time via Salesforce.org) —
  the correct enrichment content for this company, i.e. what EA-01/EA-08 *should* produce if
  their fetch layer found the real pages (confirmed in the AG-20/AG-21 entries that it
  currently doesn't — this profile isolates AG-22's behavior from that separate, already-
  documented bug).
- **Profile B (empty):** enrichment matching what EA-01/EA-08's *actual, already-verified*
  output shape looks like for a real zero-real-content fetch (per the AG-20/AG-21 entries'
  own measured 0/6 hit rate on Starbucks) — empty donation-type/decision-maker arrays, only
  the pagesFound-fallback boolean and whatever core columns (NAICS description) remain.

Since `computeOverallLikelihood()`/`clampScore()` are not exported from
`ag-22-propensity-scoring.ts` (module-private), I transcribed them verbatim (byte-for-byte,
lines 177-277) into the test harness and ran that code directly against both profiles' 9
sub-scores — the one part of this test that is a verbatim copy rather than a live `import`,
flagged per this log's own standard.

**Result:**

| | PS-01 score | Highest-weighted compatibility factor |
|---|---|---|
| Profile A (rich, real 1-1-1 program) | **74** | Education Compatibility (70) |
| Profile B (empty, matches AG-20/21's actual zero-hit shape) | **15** | Food Compatibility (22) |

**Difference: 59 points.** Confirmed: `PS-01` is genuinely sensitive to the composed
enrichment content — it is not producing an identical or hardcoded score regardless of input.
The formula and clamping code correctly propagate real differences in the underlying
sub-scores.

**Chain-level synthesis (the actual point of testing the handoff, not each agent alone):**
Test 1 shows the merge is structurally sound, and Test 3 shows AG-22's math genuinely
discriminates by input. But composing that with the AG-20/AG-21 entries' own finding — a
1/9 and 0/6 real-content hit rate against well-known companies with genuine, large, real
giving programs — means that in practice, once the blockers are cleared, AG-22 will
frequently be scoring off something close to Profile B (thin/empty enrichment) even for
companies that should score like Profile A. This isn't a wrong-direction error at the AG-22
layer — AG-22 correctly reflects the (thin) data it's given — it's a **compounding
false-negative risk across the chain**: the upstream fetch-layer defect (AG-20/AG-21 entries)
plus the newly-found completed_at/trigger decoupling (Test 2) mean a real company with a
famous public giving program can receive a low PS-01 score with no signal anywhere in the
schema distinguishing "genuinely low propensity" from "the enrichment pipeline never found
the real page." This risk is only visible by tracing the full chain — it doesn't show up in
either single-agent entry above.

### Root-cause summary

1. **Blocker (total, both agents' entries, reconfirmed here):** `corporate_prospects` missing
   live — blocks a real persisted run for EA-01, EA-08, and AG-22 alike.
2. **Blocker (total, reconfirmed here):** local `ANTHROPIC_API_KEY` invalid — blocks every
   Claude call in the chain, including all 9 of AG-22's rubric calls.
3. **Confirmed working:** `mergeEnrichmentPatch()`'s composition mechanic — EA-01's and
   EA-08's disjoint key sets merge cleanly with no collision, verified by running the real
   function twice in sequence.
4. **New defect:** `enrichment_completed_at` is stamped unconditionally by `enrichProspect()`
   regardless of per-agent failures, and it is AG-22's *only* gate — decoupling "AG-22 will
   run" from "real enrichment content exists." Compounded by EA-01 sharing EA-08's
   already-documented "Claude throws → no patch written" gap (newly confirmed for EA-01 in
   this session, not previously stated).
5. **Confirmed working:** AG-22's real (verbatim-run) `computeOverallLikelihood()` aggregation
   genuinely discriminates by input — 74 vs. 15 across two realistic profiles, not identical
   regardless of what's fed in.
6. **Chain-level risk (synthesis, not visible from either single-agent entry):** AG-20/AG-21's
   own documented fetch-layer miss rate means AG-22 will systematically underscore real
   companies with genuine giving programs once the two total blockers are cleared, with no
   schema signal distinguishing "low propensity" from "enrichment never actually found
   anything."

**Recommendation:** don't mark the full pipeline as end-to-end verified. Beyond the AG-20/
AG-21 entries' own recommendations (apply migration 107+108/109, fix the API key, widen the
candidate-path lists): (a) change AG-22's trigger condition to reflect whether any EA-0X agent
actually wrote a non-default patch (e.g. a per-prospect `enrichment_attempted_agents` list or
per-agent completion timestamps inside `enrichment` itself), not just "the loop finished"; (b)
add a `try/catch` around every EA-0X agent's `callClaude()` call (not just EA-08) so a Claude
failure always writes an explicit empty/failed marker instead of leaving the field silently
absent, matching the fix already recommended in the AG-21 entry.

**Verification method:** live execution of the real, unmodified, exported
`mergeEnrichmentPatch()` (via `node --import tsx`, since `node -r tsx/cjs` does not support
the ESM `import` syntax needed here) against an in-memory mock Supabase client, using EA-01's
and EA-08's exact real patch payloads copied verbatim from their own source; a verbatim,
byte-for-byte transcription of AG-22's module-private `computeOverallLikelihood()`/
`clampScore()` run directly against two realistic, contrasting score sets; fresh live checks
of both the `corporate_prospects` table and the Anthropic API key (both still blocking); and
direct reading of `enrichProspect()`, `triggerScoreEngine()`, and AG-22's `execute()` for the
trigger-decoupling defect. The 9 individual `PS-02..PS-10` rubric scores are my own reasoned
application of AG-22's real, unmodified prompt to real company facts, substituting for the
blocked live Claude call — explicitly not a live completion, consistent with how the AG-20/
AG-21 entries handled the same blocker. No `corporate_prospects` test rows were created (same
table-missing blocker); no mocks used in place of real code paths, only in place of the
external DB/Claude-API network calls those code paths make.

---

## AG-15

**Spec under test:** `AGENTS_v2.md` §5, AG-15 "Grant Probability Agent", plus its own
"Real vs. Canonical" cross-reference row (§4) and `FEATURE_REGISTRY_v2.md`'s two places this
feature is tracked: Pillar 5 (rows #102-106, "Probability Scoring Engine" etc., all stamped
`IN BUILD` / `Tonight.` from the original ~July 17-19 build session and never updated since)
and the Autonomous Agents table (row #196, `AG-15 Autonomous Probability Scoring — BUILT —
Post-discovery or scheduled. Threshold gate chains to AG-05.`, no caveat). This entry checks
both halves of what "AG-15" actually means in this codebase: the live deterministic engine
(`computeGrantProbability()`) and the autonomous agent wrapper (`ProbabilityScoringAgent`,
`agentId: "ag-15-probability"`) that `AGENTS_v2.md` itself already flags as blocked.

**Verdict: split result. The deterministic engine is genuinely BUILT and verified working
end-to-end against real production data — `FEATURE_REGISTRY_v2.md` Pillar 5 rows #102-104 are
actually true today, ahead of their stale "IN BUILD / Tonight" wording. But
`FEATURE_REGISTRY_v2.md` row #196 ("AG-15 Autonomous Probability Scoring — BUILT — ... chains
to AG-05") is false and directly contradicted by a live test this session: the autonomous
agent cannot run at all in production, confirmed by reproducing its exact failure live, not
just by reading the code.**

### What actually happened (in order)

1. **`pnpm tsc --noEmit` — both real files compile clean.** Neither
   `src/lib/intelligence/grant-probability-engine.ts` nor
   `src/lib/agents/probability-scoring-agent.ts` appears anywhere in the compiler's error
   output. (The full run does report ~30 pre-existing errors, all confined to
   `src/__tests__/**` — unrelated test-file issues, not AG-15 code; consistent with project
   memory that the tsc gate doesn't cover the test tree cleanly.)

2. **Reproduced `ProbabilityScoringAgent.startRun()`'s exact live-DB failure, not just read
   the code and trusted its own header comment.** The class's own header (lines 42-48) already
   states `agent_type: "ag-15-probability"` is "still not a value in the agent_type enum." To
   confirm this is current, not stale, I ran the exact insert `startRun()` performs
   (`agent_runs.insert({ organization_id, agent_type: "ag-15-probability", status: "running",
   trigger_source, input_params, started_at })`, copied field-for-field from
   `autonomous-base.ts` lines 136-147) directly against the live production database
   (`vbjplpquqxxfbpazyalt`) via the service-role client, scoped to the real Faith Foundation
   org (`b1ab7402-dfc2-4712-869f-70ea3566cc1d`). Result:
   ```
   error: {"code":"22P02","message":"invalid input value for enum agent_type: \"ag-15-probability\""}
   ```
   Confirmed live and current, not a doc claim. **`ProbabilityScoringAgent.run()` cannot
   execute at all in production right now — it throws before a single line of its own logic
   runs, on every trigger path** (`autonomous`, `manual`, `chain`, `schedule` alike, since
   `startRun()` is the very first line of `run()`).

3. **Checked whether the AGENTS_v2.md §1.3 chain-routing gap (no `routeQueueItem()` case for
   `'ag-15-probability'`) is still real — it is not; that part has since been fixed.** Grepping
   `worker/autonomous-orchestrator.ts` today shows an explicit `case 'ag-15-probability':`
   (line 1256) that calls `new ProbabilityScoringAgent(...).run('chain')` — so the chain
   producers (`OpportunityDiscoveryAgent`'s `queueChainedAgent("ag-15-probability", ...)`,
   `EligibilityScoringAgent`'s same call, `DeadlinePredictionAgent`'s same call) now have a
   real destination. This is genuine, verified progress since the July 19 edition of
   `AGENTS_v2.md` — the routing half of the "unreachable by every available path" claim in
   that document is now stale and should be corrected. **It does not change the outcome**:
   `probability-scoring-agent.ts`'s own header (written after the routing fix, per its "FULL
   AGENTIC UPGRADE (July 2026)" framing and explicit acknowledgment of the still-open enum
   gap) confirms the agent's author already knew routing alone wasn't enough — item 2 above is
   the live confirmation that the enum gap is the surviving, sole blocker.
   `runQueueItem()`'s outer `try/catch` (lines 1381-1399) catches the thrown error, increments
   `agent_queue.retry_count`, and marks the row `failed` after 3 attempts — consistent with
   `AGENTS_v2.md`'s "does not crash the nightly pipeline, but never successfully completes a
   run" framing for sibling agents AG-17/AG-05.

4. **Ran the real, unmodified `computeGrantProbability()` — the actual live implementation
   behind AG-15's manual/batch call sites — against two real, contrasting opportunities in the
   live Faith Foundation org**, imported directly (`import { computeGrantProbability } from
   './src/lib/intelligence/grant-probability-engine'`, executed via `node --import tsx`), no
   mocks, real Supabase writes:
   - **CDBG (Community Development Block Grant)**, `housing_grant`, no deadline on file, no
     eligibility score on file → **score 40, confidence "low", recommendation "consider"**.
     Factor math checks out by hand: eligibility defaults to neutral 0.5 × 30% = 15;
     category_win_rate defaults to neutral 0.3 × 25% = 7.5 (confirmed zero real `outcomes` rows
     exist for this org — the neutral fallback is the *correct* behavior here, not a bug
     papering over missing data); deadline_proximity = 0 (no deadline) × 20% = 0; twin
     completeness = real live value 0.70 × 25% = 17.5. Sum = 40.0, matches exactly.
   - **CEVSS (Centers of Excellence for Veteran Student Success)**, `government_grant`,
     real deadline on file (`2026-06-23`, **already 37 days in the past relative to today's
     date 2026-07-30**) → **score 40, confidence "medium"** (confidence correctly moved from
     low to medium because a real deadline value is now present, satisfying one more of the 4
     `realDataCount` checks — even though that deadline has passed, which is a separate,
     genuine defect, see below).
   - Both results **persisted for real** to `opportunity_probability_scores` via the function's
     own upsert — confirmed by reading the row back after each run, not just trusting the
     return value.

5. **Found a genuine, live-reproduced logic defect in `computeGrantProbability()`'s risk-message
   builder** while inspecting the CEVSS result: for a deadline that has already passed (37 days
   ago), `buildKeyRisks()` (lines 235-247) produced the risk text **"Deadline is under 15 days
   away — limited prep time"** instead of the intended **"Deadline has already passed."**
   Reading the code confirms why: 
   ```
   const days = differenceInCalendarDays(new Date(opportunity.deadline), new Date());
   if (days < 15) {
     risks.push("Deadline is under 15 days away — limited prep time.");
   } else if (days < 0) {
     risks.push("Deadline has already passed.");
   }
   ```
   `days < 15` is true for every negative value too, so the `else if (days < 0)` branch is
   **dead code — structurally unreachable**, since any `days < 0` already satisfied `days < 15`
   on the branch above it. This does not affect the numeric score (`scoreDeadlineProximity()`
   has its own, separately-correct `days >= 0 ? 0.1 : 0` check and did score this opportunity's
   deadline factor at 0, the right answer) — it is purely a misleading user-facing risk message
   for any opportunity whose deadline has lapsed but is still marked `status = 'open'` (which
   CEVSS, a real row in the live database, currently is). Not previously documented anywhere
   in `AGENTS_v2.md` or `FEATURE_REGISTRY_v2.md`.

6. **Confirmed the two real call sites that make Pillar 5 rows #102-104 true today**: 
   `src/app/api/intelligence/grant-probability/route.ts` imports and calls
   `computeGrantProbability()` directly (line 5, line 55) — the "Probability API Route" (#103)
   is real, not a stub. `scripts/batch-score-opportunities.ts` does the same (line 23, line
   147) for the "Batch Score Runner" (#104). `src/app/(dashboard)/opportunities/page.tsx`
   references `opportunity_probability_scores`/`overall_score` directly, consistent with #105
   ("Probability Badges on Opportunities") being wired to real data, not a placeholder — UI
   rendering itself was not re-verified visually this session (no browser check performed), so
   treat #105's specific visual claim as read-verified, not screenshot-verified.

### Root-cause summary

1. **Confirmed working, ahead of the stale registry wording:** the deterministic engine
   (`computeGrantProbability()`) is real, compiles clean, and was proven this session to run
   against two different real live opportunities in the real production org, producing
   correctly-computed (hand-checked) scores that respond to genuine differences in input
   (twin completeness, deadline presence, eligibility score, outcome history) rather than a
   fixed or fabricated number, and persists them via a real upsert. `FEATURE_REGISTRY_v2.md`
   #102-104 should read BUILT, not IN BUILD.
2. **Confirmed broken, contradicting the registry's unqualified claim:** the autonomous agent
   (`ProbabilityScoringAgent`, `agent_type: "ag-15-probability"`) cannot execute at all in
   production — reproduced live, not inferred from the enum audit alone. Every trigger path
   (nightly schedule, chain from AG-17/AG-02/AG-25, manual, queue) fails at the first line of
   `run()`. `FEATURE_REGISTRY_v2.md` #196 ("BUILT ... Threshold gate chains to AG-05") is false
   as stated; the described chain (probability → threshold gate → AG-06 draft) has never
   executed once in production.
3. **Partial correction to `AGENTS_v2.md` §1.3 itself:** the chain-routing gap it documents
   for `'ag-15-probability'` has been fixed since that document's July 19 pass —
   `worker/autonomous-orchestrator.ts` now has a live `case 'ag-15-probability'`. The enum gap
   (§1.2) is the sole remaining blocker for this specific agent, not routing.
4. **New defect, not previously documented:** `buildKeyRisks()`'s deadline-passed branch is
   dead code due to a bounds-check ordering bug, producing a misleading risk message ("under 15
   days away" instead of "already passed") for any open opportunity with a lapsed deadline —
   confirmed against a real row (CEVSS) in the live database, not a synthetic case.

**Recommendation:** correct `FEATURE_REGISTRY_v2.md` row #196 to reflect that the autonomous
wrapper is blocked (matching the caveats already present on neighboring rows like #217/#218/
#227), not unqualified BUILT. Add the `ag-15-probability` (and the other 11 still-missing
literals per `AGENTS_v2.md` §1.2) to the `agent_type` enum via one migration before trusting
any nightly/chain-triggered probability scoring. Separately, swap `buildKeyRisks()`'s deadline
check to `days < 0` first (or `else if` ordering fixed) so a lapsed deadline reports correctly
instead of falling into the "under 15 days" branch.

**Verification method:** live `pnpm tsc --noEmit` against the full project; a live,
field-for-field reproduction of `startRun()`'s real `agent_runs` insert against the live
production database (project `vbjplpquqxxfbpazyalt`), scoped to the real Faith Foundation org,
with the resulting error captured verbatim (no test row was left behind — the insert failed
before a row was created, so there was nothing to clean up); a repo-wide grep confirming
`routeQueueItem()`'s current case list; live execution of the real, unmodified, exported
`computeGrantProbability()` (via `node --import tsx`, no mocks) against two real open
opportunities already present in the live database, with both the returned object and the
persisted `opportunity_probability_scores` row read back and hand-checked against the
function's own factor-weight math; direct reading of `buildKeyRisks()` to root-cause the
deadline-message defect the live CEVSS run surfaced. All temporary test scripts were deleted
after the session; no repo files were left behind.
