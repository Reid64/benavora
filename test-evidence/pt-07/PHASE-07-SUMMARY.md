# PT-07 — Phase 07 Summary (Third-Party Integrations)

Consolidated numbers for the PT-07 phase, across four evidence artifacts (Supabase real-state
probe, Railway worker real-job round-trip, external data-source API probes, comms/billing
integration probes). Every number below cites the evidence artifact it came from — re-run the cited
verifier or read the cited file directly to reproduce it; nothing here is asserted from memory.

## The question this phase answers

Every prior phase checked whether *this codebase's own* logic, routing, and data are correct.
PT-07 checks the boundary the codebase doesn't control: **for every real third-party system this
app talks to over the network — Supabase itself, the Railway worker, six external government/
nonprofit data APIs, and three comms/billing providers — does a real, live round-trip actually
succeed today, with the exact request shape the app's own code sends, against the exact response
shape the app's own code expects to receive?** A dependency being reachable is not the same
question as a dependency working; this phase tested the second one, live, wherever a credential
existed to do so, and recorded an explicit, evidenced `PENDING-SCOPE` wherever one didn't.

## Headline result: the platform's own infrastructure is solid; the majority of its external grant-discovery data sources are silently broken

**Read this first.** Supabase itself (DB, Auth, Storage) and the Railway worker's real job
round-trip all passed cleanly — this platform's own core infrastructure is genuinely live and
correct. But **of the six external data sources checked, two of the platform's primary funding
sources — Grants.gov and SAM.gov — are confirmed broken on every real call today**, and neither
failure is visible anywhere: both integrations degrade to a silent empty result (or, for two SAM.gov
sub-adapters, a caught error with no downstream signal), so the daily/scheduled jobs that depend on
them have been running "successfully" while finding nothing. Realtime's live-push layer was also
found generating zero events for any of the 7 tables the app subscribes to — a previously-documented
(2026-08-07), never-fixed gap, now formally registered for the first time. Comms/billing (Resend,
Stripe, Google Calendar) are all confirmed **unconfigured in every environment**, not broken — a
real, explicit, evidenced `PENDING-SCOPE`, not an untested assumption.

## Method

Four evidence artifacts, each with its own gate script:

1. **Supabase real-state probe** (`test-evidence/pt-07/supabase-state.json`) — four live checks
   against production: DB connectivity forced into a real read-only session (a real rejected
   `CREATE TABLE` proves the read-only property is enforced by Postgres, not just requested); Auth
   (a real magic-link session issued for the real Faith Foundation org owner, then independently
   verified via `auth.getUser()` on a fresh client); Storage (`storage.listBuckets()` cross-checked
   against every bucket name the app's own source code references, static and per-org dynamic);
   Realtime (a real query of `pg_publication_tables`, cross-checked against every table the app's
   own source subscribes to via `postgres_changes`). Verified: `node scripts/audit/verify-pt07-001.mjs`
   (exit 0).
2. **Railway worker real-job round-trip** (`test-evidence/pt-07/worker-roundtrip.json`) — a real
   `agent_queue` row (agent `deadline_prediction`, a DB-only agent with zero Claude cost, chosen so
   the round-trip proves worker pickup/execution without depending on an external LLM credential)
   enqueued against a disposable org, polled every 1.5s against the live, deployed `railway-worker-1`
   process until it transitioned `queued → completed` with real captured before/after row states and
   a full transition/poll log, plus two independent `worker_status` heartbeat freshness checks
   bracketing the run. All disposable rows deleted and cleanup independently re-verified afterward.
   Verified: `node scripts/audit/verify-pt07-002.mjs` (exit 0).
3. **External data-source API probes** (`test-evidence/pt-07/data-sources.json`) — for each of 6
   real external data sources, the app's own client file was read first to construct the *exact*
   request the app's own code actually sends (URL, method, body/query params), that exact request
   was fired for real against the live third-party API, the real response was captured verbatim, and
   the response's actual field shape was diffed against the specific fields the app's own parser
   reads. Verified: `node scripts/audit/verify-pt07-003.mjs` (exit 0).
4. **Comms/billing integration probes** (`test-evidence/pt-07/comms-billing.json`) — for Resend,
   Stripe, and Google Calendar: a live `vercel env ls` query confirming key/secret presence across
   every Vercel environment plus local `.env.local`; for each, either a real dry-run of the app's own
   unmodified send/connect function with the credential deliberately absent (matching the real
   production state), or — for Stripe specifically, since its webhook code path doesn't require a
   live secret to exercise — a real, offline functional test of the actual `stripe` SDK's
   `constructEvent()` against a valid signature, a tampered payload, and a wrong secret. Verified:
   `node scripts/audit/verify-pt07-004.mjs` (exit 0).

## Results by artifact

### Supabase real-state probe — 3 of 4 clean, 1 real finding (WGR-148)

Full detail: `test-evidence/pt-07/supabase-state.json`.

| Check | Method | Result |
|---|---|---|
| DB | Real `SELECT` + a real rejected `CREATE TABLE` (`SQLSTATE 25006`) proving read-only enforcement | **PASS** |
| Auth | Real magic-link issue + independent `auth.getUser()` verification, real org owner | **PASS** |
| Storage | `storage.listBuckets()` vs. every bucket name referenced in source — 0 missing, 0 unexpected | **PASS** |
| Realtime | `pg_publication_tables` vs. every `postgres_changes` subscription in source — 7 of 7 missing | **FINDING (WGR-148, P1)** |

The `supabase_realtime` publication exists but has **zero member tables** — Realtime never fires a
change event for `submission_queue`, `autoapply_submissions`, `autoapply_review_queue`,
`worker_status`, `agent_runs`, `agent_decisions`, or `applications`, silently, with no error anywhere.
This is not a new discovery — `STATE_OF_THE_BUILD.md`'s 2026-08-07 "Command Center Realtime" entry
already found and documented the identical root cause for a 3-table subset, with a one-line
`ALTER PUBLICATION` fix proposed and never applied. That entry was never promoted into
`WIRING_GAP_REGISTER.md`; this session's independent, fresh live query (2026-08-20) confirms the
same gap still holds ~2 weeks later, now against the full, current 7-table set. Registered this
session as **WGR-148**.

### Railway worker real-job round-trip — PASS, 0 findings

Full detail: `test-evidence/pt-07/worker-roundtrip.json`.

A real `deadline_prediction` job enqueued at `2026-08-20T16:33:39.972Z` (`agent_queue` row
`d08f2cfe-...`, disposable org `4fe78a4e-...`) was picked up and completed by the real, live
`railway-worker-1` process in **25,565 ms**, confirmed via 16 real polls at 1.5s intervals (not a
single before/after snapshot — the full state-transition timeline was captured) and a real,
non-empty `output_payload` (`"deadline_prediction completed (tokens=0)"`). `worker_status`
heartbeats bracketing the run: 1.8s stale before, -1.3s (i.e. updated mid-poll) after — both well
inside the 120s freshness threshold, confirming the worker is genuinely alive and processing right
now, not a stale/frozen `status:"idle"` row. The one other registered worker (`benavora-worker-1`)
is confirmed genuinely offline (last heartbeat 2026-07-20, ~30 days stale) — correctly excluded from
the liveness verdict rather than averaged in. All disposable rows (org, queue row) deleted and
independently re-verified gone afterward.

### External data-source API probes — 2 of 6 sources fully OK, 2 broken outright, 1 degraded, 1 unconfigured — 8 new findings (WGR-138 through WGR-145)

Full detail: `test-evidence/pt-07/data-sources.json`.

| Source | App's coded request | Real live response | Verdict | Registered |
|---|---|---|---|---|
| Grants.gov | `POST .../grantsws/rest/opportunities/search/v2` | **HTTP 403** "Missing Authentication Token" (dead route) | **BROKEN** | WGR-138 (P0) |
| SAM.gov opportunities search | `GET .../opportunities/v2/search` with no date range | **HTTP 400** "PostedFrom and PostedTo are mandatory" | **BROKEN** | WGR-139 (P0) |
| SAM.gov opportunities search (once date range added) | — | `description` is always a fetch-URL, never text; `awardAmount` never present | **degraded data quality** | WGR-140 (P1), WGR-141 (P2) |
| SAM.gov Entity Management v3 adapter | `GET .../entity-information/v3/entities?...&activeDate=...` | **HTTP 400** "activeDate does not exist" | **BROKEN** | WGR-142 (P0) |
| SAM.gov Award Notices adapter | reads `hit.awardee`, real shape is `hit.award.awardee` | 0 of 5 real hits carry the field the app reads | **BROKEN** | WGR-143 (P0) |
| USASpending.gov | `POST .../search/spending_by_award/` | **HTTP 200**, all 6 app-read fields present on the real result | **OK** | — |
| ProPublica Nonprofit Explorer | `GET .../organizations/{ein}.json` | **HTTP 200**, all app-read `organization`/`filing` fields present | **OK** | — |
| IRS BMF CSV / 990 index CSV / 990 batch ZIP | 3 direct `GET`/`HEAD` calls | all reachable; BMF file now has a header row the importer's own code/comment assumes doesn't exist (currently harmless by coincidence) | **DEGRADED** | WGR-144 (P3) |
| ScraperAPI proxy rotation | `resolveProxy()` / gateway CONNECT tunnel | gateway is real and live (401 on an invalid key); no key configured anywhere in this environment, so every scrape currently runs with zero proxy | **NOT_CONFIGURED** | WGR-145 (P1) |

**Every one of these findings shares the same shape**: none of them crash. `searchGrantsGovOpportunities()`
and `searchSamGovOpportunities()` both treat any `!response.ok` as a silent empty array;
`searchEntitiesByNaics()` and `normalizeAwardee()` fail differently (one throws, one silently
skips every hit) but land at the same net effect — zero real results, zero surfaced error, on every
real invocation, for the daily Grants.gov cron and every SAM.gov-backed research/donor-discovery
path.

### Comms/billing integration probes — 3 of 3 explicit, evidenced PENDING-SCOPE — 2 new findings (WGR-146, WGR-147)

Full detail: `test-evidence/pt-07/comms-billing.json`.

| Integration | Configured anywhere? | Real dry-run / functional test | Verdict | Registered |
|---|---|---|---|---|
| Resend (transactional email) | No — absent from `.env.local` and every Vercel environment | Real `sendEmail()` call returned `{success:false, error:'RESEND_API_KEY not configured'}` (documented no-key branch, no crash) | **PENDING-SCOPE** | WGR-146 (P2) |
| Stripe (billing) | No — absent from `.env.local` and every Vercel environment | Webhook signature verification functionally tested offline against the real `stripe` SDK: valid signature accepted, tampered payload rejected, wrong secret rejected — all 3/3 pass; webhook route code read confirms fail-closed on missing secret/signature and idempotent-per-event-id handling | **PENDING-SCOPE** (billing itself unconfigured; webhook code is genuinely correct) | not registered as a defect — code confirmed correct |
| Google Calendar (OAuth sync) | No — `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` absent everywhere | Real `getOAuthClient()` call threw `'Missing GOOGLE_CLIENT_ID'` immediately, reproducing the exact failure any real connect attempt hits today; 0 orgs have ever connected (live `integrations` table query) | **PENDING-SCOPE** | WGR-147 (P3) |

None of the three is a code defect — every dry-run degraded gracefully, and the one piece of
webhook code that *could* be exercised without a live secret (Stripe's signature verification) was
found genuinely correct. The finding, in all three cases, is the absence of the credential itself,
which is a real production capability gap (zero platform-originated emails can be sent today; no
billing checkout can run; no org can authorize Google Calendar sync), not a bug in the code that
would run if the credential existed.

## Register additions this phase

| ID | Severity | Scope Tag | One-line |
|---|---|---|---|
| WGR-138 | P0 | CONFIRMED-BROKEN | Grants.gov: app's coded URL is a dead route (403); even the real current endpoint returns a different response shape than the app's parser expects. |
| WGR-139 | P0 | CONFIRMED-BROKEN | SAM.gov opportunities search: app omits mandatory `postedFrom`/`postedTo` — every real call 400s, silently swallowed to empty. |
| WGR-140 | P1 | CONFIRMED-BROKEN | SAM.gov opportunities search: `description` field is always a fetch-URL, never literal text, on every real hit. |
| WGR-141 | P2 | CONFIRMED-BROKEN | SAM.gov opportunities search: `awardAmount` is never present on any real hit — `amount_max` is permanently null via this source. |
| WGR-142 | P0 | CONFIRMED-BROKEN | SAM.gov Entity Management v3 adapter: sends a rejected `activeDate` param — every real call 400s. |
| WGR-143 | P0 | CONFIRMED-BROKEN | SAM.gov Award Notices adapter: reads `hit.awardee`, real API nests it at `hit.award.awardee` — every real call returns zero prospects. |
| WGR-144 | P3 | CONFIRMED-BROKEN | IRS BMF CSV now has a header row the importer's code/comments assume doesn't exist; currently harmless by coincidence, not by design. |
| WGR-145 | P1 | CONFIRMED-BROKEN | ScraperAPI: gateway is real and live, but no key is configured anywhere — every scrape currently runs with zero proxy/rotation. |
| WGR-146 | P2 | PENDING-SCOPE | Resend: `RESEND_API_KEY` absent from every environment — zero platform-originated email can be sent today; degrades gracefully. |
| WGR-147 | P3 | PENDING-SCOPE | Google Calendar: OAuth app credentials absent from every environment — sync cannot be authorized; 0 orgs currently affected. |
| WGR-148 | P1 | CONFIRMED-BROKEN | Realtime: `supabase_realtime` publication has 0 member tables — 7 of 7 subscribed tables never push live updates (60s-poll fallback covers at least the confirmed consumer). |

Register verified to contain PT-04's own last row (`WGR-137`) plus all 11 of this phase's rows —
see `node scripts/audit/verify-pt07-005.mjs`. The register now runs `WGR-001` through `WGR-148`,
unbroken, closing out the full PT-00 through PT-14 audit program (PT-12 was never assigned in this
numbering scheme).
