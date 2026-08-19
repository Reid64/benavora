# PT-02 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how each was produced, see `PHASE-02-SUMMARY.md` in this same directory.
This doc is the short version: is the API layer sound and authorization enforced, what's actually
broken and how bad, what's still owed, and what we recommend next.

## The question you actually care about: is the API layer sound and authorization enforced?

**Yes, on both dimensions we tested it.**

- **318/318 API routes tested with zero authentication. Zero auth bypasses.** No unauthenticated
  caller reached real data or a real action on any route — every mutation, every read, every
  admin/owner-gated route rejected before doing anything. The only 2 non-`PASS` results
  (`/api/platform/bootstrap`, `/api/unsubscribe`) are the opposite failure direction — both are
  *too* restrictive (they're supposed to be reachable without a session and currently aren't), not
  a leak.
- **304/304 role-tier calls (76 route+method entries × 4 real roles) came out exactly right.**
  Every below-tier call was refused (192/192); every at-or-above-tier call cleared the gate
  (112/112). Zero admin/owner routes under-enforce their tier. Zero routes over-restrict a tier that
  should have access.

If either of those had come back with even one bad row, that would be the headline of this whole
phase. Neither did. Authorization is sound.

## What's actually broken, and how bad

Nothing found this phase is an authorization problem. Everything below is a data-correctness or
API-contract problem, sitting behind authorization that already works correctly.

**Two of these are live, currently-wrong numbers real users see today, not future risk:**

1. **`GET /api/donor-discovery/requests/[id]`** silently undercounts a real request's prospect count
   by 99.3% (reports ~1,000 instead of the real 133,812) once a request has more than 1,000 linked
   prospects — which the real Faith Foundation org's real, currently-open request already does.
   (**WGR-029**, P1)
2. **`GET /api/intelligence/proposals`** — the Intelligence Library page every user sees — shows an
   average award amount of $1,010,648 when the real number, across all 3,489 real rows, is
   $37,933,899 (~37x off), and silently drops 2 real data sources from its own filter dropdown. Same
   root cause as #1: an unbounded query that Supabase's PostgREST silently caps at 1000 rows with no
   error, and the app code trusts the row count as complete without checking. (**WGR-031**, P1)

**One route is fully, unconditionally broken, not an edge case:**

3. **`POST /api/email/templates` 500s on every single request**, for every org, at the correct
   (writer) role. Root cause: the code writes to columns (`subject`/`body`) that don't exist on the
   live table — the real columns are `subject_template`/`body_template`. Nobody can create an email
   template through this API today. (**WGR-027**, P1)

**Two soft-delete API-contract quirks** (draft queue, AutoApply request profiles): `DELETE` sets a
status flag rather than removing the row, but a subsequent `GET` still returns 200 with the item
instead of 404. Any caller (or future audit) that checks "did the delete work" by expecting a 404
will get a false negative. By design, not a crash — lower severity. (**WGR-025**, **WGR-026**, both
P2)

**The 5 previously-unexplained 500s from PT-00 are now root-caused** — all 5 are real, all 5 sit
behind correctly-enforced auth, none are security issues:
- 4 of 5 (`/api/consultant/clients`, `/api/outreach/sequences`, `/api/schoolfunder`,
  `/api/settings/notifications`) are **missing tables** — a real migration file exists on disk with
  the exact columns the route expects, but the migration was never applied to production. This is
  the same platform-wide migration-drift pattern `MIGRATION_AUDIT.md` already documented (28 of 108
  root-tree migrations never applied as of its last count).
- 1 of 5 (`/api/agents/discovery`) is an **application code bug**: the route queries a column name
  (`organization_id`) that doesn't match the live table's real column (`org_id`) — the table exists,
  the code is just wrong. A second, uninvestigated call site with the identical bug was spotted in
  `morning-digest.ts` while diagnosing this one.

## Still owed — a real product decision, not resolved by this task

**WGR-007** (`GET /api/outreach/sequences` 500ing): the missing-table root cause confirms a decision
that was already flagged and left open back in August — apply the dormant `followup_sequences`
migration as-is, or retire this route in favor of AG-28's `application_followups` model instead. We
checked live whether the alternative is even ready: it isn't — `application_followups` is **also**
missing from production, so neither option is a same-day fix without its own migration-apply step
first. This needs your call, not ours.

## One thing worth your attention that isn't a bug in the usual sense

**WGR-023**: `src/middleware.ts` requires a valid session cookie for essentially every API path,
including all 14 real cron-secret routes and all 4 real webhook-signature routes — there's no
exemption list for `/api/cron/*`, `/api/webhooks/*`, `/api/sources/*`, etc. In production, Vercel
Cron, Stripe, and Resend never send a session cookie either, so if this local-dev finding holds in
production, those routes' actual intended callers would get blocked the same way an anonymous
attacker would — a 307 redirect before the route's own `CRON_SECRET`/signature check ever runs.

**We're not certain this holds in production, and we want to say that plainly rather than bury it.**
You told us `CRON_SECRET` is set in Vercel production and that cron routes return 401 (not a
redirect) when hit unauthenticated there — which is the opposite of what we found locally. We didn't
independently re-check that against the deployed environment this phase (see `WIRING_GAP_REGISTER.md`
row WGR-003's update for the exact framing). If your observation is right, this may be a non-issue in
practice — but we'd want a real `curl` against the live Vercel URL, not local `pnpm dev`, before
calling it closed either way. Worth a 10-minute check before the next phase, not a blocker.

## Recommendation for the next phase

**Go.** PT-02 confirmed the API layer's authorization is genuinely sound — the two questions that
would have been headlines (an auth bypass, an under-enforced admin route) both came back clean. What
it found instead is real but contained: data-correctness bugs (silent truncation, one unconditionally
broken route, two soft-delete quirks) and confirmation of already-documented migration drift, all
sitting behind auth that works. Nothing here indicates a need to re-scope.

Two real candidates for the next phase, both of which feed directly into PT-14 (security):

- **PT-05, tenant isolation** — this phase confirmed role-tier boundaries *within* one org's data.
  It did not test whether one org can read or write another org's data through these same 231
  mutation routes. That's the natural next question given how many of today's findings trace back to
  "the app trusts a query result without double-checking it" (the pagination truncations) — the same
  class of assumption is exactly what a cross-tenant leak would exploit.
- **PT-06, DB integrity** — the missing-table pattern (4 of the 5 root-caused 500s, plus WGR-007's
  still-open decision) points at the same underlying migration-drift problem `MIGRATION_AUDIT.md`
  already flagged platform-wide. A dedicated pass reconciling migration files against what's actually
  live in production would likely surface more of the same class of bug before it causes another
  silent 500 or truncation.

Either is a reasonable next step; we lean slightly toward **PT-05 (tenant isolation)** since it's the
more direct extension of what this phase already proved out (role/auth correctness) and has the
highest severity ceiling if something is wrong (a cross-org data leak would be a real P0, not a P1/P2
data-correctness bug like everything found this phase). Your call.
