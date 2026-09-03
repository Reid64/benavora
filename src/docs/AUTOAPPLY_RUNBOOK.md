# AutoApply Runbook

Operational reference for the AutoApply submission pipeline: architecture, integration setup, failure diagnosis, manual overrides, monitoring, and escalation.

**Scope note on Zoho:** this document was requested to include Zoho integration steps. A full repo search found **no Zoho integration anywhere in the AutoApply codebase** — no Zoho CRM sync, no Zoho-based form-filling, no Zoho env vars, no Zoho API routes, no Zoho migrations. The only "Zoho" hits in the repo are an unused `{/* ZOHO_BOOKINGS_EMBED */}` placeholder comment on the marketing site's `/demo` page and a reference to an unrelated third party's mail hosting — neither has anything to do with AutoApply. Section 2 below documents the integrations that actually exist (Gmail confirmation monitoring, Resend email submission) instead of fabricating Zoho steps. If a real Zoho integration is needed, it does not exist yet and must be scoped and built — treat any pre-existing instructions that assume one as wrong.

---

## 1. Architecture Overview

AutoApply spans two deployments:

- **Vercel/Next.js app** — API routes (`src/app/api/autoapply/*`), the admin dashboard (`src/app/(dashboard)/admin/autoapply-ops`), and cron triggers.
- **Railway worker service** (`worker/`) — a long-running Node process that does the actual submission work. Entry point `worker/index.ts` boots several loops in parallel inside one process: `QueueProcessor` (`worker/queue-processor.ts`), `dd-request-processor.ts`, `knowledge-indexer-processor.ts`, `confirmation-monitor.ts` (imported from `src/lib/autoapply/`), `scheduler.ts`, and a `StreamServer` for live browser-session viewing.

### Queue flow

1. **Enqueue.** A row lands in `submission_queue` with `status='pending'` via:
   - `POST /api/autoapply/queue` (`src/app/api/autoapply/queue/route.ts`) — batch mode, capped per tier by `BATCH_CAPS`.
   - The Donor Discovery handoff path in the same route file.
   - The nightly cron `src/app/api/cron/autoapply/route.ts` calling `populateQueue()`.
2. **Claim.** `worker/queue-processor.ts` does a two-step SELECT→UPDATE claim ordered by `priority`, `created_at` (no `FOR UPDATE SKIP LOCKED` yet — known gap, see §3).
3. **Process** (`processItem()`): queue-control-plane check → funder fetch → SSRF guard on the portal URL (`assertUrlSafe`) → org-readiness check → usage-allowance check → submission-controls (velocity/cross-client/domain throttle) → relationship contact rules → risk assessment → then either:
   - **Web form path** — `StealthBrowser` launches, `FormAnalyzerAgent` maps the form, CAPTCHA/verification-challenge detection runs, `FormFillerAgent.fillAndSubmit()` submits, `parseConfirmationPage()` reads the result.
   - **Email path** (no portal URL on the funder record) — `submitViaEmail()` sends via Resend.
4. **Agent 16 browser-automation sub-pipeline.** A second, distinct pipeline for application-scoped browser automation (`automation_sessions` table, `BrowserAutomationAgent`) is routed via `item.automation_session_id`. `checkConcurrentAutomation()` prevents this pipeline and the standard queue pipeline from both targeting the same org+funder at once.
5. **Confirmation.** `src/lib/autoapply/confirmation-monitor.ts` polls a dedicated Gmail inbox (`apply@benavora.com`) read-only every 5 minutes, matches inbound confirmation emails to `autoapply_submissions` rows by portal domain + normalized org name, sets `confirmation_email_received=true`, and extracts a confirmation number via a Claude call. If that same Claude call finds a portal login/password in the email body, it hands them to `CredentialManager.storeCredentials()` (`src/lib/autoapply/credential-manager.ts`) so a later submission to that funder can reuse them.
6. **Retry sweep.** Hourly cron `src/app/api/cron/autoapply-retry/route.ts` calls `runRetrySweep()` (`src/lib/autoapply/submission-retry.ts`): finds `autoapply_submissions` rows with `status='submitted'`, `confirmation_email_received=false`, older than 6h, under 3 retries; re-enqueues them into `submission_queue`; marks rows `status='failed'` after 3 exhausted retries.

### Key tables

| Table | Purpose |
|---|---|
| `submission_queue` | work items — `status`, `priority`, `started_at`, `completed_at`, `scheduled_for`, `paused_at`, `pause_reason`, `paused_screenshot_path`, `paused_history` (jsonb), `risk_score`, `risk_factors`, `error_message`, `automation_session_id`, `automation_mode` |
| `autoapply_submissions` | submitted-application record — `status`, `submitted_at`, `retry_count`, `next_retry_at`, `confirmation_email_received`, `confirmation_received_at`, `error_message` |
| `automation_sessions` | Agent 16 browser-automation session state |
| `worker_status` | heartbeat table — `status`, `last_heartbeat_at`, `started_at`, `current_item_id`, `items_processed`, `items_failed` |
| `funders` | includes `portal_status` (flips to `dead` when a health check fails) |
| `funder_credentials` | one row per `(organization_id, funder_id)` — portal login `username` + AES-256-GCM `encrypted_password` (`CredentialManager`), `last_login_at`, `login_success` |

`submission_queue.status` and `autoapply_submissions.status` are plain `string` columns — there is no DB-level enum constraint, only application-level conventions (see §3).

---

## 2. Integrations (Gmail + Resend + CredentialManager — not Zoho)

There is no CRM sync step in this pipeline. The real integration points are:

### Gmail confirmation monitor
- Reads a dedicated inbox, `apply@benavora.com`, **read-only**, on a 5-minute interval, from inside the worker process.
- Requires one-time human OAuth consent as that mailbox to mint `GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN`; there is no code-only fix for token expiry (see §3).
- `confirmation-monitor.ts` detects OAuth failures (`invalid_grant`, `invalid_client`, `unauthorized_client`) via `isOAuthRefreshFailure()`, logs to `system_errors` with `severity='critical'`, and degrades the whole cycle to a no-op until the token is re-minted.

### Resend (email-submission channel)
- Used by `submitViaEmail()` when a funder record has no portal URL — the application is emailed directly to the funder instead of form-filled.
- Configured via `RESEND_API_KEY`.

### CredentialManager (portal-login credential store)
- `src/lib/autoapply/credential-manager.ts` — not an external service, but the storage layer that sits between the two integrations above and the `worker/queue-processor.ts` form-fill path.
- `storeCredentials()` AES-256-GCM encrypts a portal `password` (key derived from `CREDENTIAL_ENCRYPTION_KEY` via `scryptSync`) and upserts it into `funder_credentials`, keyed by `(organization_id, funder_id)`.
- `getCredentials()` decrypts and returns stored credentials; `updateLastLogin()` records `last_login_at`/`login_success` after each use.
- Two write paths populate it: (1) `worker/queue-processor.ts` stores credentials itself right after a portal's own account-registration flow completes, and (2) `confirmation-monitor.ts` stores credentials when the Claude extraction call finds a login/password inside a confirmation email (see §1 step 5).
- One read path consumes it: `worker/queue-processor.ts` calls `getCredentials()` before attempting a portal login on a later submission to the same funder; if none exist, the item is routed to `requires_account_setup` (see §3).

### Setting up or rotating these
1. **Gmail token refresh:** sign in to `apply@benavora.com`, run the OAuth consent flow the confirmation-monitor module expects, capture the resulting refresh token, and set `GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN` in the worker's environment (Railway) — not just Vercel, since the monitor runs inside the worker process. Restart the worker after rotating.
2. **Resend key rotation:** update `RESEND_API_KEY` in both Vercel (app-side email sends) and Railway (worker email-submission channel) if the key is shared, or scope separately if not. Confirm with a test send before relying on it.
3. **`CREDENTIAL_ENCRYPTION_KEY` rotation:** rotating this key without a re-encryption pass makes every existing `funder_credentials.encrypted_password` undecryptable (`decrypt()` will throw) — re-encrypt existing rows or force a fresh account-registration cycle before rotating in production.

If a genuine Zoho integration is later required (e.g., CRM sync of submitted applications, or Zoho-hosted email sending), it needs to be scoped from scratch — there is no partial implementation to extend.

---

## 3. Troubleshooting Common Failures

| Symptom | Cause | Where to look | Fix |
|---|---|---|---|
| Item stuck in `paused_verification` | CAPTCHA or verification-challenge text detected on the portal. CAPTCHA auto-solve was deliberately removed (product decision, human-in-the-loop only) — the worker unconditionally pauses rather than attempting to solve. | `submission_queue.pause_reason`, `paused_screenshot_path`, `paused_history` | Review the screenshot, resolve manually via the portal if needed, then call the resume/skip API (§4). |
| Item stuck in `requires_account_setup` | Portal requires a one-time human account creation before automation can proceed (e.g., some portals like Walmart Spark Good). | `submission_queue.status`, `pause_reason` | Create the account manually once, then resume the item. |
| Item `failed` with `captcha_failed` / `captcha_blocked` / `account_required` / `timeout` / `site_error` | Classified by `classifyError()` / `isIpBlock()` in the worker. | `submission_queue.error_message` | Match the classification to the right remediation — IP block may need proxy rotation (`worker/proxy-manager.ts`); timeout may just need a re-enqueue. |
| Item `skipped`, funder `portal_status='dead'` | `quickHealthCheck()` determined the portal is unreachable. | `funders.portal_status` | Verify the portal URL manually; if genuinely dead, leave it — the health check will keep skipping it. If it's back up, clear `portal_status` and re-enqueue. |
| Item routed to `pending_manual` with `automation_mode='manual'` | Risk assessment (`assessSubmissionRisk()`) recommended manual handling — writes `risk_score`, `risk_factors`, fires a `review_needed` webhook. | `submission_queue.risk_score`, `risk_factors` | Review the risk factors; either handle manually or override (§4) if the risk assessment is a false positive. |
| Confirmation-monitor cycle silently doing nothing | Gmail OAuth refresh token expired or revoked. | Worker logs, `system_errors` table (`severity='critical'`) | Re-mint the refresh token per §2. This is the single most common "why hasn't AutoApply confirmed anything in hours" cause. |
| Application submitted but never confirmed after 6h+ | Either the confirmation email genuinely hasn't arrived yet, or the confirmation monitor can't match it (portal domain / org name normalization mismatch), or the monitor itself is down (see above). | `autoapply_submissions.retry_count`, `next_retry_at` | The hourly retry sweep re-enqueues automatically up to 3 times; after that it's marked `failed`. Check the confirmation monitor is actually running before assuming the email never came. |
| Ordinary funder submissions instantly failing after a deploy | Historical bug: `automation_session_id` truthy-check regression. If a DB deployment is missing a migration that added a related column, the column can come back `undefined` instead of `null`, and a strict `!== null` check misrouted normal submissions into the Agent 16 browser-automation pipeline. Fixed in the current code (`worker/queue-processor.ts`) with a loose truthy check, but a schema drift could reintroduce a similar class of bug. | `submission_queue.automation_session_id` | If this pattern recurs, check for missing/unapplied migrations before assuming a logic bug. |
| Skipped/failed rows with no reason recorded | Historical bug: if `submission_queue.error_message` / `risk_score` / `risk_factors` columns are missing from the live schema, PostgREST rejects the entire UPDATE (not just the missing column), so the diagnostic write silently no-ops. Fixed via migration `125_submission_queue_error_visibility.sql`. | — | If diagnostics go blank again, check for schema drift (missing columns) before assuming the worker stopped writing errors. |
| Worker appears alive but nothing is processing | Two AutoApply pipelines (standard queue vs. Agent 16 browser automation) can hit a mutual-exclusion guard (`checkConcurrentAutomation()`) if they target the same org+funder. | `worker_status`, `submission_queue.status='processing'` age | Check for a stuck concurrent session on the same org+funder pair; if one side is dead, it should release, but a hard crash mid-session can leave a stale lock. |
| Root-cause-unclear pipeline stalls (~65–83s then skipped, zero downstream rows) | An unresolved historical incident (2026-08-06) whose leading hypothesis — unwrapped/untimed parallel Claude calls inside `FormAnalyzerAgent` — was never confirmed. | Worker logs around the stall window | If this recurs, add timing/logging around `FormAnalyzerAgent`'s Claude calls before assuming a new bug — this may be the same unresolved issue resurfacing. |

General diagnostic order: (1) check `worker_status.last_heartbeat_at` — is the worker even alive? (2) check the specific item's `submission_queue.status` and `error_message`/`pause_reason`. (3) check for schema drift (missing/unapplied migrations) before assuming application logic is wrong — this has been the root cause more than once. (4) check the Gmail confirmation monitor's OAuth health before assuming a confirmation is "missing."

---

## 4. Manual Override Procedures

- **Resume a paused item:** `PATCH /api/autoapply/review-queue/[id]/resume` — flips `paused_verification` back to `queued` via the Postgres RPC `resume_paused_submission_queue_item()`. Uses a conditional `UPDATE...RETURNING` so two reviewers can't double-resume (returns 409 `already_handled` on a race).
- **Skip an item:** `PATCH /api/autoapply/review-queue/[id]/skip` — same RPC pattern; requires a `reason` of `not_worth_it | portal_broken | duplicate | other`.
- **Reassign an item:** `PATCH /api/autoapply/review-queue/[id]/reassign` (present alongside resume/skip; same directory).
- **Pause/resume at platform, tenant, funder, or domain level:** `GET/POST/DELETE /api/autoapply/controls`, backed by `QueueControlPlane` (`src/lib/autoapply/queue-controls.ts`). Platform-level pause requires `admin` role; tenant/funder/domain-level requires `owner`.
- **Force a retry:** there is no dedicated "force retry now" endpoint. To force a retry, either resume a paused item (above) or manually re-insert a row into `submission_queue` referencing the same funder/org.
- **Manual DB intervention (last resort):** direct writes to `submission_queue`/`autoapply_submissions` should go through the RPCs above when possible so `paused_history` and audit fields stay correct. If a raw update is unavoidable, still append to `paused_history` rather than overwriting it, and record the reason in `error_message` or `pause_reason`.

---

## 5. Monitoring — Checking for Stuck Submissions

- **Primary dashboard:** `GET /api/admin/autoapply-ops` (admin-only), backing `src/app/(dashboard)/admin/autoapply-ops/AutoApplyOpsClient.tsx`. Surfaces worker status/heartbeat, queue depth, platform-paused flag, 24h/7d/30d success rates, failure breakdown, cost tracking, portal block-rate stats, anti-automation portal list, and top/flagged tenants.
- **Known monitoring gap:** this dashboard does not explicitly list "stuck" items by age. There is currently no dedicated cron sweeping `paused_verification` or `pending_manual` items for staleness — only `submitted`-status rows get the automatic 6h/hourly sweep in `submission-retry.ts`. **Items stuck in `paused_verification` or `pending_manual` sit indefinitely until a human resumes or skips them via §4** — don't assume the system will self-clear these.
- **Manual staleness check** (run against `submission_queue` until a proper sweep exists):
  - Rows with `status='paused_verification'` or `status='pending_manual'` where `paused_at` (or `started_at`) is older than a reasonable SLA (e.g., 24h) need human review.
  - Rows with `status='processing'` where `started_at` is old relative to typical submission duration (worker crash mid-item is the likely cause — check `worker_status.last_heartbeat_at` to confirm the worker is even alive).
- **Worker liveness:** `worker_status.last_heartbeat_at` — if this is stale, nothing is being processed regardless of queue state; check Railway deploy status before investigating individual items.
- **`poll_queue.mjs`** (repo root) is a minimal ad hoc debug script that hardcodes a single `submission_queue` row id and does a raw PostgREST GET — useful as a template for one-off manual lookups, not a monitoring tool.
- **Confirmation monitor health:** check worker logs / `system_errors` (`severity='critical'`) for OAuth refresh failures before concluding a batch of unconfirmed submissions reflects a real-world problem rather than the monitor being down.

---

## 6. Escalation Procedures

1. **Worker down / heartbeat stale** — check Railway deploy status for the `benavora-worker` service first (billing lapses have caused full outages before). If Railway shows healthy but heartbeat is stale, check for an unhandled exception crashing the process — `worker/index.ts` runs all loops in one process, so one uncaught error can take everything down.
2. **Confirmation monitor OAuth expired** — not code-fixable remotely; requires a human with access to `apply@benavora.com` to redo the OAuth consent flow and update `GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN` on Railway. Escalate to whoever holds that mailbox's credentials.
3. **Schema drift (missing columns/migrations)** — if diagnostics or routing bugs point to a column behaving inconsistently (undefined vs. null, or writes silently no-op'ing), check applied migrations against the codebase's migration files before treating it as an application bug. Escalate to whoever owns the migration pipeline to reconcile.
4. **Risk-gated items piling up in `pending_manual`** — if the volume is high enough to suggest the risk model itself is miscalibrated (not just individual flagged items), escalate to whoever owns `assessSubmissionRisk()` rather than clearing items one by one.
5. **Suspected IP block / anti-automation detection at scale** (many funders on one domain failing with `captcha_blocked` or `isIpBlock()` classifications) — escalate for proxy rotation (`worker/proxy-manager.ts`) review rather than retrying individual items, since retries against a blocked IP will keep failing.
6. **Unclear root cause after following §3's diagnostic order** — document what was checked (heartbeat, item status/error, migration state, confirmation-monitor health) and escalate with that context rather than re-running the same checks; the 2026-08-06 pipeline-stall incident was never fully root-caused and may recur in a form that needs deeper investigation (timing/logging around `FormAnalyzerAgent`'s Claude calls).

---

*Verified against live code as of 2026-09-03. `submission_queue`/`autoapply_submissions` status values are application-level conventions, not DB enums — treat exact status strings as subject to change and confirm against `worker/queue-processor.ts` if behavior here seems out of date.*
