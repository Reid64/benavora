# PT-14 — Phase 14 Summary (Security: Injection Sweep, RLS/Anon + Storage Audit, Bundle Secret
Scan, Middleware Review)

Consolidated numbers for the PT-14 phase, across all three sub-passes (PT-14-001/002 injection
sweep, PT-14-004/005 RLS/anon + storage audit, PT-14-003 bundle secret scan + middleware review).
Every count below cites the evidence artifact it came from — re-run the cited verifier or read the
cited file directly to reproduce it; nothing here is asserted from memory.

## P0 findings — read this first

Four P0s across the whole phase, all in the SSRF/availability space. Nothing else in this phase
(RLS, storage, secrets, XSS, the one SQLi finding) reaches P0 — see the sections below for why each
of those is graded lower.

| id | what | live-confirmed? |
|---|---|---|
| **WGR-108** | `POST /api/intelligence/ingest` — zero-validation server-side `fetch()` on a fully user-supplied URL, response **persisted** to the Intelligence Library (SSRF + exfiltration) | Yes — real local listener reached via the exact vulnerable code |
| **WGR-109** | AutoApply `WebhookNotifier.notify()` — zero-validation `fetch()` to an admin-set `webhook_url`, fires on every real AutoApply event | Yes — real local listener received the POST |
| **WGR-110** | AutoApply submission pipeline navigates a real headless browser to `funders.giving_portal_url` with zero SSRF guard (worse than the other two — full browser, not just a fetch) | No — static source read only, high-confidence, not empirically reproduced |
| **WGR-111** | `src/middleware.ts` redirects every request with no Supabase session cookie to `/login`, including Stripe/Resend webhooks and Vercel Cron — before the route's own signature/`CRON_SECRET` check runs | Yes — 21 live attempts against production this phase (injection sweep), plus a second, independent set of 7 live production probes (dedicated middleware review, `bundle-and-middleware.json`) |

Everything below this point is detail and lower-severity findings. See `REVIEW-PACK.md` in this
same directory for the plain-language version.

## Scope and prerequisites

Step 1 of this phase's own instructions was to confirm PT-00 (route inventory), PT-05 (tenant
isolation, cross-org read/write results), and PT-06 (DB integrity/schema) artifacts exist and are
usable before starting — confirmed:

- **PT-00** (`test-evidence/pt-00/route-manifest.json`) — 464 routes discovered (146 pages, 318 API
  routes), generated 2026-08-19. This is the source manifest PT-02's route classification (below) is
  built from.
- **PT-02** (`test-evidence/pt-02/api-routes.json`) — the actual "route classification" this phase's
  injection sweep is scoped against, per the task's own wording. 318 API routes, 231 flagged
  `isMutation`, classified by real auth mechanism: 271 `requireRole`, 17 `auth.getUser`, 14
  `cron_secret`, 4 `webhook_signature`, 3 `requireAuth`, 1 `oauth_code_exchange`, 8 `none_detected`.
- **PT-05** (`test-evidence/pt-05/PHASE-05-SUMMARY.md`, `cross-read.json`, `cross-write.json`) — the
  "table list + isolation results" this phase's task text asked to confirm. Real result: 0/120
  tenant-scoped tables leaked cross-org on read (WGR-071) or write (UPDATE/DELETE/INSERT, WGR-073),
  including all 13 tables PT-06 flagged as missing their live FK to `organizations`
  (`tenant_fk_gap`). This is the load-bearing context for grading this phase's own SQLi finding
  (WGR-112) as tenant-contained rather than a cross-org leak — PT-05 already independently proved
  the `organization_id` boundary itself holds even where individual query-filter injection exists.
- **PT-06** (`test-evidence/pt-06/live-schema.json`, `integrity.json`) — 184 tables / 2,226 columns
  live-queried 2026-08-20; confirms the real column shapes (`funders.giving_portal_url`,
  `webhook_configs.webhook_url`, `synced_email_threads.subject`/`.snippet`/`.gmail_thread_id`, etc.)
  this phase's SSRF/SQLi findings depend on.

All four prerequisite files existed and were non-empty before any new work started this phase — no
HALT was needed.

## Method

Per the task's explicit instruction, this was not a per-route manual fuzz of all 464 routes (not
tractable in one pass) but a two-layer sweep:

1. **Static classification** across every real query-construction, HTML-rendering, and outbound-fetch
   sink in `src/`/`worker/` — grep-based, exhaustive (every `.rpc(`/`.or(\`.../`.filter(\`.../
   `dangerouslySetInnerHTML`/raw `fetch(` call site with a non-literal URL was individually read and
   classified), not sampled.
2. **Live attempt+result tests** for every candidate the static sweep surfaced, run via
   `scripts/audit/pt14-002-live-tests.mjs`: real HTTP requests against production for SQLi/CSRF (a
   real throwaway org/user provisioned via service role, real session cookies obtained through
   `@supabase/ssr`'s own `createServerClient` cookie-jar serialization — not a hand-reconstructed
   cookie encoding — matching the proven methodology in `scripts/security-test-main.mjs`), a mix of
   production test-data inserts and direct execution of the one real raw-HTML-building function for
   XSS, and entirely local comparative tests for SSRF (no production network side-effects — see
   below for why). All test data (2 throwaway orgs, their users, and every seeded row) was deleted
   after each run and independently re-confirmed removed (`test-evidence/pt-14/injection.json`'s own
   `testOrgIds`, cross-checked against a final `organizations` query finding zero `PT14SEC-%` rows
   remaining).

**Why SSRF ran entirely locally, not against production**: the three real SSRF sinks this phase found
are all *server-side outbound* fetches (the platform's own server making a request to an
attacker-chosen address), not something a client-side request against production could safely or
meaningfully probe — pointing production's own server at an address you don't control and hoping to
observe the result from outside is neither safe nor conclusive. The decisive, safe, and fully
"real, unmodified code" way to prove the absence of protection is a same-host comparative test: start
a real local HTTP listener, then run (a) the platform's own hardened `safeFetch()`
(`src/lib/security/safe-fetch.ts`, imported live and unmodified) against it and confirm it blocks,
and (b) the *exact* vulnerable `fetch()` call from each real sink (copied verbatim from source, not
reimplemented) against the same listener and confirm it does not. This is the same contrast method
`SECURITY_TEST_2026-08-15.md`'s own SSRF section already used for `safeFetch()`'s positive-control
cases (loopback/RFC1918/link-local all `BLOCKED`).

## Results by vector class

Full per-attempt detail: `test-evidence/pt-14/injection.json` (34 attempts total, one row per
attempt, every row carrying a real `verdict`). Verified via `node scripts/audit/verify-pt14-001.mjs`
(exit 0) — the verifier independently recomputes every summary count from the raw `attempts[]` array
rather than trusting the file's own `summary` object, and requires every one of the four vector
classes to have at least one attempt whose `method` is a genuine live/direct-execution test, not
static-only.

### SQLi — 1 real finding (WGR-112, P2), 3 confirmed-mitigated/baseline

| id | target | verdict |
|---|---|---|
| sqli-001 | GET /api/email/threads?search= (baseline, no injection) | BASELINE_OK — 0 results for a non-matching term |
| sqli-002 | GET /api/email/threads?search= (comma-injected `gmail_thread_id.neq.<bogus>` clause) | **VULNERABLE** — both seeded rows returned despite neither matching the search term |
| sqli-003 | GET /api/intelligence/corporate-prospects?q= (comparison — `[%,]` stripped before use) | MITIGATED |
| sqli-004 | POST /api/intelligence/library/search {query} (comparison — `sanitizeIlikeTerm()`, `[,()%]` stripped) | MITIGATED |

Every real query-construction sink in `src/`/`worker/` was individually read this session, not
sampled: 12 raw-template-literal `.or(\`...\`)` call sites found repo-wide (`email/threads`,
`funders/[id]/relationship-builder`, `intelligence/corporate-prospects`, `intelligence/library/
search`, `relationship-builder-agent.ts`, `foundation-matcher.ts`, `proposals-query.ts`, and 4 worker
job files) — 8 of the 12 confirmed to interpolate only internal, non-user-controlled values (ISO
timestamps, DB-derived UUIDs, a hardcoded NTEE prefix lookup table); the remaining 4 are the ones
listed above. Zero raw `pg`/`postgres` client usage and zero dynamic `EXECUTE format(...)` SQL found
anywhere in `src/`/`worker/` (grep across both directories, zero hits outside `scripts/` audit
tooling) or in any migration file — this codebase's only real query-injection surface is the
PostgREST-filter-string class documented above, not classical string-concatenated SQL.

**Scope of WGR-112, precisely**: `organization_id` is enforced via a separate, non-injectable
top-level `.eq()` filter (a distinct PostgREST query parameter, ANDed with the vulnerable `.or()`
clause) — this specific hole cannot cross the tenant boundary, both by construction (the injectable
string never touches the `organization_id` filter) and by PT-05's independent, already-proven 0/120
cross-tenant-leak result. Real impact is a same-org business-logic filter bypass (a caller's own
session can retrieve more of their own org's rows than the search term should match, or trigger a
500 with certain malformed payloads — also reproduced this session) — not a cross-tenant leak, and
not classical SQL injection in the string-concatenation sense.

### XSS — 0 exploitable findings; 1 already-documented, still-unfixed adjacent gap re-confirmed (WGR-113, P2)

| id | target | verdict |
|---|---|---|
| xss-001 | knowledge_base.content (stored, live insert) | STORED_BUT_NO_RENDER_SINK |
| xss-002 | contacts.name (stored, live insert) | STORED_BUT_NO_RENDER_SINK |
| xss-003 | src/app/api/unsubscribe/route.ts's own `escapeHtml()` (direct execution against a live `<script>`/quote/ampersand payload) | BLOCKED |
| xss-004 | src/lib/email/templates/*.ts (5 files, static re-scan) | CONFIRMED_STILL_UNFIXED |
| xss-005 | repo-wide `dangerouslySetInnerHTML` census | NO_USER_CONTROLLED_SINK |

Zero exploitable React-render-path XSS found. Confirmed exactly 2 `dangerouslySetInnerHTML` call
sites exist repo-wide: one is a comment (`MarkdownContent.tsx`'s own header explaining it deliberately
avoids the API — that component builds React nodes directly for exactly this reason), the other
(`HowItWorksClient.tsx`) injects a hardcoded, developer-authored CSS string interpolating only a
fixed brand-token hex constant — read directly, confirmed no user-controlled data reaches it. A live
`<script>`/`onerror` payload was inserted via a real authenticated session into both
`knowledge_base.content` and `contacts.name`, confirmed to round-trip raw and unescaped from the
database (correct — escaping belongs at render time, not write time) with no render sink found for
either field. `src/app/api/unsubscribe/route.ts` is the one real place in this codebase that builds a
raw `text/html` response embedding attacker-controlled input (the `email`/`token` GET query params) —
its own `escapeHtml()` function was executed directly (byte-for-byte copied, not reimplemented)
against a live payload and correctly neutralized every HTML-meaningful character.

**WGR-113** re-confirms, not newly discovers: `SECURITY_TEST_2026-08-15.md` section 2b already
documented all 5 email templates (`base-layout`, `draft-ready`, `morning-digest`, `urgent-alert`,
`welcome`) interpolating user-controlled fields (org display name, digest item titles) into raw HTML
with zero escaping — that finding was never carried into `WIRING_GAP_REGISTER.md`, so this phase adds
it there (WGR-113) rather than leaving it undocumented in the register the rest of this audit program
actually tracks against. Re-scanned fresh this session: still zero `escapeHtml`/`sanitize` reference
across all 5 files, unchanged.

### CSRF — 0 forgeable state-changing routes found; 1 major availability finding (WGR-111, P0)

| id | count | verdict |
|---|---|---|
| csrf-nocookie-* (8 routes: requireRole-gated mutations/reads) | 8/8 | BLOCKED (307/401/403) |
| csrf-unsigned-webhook-* (4 webhook_signature routes, forged unsigned event) | 4/4 | BLOCKED |
| csrf-unauth-cron-* (7 cron_secret routes, no Authorization header) | 7/7 | BLOCKED |
| csrf-header-spoof-onboarding | 1/1 | BLOCKED |
| csrf-middleware-blocks-external-webhooks-and-cron | 1 | MIDDLEWARE_INTERCEPTS_UNAUTHENTICATED_CALLERS |

21 live attempts against production, 0 forgeable — every no-cookie request to a `requireRole`-gated
route correctly redirects/rejects; a spoofed `x-organization-id`/`x-user-id` header (the trust
mechanism `/api/onboarding` uses in lieu of `requireRole()`) is confirmed genuinely overwritten by
`src/middleware.ts`'s `Headers.set()` before the route ever sees it, not merely appended alongside
the real value.

**But investigating *why* the 4 webhook and 7 cron/source routes reject an unsigned/unauthenticated
forged request surfaced a real, separate, and more serious problem than the CSRF question itself.**
All 11 of those routes reject the forged attempt via the exact same mechanism as every other
protected route on this platform: `src/middleware.ts`'s catch-all matcher redirects any request with
no valid Supabase session cookie to `/login`, **before the route handler — and its own real HMAC
signature check or `CRON_SECRET` comparison — ever runs.** Confirmed live: every one of the 11
routes returned a real `307` redirect to `/login`, not a `401`/`400`/`500` from the route's own logic.
This is airtight *as* a forgery defense (a request that never reaches the handler cannot forge
anything), but middleware has no way to distinguish "no session cookie because this is a forged
attacker request" from "no session cookie because this is Stripe/Resend/Vercel Cron, which never
carry one in the first place." `vercel.json` schedules 5 real cron jobs
(`/api/cron/{research,grantsgov,reminders,autoapply,domain-warmup}`) via Vercel's own Cron invoker —
also just an HTTP request with no session cookie, also subject to the same middleware redirect.
**WGR-111**: real Stripe billing events, real Resend delivery/reply events, and all 5 real Vercel
Cron jobs may be silently redirected and never reach their handlers in production today. This was
not confirmed against an actual live Stripe/Resend delivery or a real Vercel Cron firing this session
(would need external dashboard/delivery-log access, out of reach here) — flagged as a real,
repeated, directly-observed production finding, not a certainty about how Stripe/Resend/Vercel
specifically behave on a redirect response.

### SSRF — 2 live-confirmed findings (WGR-108, WGR-109, both P0), 1 high-confidence static finding (WGR-110, P0)

| id | target | verdict |
|---|---|---|
| ssrf-000 | src/lib/security/safe-fetch.ts `safeFetch()` (positive control, real local loopback listener) | BLOCKED |
| ssrf-001 | POST /api/intelligence/ingest {source:'url'} — exact vulnerable `fetch()` copied verbatim | **VULNERABLE** |
| ssrf-002 | src/lib/autoapply/webhook-notifier.ts `WebhookNotifier.notify()` — exact vulnerable `fetch()` copied verbatim | **VULNERABLE** |
| ssrf-003 | AutoApply `giving_portal_url` -> `stealth-browser.ts` headless navigation (static only) | NO_GUARD_FOUND_STATIC |

`src/lib/security/safe-fetch.ts` (`safeFetch()`) is the platform's real, working SSRF defense — but
repo-wide grep confirms only 2 files import it: `src/lib/agents/custom-api.ts` and
`src/lib/agents/custom-scrape.ts` (the Custom API Connector / Scraping Target feature it was built
for, per `FEATURE_REGISTRY_v2.md` rows #59/#60). Three other real, server-side, user-URL-taking fetch
paths exist entirely outside that protection:

1. **`POST /api/intelligence/ingest`** (WGR-108) — `requireRole('writer')` (the lowest privileged
   authenticated role above viewer) is the only gate; the fetched content is then extracted and
   **persisted** to `intelligence_funded_proposals`, readable later by any viewer through the
   Intelligence Library — full response-content exfiltration, live-reproduced this session (a real
   local loopback listener's marker payload was successfully retrieved through the exact vulnerable
   code path).
2. **`WebhookNotifier.notify()`** (WGR-109) — `requireRole('admin')` gates *creating* the webhook
   config, but the fetch itself fires automatically on every subsequent AutoApply event with zero
   URL validation beyond a bare `new URL(webhook_url)` syntax check; live-reproduced this session (a
   real local loopback listener genuinely received the POST).
3. **AutoApply's `giving_portal_url` -> full headless browser navigation** (WGR-110) — the highest-
   severity of the three by mechanism (real Chromium navigation, not just an HTTP fetch — meaning JS
   execution, screenshots, and page-content extraction all become available), confirmed via static
   source read (zero SSRF-guard pattern anywhere in `stealth-browser.ts` or the general-purpose
   `stealth-engine.ts`) but not live-reproduced (a full Playwright browser launch was judged out of
   reasonable scope for this pass) — flagged as high-confidence, not empirically confirmed the way
   the other two are.

## Register coverage

7 new rows this phase: **WGR-108 through WGR-114** (`test-evidence/_register/WIRING_GAP_REGISTER.md`),
continuing numbering from PT-13's last row (WGR-107). WGR-108/109/111/112/113 are `CONFIRMED-BROKEN`
(live-reproduced or directly, repeatedly observed against production); WGR-110 is `UNVERIFIED`
(high-confidence static evidence, not live-reproduced); WGR-114 is `CONFIRMED-OK` (the clean/mitigated
results, recorded together per this register's own established convention — see WGR-071/073/076 —
rather than one row per individual passing attempt).

## Verifier status

```
node scripts/audit/verify-pt14-001.mjs
  -> PASS: injection.json records the sweep across all four required vector classes.
     sqli: 4 attempts, 1 vulnerable
     xss: 5 attempts, 0 vulnerable
     csrf: 21 attempts, 0 vulnerable
     ssrf: 4 attempts, 2 vulnerable
     Total P0 findings: 4
     Total attempts: 34
```

The verifier requires: all four vector classes present with >=1 attempt each; every attempt carries
a non-empty `verdict`/`id`/`target`/`description`/`method`; no duplicate ids; each vector class has
at least one genuinely live (non-static-only) attempt; `summary` counts independently recomputed from
the raw `attempts[]` array match the file's own `summary` object exactly; every `severity: "P0"`
finding carries a real, non-trivial description.

## Cleanup verification

Both throwaway test orgs (`PT14SEC-SQLI-*`, `PT14SEC-XSS-*`) and every row seeded under them
(`synced_email_threads` x2, `knowledge_base` x1, `funders` x1, `contacts` x1, plus their
`platform_config`/`profiles` rows and auth users) were deleted after the run and independently
re-confirmed removed via a fresh `organizations` query returning zero `PT14SEC-%` rows. One earlier
run in this session was interrupted mid-cleanup by a local shell pipe issue (unrelated to the
application) and left 2 orgs + their child rows behind; found and fully cleaned up before this
summary was written, confirmed by the same zero-remaining-rows check. No real customer data was read,
written, or touched by any live test this phase.

---

## PT-14-002/004/005 addendum -- table-by-table RLS + storage anon audit, resolving the MASTER_BACKLOG-vs-later-claim conflict

**The conflict this addendum resolves:** `MASTER_BACKLOG.md` §1.1/§1.2 (dated 2026-07-30) flagged 8
tables anon-readable with real data (`platform_admins`, `organizational_digital_twins`,
`opportunity_probability_scores`, `donor_discovery_directory`, `autoapply_submissions`,
`submission_queue`, `form_templates`, `request_profiles`) and 5 of 6 live storage buckets with zero
`storage.objects` policy. Separate, later sessions (`STATE_OF_THE_BUILD.md`, 2026-08-03 and
2026-08-06: "RLS remediation complete... independently re-verified 55/55 PASS") claimed these were
all fixed. Neither claim was re-checked against the other with the real anon key until this pass.

**Method:** two layers, both real, per table/bucket -- (a) DB-level ground truth (`pg_class.
relrowsecurity`, `pg_policies`, `information_schema.role_table_grants`) fetched over the same
read-only-enforced `DATABASE_URL` connection PT-06/PT-05 already proved safe (verified again this
session with a real rejected `CREATE TABLE`), and (b) a real, live, unauthenticated `GET` against
`{SUPABASE_URL}/rest/v1/{table}` using **only** the anon key (`apikey` + `Authorization: Bearer
<anon key>`, no session, no JWT), compared against an identical service-role request as ground truth
for whether real data exists. Extended to **all 184 tables** in PT-06's current live schema (not
just the 8 MASTER_BACKLOG named -- the schema has grown since 2026-07-30) and **all 7 live storage
buckets** (one more than MASTER_BACKLOG's 6 -- see below). RPCs enumerated via `pg_proc` +
`has_function_privilege('anon', ..., 'EXECUTE')`, not live-invoked (several are real mutating
functions; invoking them with the anon key risks corrupting production state, which enumeration
does not require).

### Result: the later claim was correct. 0 of 184 tables, 0 of 7 buckets return real data to anon today.

All 8 disputed MASTER_BACKLOG §1.1 tables resolved `CONFIRMED_FIXED_LIVE` -- re-verified individually,
right now, with the real anon key, not by re-reading either prior document. Verdict breakdown across
all 184 tables: 77 `ANON_BLOCKED_NO_GRANT` (base table privilege revoked), 55 `ANON_BLOCKED_BY_RLS`
(grant present, RLS correctly filters to zero rows against a real, nonzero service-role row count),
52 `TABLE_EMPTY_INCONCLUSIVE` from live data alone -- each individually resolved via a DB-level
grant+RLS+policy fallback check rather than left open (0 of the 52 flagged at-risk). Full detail:
`WGR-115`.

5 of MASTER_BACKLOG's disputed buckets (`session-recordings`, `org-b1ab7402-...`, `documents`,
`autoapply-screenshots`, `org-documents`) resolved: 3 confirmed against **real objects** the
service-role list found (resolving `STORAGE_POLICY_AUDIT.md`'s own documented "0 objects, can't
distinguish locked-down from empty" ambiguity) -- anon `LIST`/`GET` both correctly blocked; 2 (no
objects to test today) resolved safe via the DB-level `ZERO_POLICY_DEFAULT_DENY` check. `nofa-pdfs`
(§1.2 #13, never disputed as broken, only flagged for a one-line intentionality confirmation) is
unchanged -- still open, still needs Reid's confirmation, not resolved by this audit. Full detail:
`WGR-116`.

### Two real findings, neither a live P0, both worth a follow-up pass

1. **A 7th bucket, `org-branding`, exists live today** -- not in MASTER_BACKLOG's original 6 (created
   after 2026-07-30). Same shape as `nofa-pdfs`: public read by design, but write is
   `TO authenticated` with **no** organization/owner check -- any authenticated user from any org can
   overwrite any object. Plausibly intentional (public-facing branding assets) but needs the same
   one-line confirmation `nofa-pdfs` already needed. `WGR-117`.
2. **Beyond the task's literal read-only scope, surfaced by the same DB-level grant query**: 107 of
   184 tables still carry an unrevoked default PostgreSQL `PUBLIC` `INSERT`/`UPDATE`/`DELETE` grant
   to `anon`, and all 47 public-schema RPC functions have `EXECUTE` granted to `anon` (including real
   mutating functions like `resume_paused_submission_queue_item`/`increment_usage_tracking`/
   `donor_discovery_upsert_directory`). Live-verified **none of this is currently exploitable** --
   every one of the 107 tables' applicable write policy predicate references `current_org_id()`/
   `auth.uid()`/`auth.role()='authenticated'`, all of which evaluate false for an anon caller (no JWT
   `sub` claim), and the mutating RPCs run `SECURITY INVOKER` (as the anon role), so they're subject
   to those same table grants -- e.g. `resume_paused_submission_queue_item` would fail immediately
   since `submission_queue` has zero anon grants at all. This is real, live-verified defense-in-depth
   debt, not a live hole: protection currently depends on every write policy's predicate staying
   correct rather than the grant being absent, unlike the read-side tables in `WGR-115`, which are
   protected by the grant itself being gone. `WGR-118`, `WGR-119`.

### Verifier status

```
node scripts/audit/verify-pt14-002.mjs
  -> PASS: rls-anon-audit.json records a real anon-access verdict for every one of PT-06's 184
     tables, and a real policy verdict for every one of 7 storage buckets.
     Tables by verdict: {"ANON_BLOCKED_NO_GRANT":77,"TABLE_EMPTY_INCONCLUSIVE":52,"ANON_BLOCKED_BY_RLS":55}
     Table P0 findings: 0
     Buckets by exposure verdict: {"ANON_BLOCKED":3,"OPEN_PUBLIC_BY_DESIGN":2,"NO_OBJECTS_TO_TEST":2}
     Bucket P0 findings: 0
     RPCs enumerated: 47 (47 anon-executable)
     Disputed MASTER_BACKLOG items resolved: 14 (0 still open, 11 confirmed fixed)
```

The verifier requires: every one of PT-06's 184 tables present with a valid verdict backed by a real
anon HTTP probe result (no static-only classifications); every `TABLE_EMPTY_INCONCLUSIVE` table
carries a `db_level_fallback_verdict` so an empty-today table never stays genuinely unresolved; every
P0-severity table finding carries a real nonzero row count as evidence; every live storage bucket has
both a `db_policy_verdict` and a real `live_exposure_verdict` backed by a real anon probe; the RPC
surface is enumerated and non-empty; all 8 of MASTER_BACKLOG §1.1's named tables are present and
resolved in `disputed_items_resolution`; and the file's own summary counts match its raw data with no
drift.

Evidence: `test-evidence/pt-14/rls-anon-audit.json`. Register: `WGR-115` through `WGR-119`.

---

## PT-14-003 addendum -- client-bundle secret scan + middleware disposition

### Bundle secret-scan result: PASS, 0 findings

Ran a fresh `pnpm run build` (`.next` deleted first, so this scans real, current output, not a
stale artifact) and scanned every file the build actually ships to a browser -- **247 shipped
files scanned**: 209 static JS/CSS/JSON chunks, 12 prerendered HTML pages, 26 RSC payloads.
Explicitly out of scope, and stated as such rather than silently included: `.next/server/**/*.js`
(server-only route-handler/RSC-render code that never reaches a client, so a secret referenced
there is not a client-bundle leak by definition).

Three independent passes, all real:
1. **Known-value pass** -- every secret in `.env.local` with a real, non-`NEXT_PUBLIC_*` value
   (`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `SAM_GOV_API_KEY` x3,
   `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY` x2, `FAITH_FOUNDATION_ORG_ID`) searched literally
   across all 247 files -- **zero matches**. 19 further server-only secret names referenced
   somewhere in `src/`/`worker/` (`CRON_SECRET`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`,
   `CREDENTIAL_ENCRYPTION_KEY`, etc.) had no local value in `.env.local` to test the known-value
   way -- listed explicitly in `bundle-scan.txt`/`_bundle-scan-summary.json`'s
   `secretsReferencedButNotChecked` rather than silently skipped, since a missing local value means
   this specific pass could not check them by literal string match (the pattern pass below still
   covers several of them by shape).
2. **Pattern pass** -- format-based regexes for Stripe live/test/restricted secret keys, PEM
   private-key blocks, AWS access key IDs, Resend API keys, Postgres connection strings with
   embedded credentials, and OpenAI/Anthropic key shapes -- **zero matches** across all 247 files.
3. **JWT role-claim pass** -- every JWT-shaped token found in the bundle (77 total) had its payload
   base64-decoded and its `role` claim checked. **All 77 are `role: "anon"`** -- the real, publicly
   intended `NEXT_PUBLIC_SUPABASE_ANON_KEY` (protected by RLS, not secrecy, per the RLS/anon audit
   above, which independently confirmed 0 of 184 tables leak data to this exact key). **Zero
   `service_role`/`supabase_admin` tokens present anywhere in the shipped bundle.**

**Verdict: PASS, 0 P0 findings.** Full raw output: `test-evidence/pt-14/bundle-scan.txt`. Structured
summary: `test-evidence/pt-14/_bundle-scan-summary.json`, rolled into
`test-evidence/pt-14/bundle-and-middleware.json`. Verified via
`node scripts/audit/verify-pt14-003.mjs` (exit 0) -- the verifier independently re-derives the
scanned-file count from the raw `bundle-scan.txt` output and requires it to match the JSON summary's
own claimed count, so a stale or hand-edited summary would fail the check, not just a missing file.

### Middleware disposition: WGR-023's root cause reconfirmed live in production, plus a real
conflicting-report finding

PT-02's WGR-023 (`src/middleware.ts` has no exemption for cron/webhook/bootstrap/unsubscribe
routes) was originally built entirely on a **local dev-server** unauthenticated-rejection sweep --
its own text says production env vars "were not checked." This pass closed that gap with a real
probe against `https://www.benavora.com` itself (not local `pnpm dev`), 7 of the 18 routes WGR-023
names, including 2 of the 5 real `vercel.json`-registered Cron targets (`/api/cron/grantsgov`,
`/api/cron/domain-warmup`) and both webhook routes (`/api/webhooks/stripe`, `/api/webhooks/resend`),
plus `/api/platform/bootstrap` and `/api/unsubscribe`.

**Every one of the 7 returned `HTTP 307 Location: /login`** -- full headers captured, including a
real `Server: Vercel` and a distinct `X-Vercel-Id` on every response (confirming genuine
per-request production responses, not a cached/CDN artifact). Adding an
`Authorization: Bearer wrongsecret` header made no difference to any of the 7 -- `src/middleware.ts`
redirects an unauthenticated caller before the route's own `CRON_SECRET`/signature check ever runs,
confirmed identically in production as it was locally. **This is the same underlying fact WGR-111
already registers (P0, from the injection/CSRF sweep's own 21 production attempts) -- this pass
reaches it a second, independent way (a dedicated middleware review, separate evidence file,
`bundle-and-middleware.json`, not `injection.json`), which is why WGR-023's own row has been
updated in place (see Register coverage below) rather than left describing only the stale
local-dev-only evidence.**

**A real, unresolved discrepancy, recorded rather than silently preferring one source:**
`WIRING_GAP_REGISTER.md`'s WGR-003 row separately records "Reid reports cron routes return `401`
(not a redirect) when hit unauthenticated in production." This session's live curl evidence
directly contradicts that report for every one of the 7 routes probed today (`307`, not `401`).
Recorded explicitly in `test-evidence/pt-14/bundle-and-middleware.json`'s
`middlewareReview.wgr023Disposition.conflictingReport` field rather than silently resolved either
way -- needs Reid to reconcile (a stale report, a since-reverted fix, or testing against a
different deployment/environment than `www.benavora.com`).

**Matcher-gap check (the opposite direction -- a route that bypasses auth when it shouldn't) --
no gap found.** `PUBLIC_PATHS`, `isPublicPath()`'s three narrow exemption clauses (`/api/auth/*`,
`/invite*`, the exact `/api/users/accept` path), and the exported `matcher` regex were parsed
directly out of the live `src/middleware.ts` source (not hardcoded/assumed from memory) -- the
exemption list is exactly the 10 static/auth pages plus those 3 individually-justified clauses, and
the matcher only excludes standard Next.js static-asset infrastructure. **Verdict:
`NO_BYPASS_GAP_FOUND`.** Net picture across both directions checked this phase: this codebase's
middleware errs toward *over*-restriction (WGR-023/WGR-111 -- blocking legitimate server-to-server
callers), never under-restriction -- zero auth-bypass findings anywhere in PT-14.

### Register coverage (this addendum)

**WGR-023's existing row was updated in place** with this session's live production confirmation
(see the row's own "Update (PT-14-003" text). **One new row this addendum, WGR-120** (P3,
`CONFIRMED-OK`) registers the bundle secret-scan's clean result, following the register's
established convention of recording a verified-clean outcome as its own row (see WGR-071/073/076/
114) rather than leaving a 0-finding pass undocumented.

### Verifier status

```
node scripts/audit/verify-pt14-003.mjs
  -> PASS: bundle scan ran for real (247 shipped files scanned, 0 P0 secret finding(s)) and the
     middleware review is recorded with 7 real production probe(s) (cron + webhook both covered)
     and a completed matcher-gap check (NO_BYPASS_GAP_FOUND).
     Bundle scan verdict: PASS
     WGR-023 disposition severity: P0
     Overall verdict: PASS
     P0 findings recorded: 0
```

The verifier requires: `bundle-scan.txt` exists, is non-empty, and contains all 5 expected raw-scan
sections with a positive scanned-file count; `bundle-and-middleware.json` exists, is well-formed,
and its `bundleSecretScan.scope.totalShippedFilesScanned` matches the raw `.txt` file's own count
exactly (catches drift between the two); at least one live production probe targets a real
`/api/cron/*` route and at least one targets a real `/api/webhooks/*` route (not just an arbitrary
API route); every probe targets an actual `benavora.com` URL (not a local dev server); the
matcher-gap check reports a known verdict backed by a real, non-empty `PUBLIC_PATHS` list parsed
from source; and the file's own `overallVerdict` is independently recomputed from
`bundleSecretScan.summary.verdict` + `matcherGapCheck.verdict` rather than trusted as hand-set.

Evidence: `test-evidence/pt-14/bundle-scan.txt`, `test-evidence/pt-14/bundle-and-middleware.json`.
Register: `WGR-023` (updated), `WGR-120` (new).
