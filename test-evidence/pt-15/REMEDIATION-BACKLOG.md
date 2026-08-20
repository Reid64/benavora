# REMEDIATION BACKLOG

Ranked, actionable fix list derived from `test-evidence/_register/WIRING_GAP_REGISTER.md`
(consolidated as of commit `5c747ee174c0abd83bff2cd266d825c511ebba5f`). This is the hand-off into the
remediation build phase — every item below names the recommended fix and points back at the
register row (`WGR-XXX`) for the full finding text, real evidence path, and exact reproduction
command. Do not re-derive the finding from scratch; the register already has it.

Ordering: **Wave 0 (P0, fix immediately, no exceptions) → Wave 1 (P1, this cycle) → Wave 2 (P2,
opportunistic) → Wave 3 (P3, track/decide, don't fix blind).** Within a wave, items are grouped into
batches where multiple WGR rows share one root cause — fixing the batch's root cause closes every
row in it, which is both more efficient and less error-prone than 66 independent one-off patches.

Companion doc: `GO-NO-GO.md` (the go/no-go verdict this backlog exists to close out).

---

## Wave 0 — P0 (16 open, fix immediately)

Each row: recommended fix, then `→ WGR-XXX`.

1. **Add server-side URL validation (host allowlist / private-IP-and-metadata-endpoint block,
   scheme restricted to `http(s)`) before every outbound `fetch()` on a user- or org-controlled URL.**
   Three independent call sites need the same guard: `POST /api/intelligence/ingest`'s `url` field
   (`src/app/api/intelligence/ingest/route.ts:61-77`), `WebhookNotifier.notify()`'s
   `webhook_configs.webhook_url` (`src/lib/autoapply/webhook-notifier.ts:123`), and AutoApply's
   `funders.giving_portal_url` navigation in the real submission pipeline
   (`worker/queue-processor.ts:566`). Build one shared `safeFetch()`/URL-validator utility and apply
   it to all three rather than three separate patches — this is a real, live SSRF surface reachable
   by an authenticated non-admin role today. → **WGR-108, WGR-109, WGR-110**
2. **Widen `src/middleware.ts`'s `PUBLIC_PATHS`/`isPublicPath()` to recognize a valid
   `CRON_SECRET`/webhook-signature bearer credential as an alternative to a Supabase session cookie**,
   not just an unauthenticated-request carve-out. Currently any legitimate non-browser caller (cron,
   webhook) gets redirected to `/login` before its own route-level auth check ever runs, for every
   path not explicitly listed. → **WGR-111** (also closes the same root cause reproduced at
   `POST /api/notifications` under WGR-122, P1, and the fault-injection case under WGR-124, P1 — see
   Wave 1 batch 4)
3. **Investigate and fix the `/documents` page hang directly** — a real 30000ms Playwright navigation
   timeout, reproduced during the smoke sweep. Start by checking for an unresolved/never-`await`ed
   promise or an unbounded query in this page's data-loading path (the same class of bug several
   schema-drift P1 rows below turned out to be). Cross-reference WGR-014 (P3, UNVERIFIED) which did
   **not** reproduce the same hang on a later attempt — reconcile before closing either row; this may
   be intermittent/load-dependent rather than deterministic. → **WGR-004** (see also WGR-014)
4. **Wire (or explicitly remove) the `impersonation_org_id` cookie's consumer.** Admin impersonation
   currently sets a cookie that zero other code reads — meaning either impersonation silently does
   nothing after the initial redirect (a functional bug) or there's a missing authorization check
   that should be scoping subsequent requests to the impersonated org and isn't (a security gap).
   Determine which via a live click-through, then fix the actual gap; do not just delete the cookie
   without confirming impersonation isn't relied upon elsewhere. Fix the audit-log write path in the
   same pass — `impersonation_log.admin_id`'s FK target is broken for every real caller today
   (P1, WGR-075), so impersonation currently has no working audit trail either. → **WGR-074**
   (+ **WGR-075**)
5. **Get the real E2E suite passing on WebKit** — currently 0% pass rate, a total, not partial,
   failure on one of three baseline engines. Start by running the suite headed/locally against
   WebKit specifically to see the actual failure mode (likely a Playwright/WebKit-specific selector,
   timing, or polyfill gap) rather than assuming a app-code defect first. → **WGR-099** (the sibling
   application-creation-flow failure, WGR-100, P1, is very likely the same root cause reproduced a
   second way — fix together)
6. **Root-cause `POST /api/ai/draft`'s silent write failure to `draft_versions`.** The route returns
   a real generated draft (HTTP 200, full content) while the insert never lands. Check for a
   swallowed insert error (the same "caught but not surfaced" pattern the silent-catch census found
   repeatedly elsewhere in this codebase, e.g. WGR-101/102/103/107) before assuming a schema-drift
   cause. This is the platform's single core value-delivery action failing silently — highest
   real-world-impact item in this list after the SSRF cluster. → **WGR-129**
7. **Add server-side enforcement of the stage-transition rules directly on the `applications` table**
   (a Postgres trigger or a check the write path cannot bypass), not just in `executeTransition()`'s
   application-layer logic. A raw `supabase.from('applications').update({stage:'awarded'})` call
   currently succeeds with zero validation, confirmed live. Fix this and WGR-130
   (`getTransitionRule` correctly flags the skip as illegal, but nothing enforces that verdict) and
   WGR-132 (P1: `canMoveToStage()`'s owner/admin-only claim isn't actually enforced either) together
   — all three are the same enforcement gap observed three different ways. → **WGR-130, WGR-131**
   (+ **WGR-132**, P1)
8. **Fix the PKCE password-recovery flow** — a real, fresh, unexpired, unreused Mailpit-delivered
   recovery link is being rejected. Compare the app's PKCE code-exchange implementation against
   Supabase's current expected flow (this class of bug is usually a code-verifier storage/cookie
   mismatch between the link-issuing request and the exchange request). → **WGR-133**
9. **Fix Grants.gov's URL** — the app-coded URL doesn't match the real, current API endpoint.
   Confirm the correct URL directly against Grants.gov's current API docs, not from memory. This is
   the live path behind the daily `/api/cron/grantsgov` sync. → **WGR-138**
10. **Fix SAM.gov `opportunities/v2/search`'s missing `postedFrom`/`postedTo` params** — the real,
    current API now requires a date range and rejects requests without one.
    `src/lib/sources/samgov-client.ts`'s `searchSamGovOpportunities()`. → **WGR-139**
11. **Fix the SAM.gov Entity Management API v3 caller's malformed request** — a separate
    implementation (`src/lib/donor-discovery/adapters/samgov-adapter.ts`'s `searchEntitiesByNaics()`)
    from item 10 above, same host, unconditionally sets a parameter the real API rejects. Given this
    is the *second* separately-broken SAM.gov client in this codebase, consider consolidating both
    into one maintained client rather than fixing each independently — see Wave 1 batch 5.
    → **WGR-142**
12. **Fix SAM.gov Award Notices' `normalizeAwardee()`** — a third, separate consumer of the same
    `opportunities/v2/search` endpoint (`ptype=a`), same file as item 11. → **WGR-143**

**Batching note for items 9–12:** four of the sixteen P0s are third-party API integration breakage
against Grants.gov/SAM.gov, and three of those four are three *separately-maintained* SAM.gov
clients in this codebase hitting the same real host differently. Fixing each in isolation risks the
same drift recurring the next time SAM.gov changes its API shape. Recommend consolidating to one
SAM.gov client used by all three call sites as part of this fix, not just patching each
independently — see Wave 1 batch 5 for the related P1/P2 SAM.gov field-shape gaps (WGR-140, WGR-141)
that should be folded into the same consolidation.

---

## Wave 1 — P1 (66 open, this cycle)

### Batch 1 — Migration/schema drift (fixes ≈21 rows with one root cause)

**Root cause:** this project has no Supabase-CLI migration-tracking table
(`supabase_migrations.schema_migrations` does not exist — WGR-041) and two parallel, independently-
numbered migration directories exist (`supabase/migrations/` and `src/supabase/migrations/`). Real
application code across the platform was written against migration files that were either never
applied to the live database, or were superseded by a conflicting sibling migration defining the
same table with different columns.

**Recommended fix, in order:**
1. Stand up real migration tracking (`supabase migration repair`/adopt the CLI's own tracking table,
   or a hand-rolled `applied_migrations` ledger if the CLI path is impractical) so "is this migration
   live" stops being a per-incident forensic question — this closes WGR-041 and prevents every
   future recurrence of this entire batch's failure mode.
2. Reconcile the two migration directories into one canonical tree (or explicitly document which one
   is authoritative going forward and retire the other) before applying anything further.
3. Apply the specific missing tables/columns, one migration at a time, verifying against the live
   schema after each: WGR-042 (`funder_giving_history.grant_purpose`/`.source`), WGR-043
   (`success_probability_scores.data_quality`/`.created_at`/`.updated_at`), WGR-044
   (`webhook_configs.type`/`.is_active`/`.updated_at`), WGR-045 (`funder_relationships`,
   `queue_controls`, `submission_usage`, `tier_limits` — entire tables absent), WGR-046
   (`intelligence_grantmaker_profiles`, 9 missing columns), WGR-047 (`board_members`' real column set
   vs. the code's assumed set), WGR-048 (`twin_auto_populate_log`, duplicate-tree conflict), WGR-049
   (`applications.metadata`), WGR-050 (`intelligence_funded_proposals`, 20 missing columns), WGR-051
   (`prospects.contact_name`/`.contact_title`), WGR-052 (`email_threads`/`email_messages` tables
   absent), WGR-053 (`deadline_predictions` table, `funders.next_predicted_open_date`), WGR-054
   (`applications.funder_id` doesn't exist — code must use `opportunity_id`), WGR-055
   (`rubric-extractor.ts`'s column list), WGR-056 (`funders.city`/`.state`), WGR-057
   (`funders.portal_type`), WGR-058 (`alerts.title`/`.alert_type`), WGR-059
   (`organizations.service_areas` plural — use singular `service_area`), WGR-060
   (`intelligence_grantmaker_profiles` drifted column names across 5 call sites).
4. Close the remaining Data/Infra integrity gaps surfaced by the same audit pass: WGR-064 (13 tables
   with an org-scoping column but no FK to `organizations`), WGR-065 (6 identifier-shaped columns
   with no unique index), WGR-067 (`foundation_directory.email` NULL on 100% of 133,812 rows —
   verify whether this is an enrichment-pipeline gap or a genuinely-absent data source before
   treating as a bug), WGR-068 (migration idempotency — 1st-apply-pass results, verify 2nd-apply-pass
   is clean too).

→ **WGR-041, WGR-042, WGR-043, WGR-044, WGR-045, WGR-046, WGR-047, WGR-048, WGR-049, WGR-050,
WGR-051, WGR-052, WGR-053, WGR-054, WGR-055, WGR-056, WGR-057, WGR-058, WGR-059, WGR-060, WGR-064,
WGR-065, WGR-067, WGR-068**

### Batch 2 — Autonomous-agent execution proof (≈15 rows)

**Root cause:** the agent registry/UI claims several agent classes run nightly and produce output;
directly running each one this audit found `agent_runs.errors = []` (clean completion) but zero rows
written to the real target table. Two distinct sub-causes, need to be split apart per agent before
fixing — do not assume all 15 share one fix:

- **Seed-data artifact (likely NOT a real production bug — UNVERIFIED tier in the register):**
  WGR-083 (AG-25 Deadline Prediction — seeded opportunities already had deadlines set, so the
  "predict only when missing" gate correctly found nothing), WGR-085 (AG-30 Donor Intent — synthetic
  company names have no real web footprint to find), WGR-088 (AG-42 Change Monitor — seeded
  `.example` placeholder domains fail DNS resolution before any real check runs), WGR-089 (AG-43
  Funder Signals — likely the same class as WGR-085, not independently isolated). **Recommended
  action: re-run each against real (not synthetic) seed data or real production org data before
  concluding these are broken** — the current UNVERIFIED tag reflects exactly this open question.
- **Genuine wiring/table-name gap (CONFIRMED-BROKEN):** WGR-077 (AG-05 research family), WGR-078
  (AG-13 foundation enrichment), WGR-079 (AG-14 donor discovery — two distinct findings), WGR-080
  (AG-18 reputation), WGR-081 (AG-23/AG-32 canonical-number collision — a real naming/registry
  conflict, not just a null-result), WGR-082 (AG-24 — not agent-framework code at all, a
  registry-classification error, not a runtime bug), WGR-084 (AG-26 forecast), WGR-086 (AG-36
  learning aggregator — flagged priority since it corrects a stale "not wired" assumption elsewhere
  in governance docs), WGR-087 (AG-40 strategic advisor — independently reproduces WGR-059's
  `service_areas` bug, fix once via Batch 1 item 3), WGR-090 (AG-20 EA-01 giving detector). **These
  need per-agent root-cause fixes** (mostly likely folding into Batch 1's schema-drift fix once each
  is individually traced, per WGR-087's own cross-reference).
- **WGR-093** (data-integrity): agent-number collisions beyond the 3 the registry's own seed script
  already documents as deliberate — resolve by either registering the undocumented collisions
  explicitly or renumbering.
- **WGR-095**: incidental soak-test finding from a real Railway log pull — see the row's own evidence
  for the specific symptom before batching further.

**Recommended fix approach:** for every "clean completion, zero output rows" agent, add real
assertion-level monitoring (row-count-written, not just error-count) to the nightly job's own
completion record, so this class of false-pass can't recur silently — this is the same fix the P2
row WGR-107 (`completeRun()`/`failRun()` discard the real error object) already names for the
underlying observability gap.

→ **WGR-077, WGR-078, WGR-079, WGR-080, WGR-081, WGR-082, WGR-083, WGR-084, WGR-085, WGR-086,
WGR-087, WGR-088, WGR-089, WGR-090, WGR-093, WGR-095**

### Batch 3 — Missed/misrouted scheduled jobs (4 rows)

- WGR-035: `/api/cron/draft-automation` — confirm this cron is actually registered in `vercel.json`
  and that it calls the real `DraftQueueEngine.processDeadlineApproaching()`/
  `DraftAutoGenerator.processQueue()` functions, not a stale/renamed reference.
- WGR-036: `SalesCampaignEngine.processQueuedSends()` — confirm it has *any* scheduled trigger at
  all; the register's own finding implies this may be entirely unwired.
- WGR-037: the AutoApply 14/30/60-day donation follow-up email system — a two-layer gap (both the
  scheduling AND the underlying `autoapply_follow_ups` consumer need checking per the finding).
- WGR-038: `sequenceEngine.processScheduledSends()` — the sole consumer of `email_sequence_
  enrollments`, confirm its trigger is real and firing.

**Recommended fix:** audit `vercel.json`'s full cron list against every function in the codebase that
assumes it runs on a schedule (a superset of just these 4), fix the mismatches found, and add the
missing cron/queue-processor entries.

→ **WGR-035, WGR-036, WGR-037, WGR-038**

### Batch 4 — Middleware/availability gap, reproduced 3 ways (2 remaining rows after Wave 0 item 2)

WGR-122 (real bearer-token-authenticated `POST /api/notifications` call redirected to `/login` before
reaching route logic) and WGR-124 (fault-injection: +15000ms DB latency causes the public route to
fail past the harness's own 30000ms bound) are both closed by the same middleware fix as Wave 0 item
2 (WGR-111) plus, for WGR-124 specifically, a review of whether 30s is a reasonable client-side
timeout budget for a slow-DB scenario or whether the route itself needs a faster-failing internal
timeout.

→ **WGR-122, WGR-124**

### Batch 5 — SAM.gov client consolidation (2 rows, folds into Wave 0 items 9–12)

WGR-140 (`description` field is always a URL requiring a second GET, not inlined text — the app
likely expects inline text) and WGR-141 (`awardAmount` field never present in real hits — the app may
be reading a field name that doesn't exist in the current API response shape) should be fixed as part
of the same SAM.gov client consolidation recommended in Wave 0.

→ **WGR-140, WGR-141**

### Batch 6 — Remaining individual P1 items (no shared root cause with the above)

| ID | Recommended fix |
|---|---|
| WGR-002 | Supply `VERCEL_TOKEN`/`VERCEL_PROJECT_ID` in the environment where the deploy-verifier gate runs (DIRECTIVE-019); until then the gate can only report PENDING/INDETERMINATE. |
| WGR-005 | `GET /api/agents/discovery` 500s on a bare authenticated request — trace the real thrown error (likely another schema-drift instance; check against Batch 1 first). |
| WGR-006 | `GET /api/consultant/clients` 500s — same approach as WGR-005. |
| WGR-007 | `GET /api/outreach/sequences` 500s — same approach. |
| WGR-008 | `GET /api/schoolfunder` 500s — same approach. |
| WGR-009 | `GET /api/settings/notifications` 500s — same approach. |
| WGR-027 | `POST /api/email/templates` 500s unconditionally for every request/org/role — high-confidence schema-drift instance, check first against Batch 1's methodology. |
| WGR-033 | `worker/enrichment-processor.ts` (EA-01..EA-10 corporate-enrichment pipeline) is a complete, real processor never wired into the worker's boot sequence — add its `start()` call to `worker/index.ts`. |
| WGR-040 | Add a per-item timeout wrapper around `processAgentQueue()`/`runQueueItem()`'s claimed-job execution so one hung agent can't block the whole queue indefinitely. |
| WGR-075 | Fix `impersonation_log.admin_id`'s broken foreign key — currently unwritable for every real production caller, meaning impersonation has no audit trail today. Fold into Wave 0 item 4. |
| WGR-100 | Same WebKit/cross-browser root cause as Wave 0 item 5 — fix together. |
| WGR-101 | Silent catch in `src/lib/agents/form-filler.ts:253` inside the AutoApply form-filler's real submission path — surface the swallowed error (log + increment a real failure metric) instead of a bare catch. |
| WGR-104 | `worker/index.ts:144` — the one background sub-process wired so an unhandled failure does NOT crash the worker; confirm this is intentional graceful-degradation and, if so, add real alerting on that failure path since it's currently silent by design. |
| WGR-105 | `src/app/api/admin/system/route.ts:71-73`'s `donor_discovery_requests` depth query filters `.eq("status","pending")` but (per the finding) the real status taxonomy doesn't match — reconcile the filter against real status values. |
| WGR-132 | Fold into Wave 0 item 7 (stage-transition enforcement). |
| WGR-135 | `computeGrantProbability()`'s persisted `opportunity_probability_scores` rows are never recomputed when input data changes — add a recompute trigger (on the relevant input-table writes, or a scheduled re-score sweep) so scores don't silently go stale. |
| WGR-148 | The `supabase_realtime` Postgres publication has zero member tables — any feature assuming live Realtime updates is currently getting none. Add the relevant tables to the publication (`ALTER PUBLICATION supabase_realtime ADD TABLE ...`) or confirm no feature actually depends on it and remove the assumption from any UI that implies live updates. |

---

## Wave 2 — P2 (28 open, opportunistic — but 2 items should be pulled forward)

**Pull forward alongside Wave 0/1 despite the P2 tier, because they compound the security picture in
`GO-NO-GO.md` §2:**
- **WGR-118**: revoke the unrevoked default `anon`/`authenticated` grants on the 107 of 184
  public-schema tables that still carry them beyond what RLS should allow.
- **WGR-119**: review the full enumerated anon-`EXECUTE`-able RPC surface (`pg_proc` +
  `has_function_privilege`) and revoke/lock down any function that shouldn't be anon-callable.
- **WGR-112**: `GET /api/email/threads?search=` interpolates the raw `search` param directly into a
  PostgREST filter — parameterize/escape it properly; SQLi-shaped, not yet confirmed exploitable but
  should not ship as-is.
- **WGR-113**: 5 transactional HTML email templates interpolate user-controlled content unescaped —
  add HTML-escaping before interpolation.

**Batch: silent-catch census (3 more rows beyond WGR-101 above)** — WGR-102 (`form-filler-agent.ts`,
distinct file from WGR-101), WGR-103 (`sequence-engine.ts:230`, per-enrollment send loop), WGR-107
(`AutonomousAgent.completeRun()`/`failRun()` discard the real error object platform-wide — fixing
this one is the highest-leverage item in this batch, since it's the shared base class every
autonomous agent uses, including all of Wave 1 Batch 2's agents). Recommended fix: surface the
discarded error (structured log at minimum, ideally a real alert) rather than a bare/near-bare catch,
starting with WGR-107 since it's the shared root.

**Batch: CRUD soft-delete visibility (2 rows)** — WGR-025 (`DELETE /api/drafts/queue/{id}`) and
WGR-026 (`DELETE /api/autoapply/profiles/{id}`) both soft-delete but a subsequent GET still returns
the "deleted" row. Fix: filter soft-deleted rows out of the corresponding GET queries.

**Batch: test-suite first-run findings (3 rows)** — WGR-096 (`unit-src` suite), WGR-097
(`smoke-playwright-public`), WGR-098 (`visual-regression`) all completed for the first documented time
in this repo during this audit; each has its own real findings — review each suite's specific failures
in the register and fix or file as its own follow-up, this batch entry is a pointer not a single fix.

**Batch: third-party fuzz-response handling (2 rows)** — WGR-126, WGR-127: `grantsgov-client`'s and
`samgov-client`'s response parsers both throw uncaught exceptions on a malformed (not just
empty/error) third-party response shape. Add defensive parsing/validation so a malformed upstream
response degrades gracefully instead of crashing the caller.

**Remaining individual P2 items** (no shared root cause; see the register for full detail):
WGR-003 (13 env vars absent locally), WGR-013 (shared dev-server hydration-bundle contamination),
WGR-061 (`knowledge_queries.organization_id` → real column `org_id`), WGR-066 (duplicate-row-rate
audit, informational), WGR-091 (AG-31/33/34 have zero implementation — scope decision: build or
formally retire), WGR-106 (`alerting.ts`'s `checkAlerts()` is fully built but unwired — connect it),
WGR-121 (13 malformed-payload cases produce a real 500 instead of a clean 4xx — add input validation
per route), WGR-145 (`SCRAPER_API_KEY` absent — ScraperAPI proxy rotation currently disabled),
WGR-149 (Postgres/PostgREST connection-pool contention under load — informational, monitor), WGR-153
(rate-limiting posture: 23/56 expensive AI/agent routes rate-limited, 30 have neither a rate limit
nor a billing-tier throttle — extend rate limiting to the remaining 30, prioritizing any with
`maxDuration >= 60s`).

**Scope decisions needed, not code fixes (PENDING-SCOPE):** WGR-069 (2 orphan tables — reconcile or
document), WGR-092 (AutoApply/AG-12 has no test coverage — decide priority for building it), WGR-117
(the undocumented `org-branding` public bucket — intentional or lock down), WGR-146 (Resend not
configured anywhere — decide when email sending goes live).

---

## Wave 3 — P3 (8 open — track, don't fix blind; 29 CONFIRMED-OK rows need no action)

| ID | Scope Tag | Note |
|---|---|---|
| WGR-014 | UNVERIFIED | Did NOT reproduce WGR-004's `/documents` hang on a later attempt — reconcile with WGR-004 (Wave 0 item 3) before either row is closed; may be intermittent. |
| WGR-034 | CONFIRMED-BROKEN | `process-discovery-request.ts` job-handler wiring gap — lower urgency than Wave 1 Batch 3's crons, same audit category. |
| WGR-062 | UNVERIFIED | Index/summary row pointing at the full 21-missing-table/50-column-mismatch cross-reference — superseded in practice by Wave 1 Batch 1's itemized fixes; close this row once Batch 1 is done. |
| WGR-072 | PENDING-SCOPE | 4 tables with RLS-enabled-zero-policy — decide if intentional (safe-by-default) or a real access gap. |
| WGR-094 | CONFIRMED-BROKEN | Registry/governance-doc metadata drift — a documentation-accuracy fix, not a runtime bug. |
| WGR-134 | CONFIRMED-BROKEN | AutoApply page's "QUEUE" mini-panel — a real but narrow UI finding, see register for specifics. |
| WGR-144 | CONFIRMED-BROKEN | IRS BMF CSV import script's own header-row assumption may be wrong — verify against a real current BMF file before the next scheduled import run. |
| WGR-147 | PENDING-SCOPE | Google OAuth entirely unconfigured — decide when Gmail/Calendar integration goes live; see `GO-NO-GO.md` §5(a). |

---
*Derived from `WIRING_GAP_REGISTER.md` as of commit `5c747ee174c0abd83bff2cd266d825c511ebba5f`. Every
WGR ID cited above carries its own full finding text, real evidence path, and reproduction command in
the register — this document is the fix plan, not a duplicate of the evidence.*
