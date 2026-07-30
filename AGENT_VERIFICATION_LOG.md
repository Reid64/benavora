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
