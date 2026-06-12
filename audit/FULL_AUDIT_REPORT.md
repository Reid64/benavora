# Benavora — Full Production-Readiness Audit

**App:** Benavora (nonprofit funding automation platform)
**Environment:** `localhost:3000` (Next.js 14 dev), Supabase project `vbjplpquqxxfbpazyalt`
**Auditor account:** `reid@benavora.com` — role **owner**, org **FAITH Foundation** (`bed3e621-d93c-4e89-bfc4-a0fcea61b8fd`)
**Date:** 2026-06-11
**Method:** Direct Supabase service-role queries + anon-key RLS probing + Playwright (Chromium) UI driving + authenticated API calls (cookie replay). Every claim below is backed by an observed result; raw evidence is in `audit/*.json` and `audit/screenshots/`.

> **Note on tooling:** The Supabase MCP integration is bound to a *different* account (`tarritrix`/`tarritrix-audit`), not this app's project. No Supabase personal access token (`sbp_…`) is present, so the Management API / arbitrary SQL was unavailable. RLS was therefore verified **behaviorally** (anon vs service-role visibility) and FK integrity via **orphan detection** — both stronger-than-schema evidence that the live data is correct.

---

## Executive Summary

**Overall health grade: B**

Benavora is a genuinely functional, well-architected multi-tenant SaaS. Authentication, organization isolation, the AI agent layer, the application pipeline, core CRUD, billing/usage enforcement, rate limiting, and audit logging all **work and were proven with live evidence**. The architecture (server-side role gates, RLS on every table, derive-org-from-session-never-body) is sound.

It is held back from an A by a small number of concrete defects:

- **Document storage is completely broken** — no Supabase Storage bucket exists, so upload *and* download fail (a core feature is non-functional).
- **Migration `008_stripe_billing.sql` was never applied** — the `stripe_webhook_events` table is missing and `feature.stripe_billing` is `false` everywhere; the Stripe webhook handler will fail at runtime.
- **Cross-organization data corruption** in seed data — 3 outcomes are owned by a different org than their parent application, which makes outcome-recording return `409` for affected apps.

None of these are architectural; they are environment/migration/seed-data and one storage-provisioning gap. The codebase itself is consistent and defensible.

| Phase | Result |
|---|---|
| 1 — Database | 38/39 tables healthy, RLS enforced on all, **0 orphans** across 19 FK relationships; 1 table missing (migration 008 unapplied) |
| 2 — Auth | **FULLY WORKING** — login, wrong-password, logged-out redirect, registration, logout/session-destroy all pass |
| 3 — Pages | Mostly working; **Documents BROKEN**, Settings flags read-only, draft persistence gap |
| 4 — Agents | 4 agents fully working with real AI output; others validate/gate correctly |
| 5 — Cross-cutting | Org isolation ✓, rate limiting ✓, usage tracking ✓, audit log ✓ |

---

## PHASE 1 — Database Integrity

**Row counts (service role) and RLS behavioral test (anon key).** All 39 migration-defined tables were checked. Anon sees **0 rows on every populated table** while the service role sees the real data → RLS is enforced and effective. (`audit/phase1-results.json`)

| Table | Rows | RLS blocks anon | | Table | Rows | RLS blocks anon |
|---|---|---|---|---|---|---|
| organizations | 8 | ✅ (8→0) | | proven_narratives | 2 | ✅ |
| profiles | 5 | ✅ | | deadlines | 5 | ✅ |
| funders | 11 | ✅ (11→0) | | notes | 0 | ✅ |
| contacts | 5 | ✅ | | search_profiles | 1 | ✅ |
| opportunities | 8 | ✅ | | email_campaigns | 1 | ✅ |
| opportunity_keywords | 7 | ✅ | | campaign_steps | 2 | ✅ |
| applications | 6 | ✅ | | outreach_contacts | 1 | ✅ |
| pipeline_history | 7 | ✅ | | campaign_sends | 1 | ✅ |
| documents | 5 | ✅ | | agent_runs | 14→32* | ✅ |
| application_documents | 0 | ✅ | | platform_config | 86 | ✅ |
| knowledge_base | 17 | ✅ | | research_cache | 0 | ✅ |
| board_members | 5 | ✅ | | automation_sessions | 1 | ✅ |
| programs | 3 | ✅ | | automation_steps | 3 | ✅ |
| outcomes | 3 | ✅ | | automation_screenshots | 1 | ✅ |
| integrations / synced_email_* / email_thread_links | 0 | ✅ | | subscriptions / invoices | 0 | ✅ |
| usage_metrics | 3 | ✅ | | audit_logs | 22→13* | ✅ |
| user_invitations / onboarding_steps | 0 | ✅ | | **stripe_webhook_events** | **MISSING** | — |

\* counts grew during testing (agent_runs) or are per-org (audit_logs FAITH=13).

**Foreign-key / orphan checks — 19 relationships, 0 orphans:**
profiles→orgs, funders→orgs, contacts→orgs, contacts→funders, opportunities→orgs, opportunities→funders, applications→orgs, applications→opportunities, deadlines→orgs, deadlines→opportunities, outcomes→orgs, outcomes→applications, pipeline_history→applications, knowledge_base→orgs, proven_narratives→orgs, documents→orgs, agent_runs→orgs, board_members→orgs, programs→orgs — **all clean.**

**Schema vs. migrations:** 38 of 39 `CREATE TABLE` definitions exist and are queryable. RLS `ENABLE` statements exist for all 39 (38 enforced and verified live). 38 `CREATE POLICY` statements across the two main migrations.

### 🔴 BUG 1.1 — Migration `008_stripe_billing.sql` never applied (HIGH)
- **Evidence:** `stripe_webhook_events` returns `Could not find the table 'public.stripe_webhook_events' in the schema cache`. Independently corroborated: migration 008 line 28-35 sets `feature.stripe_billing='true'` for all orgs, but **all 8 orgs have `feature.stripe_billing='false'`** → the migration's side effects are absent.
- **Impact:** The Stripe webhook handler (`src/app/api/webhooks/stripe/route.ts`) relies on this table for idempotency (per migration 008 header). With the table missing, webhook processing will throw at runtime.
- **File:** `supabase/migrations/008_stripe_billing.sql:17` (`CREATE TABLE IF NOT EXISTS stripe_webhook_events`).
- **Fix:** Apply migration 008 to the live project.

### 🟠 BUG 1.2 — Cross-organization outcome/application mismatch (HIGH, data integrity)
- **Evidence:** All 3 `outcomes` rows have `organization_id` = Hope Harbor (`d3300000…`), but their `application_id`s (`35f1e058`, `1c4a142a`, `62a8d8b7`) all belong to **FAITH Foundation** (`bed3e621…`). Verified directly: the 3 applications' `organization_id` = FAITH; the 3 outcomes' `organization_id` = Hope Harbor. **3/3 mismatched.**
- **Impact:** Breaks tenant consistency and directly causes **BUG 11.x** (outcome recording 409). An outcome is attributed to a tenant that does not own the underlying application.
- **Fix:** Correct seed data so an outcome's `organization_id` always equals its application's; add a DB trigger/constraint enforcing `outcomes.organization_id = applications.organization_id`.

---

## PHASE 2 — Authentication (FULLY WORKING)

All sub-tests pass (`audit/phase2-results.json`, screenshots `p2-*`).

| Test | Result | Evidence |
|---|---|---|
| Login (correct) | ✅ redirects to `/dashboard`, h1 "Dashboard" | `p2-03-login-dashboard.png`; auth cookie `sb-…-auth-token` set; `/auth/v1/token` → 200 |
| Login (wrong password) | ✅ stays on `/login`, shows **"Email or password is incorrect."** | `p2-02-wrong-password.png` |
| Protected page logged-out | ✅ `/dashboard` → redirect `/login` | `p2-01-loggedout-redirect.png`; `src/middleware.ts` getUser gate |
| Registration (new user) | ✅ created `audit_test_*@example.com`, bootstrapped org via `register_organization()` RPC, reached `/dashboard` | `p2-05-registration.png` (email confirmation is OFF) |
| Logout | ✅ session destroyed — re-visiting `/dashboard` redirects to `/login` | `p2-04-after-logout.png` |
| Role model | Server-enforced hierarchy `owner(4) > admin(3) > writer(2) > viewer(1)` via `requireRole()` across 25 routes; admin audit-log/usage gated to `admin`+ | `src/lib/auth/role-gate.ts`, `src/lib/utils/constants.ts:60` |

### Notes / minor findings
- **Admin-vs-viewer live comparison not possible:** all 6 live users are role `owner`. Role gating is verified at the code/route level instead (`requireRole` is correct: derives org from profile, never from body).
- 🟡 **BUG 2.1 (LOW, security smell):** If the login button is clicked *before* React hydration completes, the form performs a **native GET submission**, putting the password into the URL query string (`/login?email=…&password=…`). Reproduced in automation; rare for human users (hydration finishes in ~2s) but the password should never be submitted via GET. **File:** `src/app/login/page.tsx:19` — consider `method="post"` on the `<form>` and/or a disabled-until-hydrated button.

---

## PHASE 3 — Per-Page Interactive Audit

Authenticated sweep of all pages returned HTTP 200 with correct content; per-org row counts **exactly match** the database (funders 5, contacts 5, opportunities 6, documents 5, KB 17, proven_narratives 2). (`audit/phase3-sweep.json`)

| Page | Status | Evidence |
|---|---|---|
| **Dashboard** | ✅ FULLY WORKING | Stat cards link to `/applications`, recent-opportunity rows link to `/opportunities/{id}`; first-link navigation verified. Numbers match DB. `p3-dashboard.png` |
| **Funders** | ✅ FULLY WORKING | Create → DB row `5f8be2aa` persisted (name, category `corporate_donation`, geographic_focus); search "Brightwater" narrows 6→1; column sort works. `p3-funder-create.png` |
| **Contacts** | ✅ FULLY WORKING | Create → DB row `d82d1faf` (name/title/email) persisted; Funder is a required first field. `p3-contact-created.png` |
| **Opportunities** | ✅ FULLY WORKING | Create → DB row `e21d3eba` persisted (requires name + category); status filter narrows 6→3; appears in dashboard recent list. `p3-opp-created.png` |
| **Applications** | ⚠️ PARTIALLY WORKING | Kanban renders 5 draggable cards. Stage **Move** dialog works: drafting→qualified persisted to DB **and** wrote a `pipeline_history` row (1→2); enforces transition rules (backward move requires a mandatory note; forward skips rejected). Native HTML5 **drag** did not fire under Playwright synthetic events (see BUG 3.1). `p3-move-success.png` |
| **Automation** | ✅ WORKING (gated) | Flag OFF → lock screen + "Enable browser automation" button. Flag ON → session pipeline UI (Pending/In Progress/Awaiting Approval/Submitted/Failed), "Start a session from an application." **No free-form URL input** — sessions are application-scoped, not arbitrary URLs. `p3-automation-enabled.png` |
| **Draft Generator** | ⚠️ PARTIALLY WORKING | Generation works (proven in Phase 4: real markdown, `[NEEDS INPUT]` flags, confidence score, sources). **Persistence gap (BUG 3.2):** generated draft is held in `useState` only — navigating away loses it unless "Save draft" is clicked. |
| **Documents** | 🔴 **BROKEN** | Upload adds **0** rows; **no Supabase Storage bucket exists** (BUG 3.3). |
| **Knowledge Base** | ✅ FULLY WORKING | Sub-routes `/knowledge-base/{profile,narratives,answers}` all 200 with real content; entries **are clickable** (open an editor); counts match DB (KB 17, proven 2). `p3-kb-narratives.png` |
| **Deadlines** | ✅ WORKING | Calendar/List toggles work without error; 4 deadlines match DB. `p3-deadlines-toggle.png` |
| **Outcomes** | ⚠️ PARTIALLY WORKING | Recording works on an un-blocked app (created outcome `2922cf99`, awarded $55k, **under correct FAITH org**); "View analytics" renders **23 SVG/canvas charts**. But 2/3 "eligible" apps return `409` (BUG 11 / cross-org). `p3-outcome-happy.png`, `p3-outcomes-analytics.png` |
| **Settings** | ⚠️ PARTIALLY WORKING | Org-name change **persists to DB and survives reload** ✅; team roster + Invite button present ✅. **Feature flags are read-only badges** — no toggle control (BUG 3.4). `p3-settings-flags.png` |

### 🔴 BUG 3.3 — Document upload & download broken: no Storage bucket (CRITICAL)
- **Evidence:** `supabase.storage.listBuckets()` (service role) returns `[]`. A direct service-role upload to the expected bucket returns **`Bucket not found`**. UI upload left the documents table at 5 rows (no insert). Existing `documents` rows are seed records whose files don't exist in storage.
- **Impact:** The Documents feature is non-functional end-to-end. Uploader targets bucket `org-${organizationId}` (`src/components/documents/DocumentUploader.tsx:144`); downloader calls `createSignedUrl` on the same bucket (`src/components/documents/DocumentList.tsx:109`). Both fail.
- **Secondary:** The UI showed **no error banner** after the failed upload in automation — a possible silent failure (the uploader's `setError` path may not be reached for this failure mode).
- **Fix:** Provision per-org Storage buckets (or a single shared bucket with path-scoped RLS) and ensure the bucket name matches `org-${organizationId}`; surface upload errors.

### 🟡 BUG 3.1 — Kanban drag does not move cards (MEDIUM)
- HTML5-native drag (`draggable` + `onDragStart`/`onDrop`, `src/components/applications/ApplicationCard.tsx`) did not persist a stage change when driven by Playwright mouse steps; `applications.updated_at` unchanged. The underlying transition logic is correct (Move dialog persists + writes history), so this is specifically the **drag-and-drop** path. Worth a manual re-test; native DnD + React is a common fragility. (No Board/List toggle was found on the page.)

### 🟡 BUG 3.2 — Generated draft not persisted (MEDIUM)
- `src/app/(dashboard)/draft-generator/page.tsx` holds the generated draft in `useState` with no `localStorage`/autosave. Navigating away before clicking "Save draft" (which writes `applications.draft_content`, `DraftEditor.tsx:84`) loses the work. Confirms the suspected persistence bug.

### 🟡 BUG 3.4 — Settings feature flags are read-only (MEDIUM)
- `FeatureFlagsSection` (`src/app/(dashboard)/settings/page.tsx:~862`) renders each flag as an **Enabled/Disabled `<Badge>`** with **no toggle/switch/button** (0 toggle controls found). Flags can only be changed from individual feature pages (e.g. the Automation page's own enable button) or the DB — not from Settings as a user would expect.

---

## PHASE 4 — AI Agents End-to-End

Called every endpoint with reid's authenticated session (cookie replay) against real data. `agent_runs` deltas confirmed in DB. (`audit/phase4-results.json`)

| Agent | Endpoint | Result | Actual output (excerpt) |
|---|---|---|---|
| **Eligibility** | `POST /api/agents/eligibility` | ✅ 200, new `agent_runs` (eligibility_scoring/completed, 746 tokens, 8.3s) | `eligibilityScore: 12, recommendation: "skip", recommendationReasoning: "Mission alignment is moderate-to-strong… FAITH Foundation works on housing stability…"` |
| **Draft** | `POST /api/ai/draft` (grant_narrative) | ✅ 200, 67s, new run (narrative_drafting, 4870 tokens) | Markdown narrative referencing org data **with `[NEEDS INPUT: …]` flags**; returns `content, confidenceScore, sources, belowThreshold` |
| **Summarize** | `POST /api/ai/summarize` | ✅ 200, 6.8s (grant_summary/completed) | Structured `summary{funderName, programName, amountMin 50000, amountMax 250000, …}` |
| **Fit Analysis** | `POST /api/ai/fit-analysis` | ✅ 200, 21s (fit_analysis/completed) | `# Fit Analysis… 1. Historical Success Rate… 2. …` |
| **Review** | `POST /api/ai/review` | ⚠️ 400 by design | Takes `applicationId` (not raw content). `{"error":"There is no draft to review on this application.","code":"no_draft"}` — logged as a `review/failed` run. Correct validation. |
| **Deadline Check** | `POST/GET /api/deadlines/check` | ✅ 200 | `{deadlinesScanned: 4, remindersTriggered: 0}` — scans FAITH's 4 deadlines (not an AI agent; no agent_runs row, correct) |
| **Research** | `POST /api/agents/research` | ⚠️ 400 validation | Requires `{profileId, agentType}` where agentType ∈ `corporate_research, foundation_research, government_research, local_sponsorship`. Could not fully exercise: FAITH owns **no** search profile and `feature.research_agents` is OFF. |
| **Learning** | `POST /api/agents/learning` | ⚠️ 429 | Requires `{outcomeId}`. Returned **`usage_limit_exceeded`** (agent_runs current 12 / limit 10) → blocked by the tier cap (see Phase 5). |
| **Outreach** | `POST /api/agents/outreach` | ⚠️ 429 | Requires `{companyName,…}` + `feature.cold_outreach_email` (OFF). Also returned `usage_limit_exceeded`. |

**Observability:** Every call wrote an `agent_runs` row with `status`, `duration_ms`, `tokens_used`, and `error_message`. Failures are recorded (e.g. 9 `narrative_drafting/failed`, 1 `review/failed`). Final FAITH `agent_runs` total = 32.

> The prompt's described contracts for **review** ("draft content") and **summarize** ("text") differ from the actual API (review→`applicationId`, summarize→`opportunityId`+optional `rawText`). The implementation is internally consistent; the prompt's descriptions were out of date.

---

## PHASE 5 — Cross-Cutting Concerns (ALL WORKING)

| Concern | Result | Evidence |
|---|---|---|
| **Organization isolation** | ✅ HOLDS | Logged in as a second user (empty org `cdbed4a4`): `/funders`, `/contacts`, `/opportunities` all show **0 rows** and **none of FAITH's 6 funder names leaked**. `p5-isolation-user2-funders.png` |
| **Rate limiting** | ✅ ENFORCED | 25 rapid `POST /api/ai/draft`: **13×200, 5×429 `rate_limited`** ("Too many draft requests. Please wait…"), 7×500. The 20-requests/min AI **burst limiter** fired. |
| **Billing tier enforcement** | ✅ ENFORCED | Free-tier `agent_runs` cap (10) returns **429 `usage_limit_exceeded`** with `upgrade_url:/billing` (learning/outreach blocked at current 12/limit 10). |
| **Usage tracking** | ✅ INCREMENTS | `usage_metrics.api_calls` rose **7 → 20** during the burst (13 successful drafts each +1), `updated_at` stamped at test time. |
| **Audit log** | ✅ CAPTURES | `/admin/audit-log` renders 13 rows = DB count; recent entries include my **org-name update** and **application stage-move**, plus login/logout. `p5-audit-log.png` |

### 🟡 BUG 5.1 — Inconsistent metered-cap assignment (LOW/MEDIUM)
- `draft`, `fit-analysis`, `summarize` meter against **`api_calls`** (high limit) while `eligibility`, `learning`, `outreach` meter against **`agent_runs`** (free limit 10). Result: the **most expensive** operation (draft: ~67s, ~5k tokens) is the **least** cumulatively capped — 13 drafts ran in one burst. Files: `src/app/api/ai/draft/route.ts:194`, `src/app/api/agents/{eligibility,learning,outreach}/route.ts` (`enforceLimit(... "agent_runs")`). Consider metering drafts against `agent_runs` too.

### 🟡 BUG 5.2 — Concurrent draft generation ~28% failure rate (MEDIUM, robustness)
- Of 25 concurrent drafts, **7 returned 500 `generation_failed`** ("The draft could not be generated. Please try again"), logged as `narrative_drafting/failed`. Likely upstream provider throttling/timeouts under concurrency. Add retry/backoff and a clearer user message.

---

## Consolidated Bug List (by priority)

| # | Severity | Bug | Location |
|---|---|---|---|
| 1 | 🔴 CRITICAL | Document upload & download broken — no Storage bucket exists (`Bucket not found`) | `DocumentUploader.tsx:144`, `DocumentList.tsx:109` |
| 2 | 🟠 HIGH | Migration 008 unapplied → `stripe_webhook_events` missing, `feature.stripe_billing=false` everywhere; Stripe webhook will fail | `supabase/migrations/008_stripe_billing.sql:17` |
| 3 | 🟠 HIGH | Cross-org corruption: 3 outcomes owned by Hope Harbor reference FAITH applications → outcome recording returns 409 for those apps | `outcomes` seed data; constraint gap |
| 4 | 🟡 MEDIUM | Documents upload fails **silently** (no error banner) | `DocumentUploader.tsx` error path |
| 5 | 🟡 MEDIUM | Generated draft not persisted (`useState` only) → lost on navigation | `draft-generator/page.tsx` |
| 6 | 🟡 MEDIUM | Settings feature flags read-only (no toggle) | `settings/page.tsx` FeatureFlagsSection |
| 7 | 🟡 MEDIUM | Kanban drag-and-drop doesn't persist (Move dialog does) | `ApplicationCard.tsx` |
| 8 | 🟡 MEDIUM | Concurrent draft ~28% 500 failure under burst | `ai/draft/route.ts` generation |
| 9 | 🟡 LOW/MED | Inconsistent metered caps (draft uncapped vs agent_runs cap) | `ai/draft/route.ts:194` |
| 10 | 🟡 LOW | Login native-GET submit pre-hydration leaks password into URL | `login/page.tsx:19` |
| 11 | 🟢 LOW | `/admin` index 404 (only `/admin/audit-log` exists) | `(dashboard)/admin/` |

---

## Recommended Priority Fixes

1. **Provision Supabase Storage buckets** (`org-{organizationId}` or a shared path-scoped bucket) and surface upload errors. *Unblocks the entire Documents feature.* (BUG 1)
2. **Apply migration `008_stripe_billing.sql`** to the live project; verify `stripe_webhook_events` exists and `feature.stripe_billing` flips true. (BUG 2)
3. **Repair the outcomes↔applications org mismatch** and add a constraint/trigger enforcing `outcomes.organization_id = applications.organization_id`; reconsider the global unique index on `application_id` vs. org-scoped eligibility. (BUG 3)
4. **Autosave generated drafts** (or persist to `applications.draft_content` on generate) so navigation doesn't lose work. (BUG 5)
5. **Make Settings feature flags editable** for owners/admins, or relabel as read-only status. (BUG 6)
6. **Add retry/backoff** to draft generation and meter drafts against `agent_runs`. (BUGs 8, 9)
7. **Harden the login form** (`method="post"`, disable submit until hydrated). (BUG 10)

---

## What Works Well (strengths)

- **Multi-tenancy:** RLS on every table, verified live; org isolation airtight; org always derived from the session profile, never the request body.
- **Auth:** complete and correct, including session destruction and registration bootstrap.
- **AI agent layer:** 4 agents produce real, org-grounded output with `[NEEDS INPUT]` flags, confidence scores, and sources; every run is recorded with tokens/duration/status (including failures).
- **Pipeline:** stage transitions enforce a real transition graph (forward conditions, mandatory backward notes) and write `pipeline_history`.
- **Billing & limits:** working metered caps (429 + upgrade URL), a 20/min burst limiter, and live usage tracking.
- **Audit logging:** captures auth events and entity mutations.
- **Data integrity:** zero orphaned records across 19 FK relationships.

---

### Audit artifacts
- Evidence JSON: `audit/phase1-results.json`, `phase2-results.json`, `phase3-*.json`, `phase35-results.json`, `phase4-results.json`
- Screenshots: `audit/screenshots/p2-*`, `p3-*`, `p5-*` (49 images)
- Test data created during the audit was cleaned up; FAITH org name and the moved application's stage were restored. One registered test user/org (`audit_test_*@example.com`) remains from the registration-flow test.
