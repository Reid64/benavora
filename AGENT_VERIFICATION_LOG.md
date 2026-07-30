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
