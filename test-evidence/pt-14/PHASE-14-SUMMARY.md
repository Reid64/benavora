# PT-14 — Phase 14 Summary (Injection Sweep: SQLi, XSS, CSRF, SSRF)

Consolidated numbers for the PT-14 phase. Every count below cites the evidence artifact it came
from — re-run the cited verifier or read the cited file directly to reproduce it; nothing here is
asserted from memory.

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
