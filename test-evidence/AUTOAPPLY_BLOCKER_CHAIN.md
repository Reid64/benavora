# AutoApply queue_processor — blocker chain to first completed run

AR-12.2, 2026-09-18. Prior sessions cleared three distinct blockers (AR-3.1
field-mapping/verification, AR-7.2 session deadlock, AR-12.1 funder
resolution) without ever producing a single `completed` row in
`agent_runs` for `agent_type = 'autoapply_queue_processor'`. This session's
job: read the live failure, fix it, repeat, until a real completed run
exists or the remaining blocker requires crossing a line this task is not
allowed to cross.

Method: every step below was run against the live production Supabase
project (`vbjplpquqxxfbpazyalt`) via the Supabase MCP tool, not against a
guess. `worker/queue-processor.ts` runs as the separately-deployed Railway
worker (`railway-worker-1`), polling the real `submission_queue` table
every 15s — nothing here is mocked or run locally.

## Starting state (2026-09-18, ~09:00–10:00 UTC)

```
select count(*) filter (where status='completed') as completed,
       count(*) filter (where status='failed') as failed
from agent_runs where agent_type='autoapply_queue_processor';
-- total=55, completed=0, failed=55
```

Error breakdown across all 55 runs:

| error type | count |
|---|---|
| `concurrent_automation_conflict` | 39 |
| `cross_client_blocked` | 6 |
| `org_not_ready` | 6 |
| `no_funder_id` | 3 |
| `funder_not_found` | 1 |

## Finding: the 55 failing runs are not production traffic

Every `organization_id` behind these 55 `agent_runs` rows resolves to an
organization named `AUTOAPPLY_TEST_*` / `AUTOAPPLY_MUTEX_TEST_*` /
`AUTOAPPLY_RISK_TEST_*` / `RLS_TEST_ORG_*` — i.e. every one of these is a
row created by this repo's own integration test suite
(`src/__tests__/integration/autoapply-*.test.ts`,
`src/__tests__/integration-live/autoapply-queue-live-worker.test.ts`),
each deliberately exercising exactly one `SkipError` branch of
`processItem()`. `concurrent_automation_conflict`'s dominance (39/55) is
`autoapply-mutual-exclusion.test.ts` and the live-worker suite proving the
mutex guard fires — not a bug, and not a queue of real orgs stuck behind a
deadlock. Cross-checked: `automation_sessions` currently has zero rows in
any non-terminal status (`pending`/`in_progress`/`awaiting_approval`/`approved`),
and `submission_queue` currently has zero `pending` rows — the queue is
empty, not backed up.

**No code change was needed for `org_not_ready`, `no_funder_id`,
`concurrent_automation_conflict`, or `funder_not_found`** — all four are
the guards working as designed against synthetic test orgs, confirmed via
git-blame/tag correlation, not a defect in `queue-processor.ts`.

## Blocker found and fixed: orphaned cross_client_submissions rows poison the one safe test target

`processItem()`'s only real "let it run all the way through" path uses
`https://httpbin.org/forms/post` (a public dummy-form echo service — the
same non-funder, non-live target this repo's own tests use specifically so
a real submission never reaches an actual foundation's portal). That path
**has worked before**: `cross_client_submissions` (written only after a
real, successful submission — `queue-processor.ts:1834`) had 4 rows, all
`funder_domain='httpbin.org'`, dated 2026-08-07 through 2026-09-15 — proof
the full analyze → fill → submit → record pipeline has completed for real,
multiple times, in the past.

The blocker: `checkCrossClientDedup()` blocks a new org's submission to a
domain if *any other* org submitted there in the last 7 days
(`submission-controls.ts:72-99`) — and all 4 owning test orgs for those
rows were already deleted (by their own tests' `afterAll`), while the
`cross_client_submissions` rows themselves were never cleaned up (no test
file deletes from that table). Every fresh attempt at a real completion —
by any org, including a brand-new one seeded specifically for this
session — was deterministically blocked by 100%-orphaned test debris, not
by a real other-tenant collision. Confirmed no other domain has ever
appeared in this table, and no non-test organization has ever used
`httpbin.org` as a funder portal.

This is **not** the cross-client dedup guard failing — the guard did
exactly its job against the data it was given. The defect is upstream: the
live-worker test (`autoapply-queue-live-worker.test.ts`) that creates
these rows never cleans them up.

**Fix (code, `src/lib/autoapply/submission-controls.ts` +
`src/__tests__/integration-live/autoapply-queue-live-worker.test.ts`):**
exported `hashOrgId()` and added a scoped `afterAll` cleanup
(`delete from cross_client_submissions where org_hash = hashOrgId(orgReadyId)`)
so this suite stops leaving permanent debris behind for the next run.

**Fix (data, one-time production cleanup):** deleted the 4 orphaned
`cross_client_submissions` rows (all `httpbin.org`, all traced to
already-deleted test orgs — verified before deleting, see below). This
does not touch, weaken, or bypass the dedup guard itself — it removes
stale rows the guard was never supposed to be permanently blocked by.

Verification before delete (all 4 owning orgs confirmed gone / test-only):
only `httpbin.org` has ever appeared in `cross_client_submissions`; the
current `funders` table's `httpbin.org` rows are all named
`AUTOAPPLY_*_TEST_FUNDER_*`, owned by orgs named `AUTOAPPLY_*_TEST_*` —
zero production/non-test usage of this domain, ever.

## First real attempt: reached genuine form-fill logic, hit a real (4th) blocker

With the orphaned dedup rows cleared, seeded a brand-new org
(`AR12_2_LIVE_RUN_q7x9k2`, id `e1e048ce-113d-443b-a6c5-1b208a7ccc7b`) using
the exact "ready" shape `autoapply-queue-live-worker.test.ts` already
proves passes every readiness/mutex/velocity/dedup gate (mission
statement, EIN, address, contact, one active `request_profiles` row, two
`tax_documents` rows), plus a funder (`AR12_2_LIVE_RUN_FUNDER_q7x9k2`, id
`58247a48-8185-4aac-8194-e0f51d6fa27d`) pointed at
`https://httpbin.org/forms/post`, and inserted a `pending` `submission_queue`
row. `railway-worker-1` (confirmed alive, `last_heartbeat_at` seconds
earlier) picked it up in under 2 seconds — `worker_status.current_item_id`
flipped to the new row, proving the orchestration layer (dequeue, claim,
every preflight gate) is not the blocker for a genuinely-ready org. It ran
for real (~21s of actual browser work, not an instant gate-reject) and
then failed:

```
status: failed
error_message: "No submit button or control found on the page."
```

## Blocker found and fixed: FormAnalyzerAgent never navigates; queue-processor.ts assumed it did

Root cause, found by reading `form_templates` for this run
(`form_structure = {"fields": [], "formAction": "", ...}` — Claude was
handed an *empty* page) and then reading the two source files together,
not guessed:

- `src/lib/autoapply/form-analyzer-agent.ts`'s `analyzeAndStore()` never
  calls `page.goto()`. It only reads whatever the page is currently
  showing (`extractPageContent()` → `document.querySelectorAll('form')`).
- `worker/queue-processor.ts`'s `processItem()` only called
  `page.goto(portalUrl)` inside the `!needsReanalysis` (cached-template)
  branch, with a comment on the `needsReanalysis` branch claiming
  "analyzer already navigated to the portal" — which was never true for
  `FormAnalyzerAgent`. Every **first-ever** analysis of a funder (no cached
  `form_templates` row — the state of every funder this pipeline has never
  successfully completed a submission to, which per this task's own premise
  is *all of them*) ran the analyzer against whatever the freshly-launched
  browser page happened to be showing — never the real portal. Confirmed
  live: `httpbin.org/forms/post`'s real markup (fetched directly) has a
  genuine 7-field form and a `<button>Submit order</button>` — the page is
  fine; it was simply never loaded before analysis ran.
- Downstream effect: `form_templates.form_structure.fields = []` got
  cached as "verified" (`last_verified_at = now`), so `submitForm()` later
  had zero fields to work with and, since navigation for the *fresh*-
  analysis path never happened at all up to that point either, no real DOM
  to find a submit control in.

**Fix (`worker/queue-processor.ts`):** moved `page.goto(portalUrl, {
waitUntil: 'domcontentloaded', timeout: 30_000 })` to run once,
unconditionally, before the `needsReanalysis` branch — so both the
first-analysis path and the cached-template path see the real page before
anything downstream reads it. Removed the now-duplicate `goto()` that
previously lived only in the cached-template branch.

This is a real product bug independent of any test/orchestration
scaffolding — it would have blocked a genuine first submission to a real
funder exactly the same way, silently caching a 0-field template that
would then poison every future retry too (since a "verified" template
under 7 days old skips re-analysis).

**Data cleanup:** deleted the one `form_templates` row this bug produced
(`id=4349b1b8-409a-43b2-a3b8-e6856915f296`, `field_count=0`) so the retry
below re-analyzes for real instead of reusing the cached empty result.

## Live re-check: first completed run

<!-- filled in after redeploy + re-test -->
