# PT-02 — Phase 02 Summary (API / CRUD / Auth Audit)

Consolidated numbers for the PT-02 phase. Every number below cites the evidence artifact it came
from — re-run the cited verifier or read the cited file directly to reproduce it; nothing here is
asserted from memory.

## Scope

PT-01 audited the frontend rendering/nav/element-wiring layer. PT-02 goes one layer down: the API
route layer itself — every route's real auth mechanism, whether an unauthenticated caller can reach
data or an action it shouldn't, whether role-tier gates (viewer/writer/admin/owner) are enforced
correctly in both directions (no under-enforcement, no over-restriction), whether a full CRUD cycle
through the real API layer round-trips correctly for a representative sample of resources, and
whether pagination/list endpoints are honest about how much data they actually returned.

Five steps, each producing its own evidence file under `test-evidence/pt-02/`:

1. **PT-02-001 — API route classification.** Extracted and classified all 318 real API routes.
2. **PT-02-002 — Unauthenticated-rejection sweep.** Hit all 318 routes with zero auth and recorded
   the real response.
3. **PT-02-003 — Role-tier enforcement matrix.** Called every admin/owner-gated route at all 4 real
   role tiers against a disposable local Supabase stack.
4. **PT-02-004 — CRUD cycles through the API layer.** Full create→read→update→delete cycles for 11
   representative resources, through the real, unmodified Next.js API layer, against a disposable
   local Supabase stack (never production — see `BRANCH_STRATEGY.md`'s hard rule).
5. **PT-02-005 — Pagination audit + known-500 root-causing.** Live-verified PostgREST's row cap,
   audited 9 list/pagination endpoints for silent truncation, and root-caused the 5 real 500s PT-00's
   smoke sweep already found.

## PT-02-001 — API route classification

**318 API routes classified** (`test-evidence/pt-02/api-routes.json`). 231 are mutation routes
(`isMutation: true` — accept POST/PUT/PATCH/DELETE), 87 are GET-only.

Auth mechanism breakdown (`authMechanismCounts`):

| Mechanism | Count |
|---|---|
| `requireRole` (viewer/writer/admin/owner tier gate) | 271 |
| `auth.getUser` (session check, no explicit tier) | 17 |
| `cron_secret` (bearer-token check against `CRON_SECRET`) | 14 |
| `webhook_signature` (Stripe/Resend/Svix signature verification) | 4 |
| `requireAuth` (session required, no tier) | 3 |
| `oauth_code_exchange` (OAuth callback flow) | 1 |
| `none_detected` | 8 |

**8 routes flagged for review** (`flaggedForReviewCount: 8`) — all routes whose intended
reachability is genuinely unauthenticated-or-token-based rather than session-gated: `GET
/api/calendar/callback` (OAuth callback), `GET/POST /api/onboarding`, `POST
/api/onboarding/complete-setup`, `POST /api/onboarding/generate-narratives`, `POST
/api/platform/bootstrap` (self-disabling first-owner setup), `GET /api/sources/state-portals`,
`GET/POST /api/unsubscribe` (bearer-token email link), `POST /api/users/accept` (invite-token
accept). **1 route flagged `possibleMiddlewareConflict`**: `/api/unsubscribe` — correctly flagged;
see PT-02-002 below, this became WGR-023.

## PT-02-002 — Unauthenticated-rejection sweep (the headline check)

**318/318 routes tested with zero authentication. Zero auth bypasses.**
(`test-evidence/pt-02/unauth-sweep.json`, `verdictCounts`, `p0FindingCount: 0`)

- **316/318 → `PASS`.** No unauthenticated caller reached a route handler's real logic or any real
  data on any of these — every mutation, every read, every admin/owner-gated route rejected before
  doing anything.
- **2/318 → `PASS_DESIGN_MISMATCH`** (`/api/platform/bootstrap`, `/api/unsubscribe`) — **not**
  auth-bypasses; the opposite. Both routes' own code intends unauthenticated reachability (bootstrap
  self-disables after first owner exists; unsubscribe is a bearer-token link for a logged-out email
  recipient) but `src/middleware.ts`'s `PUBLIC_PATHS` doesn't exempt either path, so both get
  redirected to `/login` before their own token/self-disable logic ever runs. This is a real,
  production-relevant reachability gap, registered as **WGR-023** — but graded PASS in this sweep's
  own auth-bypass framing because the failure direction is "blocks a legitimate caller," never
  "exposes data to an illegitimate one."
- **Status code distribution**: 316 responses were `307` (redirect to `/login`), 1 was `401`
  (`/api/auth/log-event`, exempted via middleware's `/api/auth/*` prefix, rejected by its own
  `auth.getUser` check directly), 1 was `400` (`/api/users/accept`, exact-matched in
  `PUBLIC_PATHS`, rejected by its own invite-token validation).
- **Root cause of the 307s, traced and registered as WGR-023**: `src/middleware.ts` has no path
  exemption for `/api/cron/*`, `/api/sources/*`, `/api/webhooks/*`, `/api/admin/webhooks/*`,
  `/api/platform/bootstrap`, or `/api/unsubscribe` — every one of these requires a valid session
  cookie to reach the route handler at all, confirmed live via `fetch`/`curl` with `redirect:
  manual`, zero cookies: `307 Location: /login` on all 14 real `cron_secret` routes and all 4 real
  `webhook_signature` routes, before the route's own `CRON_SECRET`/signature check ever executes.
  In production this would block the routes' own real callers (Vercel Cron, Stripe, Resend) the same
  way it blocks an anonymous attacker, since none of those carry a Benavora session cookie either —
  see the note on WGR-003 below for a partial counter-signal from Reid on this specific point for
  `CRON_SECRET`/cron routes.

## PT-02-003 — Role-tier enforcement matrix (the other headline check)

**76 route+method entries × 4 real role tiers (viewer/writer/admin/owner) = 304 calls. Zero
under-enforcement. Zero over-restriction.**
(`test-evidence/pt-02/role-matrix.json`, `entryCount: 76`, `totalRows: 304`, `verdictCounts:
{"PASS": 304}`, `p0FindingCount: 0`, `p1FindingCount: 0`, `overRestrictiveCount: 0`)

Every admin- and owner-gated API route (49 route files, 76 route+method entries after per-method
`requireRole()` tier extraction, including 2 entries whose required tier is chosen at runtime rather
than a literal string) was called with real, authenticated sessions at all 4 real role tiers against
a disposable local Supabase stack + org + users this audit provisioned itself (never production —
same hard rule as PT-02-004, see `BRANCH_STRATEGY.md`). This app has no "member" tier; `writer` is
the real middle tier (`src/lib/utils/constants.ts` `ROLE_HIERARCHY`).

- **192/192 below-tier calls correctly refused** — each got the specific `requireRole()` 403
  `{code: "forbidden"}` rejection.
- **112/112 at-or-above-tier calls correctly cleared the role gate** — verified by the absence of
  the `forbidden` code; several then hit real, expected downstream errors from the audit's
  intentionally minimal local schema (e.g. a missing table), which is a correct "permitted, failed
  for an unrelated reason" result, not miscounted as a refusal.

**No admin/owner route under-enforces its tier, and no route over-restricts a tier that should have
access.** This is the direct answer to the review question "is the API layer sound and authorization
enforced": on both the unauthenticated dimension (PT-02-002) and the role-tier dimension (PT-02-003),
yes.

## PT-02-004 — CRUD cycles through the API layer

**11 representative resources, full create→read→update→delete cycles, through the real API layer,
against a disposable local Supabase stack (never production).** 8/11 fully clean. 3/11 have a real
finding — none are auth/security issues, all are API-contract or schema-mismatch bugs.
(`test-evidence/pt-02/crud-cycles.json`, `resourceCount: 11`, `findingResourceCount: 3`)

| Resource | Verdict | Finding |
|---|---|---|
| `email_sequences`, `grant_budgets`, `drafts`, `applications`, `donor_discovery_prospects`, `opportunities`, `contacts`, `deadlines` | PASS | Full cycle clean, viewer-role write correctly refused (403) on every mutating step. |
| `draft_queue` | FINDING | `DELETE` is a soft delete (`status: "rejected"`); a subsequent `GET` still returns 200 with the item, never 404. Registered **WGR-025** (P2). |
| `request_profiles` | FINDING | Same pattern: `DELETE` sets `active: false`, subsequent `GET` still returns 200, never 404. Registered **WGR-026** (P2). |
| `email_templates` | FINDING | `POST /api/email/templates` **unconditionally 500s on every request, for every org, at writer role** — not an edge case, template creation is fully broken via this API. Root cause: the route inserts/selects `subject`/`body` columns that don't exist; the live table (migration 054) has `subject_template`/`body_template`. `PATCH`/`DELETE` reference the same nonexistent columns. Registered **WGR-027** (P1). |

## PT-02-005 — Pagination audit + 5 known 500s root-caused

### PostgREST's silent 1000-row cap (WGR-028)

Live-verified: this Supabase project's `db.max_rows` setting silently caps **any** request at 1000
rows, regardless of an app-level `.limit()` requesting more or no limit at all — `HTTP 206 Partial
Content` with a `Content-Range` header, not an error. A caller that trusts `data.length` without
checking `count`/`Content-Range` silently treats a 1000-row slice as complete. This is the mechanism
behind every silent-truncation finding below. Registered **WGR-028** (`CONFIRMED-OK` — this is a
platform behavior, not itself a bug; it's the cause other rows build on).

### Pagination audit — 9 endpoints checked

| Verdict | Count | Endpoints |
|---|---|---|
| `PAGINATES_CORRECTLY` | 4 | `/foundations`, `/nonprofits`, `GET /api/intelligence/corporate-prospects`, `GET /api/donor-discovery/prospects` (main listing path) |
| `BOUNDED_NO_TOTAL` | 1 | `GET /api/intelligence/outreach/prospects` (hard-capped at 200, no total returned — informational, not a truncation finding) |
| `SILENT_TRUNCATION_CONFIRMED` | 2 | **WGR-029** — `GET /api/donor-discovery/requests/[id]` progress counts, live-reproduced as a **99.3% undercount today** (real request, real org, 133,812 real linked prospects, app reports ~1000). **WGR-031** — `GET /api/intelligence/proposals`'s source-filter list and average-award-amount stat, live-reproduced as **2 real sources silently missing from the filter dropdown** and a **~37x understatement of the real average award amount** ($1,010,648 shown vs. $37,933,899 real, across 3,489 real rows) — a wrong number every user of the Intelligence Library sees today. |
| `SILENT_TRUNCATION_LATENT` | 1 | **WGR-030** — `GET /api/donor-discovery/pipeline`'s `avgScore` — same unbounded-query mechanism, but currently non-triggering: 0 real rows have a non-null `score` yet, so today's output happens to be correct by coincidence; will silently truncate the moment scoring populates >1000 rows. |
| `MIXED` | 1 | **WGR-032** — `GET /api/donor-discovery/prospects` has two internal unbounded filter-building sub-queries (separate from its correctly-paginated main listing): `request_id` branch is `SILENT_TRUNCATION_CONFIRMED` (same live mechanism as WGR-029); `taxonomy_id` branch is `SILENT_TRUNCATION_LATENT` (0 real rows currently populate the filtered columns). |

**2 of these findings are live, currently-wrong numbers a real user sees today, not hypothetical
future risk** (WGR-029, WGR-031) — both P1. WGR-030 and part of WGR-032 are P2/latent (mechanism
confirmed, not yet triggering on real data volume).

### 5 known 500s from PT-00, root-caused

All 5 previously-unexplained 500s PT-00's smoke sweep found (`GET /api/agents/discovery`, `GET
/api/consultant/clients`, `GET /api/outreach/sequences`, `GET /api/schoolfunder`, `GET
/api/settings/notifications`) were live-root-caused this phase, each confirmed via a direct
`DATABASE_URL` query and a live PostgREST REST call reproducing the exact error:

| WGR | Route | Root cause |
|---|---|---|
| WGR-005 | `GET /api/agents/discovery` | Column-name mismatch: route queries `organization_id`, live table has `org_id` (`discovery_matches`, created by migration 075 with `org_id`; a later migration's rename attempt silently no-op'd against the already-existing table). A second, uninvestigated call site with the identical bug was found in `src/lib/agents/morning-digest.ts` — noted as corroborating evidence, not separately registered. |
| WGR-006 | `GET /api/consultant/clients` | Missing table: `consultant_client_access` (migration 086) never applied to production. Application code is correct against the migration file. |
| WGR-007 | `GET /api/outreach/sequences` | Missing table: `followup_sequences` (migration 083) never applied. **Confirms an already-known, still-owed product decision** (apply migration 083 vs. retire in favor of AG-28's `application_followups`) — checked live this phase and found `application_followups` is **also** absent from production, so neither path is a ready-to-flip switch without its own migration-apply step. Not decided or applied by this task. |
| WGR-008 | `GET /api/schoolfunder` | Missing tables: `schoolfunder_students`, `schoolfunder_volunteer_hours`, `schoolfunder_donations` (migration 103) never applied, despite SchoolFunder being a confirmed-kept live feature. |
| WGR-009 | `GET /api/settings/notifications` | Missing table: `notification_preferences` (migration 087) never applied. |

4 of 5 are missing-table gaps (migration never applied to production); 1 of 5 is an application-code
column-name bug against a table that does exist. None are auth/authorization issues — all are
schema/migration-drift, the same class of gap `MIGRATION_AUDIT.md` already documented platform-wide.

## Register coverage

All PT-02 findings are recorded in `test-evidence/_register/WIRING_GAP_REGISTER.md` as rows
**WGR-023 through WGR-032**, each with a real evidence path under `test-evidence/pt-02/` and a
reproduction command. WGR-005 through WGR-009 (previously `CONFIRMED-BROKEN` with no root cause from
PT-00) were updated in place this phase with their real root causes and repro commands, not
duplicated as new rows. WGR-003 (env-var absence) was updated with a note from Reid on `CRON_SECRET`
specifically — see the Review Pack for detail. No PT-02 finding from this session exists outside the
register.

## Verifier status

```
node scripts/audit/verify-pt02-001.mjs
  -> PASS: api-routes.json has 318 API route(s), matching PT-00 route-manifest.json exactly.
     Every route has a methods[] array and a recognized auth classification. 231 mutation
     route(s), 8 flagged for review.

node scripts/audit/verify-pt02-002.mjs
  -> PASS: unauth-sweep.json covers all 318 route(s) from api-routes.json (exact path-set
     match, no duplicates, no omissions). Every row has a recognized verdict and a recorded
     outcome. Verdict counts: {"PASS":316,"PASS_DESIGN_MISMATCH":2}. No P0 auth-bypass findings.

node scripts/audit/verify-pt02-003.mjs
  -> PASS: role-matrix.json covers all 49 admin/owner-gated route(s) from api-routes.json
     across all 4 real roles (viewer/writer/admin/owner), 304 total row(s). Every row has a
     recognized verdict and a recorded outcome. Verdict counts: {"PASS":304}. No
     under-enforcement findings.

node scripts/audit/verify-pt02-004.mjs
  -> PASS: crud-cycles.json covers all 11 selected resource(s), each with all four required
     CRUD steps (create/read/update/delete) plus readAfterDelete, every step carrying a
     recognized outcome and (when tested) a numeric status. 24 step(s) actually exercised via
     real API calls, 27 recorded as no_route findings. 3 resource(s) with a FINDING verdict:
     draft_queue, request_profiles, email_templates.

node scripts/audit/verify-pt02-005.mjs
  -> PASS: pagination-and-500s.json covers all 9 expected large-table list endpoint(s) (5
     paginate correctly or are honestly bounded, 4 show silent truncation -- confirmed or
     latent), and all 5 known 500s (WGR-005..009) carry a substantive, evidence-backed root
     cause. WGR-007's pending product decision is confirmed still owed, not silently resolved.

node scripts/audit/verify-pt02-006.mjs   -> this phase's closing verifier (see REVIEW-PACK.md)
```
