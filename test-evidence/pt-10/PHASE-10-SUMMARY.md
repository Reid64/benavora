# PT-10 — Phase 10 Summary (Error Handling, Fault Injection & Recovery Audit)

Consolidated numbers for the PT-10 phase, across both sub-passes (PT-10-001 malformed-payload fuzz,
PT-10-002 dependency-outage simulation). Every number below cites the evidence artifact it came
from — re-run the cited verifier or read the cited file directly to reproduce it; nothing here is
asserted from memory.

## The question this phase answers

PT-14 already answered "can someone inject something malicious." This phase answers a different
question: **when something goes wrong that nobody engineered on purpose** — a malformed request body,
a slow or unreachable database, a worker process that dies mid-job, a third-party API that returns
garbage — does the app fail *safely* (a clean error, a redirect, a bounded retry), or does it crash,
hang forever, corrupt state, or show a raw stack trace to a user? LOCAL/BRANCH ONLY throughout, per
this audit program's standing rule (`test-evidence/pt-02/BRANCH_STRATEGY.md`) — every live call in
both sub-passes targeted a local Supabase stack (`.pt05-local-stack`) and an isolated `next dev`
instance each script started and stopped itself; no production system, `benavora.com`, or real
third-party network endpoint was ever touched (scenario 3's "malformed responses" are served by a
monkeypatched `global.fetch`, never the real internet).

## Headline result: no white-screen, no data corruption anywhere — but real gaps in both directions

**Read this first.** Across every fault this phase injected — malformed input, a hard DB outage, a
slow DB, a killed worker, garbage third-party API responses — **zero cases produced a blank/white
page, zero produced an unhandled framework crash page visible to a real user, and zero produced a
silently corrupted or duplicated database row.** Every `isBlank` flag across both evidence files is
`false`; every case that "failed" failed as a clean HTTP status (`500`/`307`), a bounded timeout, or
one permanently-stuck-but-structurally-intact row — not garbage on screen or garbage in the database.

That is the good news, and it is real, not assumed — it was checked explicitly for every case in
both sub-passes (see Method below). The bad news is that "doesn't corrupt or blank the screen" is a
low bar, and this phase found **21 real findings total** (16 from PT-10-001, 5 from PT-10-002) where
the app's actual failure behavior is still wrong in a way that matters: raw database error text
leaking to a client, a route redirecting instead of validating, indefinite hangs with no timeout
anywhere in the stack, and one genuinely permanent corrupt-state row that only direct DB
intervention can fix.

## Method

Two independently-run passes, each producing its own evidence file:

1. **PT-10-001 — malformed-payload fuzz.** 72 real HTTP requests across 18 distinct real mutation
   routes (drawn from PT-02's own `api-routes.json` working set, so a route can't be silently
   invented), spanning 6 malformed-input categories (missing required fields, wrong JS type,
   oversized strings, SQLi/XSS-shaped strings, invalid JSON, non-object bodies). Every case records
   the real captured request and response.
2. **PT-10-002 — dependency-outage simulation.** Three real fault scenarios, each targeting a
   different dependency: (1) Supabase down/slow, injected via a local fault-injection proxy sitting
   between an isolated `next dev` instance and the real local Supabase stack; (2) a real, standalone
   child worker process genuinely SIGKILLed after it had genuinely claimed a real `submission_queue`
   row (the same claim predicate `worker/queue-processor.ts`'s `dequeue()` uses) but before any
   terminal status write; (3) genuinely malformed/truncated payloads fed into 6 real third-party
   integration parser entry points (2 federal opportunity-search clients, 1 ProPublica 990 client, 1
   IRS-990-XML parser exercised with 4 garbage variants, 1 RSS/XML feed parser) via a monkeypatched
   `global.fetch` or, for the pure-synchronous IRS 990 parser, direct in-process calls with no I/O.

Both passes independently check for the three things this phase cares about on every single case:
did the response look like a raw crash/stack trace (`looksLikeCrash`), was the body blank/empty
(`isBlank`), and — for the one scenario that mutates durable state (scenario 2) — did a
post-failure, service-role, before/after row-level check find any duplication, partial write, or
unexpected field drift. Scenarios 1 and 3 have no durable-state mutation at stake, so their
equivalent "integrity" signal is instead a recorded, definite resolution for every case (a real
post-outage recovery probe for scenario 1; every fuzz case reaching either `threw_uncaught` or
`returned_without_throwing`, never left hanging/unresolved, for scenario 3).

## Results by sub-pass

### PT-10-001 — malformed-payload fuzz: 16 FINDING, 1 ACCEPTED_NO_VALIDATION, 55 PASS

Full detail: `test-evidence/pt-10/malformed-payloads.json` (`cases[]`, 72 total). Verified via
`node scripts/audit/verify-pt10-001.mjs` (exit 0) — the verifier independently re-derives
`verdictCounts`/`findingCount` from the raw `cases[]` array and requires every case to carry a real
captured request+response, a recognized category, and a recognized verdict; requires at least 10
distinct routes and 4 distinct malformed-input categories covered (actual: 18 routes, 6 categories);
and hard-fails if `baseUrl`/`targetSupabaseUrl` look like production.

**13 cases across 8 distinct routes produced a raw HTTP 500** instead of a clean 4xx validation
response: `POST /api/drafts/queue`, `POST /api/email/templates`, `POST /api/financials/budgets`,
`POST /api/outreach/templates`, `POST /api/autoapply/queue`, `POST /api/donor-discovery/requests`,
`POST /api/compliance`, `PATCH /api/knowledge-base`, `POST /api/reports/board`. Common root cause
across most of these: the offending field is only `typeof`/non-empty checked in the route, never
format/type-coerced before hitting a typed Postgres column (`numeric`/`date`/`uuid`), so a malformed-
but-well-typed JS value reaches the DB layer and throws an unhandled exception the route maps (or
fails to map) to a 500. **One of the 13 is worse than a generic 500**: `PATCH /api/knowledge-base`
with a non-numeric `annual_budget` string returns the **raw, uncaught PostgreSQL error text**
(`"invalid input syntax for type numeric"`) directly in the response body — leaking underlying
column-type/engine detail to the client instead of a wrapped error message. Registered: **WGR-121**
(P2).

**3 further cases, all against `POST /api/notifications`**, returned a `307` redirect to `/login`
instead of ever reaching the route's own body-validation logic — even though this specific test used
a real `CRON_SECRET` bearer token, not a bare cookie-less request. This is the same root-cause
middleware gap PT-14's `WGR-111` already registered (`src/middleware.ts` requires a valid Supabase
session cookie for any non-`PUBLIC_PATHS` route, with no carve-out for non-cookie auth mechanisms),
reproduced here for the first time against a route authenticated purely by a bearer header.
Registered: **WGR-122** (P1).

**1 case, `POST /api/intelligence/logic-model`, was graded `ACCEPTED_NO_VALIDATION`** — an oversized
value was accepted with a real `200`, matching a direct code read confirming no app-level size check
exists on that field. Not registered as its own row (below the register's threshold for a dedicated
finding — a missing length cap, not a crash or leak).

**All 13 of the 500-producing cases were behavior-only** — every one was matched against a real
service-role follow-up read where a write was plausible, and none found a partial write or silent
corruption; every failure was a clean request rejection with a 500 status, not a half-applied
mutation. Exploitability depth of the `injection_shaped` cases specifically (whether any of these are
also a real SQL/filter-injection hole, not just a robustness bug) is PT-14's job and is already
covered there (`WGR-108`..`WGR-113`) — not re-litigated here.

### PT-10-002 — dependency-outage simulation: 5 findings across 3 scenarios, plus 2 confirmed-clean results

Full detail: `test-evidence/pt-10/outage-simulation.json` (`totalFindingCount: 5`,
`overallVerdict: "FINDINGS_PRESENT"`). Verified via `node scripts/audit/verify-pt10-002.mjs`
(27/27 checks passed) — requires all three scenario keys present, every scenario 1/3 case to carry a
real recorded outcome/verdict and reach a definite resolution, scenario 2's post-failure integrity
check to be genuinely populated (`performed: true`, real row-count/field-drift/final-row-state data),
and every `FINDING`-verdict scenario to carry a non-empty `findings[]` array.

**Scenario 1 (Supabase slow/unavailable) — 2 findings, plus 1 confirmed-clean degrade.**

| Phase | Target | Result |
|---|---|---|
| `db_down` (connection reset) | public `/` | `404`, `165ms` → `122ms` — unaffected |
| `db_down` | `/dashboard` (real session) | `307` → `/login` — clean, no crash |
| `db_down` | `/api/notifications` | `307` → `/login` — clean, no crash |
| `db_slow` (+15000ms latency, 30000ms bound) | public `/` | `404`, `15169ms` — survived the full injected delay |
| `db_slow` | `/dashboard` | **timed out at ~30006ms, no response at all** |
| `db_slow` | `/api/notifications` | **timed out at ~30003ms, no response at all** |

A hard, total DB outage (`db_down`) degrades cleanly on every probed surface — `middleware.ts`'s
`getUser()` (no try/catch anywhere in the function) resolves to a null user via the Supabase client
library's own internal handling rather than throwing, so protected paths correctly `307`-redirect
instead of crashing. **Registered as a confirmed-clean result: WGR-123** (P3, `CONFIRMED-OK`), with
one latent risk flagged rather than silently passed over: this app has **zero React error
boundaries anywhere** (`no app/error.tsx`, `app/global-error.tsx`, or `(dashboard)/error.tsx` —
confirmed by a repo-wide search before this scenario ran) — the clean degrade here works because of
how `supabase-js` happens to handle this one specific failure mode, not because this app has a
designed catch-all for a Server Component render throwing for a different reason.

**Sustained latency (`db_slow` — the database is reachable, just slow) is the real, worse finding.**
The public path survives the full injected delay and still resolves. But both `/dashboard` and
`/api/notifications` never resolve at all — they hit the harness's own 30-second bound and abort.
Root cause, from a direct code read: neither `src/lib/supabase/server.ts` nor `admin.ts` configures
any fetch-level timeout on the Supabase client, and no query anywhere in `middleware.ts` or the
dashboard/notifications code paths sets a Postgres `statement_timeout` or wraps its own `await` in a
bounded race. The two failing targets each make two serial network round trips through the slow path
per request (middleware's own `getUser()` plus the page's/route's own separate query), which
compounds the injected 15s delay to roughly 30s+ — consistent with why they cross the bound while
the single-round-trip public path does not. **Net: a merely-slow database dependency produces the
same practical outcome as a full outage to a real user — an indefinite hang with no error message, no
loading/retry UI, and no bounded fast-fail anywhere in the stack — which is a worse user experience
than the clean, fast `307` a total outage produces.** Registered: **WGR-124** (P1,
`CONFIRMED-BROKEN`).

**Scenario 2 (worker killed mid-job) — 1 finding, the highest-severity real bug found this phase.**

A real, standalone child process genuinely claimed a real `submission_queue` row (`status`→
`processing`, confirmed via the child's own `CLAIM_WORKER_CLAIMED` log line) and was then genuinely
`SIGKILL`ed before it could write any terminal status. A direct service-role re-read, run only after
confirming the child had actually exited (not merely been signalled), found: exactly one row for the
test (no duplication from a botched claim/retry), zero field drift from the original insert (no
partial/corrupt write), and the row permanently stuck at `status='processing'` — `completed_at` and
`error_message` both still `null`, and **not reclaimable** via the real `dequeue()` predicate
(`status='pending'` only). Three code-read facts confirm this is a structural gap, not a one-off:
`dequeue()` has no stale-claim timeout at all; no cron/scheduled sweep anywhere in
`worker/scheduler.ts` reaps stale `submission_queue` rows; and the one existing manual admin remedy
(`POST /api/admin/system {action:'clear_stuck_jobs'}`) only clears `agent_runs` rows, never touches
`submission_queue`, so an admin clicking "Clear Stuck Jobs" on `/admin/system` cannot reach this row
even if they try. **Real impact: any worker crash, OOM, host eviction, or deploy restart that lands
mid-claim leaves a genuine, permanent corrupt half-done state requiring direct DB intervention to
recover — the funder application the row represents silently never gets submitted, retried, or
flagged as failed to anyone.** Registered: **WGR-125** (P1, `CONFIRMED-BROKEN`).

**Scenario 3 (malformed third-party responses) — 2 findings, 7 confirmed-clean results.**

| Target | Cases | Outcome |
|---|---|---|
| `grantsgov-client.searchGrantsGovOpportunities` | 1 | **threw uncaught**, no try/catch at the immediate call site |
| `samgov-client.searchSamGovOpportunities` | 1 | **threw uncaught**, zero protection at any layer |
| `propublica-990-client.fetchProPublicaFinancials` | 2 | returned cleanly (own internal try/catch) |
| `irs990.ts` `IRS990Source.parseXml` | 4 (empty string, truncated mid-tag, binary garbage, non-XML HTML error page) | returned cleanly on all 4 (pure sync, no I/O) |
| `ca-grants-portal-client.fetchCaGrantsPortalFeed` | 1 | returned cleanly (protected one hop up, at the CLI entry point only) |

Both throwing cases share the identical structural bug: an unexported `mapHit()`-style helper does
`hit.id`/`hit.oppTitle`-shaped field access on every array element in a parsed API response with no
null guard on the element itself, outside the function's own `fetch()`/`response.json()` try/catch.
**`grantsgov-client`'s exposure is contained one layer up**: `src/app/api/cron/grantsgov/route.ts`
wraps each org's sync call in its own try/catch, so a malformed response fails only that one org's
sync for that run (silently losing every keyword after the failure point) without crashing the cron
job or any other org. Registered: **WGR-126** (P2). **`samgov-client`'s exposure has zero protection
anywhere** — this route is hit directly by an external cron trigger with no per-org looping wrapper
the way Grants.gov's route has, so an uncaught exception here propagates out of the route handler
entirely, giving the real caller (Vercel Cron) Next.js's own generic framework error response instead
of this route's own clean `jsonError()` JSON shape every other failure path in the file uses.
Registered: **WGR-127** (P2). The 7 clean cases are registered together as a confirmed-clean result,
**WGR-128** (P3, `CONFIRMED-OK`), per the register's established convention of logging a
clean/mitigated result set as its own row rather than leaving it undocumented — with the caveat that
`ca-grants-portal-client`'s own real immediate caller still has no try/catch of its own; protection
there exists only at a CLI script's `main()`, not for any other/future caller of the library
function.

## An observed baseline anomaly, deliberately not registered as a new finding

Scenario 1's `baseline_normal` phase (no fault injected — this is the control condition, run before
any outage was simulated) recorded `looksLikeCrash: true` for `GET /api/notifications`: a real `500
{"error":"Could not load notifications.","code":"db_error"}`, even with no fault active. Investigated
before writing this summary rather than left unexplained: `automation_notifications`
(`src/app/api/notifications/route.ts`'s query target) **does not exist at all** on this session's
local Supabase stack — confirmed directly (`SELECT to_regclass('public.automation_notifications')`
against the local stack's own `DB_URL` returns null). This matches PT-09's own already-documented,
established characteristic of this exact local stack (`WGR-024`: "the audit's intentionally minimal
local schema, e.g. missing tables") — it is a fixture-provisioning gap in the disposable local test
stack, not a new production bug, and it says nothing about this app's fault-injection behavior (the
condition under test in this phase is DB *outage*, not DB *schema completeness*). Not given its own
WGR row for that reason; flagged here so it isn't silently invisible either.

## Register coverage

**8 new rows this phase: `WGR-121` through `WGR-128`** (`test-evidence/_register/WIRING_GAP_REGISTER.md`),
continuing numbering from PT-14's last row (`WGR-120`). `WGR-121`/`122` (PT-10-001's malformed-payload
findings) were registered by the prior session; `WGR-123` through `WGR-128` (PT-10-002's
outage-simulation findings) were registered by this consolidation pass. `WGR-121`/`122`/`124`/`125`/
`126`/`127` are `CONFIRMED-BROKEN`; `WGR-123`/`128` are `CONFIRMED-OK` (clean/mitigated results,
recorded per the register's own established convention — see `WGR-071`/`073`/`076`/`114`/`120` —
rather than leaving a passing result undocumented).

## Verifier status

```
node scripts/audit/verify-pt10-001.mjs
  -> PASS: malformed-payloads.json records 72 case(s) across 18 distinct route(s) (all present in
     PT-02's api-routes.json), spanning 6 case categories. Verdict counts:
     {"PASS":55,"FINDING":16,"ACCEPTED_NO_VALIDATION":1}. 16 FINDING(S) PRESENT.

node scripts/audit/verify-pt10-002.mjs
  -> verify-pt10-002: 27 check(s) passed, 0 check(s) failed.
     All required PT-10-002 evidence checks passed.
```

The PT-10-001 verifier requires: >=20 cases, >=10 distinct routes, >=4 distinct categories; every
case has a captured request+response and a recognized verdict; every `baseUrl`/`targetSupabaseUrl`
is non-production; `verdictCounts`/`findingCount` are independently re-derived from `cases[]` and
match the document's own summary fields exactly. The PT-10-002 verifier requires: all three scenario
keys present; scenario 1 covers both a fault-injected phase and the normal baseline, and records a
real post-outage recovery check; scenario 2's claim was genuinely confirmed before the kill, and its
`postFailureIntegrityCheck` records a real row-count comparison, field-drift check, and final-row
terminal state; scenario 3 covers >=3 distinct real parser/integration targets and every case reaches
a definite resolution (never left hanging/unresolved).

## Cleanup verification

PT-10-001's fuzz used a real throwaway org provisioned for the run (same `testOrgId` pattern
established elsewhere in this audit program) against the local stack only — no production data was
ever touched. PT-10-002's scenario 1 used one real throwaway user/org and a real session cookie
against the isolated local `next dev` instance and local Supabase stack; scenario 2's test row lived
under its own throwaway `organization_id`; scenario 3 made zero real network calls (monkeypatched
`fetch`, or no I/O at all for the IRS 990 parser). Both isolated `next dev` instances (ports used by
`pt10-001-malformed-payloads.mjs` and `pt10-002-outage-simulation.mjs`) were started and stopped by
their own scripts. No real customer data, `benavora.com`, or the production Supabase project
(`vbjplpquqxxfbpazyalt`) was read, written, or touched at any point in either sub-pass — both
evidence files' own `baseUrl`/`targetSupabaseUrl`/`localSupabaseStackUrl` fields were checked and
confirmed local (`http://localhost:*`/`http://127.0.0.1:*`) before this summary was written.
