# PT-03 — Phase 03 Summary (End-to-End User Journeys, Kanban Enforcement & Auth Flows)

Consolidated numbers for the PT-03 phase, across four evidence artifacts (environment
establishment, the core signup-to-deadline journey, the AutoApply + Donor Discovery hand-off
journey, and the kanban-transition/auth-flow pass). Every number below cites the evidence artifact
it came from — re-run the cited verifier or read the cited file directly to reproduce it; nothing
here is asserted from memory.

## The question this phase answers

PT-00/PT-01/PT-02 already answered "does the app render, wire up, and expose a working API layer."
This phase answers a different question: **when a real user actually drives the app through a
complete, multi-step workflow — sign up, onboard, discover a grant, draft it, move it through the
pipeline, track its deadline; queue a corporate prospect and run it through AutoApply; reset a
password — does every hand-off between stages actually work, and does the pipeline's own documented
transition rules actually get enforced anywhere below the UI?** LOCAL/BRANCH ONLY throughout, per
this audit program's standing rule (`test-evidence/pt-02/BRANCH_STRATEGY.md`) — every script in this
phase targeted the same reused local Supabase CLI stack (`.pt05-local-stack/`, Postgres 17 + GoTrue +
PostgREST, `postgresql://postgres:***@127.0.0.1:56322/postgres`, API base
`http://127.0.0.1:56321`) and its own isolated `next dev` instance (ports 3303/3304/3305 across the
three journey scripts); no production system, `benavora.com`, or the real Supabase project
(`vbjplpquqxxfbpazyalt`) was ever touched. Every target/production-ref field was checked and
confirmed non-production before this summary was written.

## Headline result: the core workflows are operable end to end, but the kanban stage machine has zero enforcement below one UI component

**Read this first.** All three driven journeys — signup → onboarding → discovery → draft → pipeline
→ deadline; Donor Discovery prospect → review → route-to-AutoApply; AutoApply queue → session →
form-fill → submit — completed with real, persisted state at every stage, and the real hand-off
between Donor Discovery and AutoApply (a genuine "Queue in AutoApply" click creating the exact
`submission_queue` row the AutoApply journey then drives to completion) is confirmed working, not
just individually-tested in isolation. That is real, positive evidence the core product loop
functions.

But this phase also found that the kanban pipeline's documented 12-stage transition graph
(`src/components/applications/pipeline.ts`) is enforced **in exactly one place**: a client-side
pre-submit check inside `StageTransitionModal.tsx`. Neither the reusable `executeTransition()`
function itself, nor the database, nor any API route (there isn't one for stage mutation) applies any
equivalent check. Three separate, independently-confirmed bypasses — a direct
`executeTransition()` call with an illegal stage-skip target, a raw `applications.update({stage})`
call bypassing `executeTransition()` entirely, and a viewer-role session performing an owner/admin-
only transition — all persisted with zero rejection. **This phase also found one genuinely broken
core-product flow (draft generation silently loses its output) and one genuinely broken auth flow
(a valid password-reset link is falsely rejected) — 6 findings total (WGR-129 through WGR-134): 4×P0,
1×P1, 1×P3.**

## Method

Four evidence artifacts, each independently verified by its own gate script:

1. **Environment establishment** (`test-evidence/pt-03/environment.txt` +
   `environment-session.json`) — confirmed the local, non-production target live, confirmed PT-00/
   PT-01/PT-02's own review-pack artifacts exist as declared dependencies, provisioned one fresh
   journey org + owner profile + a passwordless (magic-link) auth user, and confirmed the resulting
   session is independently usable against the real Auth server and a real PostgREST read — not
   assumed from the provisioning call alone. Verified: `node scripts/audit/verify-pt03-001.mjs`
   (exit 0, 6/6 checks pass, including a fresh live re-query independent of the environment file's
   own claims).
2. **Core journey** (`test-evidence/pt-03/core-journey.json`,
   `stage4-draft-persistence-diagnostic.json`, `stage5-pipeline-retry.json`) — drove a real
   signup → 7-step onboarding wizard → agent-driven opportunity discovery → 4-step Draft Generator
   wizard → application pipeline (create + move) → Predicted Deadlines panel sequence through the
   real UI, no API shortcuts except where a stage's own real trigger has no UI surface (discovery is
   queued by onboarding but has no local worker to process the queue, so the script invokes the
   exact same `runOpportunityDiscovery()` export `worker/autonomous-orchestrator.ts` would call).
   One stage (draft) failed on the first pass and got an isolated root-cause diagnostic; one stage
   (pipeline) hit a test-harness-only failure on the first pass and was retried and passed. Verified:
   `node scripts/audit/verify-pt03-002.mjs` (exit 0, all 6 stages present in order, all 16 referenced
   screenshots exist, 1 well-formed finding).
3. **AutoApply + Donor Discovery journeys** (`test-evidence/pt-03/autoapply-donor-journeys.json`) —
   drove Donor Discovery's prospect → review → route-to-AutoApply flow through the real UI, then
   continued the resulting real `submission_queue` row through AutoApply's queue → session →
   form-fill → submit stages. The first stage (queue) is 100% real UI/DB; the remaining three
   AutoApply stages are explicitly **SAFE-SIMULATED** — real DB writes mirroring
   `worker/queue-processor.ts`'s exact column shapes, verified against the real dashboard's own
   client-side query at each step, but with genuinely zero HTTP calls to `httpbin.org` or any other
   host at any point (checked, not assumed — `external_http_calls_made: 0` on every simulated stage,
   independently re-checked by the verifier). Verified: `node scripts/audit/verify-pt03-003.mjs`
   (exit 0, all 7 stages across both journeys present in order, both terminal states populated, the
   no-external-calls guarantee confirmed, all 9 referenced screenshots exist, 1 well-formed finding).
4. **Kanban transitions + auth flows** (`test-evidence/pt-03/kanban-auth.json`) — computed the full
   12×12 transition matrix from the real `getTransitionRule()` export (144 pairs), drove 3 full
   journeys through the real `executeTransition()` (23 total real-transition steps, reaching all 12
   documented stages), ran 6 rule-layer checks confirming `getTransitionRule()` itself correctly
   flags illegal skips, then ran 3 targeted enforcement-gap tests specifically designed to bypass the
   one place the rule is actually checked (the modal component) — all 3 persisted. Separately drove
   password reset, magic-link login, and session-persistence-across-reload through real Mailpit-
   delivered emails, real form submissions, and a real `page.reload()` through the app's own
   middleware. Verified: `node scripts/audit/verify-pt03-004.mjs` (exit 0, matrix structurally valid,
   all 12 stages visited, 0 steps failed across the 3 legal-transition journeys, all 3 bypass tests
   recorded a real persisted outcome, all 3 auth flows recorded with a real outcome, all 5 referenced
   screenshots exist).

## Results by artifact

### Core journey — 5 of 6 stages pass; 1 real P0 finding (draft persistence)

Full detail: `test-evidence/pt-03/core-journey.json` (`summary.total_stages: 6`,
`stages_passed: 5`, `stages_with_findings: 1`, `halted_early: false`).

| # | Stage | Result | What was actually driven |
|---|---|---|---|
| 1 | signup | PASS | Real `/register` form submit; auth user + organization + owner profile all persisted and linked. |
| 2 | onboarding | PASS | Real 7-step wizard end to end (org profile, 1 program, KB skipped, 1 board member, documents skipped, 1 search-profile keyword, "Skip for now — Free plan"). `onboarding_completed=true`, `programs`/`board_members`/`search_profiles` each 1 real row, a real `agent_queue` row queued for `ag-17-discovery`. |
| 3 | discovery | PASS | Onboarding's real queued row was picked up by directly invoking the real, unmodified `runOpportunityDiscovery()` export (the exact call the worker's `routeQueueItem()` makes for this `agent_id` — no local worker processes `agent_queue` on this stack). Real network calls to Grants.gov/SAM.gov/Federal Register: 20 real opportunities persisted, `agent_runs` completed (`items_found: 20, items_processed: 20`), UI reflects the new opportunity. |
| 4 | draft | **FAIL** | See finding below. |
| 5 | pipeline | PASS (on retry) | Create application + move `discovered → eligibility_review` through the real UI; real `pipeline_history` audit rows for both the create and the move. |
| 6 | deadline | PASS | Real Predicted Deadlines panel (`GET /api/intelligence/deadline-predictions`); real "Add to Calendar" click (real `deadlines` insert) then real "Mark complete" toggle (`is_completed=true`, `completed_at` set). |

**Stage 4 (draft) — WGR-129, P0.** `POST /api/ai/draft` can return a genuine `200` with a full,
real generated grant narrative while persisting **zero** rows to `draft_versions`. An isolated
diagnostic that called the real, unmodified route directly (bypassing only the UI's own event
handlers, not auth or routing) confirmed this precisely: a real 31,727-byte narrative came back in
122,365ms, `agent_runs` recorded a genuine successful, well-under-budget Claude call
(`status='completed'`, `duration_ms=117498`, `tokens_used=7783`), and `draft_versions` count for the
org was 0 both immediately after and on a later re-check. Root cause, confirmed by direct code and
schema reads: `draft_versions.version_number` is `NOT NULL` with no default; migration
`009_draft_versions.sql`'s own design is that a `BEFORE INSERT` trigger assigns it so "application
code never supplies it" — and `generateDraft()` (`src/lib/drafts/generator.ts`) indeed never sets
it. That trigger was absent from this phase's local stack (a local-schema gap this session found and
fixed, applied to the local stack only). But the finding is broader than one local-stack gap:
`generateDraft()`'s `draft_versions` insert is deliberately best-effort — on **any** insert error it
only `console.error()`s and leaves `savedVersion:null`, never throwing — so the route returns the
same `200` + full draft text regardless of whether the write actually succeeded, and the client
(`draft-generator/page.tsx`) never checks `savedVersion` for `null` before advancing the wizard, so a
silently-lost draft renders identically to a real save. A page reload at that point loses the draft
completely. `009_draft_versions.sql` is recorded as fully applied in production per
`MIGRATION_AUDIT.md`, but that audit's own methodology doesn't cover trigger objects — whether
production's trigger is currently live is a real, flagged open question, independent of the
silent-swallow-and-200 pattern being a genuine robustness gap on its own. A full end-to-end run
through the real UI (not the isolated diagnostic) hit a correlated symptom: an otherwise-identical
generation call was still `status='running'` in `agent_runs` after this test's own 480-second
client-side wait elapsed — real observed latency variance against the route's own
`maxDuration=300` budget, which local `next dev` does not enforce but Vercel production does; a
production timeout at that boundary would strand the run at `'running'` forever with zero
client-side feedback (the fetch has no `AbortController`/timeout of its own), recoverable today only
via the same admin "Clear Stuck Jobs" sweep already documented for a different table in `WGR-125`.

**Pipeline stage's original attempt — explicitly not registered as a finding.** The first
full-journey run recorded an unhandled Playwright error on this stage
(`page.waitForURL: Timeout 20000ms exceeded`), preserved in the evidence file under
`original_attempt_raw_error`/`original_attempt_screenshot` rather than deleted. Root-caused before
retrying: `applications/new/page.tsx`'s `handleCreate()` navigates via `router.push()` (a Next.js
client-side transition, confirmed by direct code read), which never fires a browser `load` event —
the original script's `page.waitForURL()` used Playwright's default `waitUntil:'load'` and hung for
the full 20s even though the create+navigate had genuinely succeeded. The retry (same journey
org/user, same real UI interaction sequence, only the test harness's own navigation-detection method
changed — polling `page.url()` directly) passed cleanly, confirming this was a test-harness defect,
not an app defect. Not registered in `WIRING_GAP_REGISTER.md`, consistent with this audit program's
convention of only registering confirmed app-level gaps.

### AutoApply + Donor Discovery journeys — 7 of 7 stages pass; 1 real P3 finding; the hand-off is real

Full detail: `test-evidence/pt-03/autoapply-donor-journeys.json` (`summary.donor_discovery_stages_passed:
3/3`, `autoapply_stages_passed: 4/4`, `total_findings: 1`, `halted_early: false`).

**Donor Discovery (3/3 PASS):** seeded one real prospect (`pipeline_stage='new'`) and confirmed it
listed on the real `/donor-discovery/prospects` page → clicked into the real detail page (the same
page `WGR-017` fixed a blank-render bug on; confirmed both `giving_focus_areas` and
`in_kind_history_signals` render real, non-blank content, 1,804 real chars) and moved it to
`reviewing` via the real `<select>` → clicked the real "Queue in AutoApply" button, which
`POST`s to `/api/autoapply/queue` with `source='donor_discovery'` and creates a **real, linked**
`funders` row + `submission_queue` row — independently re-queried and confirmed created, not just
optimistically flagged client-side.

**AutoApply (4/4 PASS):** the `queue` stage confirms the real `/autoapply` dashboard genuinely lists
the exact `submission_queue` row Donor Discovery just created (real client-side query, no test-only
shortcut). The remaining three stages (`session`, `form_fill`, `submit`) are explicitly
**SAFE-SIMULATED** — this journey never made a real HTTP request to any external donation portal at
any point (`external_http_calls_made: 0` on every stage, and `autoapply.no_external_http_calls_made:
true` at the top level) — but every DB write mirrors `worker/queue-processor.ts`'s real column
shapes exactly (a real `automation_sessions` row created and approved; a real `form_templates` row
with mapped fields; a real terminal `autoapply_submissions` row with a clearly-marked
`SAFE-SIM-*` confirmation number), and the real dashboard was reloaded and confirmed to reflect each
resulting state (Running → still Running during form-fill, since the dashboard has no distinct
visual state for that internal step, confirmed via screenshot rather than assumed → Completed with a
green pill).

**Finding — WGR-134, P3.** The AutoApply dashboard's "QUEUE" mini-panel shows "Queue is empty." on
**any** `loadQueue()` failure, not just a genuine empty queue — it never checks `queueError`, unlike
the Session List table ~200 lines below on the same page, which does. Reproduced live this session
via a real `PGRST200` (`submission_queue`→`funders` embedded-join failure, itself a local-schema gap
this session found and fixed before any journey stage depended on it) with a real authenticated
session — the panel rendered the identical "empty" text it would show for a genuinely empty queue,
giving no indication anything had failed.

### Kanban transitions + auth flows — the transition rule is correct; enforcement below the UI is absent; 2 of 3 auth flows pass

Full detail: `test-evidence/pt-03/kanban-auth.json`.

**Transition matrix (144 pairs, all 12×12 stage combinations) and 3 full journeys (23 real
transition steps) — the rule layer itself is correct.** `getTransitionRule()` reports 80 of 144
pairs as legal; 6 explicit illegal-transition rule checks (stage-skips, same-stage no-ops, an
out-of-order recurring-opportunity edge) all correctly returned `allowed:false` with the real
user-facing reason text. All 3 driven journeys (a full happy-path arc with a legal backward move and
a full renewal cycle; a denial + same-row recurring reapply; a follow-up path with an embedded
bypass test) reached every one of the 12 documented stages with **0 of 23 steps failing** — every
legal transition persisted correctly with a matching `pipeline_history` audit row, including the one
`creates_new_application` edge (renewal → discovered correctly leaves the original application at
`renewal_opportunity` and creates a genuinely new application row rather than mutating the original).
This establishes the enforcement-gap findings below as a targeted bypass of an otherwise-correct rule
set, not evidence the rule set itself is broken.

**Three enforcement-gap tests, all persisted with zero rejection — the rule above is enforced in
exactly one place.**

| Test | Bypass mechanism | Attempted transition | Real outcome | WGR |
|---|---|---|---|---|
| `executeTransition_direct_bypass` | Called `executeTransition()` directly, skipping `StageTransitionModal.tsx`'s own pre-check | `discovered → drafting` (an illegal 2-stage skip) | Persisted: `applications.stage='drafting'`, a `pipeline_history` row recorded as if legal | **WGR-130**, P0 |
| `raw_update_bypass` | Raw `applications.update({stage})`, skipping `executeTransition()` entirely | `discovered → awarded` (skipping 10 of 12 stages) | Persisted with `supabase_error: null` | **WGR-131**, P0 |
| `role_gate_bypass` | A real `viewer`-role session calling `executeTransition()` directly | `ready_for_review → submitted` (a legal transition, but owner/admin-only per `canMoveToStage()`) | Persisted (`outcome: PERSISTED_DESPITE_ROLE_RULE`) despite `canMoveToStage()` itself correctly returning `false` for a viewer | **WGR-132**, P1 |

There is no API route for application-stage mutation at all (confirmed by repo-wide search), and the
`applications_org_isolation` RLS policy scopes rows by `organization_id` only — it places no
constraint on the `stage` value or which prior stage a target is reachable from, and there is no
CHECK constraint or trigger on `applications.stage` anywhere in the schema. The stage-transition
graph documented in `BEHAVIORAL_CONTRACTS.md` Sec6 is, today, a purely client-side UI convention.

**Auth flows — 2 of 3 PASS.** Magic-link login (a real self-service `signInWithOtp()`, a real
Mailpit-delivered email, real token extraction and cookie construction, landing on `/dashboard` with
no re-authentication) and session persistence across a genuine `page.reload()` (a real new HTTP
request through the app's middleware, not a client-side soft nav — the session survives, and a
second tab in the same cookie jar also lands authenticated with no re-login) both **PASS** cleanly.

**Password reset — FAIL, WGR-133, P0.** A real, freshly-issued, never-expired, never-reused recovery
link was rejected by `/reset-password` as invalid ("This link is no longer valid"), even though the
underlying PKCE code exchange genuinely succeeds server-side (confirmed via response capture — a real
`200`, a session briefly established). Root-caused via temporary instrumentation (added then
reverted; `git diff` carries no trace of it): `ResetPasswordPageClient.tsx`'s mount `useEffect` calls
`exchangeCodeForSession(code)` with no idempotency guard, and this app's `reactStrictMode: true`
double-invokes every effect on mount in `next dev` — exactly this audit program's own execution
context. The two invocations race for the single-use PKCE `code_verifier` cookie: the winning call
succeeds for real, but the losing call fails with `AuthPKCECodeVerifierMissingError` (the verifier
was already consumed) and unconditionally sets the link-invalid error state, with no check for
whether a sibling invocation already succeeded. Reproduced deterministically across three separate
diagnostic runs. An independent post-hoc check directly against GoTrue confirmed the practical
consequence: the old password still works, the intended new password was never accepted — the
password was genuinely never changed, because the UI never let the form render for real. This is
registered as a real, currently-reproducing `next dev` defect; it was **not** independently confirmed
against a production build (`next build && next start`, where Strict Mode's double-invoke does not
occur) in this session, and is not asserted as confirmed-impacting in production.

## What actually held up, stated plainly (not everything in this phase was a finding)

- **The core signup-to-deadline loop works end to end**, including a real agent-driven discovery run
  against live Grants.gov/SAM.gov/Federal Register data and a real Claude-generated grant narrative —
  only the *persistence* of the draft, not its generation, is broken.
- **The Donor Discovery → AutoApply hand-off is real**, not two independently-tested features
  presented as connected: the exact `funders`/`submission_queue` rows one journey creates are the
  rows the other journey continues from, independently re-queried at the seam.
- **Zero real external HTTP calls were made anywhere in the AutoApply journey** — checked via a
  machine-readable `external_http_calls_made`/`no_external_http_calls_made` field on every simulated
  stage, not just asserted in prose, while every DB write still mirrors the real worker's exact
  column shapes.
- **80 of 144 kanban transition-matrix entries are legal, and every one of the 23 real transition
  steps across 3 full journeys — including a backward move requiring a note and a full
  denial/renewal cycle — persisted correctly** with a matching audit trail. The transition *rule* is
  correct; only its *enforcement* below one UI component is absent.
- **2 of 3 auth flows (magic-link login, session persistence across a real reload) pass cleanly**,
  including a genuine second-tab, same-cookie-jar, no-re-login check.
- **This phase's own test-harness failures were investigated, not silently swallowed**: the pipeline
  stage's original Playwright timeout was root-caused to a `waitForURL`/`router.push()` mismatch in
  the *test script*, confirmed via a same-journey retry, and explicitly *not* registered as an app
  defect — the register only contains confirmed app-level gaps, not test-tooling artifacts.

## Register coverage

**6 new rows this phase: `WGR-129` through `WGR-134`**
(`test-evidence/_register/WIRING_GAP_REGISTER.md`), continuing numbering from PT-10's last row
(`WGR-128`). `WGR-129` (core-journey's draft-persistence finding) was registered by an earlier
session in this phase (`scripts/audit/pt03-003-register-findings.mjs`); `WGR-130` through `WGR-134`
(the kanban enforcement-gap findings, the password-reset finding, and the queue-panel
error-surfacing finding) were registered by this consolidation pass
(`scripts/audit/pt03-005-register-findings.mjs`). All 6 are `CONFIRMED-BROKEN` — every one was
reproduced live against a real request/session/write, not inferred from a code read alone (though
each finding's own register row also cites the supporting code-read root cause where one applies).

| ID | Severity | One-line |
|---|---|---|
| WGR-129 | P0 | Draft generation returns 200 with real content but silently persists zero `draft_versions` rows |
| WGR-130 | P0 | `executeTransition()` enforces no stage-graph rule itself — a direct call persists an illegal stage-skip |
| WGR-131 | P0 | A raw `applications.update({stage})` call bypasses all transition logic entirely; RLS provides no backstop |
| WGR-132 | P1 | The owner/admin-only role gate on kanban transitions is UI-only; a viewer session's direct write persists |
| WGR-133 | P0 | A genuinely valid password-reset link is falsely rejected due to a Strict Mode double-invoke race |
| WGR-134 | P3 | AutoApply's QUEUE mini-panel silently shows "empty" instead of surfacing a real load error |

## Verifier status

```
node scripts/audit/verify-pt03-001.mjs
  -> 6/6 checks PASS. Live re-verification confirms the journey org, owner profile, and
     passwordless auth user all exist right now, independent of the environment file's own claims.

node scripts/audit/verify-pt03-002.mjs
  -> PASS: all 6 required stages present in order, all 16 referenced screenshots exist,
     1 well-formed finding (PT03-002-F01, P0).

node scripts/audit/verify-pt03-003.mjs
  -> PASS: all 7 stages across both journeys (donor_discovery: 3, autoapply: 4) present in order,
     both terminal states populated, no-external-calls guarantee confirmed, all 9 referenced
     screenshots exist, 1 well-formed finding (PT03-004-F01, P3).

node scripts/audit/verify-pt03-004.mjs
  -> PASS: 144-pair transition matrix structurally valid (80 allowed / 64 disallowed), 3 journeys /
     23 steps / 0 failures, all 12 documented stages visited, 6/6 illegal-transition rule checks
     correct, 3/3 enforcement-gap bypass tests recorded a real persisted outcome, all 3 auth flows
     recorded with a real outcome (2 PASS, 1 FAIL), all 5 referenced screenshots exist.

node scripts/audit/verify-pt03-005.mjs   (this phase's own closing verifier, see REVIEW-PACK.md)
  -> Confirms PHASE-03-SUMMARY.md and REVIEW-PACK.md are both real, non-empty deliverables, and
     that WIRING_GAP_REGISTER.md has grown past PT-10's last row (WGR-128) with PT-03's own rows
     (WGR-129 present as this phase's first row; WGR-134 present as its last).
```

## Cleanup verification

Every script in this phase provisions its own real, throwaway org/user identity under a
`*-pt03-*-test.local` (or `benavora-pt03-test.local`) email domain against the local stack only, and
each script's own `cleanupLeftovers()` step removes the *prior* run's leftover rows (org, profile,
and every dependent table it wrote to) before provisioning a fresh set — confirmed present and
exercised live in `environment.txt` ("Removed 1 leftover org(s)... Removed leftover auth user from a
prior run"). This session's own run's data was left in place for inspection, consistent with this
audit program's established convention — nothing from this phase was written to, or needs cleanup
from, the production Supabase project (`vbjplpquqxxfbpazyalt`) or `benavora.com`; every target field
in every evidence file was checked and confirmed local before this summary was written.
