# PT-00 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how each was produced, see `PHASE-00-SUMMARY.md` in this same directory.
This doc is the short version: what got established, what's notable, and what's being asked of you.

## What PT-00 actually did

Set up the evidence infrastructure this whole audit program depends on, and used it once to
establish a real baseline of the current codebase — not to fix anything. Five checks, each with a
committed evidence artifact and a script (`scripts/audit/verify-pt00-00{1..5}.mjs`) that re-verifies
it from the raw file, not from a claim:

1. Evidence scaffold + `WIRING_GAP_REGISTER.md` (the running list every future finding gets logged
   into, with a P0–P3 severity legend).
2. Confirmed the known build-worker-crash safeguard (`next.config.mjs`'s `cpus: 1` cap) is already
   in place — real, cold-cache build ran clean (97.9s, exit 0).
3. Generated a real route manifest from a fresh build: 464 routes (146 pages, 318 APIs), plus a
   dead-nav/orphan-route cross-reference against `nav-items.ts`.
4. Audited every env var the codebase actually references (76 of them) against local `.env.local`
   presence — names and presence only, no secret values ever recorded.
5. Ran a real authenticated Playwright smoke sweep across all 464 routes against a local dev server.

## Notable findings (11 register rows, WGR-001 through WGR-011)

**Six real, confirmed bugs**, each with its own register row and reproduction steps:
- **`/documents` page hangs — P0.** Times out past 30s on load. Graded P0 because it's a literal
  top-level sidebar nav item, not a sub-page — any user who clicks it today gets a hang (WGR-004).
- **Five API routes 500 on an authenticated, no-param request — P1.** `/api/agents/discovery`,
  `/api/consultant/clients`, `/api/outreach/sequences`, `/api/schoolfunder`,
  `/api/settings/notifications` (WGR-005 through WGR-009). Graded P1, not P0 — each was checked via
  repo-wide grep and none backs a primary-nav page's core data load (they back sub-settings pages,
  a showcase feature, or have no confirmed dashboard consumer at all).
  - One of these (`/api/outreach/sequences`) isn't new — it re-confirms a gap `STATE_OF_THE_BUILD.md`
    already documented back in 2026-08-13 (a missing `followup_sequences` table) is still live.
  - None of the six were root-caused this phase. That's deliberate — PT-00 is baseline evidence
    collection, not remediation. Root-causing and fixing is PT-01+ work.

**Two known, already-documented gaps, re-confirmed, not new:**
- `VERCEL_TOKEN`/`VERCEL_PROJECT_ID` still absent locally (WGR-002, P1) — this is the exact gap
  `STANDING_DIRECTIVES.md` DIRECTIVE-019 already names as blocking real deploy-drift verification;
  it degrades to a warning, not a hard failure, per the FORGE gate fix already in place.
- 13 more production-required secrets absent locally (WGR-003, P2) — Stripe, Resend, various
  encryption keys, `CRON_SECRET`, `SUPABASE_URL`, `WORKER_ID`. **Important:** this only checked
  local `.env.local`. Nobody checked whether these are set in Vercel/Railway production — that's a
  separate, unperformed check, not something this phase can speak to.

**Three non-findings, already investigated and explained, logged so none of them get re-asked
cold in a later phase:**
- The build-worker cap everyone worried about is already in place and working (WGR-001).
- Dead-nav (a nav link pointing at a route that doesn't exist) is zero (WGR-011).
- The orphan-route scan flags 78 of 146 pages as having no incoming `nav-items.ts` link — looks
  alarming at a glance, but it's explained, not broken (WGR-010). 6 live in the header's top tab bar
  by design instead of the sidebar; the rest are marketing pages, auth entry points
  (login/register/etc.), `/settings/*` subsections reached through their own settings nav, or
  drilldown pages reached by clicking through from a list page. `nav-items.ts` was never meant to be
  a complete index of every reachable page.

**The real, non-noisy signal in the smoke sweep:** of 464 routes, 399 passed cleanly and only 6 are
real failures. The other 59 "failures" a naive pass/fail count would show are the sweep correctly
getting rejected (404 on a placeholder ID, 400 on a missing required param, 401 on a cron-secret
route with no auth) — not bugs. Full breakdown in `PHASE-00-SUMMARY.md`.

## Go/no-go recommendation for PT-01

**Go**, with one prerequisite that isn't done yet: **PT-01 onward is not yet authored.** This session
only built and ran PT-00. Nobody has yet written what PT-01, PT-02, etc. actually check, and nobody
should start authoring them until you've:

1. Reviewed this baseline (this doc + `PHASE-00-SUMMARY.md` + the register) and confirmed the
   methodology and severity calls look right to you.
2. Told us what you actually want the rest of the audit program to cover — the register and
   summary establish *what's true right now*, not *what matters most to check next*. That's your
   call, weighed against `BENAVORA_AUDIT_PROGRAM.md`'s intended scope (that document wasn't found
   in this repo checkout as of this phase — if it lives somewhere else, point us at it; if it needs
   to be written, that's also a decision for you before PT-01 gets authored).

One of the six real bugs found (`/documents`, WGR-004) is graded P0 — a live, user-facing hang on a
top-level sidebar page — worth fixing soon on its own merits, but it doesn't need to block your
review of this baseline or gate the PT-01 authoring decision; it's a contained frontend hang, not
live data corruption or a security exposure, and per the P0 legend definition ("blocks a real
user-facing flow") it's exactly the kind of thing PT-01+ should pick up and fix directly rather
than something that needs a scope decision from you first. The other five are P1/P2/P3. This is a
"review the baseline, then tell us what's next" checkpoint, not a "stop everything" one.
