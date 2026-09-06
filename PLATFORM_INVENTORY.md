# PLATFORM_INVENTORY.md — Benavora Full Platform Inventory

Generated 2026-09-04. Phase 0 of the test-campaign scoping effort requested by Reid. This is a literal, file-by-file inventory — every dashboard page, every marketing/auth page, every settings sub-tab, every API route, and every modal/dialog component — built by reading actual source files (not inferred from docs, nav configs, or memory). Nothing here is estimated; where something is a stub, a redirect, or dead code, it is called out explicitly.

**Scope counts (verified via `find`/`grep` before any file was read):**
- Dashboard pages (`src/app/(dashboard)/**/page.tsx`): **139**
- Marketing pages (`src/app/(marketing)/**/page.tsx`): **8** (one is an MDX catch-all serving 19 further content pages)
- Top-level auth pages (`src/app/{login,register,forgot-password,reset-password}/page.tsx`): **4**
- API route handlers (`src/app/api/**/route.ts`): **341** files (many with multiple HTTP methods)
- Settings sub-tab files (`src/app/(dashboard)/settings/**`): **12** (10 real routed pages + layout.tsx + settings/page.tsx itself)
- Modal/dialog component matches (`grep -rl "Dialog|Modal"`): **52** files, expanded below to ~70 distinct modal/dialog surfaces (many files contain more than one)

**How this was built:** 21 parallel research passes, each given an explicit file list and instructed to read every file in full (following thin-wrapper pages into their real client component) and report interactive elements, literal `/api/...` calls, and modal triggers verbatim — no guessing. This document assembles those 21 reports without summarizing them away. A handful of pages use only direct Supabase client calls (`supabase.from(...)`) rather than a `/api/...` fetch — those are noted per-page as "none via fetch" so it's clear the page isn't API-less, it just doesn't route through Next's API layer.

---

## Table of Contents

1. [Dashboard Pages — Admin, Applications, Activity, Alerts](#part-1a)
2. [Dashboard Pages — AutoApply (17 pages)](#part-1b)
3. [Dashboard Pages — Billing, Board, Command Center, Compliance, Contacts, Dashboard, Deadlines, Documents, Donor Discovery (start)](#part-1c)
4. [Dashboard Pages — Donor Discovery (rest), Draft Generator, Email (start)](#part-1d)
5. [Dashboard Pages — Email (rest), Financials, Follow-ups, Foundations, Funders, Google Nonprofit, Import, Intelligence (start)](#part-1e)
6. [Dashboard Pages — Intelligence (core + PIL)](#part-1f)
7. [Dashboard Pages — Intelligence (rest), Knowledge Base, Marketplace, Nonprofits, Notifications, Onboarding](#part-1g)
8. [Dashboard Pages — Opportunities, Outcomes, Outreach, Reports (start)](#part-1h)
9. [Dashboard Pages — Reports (rest), Research, SchoolFunder, Search Profiles](#part-1i)
10. [Settings Sub-Tabs — Full Audit (incl. the 19-name stakeholder check)](#part-2)
11. [Marketing & Auth Pages](#part-3)
12. [API Routes — 9 batches, 341 handlers](#part-4)
13. [Modal / Dialog Inventory](#part-5)
14. [Cross-Cutting Findings](#part-6)

---

<a id="part-1a"></a>
## PART 1A — Dashboard Pages: Admin, Applications, Activity, Alerts

### /activity
- File: `src/app/(dashboard)/activity/page.tsx`
- Purpose: Organization activity feed — agent runs, drafts, discovered opportunities, and alerts, distinct from the owner/admin-only `/admin/audit-log`. Polls every 30s.
- Interactive elements: Activity list items are clickable links (`<Link href={item.href}>`) when `item.href` is present — no other buttons, dropdowns, tabs, or forms.
- API calls: `fetch("/api/activity")` (GET, implicit)
- Modals opened: none found
- Status: built

### /admin/audit-log
- File: `src/app/(dashboard)/admin/audit-log/page.tsx` (server wrapper) + `AuditLogClient.tsx` (client)
- Purpose: Owner/admin audit trail viewer with filtering and CSV export (BLUEPRINT §3.3 / Behavioral Contracts §24).
- Interactive elements: Button "Export CSV" (only when `canView && entries.length > 0`); Select "Organization" (owner-view only); Select "Action"; Select "User"; Select "Entity"; Input "From" (date); Input "To" (date); sortable columns (Timestamp, Organization, User, Action, Entity, Details)
- API calls: `GET /api/admin/audit-log`
- Modals opened: none found
- Status: built

### /admin/autoapply-ops
- File: `src/app/(dashboard)/admin/autoapply-ops/page.tsx` → `AutoApplyOpsLoader.tsx` (dynamic ssr:false) → `AutoApplyOpsClient.tsx`
- Purpose: Platform-wide AutoApply operational health dashboard.
- Interactive elements: Button "Refresh"; Button "Manage" (shown only if `data.platformPaused`, navigates to `/autoapply/controls`); per-portal `ExternalLink` icon buttons ("Open {name} portal")
- API calls: `GET /api/admin/autoapply-ops`
- Modals opened: none found
- Status: built

### /admin/improvements
- File: `src/app/(dashboard)/admin/improvements/page.tsx` + `ImprovementsClient.tsx`
- Purpose: AG-38 Self-Improvement Agent review UI.
- Interactive elements: Status filter pills "All"/"Awaiting Review"/"Approved"/"Rejected"/"Implemented"; per-proposal "Approve"/"Reject" buttons (only for `status === "proposed"`)
- API calls: `GET /api/admin/improvements[?status=...]`; `PATCH /api/admin/improvements/{id}`
- Modals opened: none found
- Status: built

### /admin/monitor
- File: `src/app/(dashboard)/admin/monitor/page.tsx` + `MonitorClient.tsx`
- Purpose: Live automation-queue health monitor across all tenants, auto-refreshes 30s.
- Interactive elements: Button "Refresh"; per-row "Retry" (only for `status === "failed"`)
- API calls: `GET /api/admin/monitor`; `POST /api/admin/jobs/{id}/retry`
- Modals opened: none found
- Status: built

### /admin/orgs/:id
- File: `src/app/(dashboard)/admin/orgs/[id]/page.tsx` (server, direct service-role reads) + `OrgDetailTabs.tsx`
- Purpose: Cross-tenant single-org admin detail (owner-only) — users, opportunities, applications, billing, agent activity, intelligence, danger zone.
- Interactive elements: Tabs "Users (n)"/"Opportunities (n)"/"Applications (n)"/"Billing"/"Agent Activity (n)"/"Intelligence (n)"; Button "Run Pipeline for Org"; Button "Reset Onboarding" (`window.confirm`); Button "Upgrade Plan"; Button "Suspend Organization" (`window.confirm`)
- API calls: `POST /api/admin/orgs/{orgId}` (body `{action}`); `POST /api/admin/orgs/{orgId}/suspend`
- Modals opened: none found (uses native `window.confirm`)
- Status: built

### /admin/orgs
- File: `src/app/(dashboard)/admin/orgs/page.tsx` (server) + `OrgsListClient.tsx`
- Purpose: Cross-tenant org list — search/filter, impersonate.
- Interactive elements: Text input "Search by org name..."; Select plan filter; Select status filter; Select onboarding filter; per-row "Impersonate" button
- API calls: `POST /api/admin/orgs/{orgId}/impersonate`
- Modals opened: none found
- Status: built

### /admin
- File: `src/app/(dashboard)/admin/page.tsx`
- Purpose: Platform admin dashboard — cross-tenant stat cards + Organizations table + Recent Signups table (all server-side service-role Supabase queries).
- Interactive elements: Organization name links only — no buttons/dropdowns/tabs/forms.
- API calls: none found (server-side Supabase queries, no `/api/...` fetch)
- Modals opened: none found
- Status: built

### /admin/sales-outreach
- File: `src/app/(dashboard)/admin/sales-outreach/page.tsx` + `SalesOutreachClient.tsx`
- Purpose: Sales outreach admin console — campaigns, sending domains, prospects, suppression list, analytics.
- Interactive elements: Button "Refresh"; Tabs "Campaigns"/"Domains"/"Prospects"/"Suppression List"/"Analytics"; Campaigns: Button "New Campaign" + modal (Campaign Name, Description, Prospect List ID, domain checkboxes, Daily Send Target, Window Start/End, Timezone, Subject Template, Body Template, Cancel/Create Campaign); Domains: Button "Add Domain" + modal (Domain, Resend API Key, Cancel/Add Domain); Prospects: Button "Suppress {n} selected", Button "Import CSV" (hidden file input), per-row checkbox/Suppress button, search input, Import modal (List Name, Close/Import); Suppression List: Button "Import List", Button "Add Email", search input, Add modal (Email, Reason, Cancel/Add Email); Analytics: no controls
- API calls: `GET/POST /api/admin/campaigns`; `GET/POST /api/admin/domains`; `GET/POST /api/admin/prospects`; `PATCH /api/admin/prospects/{id}`; `GET/POST /api/admin/suppression`; `POST /api/admin/suppression/import`; `GET /api/admin/sales-analytics[?period=]`; `GET /api/admin/prospects/stats`
- Modals opened: "New Campaign", "Add Sending Domain", "Import Prospects", "Add to Suppression List" (all `Modal`)
- Status: built

### /admin/system
- File: `src/app/(dashboard)/admin/system/page.tsx` + `SystemClient.tsx`
- Purpose: Platform-wide infra/system health — Supabase connectivity, active agent runs, error counts, queue depths, Railway worker heartbeats. Auto-refreshes 10s.
- Interactive elements: Button "Refresh"; Button "Clear Stuck Jobs" (owner-only, `window.confirm`)
- API calls: `GET /api/admin/system`; `POST /api/admin/system` (`{action:"clear_stuck_jobs"}`)
- Modals opened: none found (native `window.confirm`)
- Status: built

### /alerts
- File: `src/app/(dashboard)/alerts/page.tsx`
- Purpose: Org action list — deadline alerts, new opportunities, submission results, email responses, document alerts, system notices, grouped/collapsible with filters.
- Interactive elements: Button "Mark all read"; filter pills "All"/"Unread"/"Urgent"/"Snoozed"; category collapse/expand toggles (6 categories); per-alert "Mark as read", "Snooze" (dropdown: 1 hour/Tomorrow/3 days/1 week), "Dismiss"
- API calls: `fetch("/api/alerts")` GET (via `useAlerts` hook); dismiss/snooze/mark-read done via direct Supabase `.update()` on `alerts`
- Modals opened: none found (inline dropdown, not a Dialog component)
- Status: built

### /applications/:id
- File: `src/app/(dashboard)/applications/[id]/page.tsx` (wrapper) → `ApplicationDetail.tsx`
- Purpose: Tabbed application detail — Overview, Timeline, Notes, Proposal Package, Assembly; stage-move/automation/cloning actions.
- Interactive elements: Link "Back to applications"; Tabs "Overview"/"Timeline (n)"/"Notes (n)"/"Proposal Package"/"Assembly"; Button "Generate Follow-up Email" (only if stage === follow_up_due); Button "Start Automation"; Button "Clone Application"; Button "Move application"; Button "Delete"; Notes form (Textarea + "Add note"); delete-confirm modal; clone modal (Select target opportunity)
- API calls: `POST /api/agents/automation`; `POST /api/agents/follow-up`; `POST /api/agents/application-cloner` (rest via direct Supabase calls)
- Modals opened: `StageTransitionModal`, delete-confirm `Modal`, clone `Modal`
- Status: built

### /applications/list
- File: `src/app/(dashboard)/applications/list/page.tsx`
- Purpose: Sortable table alternative to the kanban pipeline view.
- Interactive elements: `SearchBar`; Select "Filter by stage"; `ApplicationsViewToggle`; sortable columns (Opportunity, Stage, Requested, Deadline, Days in stage, Updated); clickable rows
- API calls: none found (`loadPipelineApplications` uses Supabase client directly)
- Modals opened: none found
- Status: built

### /applications/new
- File: `src/app/(dashboard)/applications/new/page.tsx`
- Purpose: Create an application for a given opportunity.
- Interactive elements: Link "Back to opportunities"; Button "Browse opportunities" (empty state); Button "Open existing application" (if exists); Button "Create application"
- API calls: none found (direct Supabase calls)
- Modals opened: none found
- Status: built

### /applications
- File: `src/app/(dashboard)/applications/page.tsx`
- Purpose: Pipeline overview — 5-family stage tabs collapsing the 12-value `pipeline_stage` enum, clone-to-new-opportunity flow, chatbot.
- Interactive elements: Link "Renewals"; family filter tabs "All"/"Discovery"/"Drafting"/"Submitted"/"Awarded"/"Denied"; per-row clone icon button; Button "Browse opportunities" (empty state); clone modal (Select target opportunity); `ChatbotAssistant`
- API calls: `POST /api/applications/{cloneSource.id}/clone`
- Modals opened: "Clone application" `Modal`
- Status: built

---

<a id="part-1b"></a>
## PART 1B — Dashboard Pages: AutoApply (17 pages)

### /autoapply/:sessionId
- File: `src/app/(dashboard)/autoapply/[sessionId]/page.tsx`
- Purpose: Automation session detail — step timeline, screenshots, editable form-field report, human approval workflow gating submission.
- Interactive elements: Button "Back to AutoApply"; Button "Re-run" (if editable + application_id); Button "Reject & Cancel" (toggles reject form: Textarea reason, "Confirm rejection", "Cancel"); Button "Resume After Manual Completion" (paused-for-challenge); Button "Cancel Session"; `ApprovalWorkflow` approve action (owner/admin only); editable field inputs + implicit Save; external link to target_url
- API calls: `GET /api/agents/automation/{sessionId}` (polled 4s); `PUT .../{sessionId}` (`update_fields`, `reject`); `POST .../{sessionId}/approve`; `POST /api/agents/automation` (`{applicationId}` resume/rerun)
- Modals opened: none found (inline sections, not Dialog components)
- Status: built

### /autoapply/agreements
- File: `src/app/(dashboard)/autoapply/agreements/page.tsx`
- Purpose: Track post-award grant agreements, reporting obligations, payment schedules.
- Interactive elements: Button "Log Agreement" (opens modal); expandable rows (Terms/Reporting/Payment Schedule/Notes); modal fields: Select Funder, Amount Awarded, Select Award Type, Agreement/Start/End Date, Select Status, Textarea Terms, Next Report Due, Select Reporting Frequency, Textarea Notes, Linked Submission ID; footer Cancel/Save Agreement
- API calls: `GET/POST /api/autoapply/agreements`
- Modals opened: `Modal` "Log Agreement"
- Status: built

### /autoapply/analytics
- File: `src/app/(dashboard)/autoapply/analytics/page.tsx` → `AnalyticsPageClient.tsx` (dynamic, ssr:false)
- Purpose: Submission performance, conversion, ROI tracking.
- Interactive elements: "Filtered: {category}" clear chip; clickable pie-chart slices (category filter); Link "Configure Tests" (→ `/autoapply/settings`)
- API calls: none via fetch — direct Supabase (`autoapply_submissions`, `submission_queue`)
- Modals opened: none found
- Status: built

### /autoapply/automation-settings
- File: `src/app/(dashboard)/autoapply/automation-settings/page.tsx`
- Purpose: Per-funder automation level (Full Auto/Assisted/Manual Only).
- Interactive elements: filter pills "All"/"Full Auto"/"Assisted"/"Manual Only"/"Not Set"; header select-all checkbox + per-row checkbox; bulk bar "Set Assisted"/"Set Manual Only"/"Set Full Auto"/"Clear"; per-row Select "Override Level"; external "Portal" link
- API calls: none via fetch — direct Supabase (`funders`, `form_templates`)
- Modals opened: none found
- Status: built

### /autoapply/compliance
- File: `src/app/(dashboard)/autoapply/compliance/page.tsx`
- Purpose: US state charitable-solicitation registrations gating AutoApply, plus static state-requirement reference.
- Interactive elements: Button "Back to AutoApply Settings"; Button "Add Registration" (inline form: Select State, Registration #, Registered On/Expires On dates, Cancel/Save); per-row remove icon; reference Select "State" (shows fee/renewal/exemption + "Register Now" link)
- API calls: none via fetch — direct Supabase (`solicitation_registrations`, `profiles`)
- Modals opened: none found (inline form)
- Status: built

### /autoapply/controls
- File: `src/app/(dashboard)/autoapply/controls/page.tsx`
- Purpose: "Queue Control Plane" — pause/resume at platform/org/funder/domain level; embeds `AutonomousModePanel`.
- Interactive elements: Button "Pause All Submissions" (inline kill-switch: Textarea reason, Confirm/Cancel); Button "Resume Platform"; Active Pauses table per-row "Resume"; "Pause Organization" card (Select org, Input reason, button); "Pause Funder" card (autocomplete search, Input reason, button); "Pause Domain" card (Input domain, Input reason, button)
- API calls: `GET/POST/DELETE /api/autoapply/controls`
- Modals opened: none found (inline kill-switch)
- Status: built

### /autoapply/documents
- File: `src/app/(dashboard)/autoapply/documents/page.tsx`
- Purpose: "Document Vault" for AutoApply submissions, with readiness score.
- Interactive elements: Button "Upload New Document" (custom modal); per document-type card "Upload"/"Replace" (hidden file input), "History" (toggle); custom modal: Input Document Name, file picker, Cancel/Upload
- API calls: `GET /api/autoapply/documents`; `GET /api/autoapply/documents/readiness`; `POST /api/autoapply/documents` (multipart)
- Modals opened: inline custom modal "Upload Custom Document" (not the shared `Modal`)
- Status: built

### /autoapply/follow-ups
- File: `src/app/(dashboard)/autoapply/follow-ups/page.tsx`
- Purpose: Manage post-submission follow-up sequences.
- Interactive elements: Button "Refresh"; "Due in Next 7 Days" per-item "Send Now"; filter Select status; From/To date inputs; "Clear"; expandable rows; expanded actions "Send Now"/"Reschedule" (inline date+Save)/"Cancel This"/"Cancel All for Funder"; cancel modal (Textarea reason, Keep/Cancel)
- API calls: `GET /api/autoapply/follow-ups[?status,from,to]`; `GET /api/autoapply/follow-ups/stats`; `PATCH /api/autoapply/follow-ups/{id}`; `PATCH /api/autoapply/follow-ups/cancel-all/{funderId}`
- Modals opened: custom `CancelModal` (not shared `Modal`)
- Status: built

### /autoapply (root)
- File: `src/app/(dashboard)/autoapply/page.tsx`
- Purpose: Main AutoApply dashboard — session status, queue stats, live viewer, mode selector, autonomous queue, tabs, session list, templates, analytics.
- Interactive elements: Button "Settings"; Button "Add to Queue" (modal); "Start Session"; "Pause" (→ controls); "View All Sessions"; Tabs "Queue Panel"/"Manual Queue"; session list select-all + per-row checkbox, bulk "Analyze Forms ({n})"/"Run Selected"; Form Templates per-row "Re-analyze"; Add-to-Queue modal (select-all/deselect-all, per-funder checkboxes, Cancel/Add {n} to Queue); embedded `WorkerStatus`, `LiveSessionViewer`, `ModeSelector`, `AutonomousQueueSection`, `QueueMetrics`, `QueuePreview`, `QueuePanel`, `ManualQueue`, `SubmissionHistory`, `ReviewQueue`, `SuccessAnalytics`
- API calls: `POST /api/agents/form-analyzer`; `POST /api/agents/form-filler`; direct Supabase for queue/templates
- Modals opened: `Modal` "Add Funders to Queue"
- Status: built

### /autoapply/profiles
- File: `src/app/(dashboard)/autoapply/profiles/page.tsx`
- Purpose: "Request Profiles" defining what the org seeks (monetary/land/in-kind/volunteer/service/partnership/sponsorship/facility); 5-step wizard.
- Interactive elements: Button "Create Profile"; per-profile active toggle, "Duplicate", "Archive" (`confirm()`); "Upload Docs" link; Wizard: Step1 8 type buttons; Step2 type-specific fields (extensive, see full detail — money/land/in-kind/volunteer/service/partnership/sponsorship/facility each with their own field sets); Step3 funder-category checkboxes + geographic scope; Step4 pitch template + reset; Step5 review + "Activate immediately" toggle; footer Back/Continue/Create
- API calls: `GET /api/autoapply/profiles`; `GET /api/autoapply/documents/readiness`; `POST /api/autoapply/profiles`; `PUT /api/autoapply/profiles/{id}`; `DELETE /api/autoapply/profiles/{id}`
- Modals opened: custom `WizardModal` (not shared `Modal`)
- Status: built

### /autoapply/queue
- File: `src/app/(dashboard)/autoapply/queue/page.tsx`
- Purpose: Full application-profile/priority-score/submission-context view per queued PIL application, human-reviewed before submission.
- Interactive elements: per-item `<details>` disclosures (Pitch/Field Mappings/Risk Factors/Relationship Strategy); "View dossier" (modal); "Submit Now"; "Schedule for Later" (modal); "Edit Pitch" (modal); "Review Risk Factors"; "Skip" (modal)
- API calls: `POST /api/agents/form-filler`; rest via direct Supabase (`pil_submission_queue`, `submission_queue`)
- Modals opened: `Modal` ×4 — Dossier, Edit Pitch, Schedule, Skip confirmation
- Status: built

### /autoapply/recordings
- File: `src/app/(dashboard)/autoapply/recordings/page.tsx`
- Purpose: Browse/playback recorded AutoApply session videos.
- Interactive elements: filter Select Status, Input Funder, From/To dates, Select Sort; Button "Delete ({n})" (admin, bulk); select-all + per-card checkbox (admin); clickable cards → `VideoModal` (expand/shrink, close, 1×/2×/4× speed, native controls)
- API calls: none via fetch — Supabase Storage signed URLs, `session_recordings` table
- Modals opened: custom `VideoModal`
- Status: built

### /autoapply/review-queue
- File: `src/app/(dashboard)/autoapply/review-queue/page.tsx`
- Purpose: Two-tab human review queue — paused-for-verification submissions and ambiguous Gmail confirmation matches.
- Interactive elements: Tabs "Paused for Verification"/"Ambiguous Confirmations" (count badges); Button "Refresh"; Tab1 per-item "Mark Resolved & Retry"/"Skip" (modal)/"Reassign" (modal)/screenshot lightbox; Tab2 per-item "Resolve" (modal)
- API calls: `GET /api/autoapply/review-queue`; `PATCH .../{id}/resume`; `PATCH .../{id}/skip`; `PATCH .../{id}/reassign`; `PATCH .../ambiguous/{id}/resolve`
- Modals opened: custom inline — Lightbox, Skip, Reassign, Resolve (4 total)
- Status: built

### /autoapply/settings
- File: `src/app/(dashboard)/autoapply/settings/page.tsx`
- Purpose: Configure autonomous queue population (schedule, batch size, filters, dedup, exclusions).
- Interactive elements: Button "Queue Eligible Funders Now"; toggle "Enable Autonomous Queue Population"; Select Schedule; Input Max per Batch; Category checkboxes; Geographic Scope input+chips; Select Dedup Window; Select Min Company Size; exclusion-list autocomplete + remove; link "Manage" (→ compliance); Cancel/Save Settings
- API calls: `GET/POST /api/autoapply/config`; `POST /api/autoapply/queue`
- Modals opened: none found
- Status: built

### /autoapply/templates
- File: `src/app/(dashboard)/autoapply/templates/page.tsx`
- Purpose: Manage cached portal form structures + KB field mappings, health/coverage badges, dry-run testing.
- Interactive elements: `SearchBar`; health filter tabs "All"/"Healthy"/"Stale"/"Errors"; Button "Re-analyze Stale ({n})"; Button "Add Portal" (**no onClick handler — stub**); per group expand, "Test" (modal), "Edit" (modal), "{n} cached versions" toggle; Test modal (Run Dry Test → Needs Fixing/Looks Good); Edit modal (per-field CSS Selector, KB Field Mapping select, skip toggle, Cancel/Save)
- API calls: `POST /api/agents/form-analyzer`; `POST /api/autoapply/templates/test`
- Modals opened: `Modal` ×2 — Test Template, Detail/Edit
- Status: built, with one gap — "Add Portal" button renders but does nothing

### /autoapply/test-results
- File: `src/app/(dashboard)/autoapply/test-results/page.tsx`
- Purpose: Last 10 `autoapply_submissions` for manual test review; queue a new test.
- Interactive elements: Input portal URL; Button "Run New Test"
- API calls: `POST /api/autoapply/test`
- Modals opened: none found
- Status: built

### /autoapply/usage
- File: `src/app/(dashboard)/autoapply/usage/page.tsx` → `UsagePageClient.tsx` (dynamic ssr:false)
- Purpose: Usage/billing dashboard — submission counts vs tier limits, daily chart, cost breakdown, BYO API keys (Enterprise/Consultant).
- Interactive elements: Link "Back to AutoApply"; toggle "own API keys"; Anthropic key input + show/hide + Save; OpenAI key input + show/hide + Save; "Upgrade to {tier}" link
- API calls: `GET/POST/PATCH /api/autoapply/usage/keys`
- Modals opened: none found
- Status: built

### /autoapply/webhooks
- File: `src/app/(dashboard)/autoapply/webhooks/page.tsx`
- Purpose: Manage Slack/generic webhook configs for AutoApply events.
- Interactive elements: Button "Add Webhook"; Select Type (Slack/Custom); Input URL; event checkboxes (5); Cancel/Save; per-webhook enable/disable toggle, "Test", delete icon
- API calls: `GET/POST/DELETE /api/autoapply/webhooks`
- Modals opened: none found (inline card)
- Status: built

---

<a id="part-1c"></a>
## PART 1C — Dashboard Pages: Billing, Board, Command Center, Compliance, Contacts, Dashboard, Deadlines, Documents, Donor Discovery (start)

### /billing
- File: `src/app/(dashboard)/billing/page.tsx`
- Purpose: Subscription/billing management (owner-only).
- Interactive elements: Button "Manage billing"; `PlanCard` selection buttons; invoice table (sortable Date/Amount); "Download PDF" links
- API calls: `GET /api/billing`; `GET /api/billing/usage`; `POST /api/stripe/create-portal-session`; `POST /api/billing` (`{action:"checkout",tier}`)
- Modals opened: none found
- Status: built

### /board/:id
- File: `src/app/(dashboard)/board/[id]/page.tsx`
- Purpose: Board member detail — profile + board meeting packets. Explicitly NOT a self-service board login portal.
- Interactive elements: Link "Back to board members" only — read-only otherwise
- API calls: `GET /api/board/{id}`
- Modals opened: none found
- Status: built (read-only)

### /command-center
- File: `src/app/(dashboard)/command-center/page.tsx` (server) + `LiveClock`/`CommandCenterLive` (imported, not expanded)
- Purpose: Platform-wide (cross-tenant) Command Center for `owner` role.
- Interactive elements: Admin Quick Actions links — "Platform Admin", "Organizations", "System Health", "System Monitor", "Audit Log", "Sales Outreach", "AutoApply Ops", "Agent Improvements"
- API calls: none directly (data via `getCommandCenterSnapshot()` server-side)
- Modals opened: none found
- Status: built (redirects non-owners)

### /compliance
- File: `src/app/(dashboard)/compliance/page.tsx`
- Purpose: Compliance calendar — events (reports/audits/renewals/meetings) by month + manually tracked requirements + live compliance score.
- Interactive elements: Button "New Event" (modal, ×2 CTA); per-event "Mark Complete"; Button "Add Requirement" (modal, ×2 CTA); per-requirement "Mark Submitted"; Add Requirement modal (Title, Select type, Due date, Textarea Notes, Cancel/Add); New Event modal (Title, Select type, Due date, Select Recurrence, Cancel/Add)
- API calls: `GET/PATCH/POST /api/compliance`; `GET /api/compliance/events`; `PATCH /api/compliance/events/{id}`; `POST /api/compliance/events`
- Modals opened: `Modal` ×2 — "Add Requirement", "New Compliance Event"
- Status: built

### /contacts/:id
- File: `src/app/(dashboard)/contacts/[id]/page.tsx` → `ContactDetail.tsx`
- Purpose: Contact detail — info, linked funder, relationship status, notes, outreach panel.
- Interactive elements: Link "Back to contacts"; Button "Edit" (modal w/ `ContactForm`); Button "Delete" (modal); Select "Relationship status"; embedded `ContactOutreachPanel` (not expanded)
- API calls: none via fetch — direct Supabase (`contacts`, `funders`)
- Modals opened: `Modal` "Edit contact", `Modal` "Delete contact"
- Status: built

### /contacts/new
- File: `src/app/(dashboard)/contacts/new/page.tsx` → `ContactForm.tsx`
- Purpose: Create a contact linked to a funder.
- Interactive elements: Select Funder (required); Input Name (required); Input Title; Select Relationship; Input Email; Input Phone; Select Preferred contact method; Date Last contacted; Textarea Notes; Button "Create contact"
- API calls: none via fetch — direct Supabase
- Modals opened: none found
- Status: built

### /contacts
- File: `src/app/(dashboard)/contacts/page.tsx`
- Purpose: Contact list joined to funder name.
- Interactive elements: "New contact" CTA (×2); embedded `ContactTable` (not expanded)
- API calls: none via fetch — direct Supabase
- Modals opened: none found
- Status: built

### /dashboard
- File: `src/app/(dashboard)/dashboard/page.tsx` (server, `force-dynamic`)
- Purpose: Main org dashboard v4 — pipeline strip, flip cards, Action Queue, Top Opportunities, Funding Activity chart, AI Triggers, Alerts, Deadlines, KPI Scorecard, Recent Activity, Performance, Opportunity Mix, Platform Health.
- Interactive elements: pipeline-stage links (Onboard/Research/Opportunities/Narratives/AutoApply/Funding Secured); `FlipCards` (5 cards w/ CTAs); `AiTriggerPanel` (3 triggers: "Run scan", "Start discovery", "Generate now"); "Open AutoApply" link; `ScraperStatusCard`; links throughout Action Queue/Top Opportunities/Alerts/Deadlines panels; `ChatbotAssistant`
- API calls: none directly in this file (server-side ~20 parallel Supabase queries); `AiTriggerPanel`'s config references `/api/agents/research` and `/api/drafts/queue/trigger`
- Modals opened: none found
- Status: built

### /deadlines
- File: `src/app/(dashboard)/deadlines/page.tsx`
- Purpose: Deadlines calendar/list, Deadlines/Compliance tab switch, Google Calendar sync, AI-predicted deadlines.
- Interactive elements: Button "Sync to Calendar"; view-switch Month/Week/List; Tabs "Deadlines"/"Compliance"; checkboxes "Auto-sync new deadlines"/"Show completed"; filter pills (All/Application/Follow-up/Reporting/Renewal/Document); "Add an opportunity" (empty state); `CalendarGrid`/`WeekView` (prev/next/today); list-view "Add to Calendar"/"Complete"/"Reopen"; Predicted Deadlines "Add to Calendar"
- API calls: `GET /api/compliance`; `GET /api/integrations/google/calendar`; `POST /api/integrations/google/calendar/sync`; `POST /api/integrations/google/calendar`; `GET /api/intelligence/deadline-predictions`
- Modals opened: none found
- Status: built

### /documents
- File: `src/app/(dashboard)/documents/page.tsx`
- Purpose: Document repository — upload, categorize, link to applications.
- Interactive elements: embedded `DocumentUploader` and `DocumentList` (not expanded — upload/list controls live there)
- API calls: none via fetch in this file — Supabase direct
- Modals opened: none found in this file
- Status: built (shell built; interactive detail in un-inspected children)

### /donor-discovery/connectors
- File: `src/app/(dashboard)/donor-discovery/connectors/page.tsx`
- Purpose: Manage BYO API keys for donor-discovery connectors (Google Places, Apollo, Hunter, ZoomInfo, Clay).
- Interactive elements: per-connector "Connect" (modal)/"Disconnect" (modal)/"Coming Soon" (disabled); Connect modal (API Key input, Test, Save); Disconnect modal (Cancel/Disconnect)
- API calls: `GET /api/donor-discovery/connectors`; `POST /api/donor-discovery/connectors/test`; `POST /api/donor-discovery/connectors`; `DELETE /api/donor-discovery/connectors?provider=`
- Modals opened: `Modal` "Connect {name}", `Modal` "Disconnect {name}?"
- Status: built

### /donor-discovery/discover
- File: `src/app/(dashboard)/donor-discovery/discover/page.tsx`
- Purpose: 3-step "Discover" wizard — category/type → radius/keywords/rating → preview + launch, route to AutoApply/email.
- Interactive elements: Step1 category + business-type pill buttons; Step2 radius buttons (10/25/50/100mi), Keywords input, Select min rating; Step3 preview cards w/ Website badge; "Review them now"; per-prospect checkbox, "Add to AutoApply Queue", "Add to Email Campaign", "Quick Outreach" link, "View Details" link; floating batch bar; wizard nav Back/Continue/Search Businesses/Launch Discovery
- API calls: `POST /api/donor-discovery/discover`; `GET /api/donor-discovery/prospects?request_id=...`; `POST .../{id}/route-to-autoapply`; `POST .../{id}/route-to-email`
- Modals opened: none found
- Status: built

---

<a id="part-1d"></a>
## PART 1D — Dashboard Pages: Donor Discovery (rest), Draft Generator, Email (start)

### /donor-discovery/intent-signals
- File: `src/app/(dashboard)/donor-discovery/intent-signals/page.tsx`
- Purpose: Corporate Intent Intelligence — AI-detected giving signals with scoring + recommended actions.
- Interactive elements: Link "Back to Donor Discovery"; Button "Run Signal Analysis" (×2, editors only); "Draft Outreach Email" link per card; "View Company"/"View Source" link
- API calls: `GET/POST /api/intelligence/donor-intent`; direct Supabase for `corporate_prospects` lookup
- Modals opened: none found
- Status: built

### /donor-discovery/marketplace
- File: `src/app/(dashboard)/donor-discovery/marketplace/page.tsx`
- Purpose: Browse/filter the shared `corporate_prospects` pool.
- Interactive elements: Link back; search input; Select Industry; Select propensity; Select Sort by; two always-empty text filters (noted in code); 4 ownership toggle pills; "View Giving DNA"/"Add to Outreach" links; Previous/Next pagination
- API calls: `GET /api/intelligence/corporate-prospects?...`
- Modals opened: none found
- Status: built

### /donor-discovery/new
- File: `src/app/(dashboard)/donor-discovery/new/page.tsx`
- Purpose: 3-step wizard (Taxonomy → Geography → Review & Launch) to launch a Donor Discovery request.
- Interactive elements: `TaxonomyCombobox`; geography mode buttons Radius/States/National with mode-specific fields (Address+Geocode+Radius / 51 state checkboxes / min assets+result limit); Input Request name; Back/Continue/Launch Discovery
- API calls: `POST /api/donor-discovery/geocode`; `POST /api/donor-discovery/requests`
- Modals opened: none found
- Status: built

### /donor-discovery/outreach
- File: `src/app/(dashboard)/donor-discovery/outreach/page.tsx`
- Purpose: AI-personalized email composer/queuer for corporate prospects, single + batch modes.
- Interactive elements: search input; "Select All High-Intent (>75)"; per-prospect checkbox + "Profile" link; Select Template; "Generate with AI"; "Generate personalized email for each selected (N)" (batch mode); Subject/Body fields; "Queue for Sending"; batch mode "Exit batch mode", per-draft Retry/Subject/Body, "Queue All Personalized Emails"
- API calls: `GET /api/intelligence/outreach/prospects`; `GET /api/intelligence/corporate-prospects/{id}`; `POST /api/intelligence/outreach/generate`; `POST /api/intelligence/outreach/queue`
- Modals opened: none found
- Status: built

### /donor-discovery/outreach/prospects/:id
- File: `src/app/(dashboard)/donor-discovery/outreach/prospects/[id]/page.tsx`
- Purpose: Corporate Giving DNA profile — PS-01–10 propensity scores, enrichment, AI narrative.
- Interactive elements: Link back; Button "Generate/Regenerate Giving DNA"; external website link
- API calls: `GET /api/intelligence/corporate-prospects/{id}`; `POST .../{id}/giving-dna`
- Modals opened: none found
- Status: built

### /donor-discovery (root)
- File: `src/app/(dashboard)/donor-discovery/page.tsx`
- Purpose: Overview — stats, quick actions, active requests, pipeline funnel, top prospects, intent signal feed.
- Interactive elements: "Connectors"/"Discover Prospects" links; 4 quick-action cards; pipeline funnel stage links (New/Reviewing/Contacted/Applied/Received/Rejected); "View Prospect"; "New Discovery"; "Review"; "Coming soon" badge (Scout Report)
- API calls: `GET /api/donor-discovery/requests`; `GET /api/donor-discovery/pipeline`; `GET /api/donor-discovery/stats`
- Modals opened: none found
- Status: built

### /donor-discovery/prospects/:id
- File: `src/app/(dashboard)/donor-discovery/prospects/[id]/page.tsx` → `ProspectDetail.tsx`
- Purpose: Single prospect detail — stage, AutoApply queue, assignment, notes, contact links.
- Interactive elements: Select Pipeline stage; "Queue in AutoApply"/"Queued"/disabled; Select Assigned to; Textarea + "Add note"; external links (website/donation form/CSR/email/phone)
- API calls: `GET /api/donor-discovery/prospects/{id}`; `POST /api/autoapply/queue`; `PATCH /api/donor-discovery/prospects/{id}`
- Modals opened: none found
- Status: built

### /donor-discovery/prospects
- File: `src/app/(dashboard)/donor-discovery/prospects/page.tsx`
- Purpose: Full prospects table — filters, bulk stage-move, per-row Add to Outreach.
- Interactive elements: "Discover More" (×2+); `TaxonomyCombobox`; Select request/status filters; Input min score; Input city; search input; select-all + per-row checkbox; sortable columns; "View"/"Add to Outreach"; bulk bar (Select target stage, Move to stage)
- API calls: `GET /api/donor-discovery/requests`; `GET /api/donor-discovery/prospects?...`; `PATCH .../{id}`; `POST .../{id}/route-to-email`
- Modals opened: none found
- Status: built

### /draft-generator/:id
- File: `src/app/(dashboard)/draft-generator/[id]/page.tsx`
- Purpose: Draft editor with AI assist — confidence score, KB sources, regenerate/rescore.
- Interactive elements: Link back; Link "View application"; `AutoSaveIndicator`; Button "Regenerate with AI"; `DraftEditor` (Save, Rescore); `ConfidenceIndicator`; `KnowledgePreview`
- API calls: `POST /api/ai/draft`; `POST /api/ai/draft/rescore` (rest direct Supabase)
- Modals opened: none found
- Status: built

### /draft-generator/autonomous
- File: `src/app/(dashboard)/draft-generator/autonomous/page.tsx` (server)
- Purpose: "AI-Generated Drafts Awaiting Review" — autonomous draft list for human review.
- Interactive elements: "Review & Edit" link per card; `DismissDraftButton` ("Dismiss"/"Dismissing..."); embedded `DraftQualityPanel` (not expanded); "Settings" link (empty state)
- API calls: `DismissDraftButton` → `PATCH /api/applications/{id}` (rest server-side Supabase)
- Modals opened: none found
- Status: built

### /draft-generator (root)
- File: `src/app/(dashboard)/draft-generator/page.tsx`
- Purpose: Real 4-step wizard (Select Opportunity → Customize → Generate → Review & Export), stats/recent-drafts table, version history.
- Interactive elements: 4 free-navigation step buttons; Step1 search + clickable rows; Step2 `TemplateSelector` + Select program (Budget Narrative); Step3 "Generate draft"/"Generate new version"; Step4 "Score Draft", "Humanize", "Rescore", `DraftEditor` Save, "Copy to clipboard", "Download .txt", "Download PDF", disabled "Email draft", `GrantDNACard` Re-score, `DraftsHistoryPanel` view/revert; Back/Next; "Go to opportunities"; recent-drafts "Open"
- API calls: `GET /api/intelligence/match-feed?limit=500`; `POST /api/ai/budget`; `POST /api/ai/draft`; `POST /api/ai/humanize`; `POST /api/intelligence/grant-dna`
- Modals opened: none found
- Status: built

### /draft-generator/queue
- File: `src/app/(dashboard)/draft-generator/queue/page.tsx`
- Purpose: "Draft Queue" — AutoApply-adjacent draft automation queue, review/approve/reject/submit/retry, bulk actions, automation config.
- Interactive elements: Button "Generate Now"; stat cards; Select filters (status/priority/sort); Refresh icon; bulk bar (Approve/Reject/Submit); select-all + per-row checkbox; priority chevrons; per-row Review/Approve/Reject/Submit/Retry; Automation Settings (toggle auto-drafting, range min score, number daily limit/deadline window/confidence threshold, toggle auto-generate on discovery, toggle require approval, Save settings); Reject modal (Textarea reason, Cancel/Confirm)
- API calls: `GET /api/drafts/queue/stats`; `GET /api/drafts/queue?...`; `GET/PATCH /api/drafts/queue/config`; `PATCH /api/drafts/queue/{id}`; `POST /api/drafts/queue/trigger`
- Modals opened: `Modal` "Reject draft"
- Status: built

---

<a id="part-1e"></a>
## PART 1E — Dashboard Pages: Email (rest), Financials, Follow-ups, Foundations, Funders, Google Nonprofit, Import, Intelligence (start)

### /email/campaigns/:id
- File: `src/app/(dashboard)/email/campaigns/[id]/page.tsx`
- Purpose: Sequence detail — funnel by step, step config, per-contact enrollment with pause/resume.
- Interactive elements: Link back; "Activate"/"Resume"; "Pause"; "Mark complete"; per-enrollment "Pause"/"Resume"
- API calls: `GET /api/email/sequences/{id}`; `GET .../{id}/analytics`; `PATCH .../{id}`
- Modals opened: none found
- Status: built

### /email/campaigns
- File: `src/app/(dashboard)/email/campaigns/page.tsx`
- Purpose: List of drip campaigns + 4-step creation wizard modal (Details→Steps→Enrollment→Review).
- Interactive elements: Link back; "New Campaign" (×2); per-row Activate/Resume, Pause; wizard: Input name, Textarea description, per-step Select template/Subject+Body/delay days+hours/condition + Remove/Add step, Textarea paste-addresses + CRM contact checkboxes, review pane, Back/Cancel/Next/Create Campaign
- API calls: `GET/PATCH /api/email/sequences`; `GET /api/email/templates`; `POST /api/email/sequences`; `POST .../{seqId}/enroll`
- Modals opened: `Modal` "New Email Campaign"
- Status: built

### /email (root)
- File: `src/app/(dashboard)/email/page.tsx`
- Purpose: 3-pane Gmail-style inbox — thread list/detail/context, AI summarization, auto-linking.
- Interactive elements: mobile tabs Inbox/Thread/Context; search input; filter tabs All/Linked/Unlinked; per-thread "Link"/"Linking…"; "AI summary"/"Hide summary" + dismiss; mobile context-panel toggle; CC input; Reply textarea; "Send"; context panel "Change" (**no onClick — dead affordance**); `ChatbotAssistant`
- API calls: `GET /api/email/threads?...`; `POST /api/email/summarize`; `POST /api/email/send`; `POST /api/email/link`
- Modals opened: none found
- Status: built (minor gap: "Change" button non-functional)

### /email/templates
- File: `src/app/(dashboard)/email/templates/page.tsx`
- Purpose: Template management, AI-generate, preview, delete.
- Interactive elements: Link back; "New Template" (modal); per-template Preview toggle, Edit (modal), Delete; New/Edit modals wrap `TemplateForm` (name, type, 6 variable-insert buttons, Subject, Body, live preview, "Generate with AI" toggling `AIGenerateForm`: funder name, Select tone, Textarea purpose, Generate; Cancel/Save)
- API calls: `GET/POST/PATCH/DELETE /api/email/templates`; `POST /api/email/templates/generate`
- Modals opened: `Modal` (create), `Modal` (edit)
- Status: built

### /financials
- File: `src/app/(dashboard)/financials/page.tsx`
- Purpose: Funding overview — requested vs awarded, receivables, budget vs actual, reconciliation, renewal revenue at risk.
- Interactive elements: none — fully read-only
- API calls: none via fetch — direct Supabase
- Modals opened: none found
- Status: built (read-only by design)

### /follow-ups
- File: `src/app/(dashboard)/follow-ups/page.tsx`
- Purpose: Humanized follow-up email sequences (parsed from `notes` rows), per-step copy.
- Interactive elements: Button "Refresh"; per-step "Copy" (aria-label, shows "Copied")
- API calls: none via fetch — direct Supabase; empty-state text references `POST /api/agents/follow-up` (not called from this page)
- Modals opened: none found
- Status: built

### /foundations/:id
- File: `src/app/(dashboard)/foundations/[id]/page.tsx` → `FoundationDetail.tsx`
- Purpose: Single IRS 990 foundation record detail.
- Interactive elements: Link back; external website link
- API calls: `GET /api/foundations/{id}/profile`
- Modals opened: none found
- Status: built

### /foundations
- File: `src/app/(dashboard)/foundations/page.tsx`
- Purpose: Browsable/searchable IRS 990 directory, filters, coverage stats, single/bulk import into `funders`.
- Interactive elements: "Import Selected (N)"; search input; Select State (56); Select NTEE (26); Input min revenue/assets; select-all checkbox; per-card select/import; Previous/Next
- API calls: none via fetch — direct Supabase (`foundation_directory`, `funders` insert)
- Modals opened: none found
- Status: built

### /funders/:id
- File: `src/app/(dashboard)/funders/[id]/page.tsx` → `FunderDetail.tsx`
- Purpose: Tabbed funder detail — Overview/Contacts/Outreach/Opportunities/Applications/Notes/Intelligence.
- Interactive elements: Link back; "Relationship Builder" link; "Research funder"; "Edit" (modal)/"Delete" (modal); 7 tabs; "Add contact"; "Open Outreach"; Textarea+"Add note"; "Research funder" (Intelligence empty); Giving History EIN input+Extract/Cancel/Re-extract; Portal Login Update/Remove or Username/Password+Cancel/Save
- API calls: `POST /api/agents/funder-intel`; `POST /api/agents/giving-history`; `POST /api/agents/funder-relationship`; `GET/POST/DELETE /api/automation/portal-credentials`
- Modals opened: `Modal` "Edit funder", `Modal` "Delete funder"
- Status: built

### /funders/:id/relationship
- File: `src/app/(dashboard)/funders/[id]/relationship/page.tsx` → `FunderRelationshipBuilder.tsx`
- Purpose: Gen-1 event-sourced relationship score + AG-19 RelationshipBuilderAgent output.
- Interactive elements: Link back; Button "Run Relationship Analysis" (editable only)
- API calls: `GET /api/funders/{id}/relationship`; `GET/POST /api/funders/{id}/relationship-builder`
- Modals opened: none found
- Status: built

### /funders/import
- File: `src/app/(dashboard)/funders/import/page.tsx`
- Purpose: 4-step CSV import wizard (Upload→Map→Preview→Done).
- Interactive elements: Link back; drag-drop upload zone + hidden file input; per-field Select mapping (8 fields); "Preview Import"; "Import {N} Funder(s)"; Done: "View Funders"/"Import Another File"
- API calls: `POST /api/funders/import`
- Modals opened: none found
- Status: built

### /funders/new
- File: `src/app/(dashboard)/funders/new/page.tsx` → `FunderForm.tsx`
- Purpose: Create a funder.
- Interactive elements: Input name (required); Select Category; Textarea Description; Input Website/Portal URL; Select Portal login status; Select Preferred application method; Input Annual giving budget; Input Geographic focus; checkbox "Has a giving page"; Textarea Notes; "Create funder" (duplicate-warning re-submit flow)
- API calls: none via fetch — direct Supabase
- Modals opened: none found
- Status: built

### /funders
- File: `src/app/(dashboard)/funders/page.tsx` → `FunderCardGrid`/`FunderCard`
- Purpose: Funder list — search/filter, batch-select to queue into AutoApply.
- Interactive elements: "New funder" link; search input; Select category; per-card select checkbox + click-through; floating "Queue Selected" bar
- API calls: `POST /api/autoapply/queue` (`{funder_ids}`)
- Modals opened: none found
- Status: built

### /google-nonprofit
- File: `src/app/(dashboard)/google-nonprofit/page.tsx`
- Purpose: Hub bundling Application Manager, Business Profile wizard, Resources Hub + chatbot.
- Interactive elements: Section tabs "Application Manager"/"Business Profile Setup"/"Resources Hub"; **GoogleNonprofitForm** 5-step wizard (Org Info*, Eligibility incl. TOS checkbox*, Documents incl. required registration/affiliation docs*, Contact*, Review) w/ Back/Continue/Submit; **GoogleBusinessProfileWizard** 4-step (Profile Basics incl. hours-of-operation grid, Photos+Description, Services incl. tag editor + attributes grid, Verification incl. checklist PDF download) w/ Back/Continue; **GoogleResourcesHub** Print button, 4 tabs, SearchBar
- API calls: `POST /api/google-nonprofit/apply` (multipart) — Business Profile wizard has no API call (localStorage + client PDF only); Resources Hub reads static local JSON
- Modals opened: none found
- Status: built

### /import
- File: `src/app/(dashboard)/import/page.tsx`
- Purpose: 3-step CSV import wizard (Upload→Map→Confirm) for funders.
- Interactive elements: Link back; file input + preview table; per-field Select mapping (7); Back/Next; Import; Done: View Funders/Import Another File
- API calls: `POST /api/import/csv`
- Modals opened: none found
- Status: built

### /intelligence/community-need
- File: `src/app/(dashboard)/intelligence/community-need/page.tsx`
- Purpose: AG-35 Community Need Predictor — demand signals + "Potential Resources" matching.
- Interactive elements: Button "Run Analysis"; per-signal "Potential Resources" toggle (lazy loads); "Apply for Related Grants" link
- API calls: `GET/POST /api/intelligence/community-need`; `GET /api/intelligence/community-resources?signalId=`
- Modals opened: none found
- Status: built

### /intelligence/competitors
- File: `src/app/(dashboard)/intelligence/competitors/page.tsx`
- Purpose: Read-only Competitor Intelligence (Agent 24), tier-gated Enterprise/Consultant.
- Interactive elements: (locked state: none); "Analyze a Funder" per-funder buttons; per-group expand/collapse; "Re-run analysis"
- API calls: `POST /api/agents/competitor-intel`
- Modals opened: none found
- Status: built

### /intelligence/disaster
- File: `src/app/(dashboard)/intelligence/disaster/page.tsx`
- Purpose: AG-25 Disaster Response — live FEMA declarations matched to a static emergency-funding database.
- Interactive elements: per-declaration "Deploy Response" (writer only); 8 fixed "Apply" external links (FEMA BRIC, HUD CDBG-DR, SBA Disaster Loans, Red Cross Partnership, Texas GLO, USDA Rural Dev Emergency, SBA EIDL, FEMA HMGP)
- API calls: `GET /api/agents/disaster`; `POST /api/agents/disaster` (`{declarationId}`)
- Modals opened: none found
- Status: built

---

<a id="part-1f"></a>
## PART 1F — Dashboard Pages: Intelligence (core + PIL)

### /intelligence/donor-intent
- Purpose: AG-30 Donor Intent Monitor — press/ESG/SEC/hiring/facility-expansion signals predicting giving announcements.
- Interactive elements: Button "Run Analysis"; "View source →" link per card
- API calls: `GET/POST /api/intelligence/donor-intent`
- Modals: none. Status: built

### /intelligence/gap-analysis
- Purpose: Portfolio-wide narrative + geographic gap analyzer.
- Interactive elements: Button "Refresh" (empty-state only)
- API calls: `GET /api/intelligence/gap-analysis`
- Modals: none. Status: built

### /intelligence/knowledge
- Purpose: Funding Knowledge Engine free-text Q&A over funded-proposal patterns.
- Interactive elements: Textarea; 6 suggested-query chip buttons; Button "Ask"
- API calls: `POST /api/intelligence/knowledge-query` (counts via direct Supabase)
- Modals: none. Status: built

### /intelligence/learning-network
- Purpose: Platform Learning Network — anonymized cross-org pattern intelligence.
- Interactive elements: none — read-only
- API calls: `GET /api/intelligence/learning-network`
- Modals: none. Status: built

### /intelligence/match-feed
- Purpose: Personalized Match Feed ranking opportunities to the org's Digital Twin (deterministic, blended w/ AG-15 where available).
- Interactive elements: Button "Refresh"; per-card "Show/Hide factor breakdown"; "Improve Organization Profile" link
- API calls: `GET /api/intelligence/match-feed?limit=25`
- Modals: none. Status: built

### /intelligence/matches
- Purpose: Semantic Funder Matches (Claude-scored).
- Interactive elements: Button "Run Analysis" (editable only)
- API calls: `POST /api/agents/semantic-matching`
- Modals: none. Status: built

### /intelligence (hub)
- Purpose: Module index linking to 11 intelligence surfaces, real per-module stats where cheap.
- Interactive elements: 11 module cards, each a link (Competitor Intelligence, Funder Matches, Funder Recommendations, Organization Profile, Funder & Contact Monitoring, Disaster Response, Funding Knowledge Engine, Global Learning Network, Strategic Recommendations, Community Need Prediction, Impact Simulator)
- API calls: `GET /api/intelligence/digital-twin`; `GET /api/intelligence/reputation`; `GET /api/intelligence/learning-network`; `GET /api/intelligence/strategic-advisor`; `GET /api/intelligence/community-need`; `GET /api/intelligence/stats`
- Modals: none. Status: built

### /intelligence/pil/agents
- Purpose: PIL agent activity monitor — all 44 registry agents + computed run stats.
- Interactive elements: Link back; Select "Filter by family" (8 families); per-agent row expand (run history)
- API calls: `GET /api/pil/agents`; `GET /api/pil/agents/{agentId}/runs` (per agent, parallel)
- Modals: none. Status: built

### /intelligence/pil/discover
- Purpose: PIL natural-language discovery → structured research plan.
- Interactive elements: Link back; Textarea; Button "Build Research Plan"; result link "Run {id} - Monitor progress"
- API calls: `POST /api/pil/discover`
- Modals: none. Status: built

### /intelligence/pil (hub)
- Purpose: Top-level PIL dashboard summarizing pipeline (research, prospects, agents, budget, review queue).
- Interactive elements: 5 stat cards, each a link
- API calls: `GET /api/pil/agents`; `GET /api/pil/cost/summary`; `GET /api/pil/prospects`; `GET /api/pil/review-queue?status=pending`; `GET /api/pil/research`
- Modals: none. Status: built

### /intelligence/pil/prospects/:id
- Purpose: PIL prospect dossier — evidence, relationship graph, research history, actions.
- Interactive elements: Link back; Tabs Overview/Evidence/Graph/Research/Actions; per-run row toggle; Button "Start Research" (modal)
- API calls: `GET /api/pil/prospects/{id}`; `GET /api/pil/research/{runId}` (lazy)
- Modals: `StartResearchModal`. Status: built (custom force-directed SVG graph, no external deps)

### /intelligence/pil/prospects
- Purpose: PIL prospect list — filter/search/sort, dossier/start-research quick actions.
- Interactive elements: Select status filter; Select type filter (14 entity types); Search input; "View Dossier" link; per-row "Start Research" (modal); "Discover Prospects" (empty state); sortable columns
- API calls: `GET /api/pil/prospects`
- Modals: `StartResearchModal`. Status: built

### /intelligence/pil/research
- Purpose: PIL research run monitor — auto-polls every 10s, drill-down steps.
- Interactive elements: Link back; per-run row expand (RunSteps)
- API calls: `GET /api/pil/research` (polled 10s); `GET /api/pil/prospects` (polled); `GET /api/pil/research/{runId}` (lazy)
- Modals: none. Status: built

### /intelligence/pil/review-queue
- Purpose: PIL human review queue (generic subject types) — approve/reject.
- Interactive elements: Link back; Select status filter; per-item row → `ReviewModal` (Textarea notes, Reject/Approve)
- API calls: `GET /api/pil/review-queue?...`; `GET /api/pil/prospects`; `POST /api/pil/review-queue/{id}/decision`
- Modals: `Modal`-based `ReviewModal`. Status: built

### /intelligence/recommendations
- Purpose: Ranked funder matches from `FunderRecommender` (geographic/program/award-size fit).
- Interactive elements: Select category; Input amount; Input geography; Button "Find Matches"; per-card "Add to Funders" (→"Done"), "Dismiss" (view-only), expand toggle (lazy AI explanation)
- API calls: `GET /api/intelligence/recommendations?...`; `GET /api/intelligence/recommendations/explain?funderId=` (lazy); direct Supabase insert for Add
- Modals: none. Status: built

### /intelligence/relationship-graph
- Purpose: AG-32 board-to-funder connection graph + analytics.
- Interactive elements: Button "Discover Connections"; List/Graph view toggle; "Request Introduction" (in `ConnectionCard`)
- API calls: `GET/POST /api/intelligence/relationship-graph`; `GET /api/intelligence/relationship-graph/analytics`
- Modals: none. Status: built

### /intelligence/reputation
- Purpose: AG-18 Reputation Intelligence — unread alerts + on-demand entity search.
- Interactive elements: Add-Entity form (name, Select type); Button "Check Now"; severity filter tabs (6); per-alert "Mark Read"
- API calls: `GET/POST/PATCH /api/intelligence/reputation`
- Modals: none. Status: built

### /intelligence/simulate
- Purpose: AG-41 Impact Simulation — lose/gain funder, program expansion, budget cut.
- Interactive elements: 4 scenario buttons; scenario-specific fields (Select funder / amount input / program budget+staff / cut % slider); Button "Run Simulation"; per-past-sim "View"
- API calls: `POST /api/agents/simulate` (direct Supabase for reads — no GET route exists)
- Modals: none. Status: built

### /intelligence/strategic-advisor
- Purpose: AG-40 capstone — synthesizes every other agent's output into prioritized recommendations.
- Interactive elements: Button "Generate Insights"; per-rec "Mark Done"/"Dismiss"/"Snooze 1 Week"
- API calls: `GET/POST/PATCH /api/intelligence/strategic-advisor`
- Modals: none. Status: built

### /intelligence/twin
- Purpose: Organizational Digital Twin — 10-section completeness diagnostic.
- Interactive elements: Button "Auto-Populate Twin"; "Update Twin" link; per-section recommendations expand/collapse; "Fix Now" links
- API calls: `GET /api/intelligence/twin/completeness`; `POST /api/intelligence/twin/auto-populate`
- Modals: none. Status: built

---

<a id="part-1g"></a>
## PART 1G — Dashboard Pages: Intelligence (rest), Knowledge Base, Marketplace, Nonprofits, Notifications, Onboarding

### /knowledge-base/answers
- Purpose: Standard Answers CRUD (FAQ-style, reserved "custom" category).
- Interactive elements: "New answer" (modal); per-answer edit/delete icons; delete-confirm modal
- API calls: none via fetch — direct Supabase
- Modals: `Modal` create/edit (`AnswerEditor`), `Modal` delete-confirm. Status: built

### /knowledge-base/edit
- Purpose: Full 10-section org profile editor feeding AI drafting/scoring/Twin; per-section autosave + AI Assist.
- Interactive elements: extensive — 10-section left nav w/ % scores; per-section "AI Assist"; Mission (textareas, TagInput core values, year founded); Programs (dynamic rows + add/remove); Financial (Import from 990, budget, dynamic revenue-source rows, DocumentUploader); Leadership (ED fields, dynamic board rows); Geographic; Target Population (checkbox grids for populations/languages); Impact (dynamic KPI rows, achievements, awards TagInput); History (founding story, dynamic milestones); Partnerships (dynamic partner rows, gov-contracts checkbox, coalition TagInput); Compliance (tax status, EIN read-only, dynamic state-registration rows, audit result select, insurance checkbox+TagInput, background-check checkbox); Ctrl/Cmd+S shortcut
- API calls: `GET/PATCH /api/knowledge-base`; `POST /api/knowledge-base/suggest`
- Modals: none (full-page tabbed editor). Status: built

### /knowledge-base/narratives/:id
- Purpose: Single narrative detail (server wrapper) → `NarrativeDetail`.
- Interactive elements: "Edit" (modal); Select assigned category; "Mark as proven/unproven" (owner/admin); usage-history "Open draft" links
- API calls: none via fetch — direct Supabase
- Modals: `Modal` "Edit narrative". Status: built

### /knowledge-base/narratives
- Purpose: Reusable narratives CRUD with proven-status badges.
- Interactive elements: "New narrative" (modal); Select category filter; per-card edit/delete icons; delete modal (extra proven-narrative warning)
- API calls: none via fetch — direct Supabase
- Modals: `Modal` create/edit, `Modal` delete-confirm. Status: built

### /knowledge-base (hub)
- Purpose: Two-column landing — left nav, org-profile hero, metric cards, proven-narratives list.
- Interactive elements: nav links (Overview/Organization Profile/Full Editor/Proven Narratives/Q&A Library); "Edit Organization Profile" link; "Add a Narrative" (empty state); `ChatbotAssistant`
- API calls: `GET /api/knowledge-base`
- Modals: none. Status: built

### /knowledge-base/profile
- Purpose: Org identity/mission/capacity/contact form + board members + programs sub-tables.
- Interactive elements: Save profile; Board Members add/edit/remove (modals); Programs add/edit/delete (modals)
- API calls: none via fetch — direct Supabase
- Modals: `Modal` ×4 (Add/Edit board member, Remove confirm, Add/Edit program, Delete confirm). Status: built

### /marketplace
- Purpose: Donation Recommendation Marketplace MVP — rule-based matching, minimal request/approve flow (no receipts, no AI matching, no payments).
- Interactive elements: "New Listing" toggle (inline form: Title, Description, Select category ×12, Item Type, Quantity, Estimated Value, Geographic Scope, Post/Cancel); incoming-request Approve/Decline; matched-to-you Request/Withdraw
- API calls: `GET/POST /api/marketplace/listings`; `GET/PATCH /api/marketplace/matches`
- Modals: none (inline form). Status: built

### /nonprofits
- Purpose: Server-rendered IRS BMF (~2M rows) directory browse.
- Interactive elements: search form (GET, server-rendered): text input, Select state, Search button; Clear link; Previous/Next; external website links
- API calls: none — server component, direct Supabase
- Modals: none. Status: built

### /notifications
- Purpose: Notifications center — last 90 days, read/unread, filterable.
- Interactive elements: "Mark all read"; read-filter toggle (all/unread/read); Select type filter; per-item "Mark read"
- API calls: `GET/PATCH /api/notifications`
- Modals: none. Status: built

### /onboarding
- Purpose: 7-step setup wizard (Org Profile, Programs, KB AI Draft, Board Members, Documents, Search Profile, Plan Selection).
- Interactive elements: "Explore the platform first" skip link; Step1 org fields; Step2 dynamic program rows; Step3 auto-triggered AI draft, editable textareas, keyword badges, Retry; Step4 dynamic board-member rows; Step5 3 optional document slots; Step6 profile name/keywords/category grid/geography/amount range; Step7 `PlanCard`s + Back + Skip-to-Free; global Back/Save & Continue
- API calls: `GET/POST /api/onboarding`; `POST /api/onboarding/generate-narratives`; `POST /api/onboarding/complete-setup`
- Modals: none. Status: built

---

<a id="part-1h"></a>
## PART 1H — Dashboard Pages: Opportunities, Outcomes, Outreach, Reports (start)

### /opportunities/:id
- File wrapper + `OpportunityDetail.tsx`
- Purpose: Opportunity detail — Overview/Eligibility/Validation/Applications/Notes/Intelligence tabs.
- Interactive elements: Tabs ×6; "Apply Now"/"View Application"/"Applied"/"Closed"/"Expired" CTA; "Parse NOFA" (×2); "Edit" (modal)/"Delete" (modal); Notes textarea+submit; "Validate"/"Re-run validation"
- API calls: `GET /api/opportunities/{id}/probability`; `POST /api/agents/nofa-parser`; `POST /api/ai/validate`; `GET/POST /api/intelligence/fundability`; `GET /api/intelligence/briefing`
- Modals: `Modal` Edit (w/ `OpportunityForm`), `Modal` Delete confirm. Status: built

### /opportunities/new
- Purpose: Create-opportunity wrapper → `OpportunityForm`.
- Interactive elements: Inputs (name, amount available/min/max, deadline, URL, geographic restrictions); Selects (Category, Funder, Source type, Status, Application method, Recurrence); Textareas (Description, Eligibility); tag inputs (Required documents, Keywords); "Create opportunity"
- API calls: none via fetch — direct Supabase
- Modals: none. Status: built

### /opportunities
- Purpose: Grants/donations/sponsorships tracker with filter/sort/search, Land Bank Spotlight, expandable probability breakdowns.
- Interactive elements: "Run Land Bank Discovery"/"Discover More..." (housing orgs, editable); "Add Opportunity"; per-card Skip, Score Breakdown toggle, View, Apply Now; "Run Research Now" (empty state); filter chips (7); search input; Select status/sort
- API calls: `POST /api/intelligence/land-banks`; direct Supabase reads
- Modals: none. Status: built

### /outcomes/analytics
- Purpose: Outcomes & Analytics — pipeline funnel, success rates, dollar efficiency, source mix, deadline density, agent activity, ROI, YoY, top narratives, pattern insights. Embeds lazily-loaded `AnalyticsDashboard`.
- Interactive elements: "Back to outcomes" link; "Retry" (on error)
- API calls: none via fetch — direct Supabase (`AnalyticsDashboard`'s own controls not read, out of file scope)
- Modals: none. Status: built

### /outcomes
- Purpose: Record outcomes (awarded/partial/denied), triggers Recursive Learning Agent.
- Interactive elements: "View analytics" link; "Go to pipeline" (empty state); per-eligible-app "Record" → modal (`OutcomeForm`: Select outcome, conditional amount/denial-reason, Textarea feedback, Cancel/Record)
- API calls: `POST /api/agents/learning`; `POST /api/agents/funder-relationship` (best-effort); `POST /api/autonomous/grant-dna-trigger`; `POST /api/autonomous/knowledge-indexer-trigger`
- Modals: `Modal` "Record outcome". Status: built

### /outreach/campaigns/:id
- Purpose: **Deprecated — pure redirect stub** to `/email/campaigns` (schema consolidated; no id mapping exists between old/new).
- Status: placeholder-or-empty (unconditional `redirect()`, no UI)

### /outreach/campaigns
- Purpose: **Deprecated — pure redirect stub** to `/email/campaigns`.
- Status: placeholder-or-empty (unconditional `redirect()`)

### /outreach (root)
- Purpose: Cold outreach contact list (Cold Outreach Agent output), convert-to-funder, scan-new-company.
- Interactive elements: "Campaigns" link; "Scan company" (modal); table `SearchBar` + Select status filter; per-row "Convert to Funder" (modal) or "Converted" badge
- API calls: `POST /api/agents/outreach`
- Modals: `Modal` "Scan a company", `Modal` "Convert to funder". Status: built

### /outreach/sequences
- Purpose: **Deprecated — pure redirect stub** to `/email/campaigns` (backing table never applied to prod).
- Status: placeholder-or-empty (unconditional `redirect()`)

### /outreach/templates
- Purpose: Outreach template library per channel + "Donor Personalization Engine MVP" content-variant toggle.
- Interactive elements: "New Template" (modal, ×2); channel tabs (5); per-template variant pills + "+ Add variant"; New Template modal (name, Select channel, Subject, Body, Cancel/Create); New Variant modal (name, subject override, Body, Cancel/Add)
- API calls: `GET/POST /api/outreach/templates`; `PATCH/DELETE .../{tid}/variants/{vid}`; `POST .../{tid}/variants`
- Modals: `Modal` "New Template", `Modal` "New variant". Status: built

### /renewals
- Purpose: Renewal-obligation tracker sorted by nearest reporting deadline.
- Interactive elements: `ApplicationsViewToggle`; Button "Refresh"; "Generate Narrative" link per row; "View applications" (empty state)
- API calls: `GET /api/renewals`
- Modals: none. Status: built

### /reports/board-report
- Purpose: Auto-generated printable board report for a date range.
- Interactive elements: date range inputs; "Apply"; "Print / Export PDF"; "Generate Executive Summary"
- API calls: `GET /api/reports/board-report/detail?...`; `POST /api/reports/board-report/executive-summary`
- Modals: none. Status: built

### /reports/forecast
- Purpose: AG-26 Funding Forecast — 90-day/12-month probability-weighted projections.
- Interactive elements: Button "Run Forecast"/"Run New Forecast"
- API calls: `GET/POST /api/reports/forecast`
- Modals: none. Status: built

### /reports/funding-summary
- Purpose: Pipeline metrics, funding-by-source/category, monthly trend, "Opportunity Volume Trend" chart, top-funders table.
- Interactive elements: period toggle (This Month/Quarter/Year/All Time); "Export PDF"/"Export CSV"; trend grouping toggle (By Source Type/By Category)
- API calls: `GET /api/reports/funding-summary?period=...`; `GET /api/intelligence/trends`
- Modals: none. Status: built

### /reports/impact
- Purpose: Donor/funder impact report — mission, programs, financial stewardship, editable Stories of Impact, AI enhance.
- Interactive elements: "Print / Export PDF"; "Enhance with AI"; 2 story textareas; "Save Stories"
- API calls: `GET/PUT /api/reports/impact`; `POST /api/reports/impact/enhance`
- Modals: none. Status: built

---

<a id="part-1i"></a>
## PART 1I — Dashboard Pages: Reports (rest), Research, SchoolFunder, Search Profiles

### /reports (hub)
- Purpose: Board Reports hub — generate PDF + printable Board Report Summary, links to 3 other report pages.
- Interactive elements: 2 date-range forms (PDF gen, Summary gen); "Generate Board Report" ×2; "Download PDF"; "Print / Export"; 3 category cards (static); links to Funding Summary/Board Report/Impact Report
- API calls: `GET /api/reports/board-report?dateFrom=&dateTo=`; `POST /api/reports/board`
- Modals: none. Status: built

### /reports/roi
- Purpose: AG-39 ROI Optimizer — win rate, best submission day, optimal word count, attachment impact.
- Interactive elements: none — read-only (custom inline SVG charts)
- API calls: `GET /api/reports/roi`
- Modals: none. Status: built

### /reports/simulate
- Purpose: AG-37 Fundraising Simulator — 6 scenario types (board expansion/staff hire/geo expansion/new program/budget increase/partnership).
- Interactive elements: 6 scenario buttons + scenario-specific fields (sliders, selects, number/text inputs); "Run Simulation"; per-past-sim "View"
- API calls: `GET/POST /api/reports/simulate`
- Modals: none. Status: built

### /research/match
- Purpose: Keyword/Jaccard-overlap foundation matcher (distinct from AI-scored `/intelligence/matches`).
- Interactive elements: Textarea mission; number inputs min/max grant; Select state; "Run Match"
- API calls: `POST /api/match/foundations`
- Modals: none. Status: built

### /research (hub)
- Purpose: "Research Command Center" — run research agents, browse resources/funding-source directory, discovered opportunities, historical federal awards; embeds Search Configuration as a 2nd tab.
- Interactive elements: Tabs "Research"/"Search Configuration"; resource search+category filter+"Browse all"/"Hide"+per-card "Visit"; agent launchpad — "Run All 4" + 4 lanes (Corporate Giving/Foundation Grants/Government Grants/Local Sponsorship), "Run All 6" + 6 lanes (Grants.gov/SAM.gov/Simpler Grants/HUD/TDHCA/Corporate Directory); `RunHistory`; funding-source directory search + "Poll Now" + per-group Show/Hide + "Visit →"; discovered-opportunities search+Search button+Clear+per-card Apply/applied-badge; "Pull Historical Awards"; footer "View agent run history →"
- API calls: `POST /api/sources/poll`; `POST /api/agents/usaspending`; `POST /api/agents/research`
- Modals: none. Status: built (10 distinct agent-trigger lanes + 2 "Run All" bulk actions)

### /schoolfunder
- File: server component + `SchoolFunderBoard.tsx`
- Purpose: Faith Foundation program — students earn donor-funded tuition assistance via volunteering.
- Interactive elements: "+ Add Student"/"Cancel" toggle (form: First/Last Name, Email, School, Grade, Target Amount, Save); per-student "Log Hours" (inline form: Hours, Activity, Save) and "View Details"/"Hide Details" toggle
- API calls: `GET/POST /api/schoolfunder`; `POST /api/schoolfunder/hours`
- Modals: none (inline forms). Status: built — page.tsx has explicit fallback messaging if `schoolfunder_*` tables aren't migrated in an environment

### /search-profiles/configure
- File: re-export → `SearchConfiguration.tsx` (also embedded as Research's "Search Configuration" tab)
- Purpose: Full "Discovery Preferences" config for a single search profile.
- Interactive elements: extensive — profile name, keyword tag input, active checkbox, funding-type checkbox grid, ranked source-category priority list (raise/lower/remove + add), focus-area weighted tags, min/max amount, recurrence select, geographic scope tag input w/ presets, eligibility pre-filter checkboxes, min org age, populations tag input w/ presets, excluded-categories grid, excluded-funders tag input, per-research-family enable checkbox + schedule select; sticky Cancel/Save
- API calls: none via fetch — direct Supabase
- Modals: none. Status: built

### /search-profiles (root)
- Purpose: List/manage saved search configs — quick create/edit modal + link to Advanced setup.
- Interactive elements: "Advanced setup" link; "New profile" (modal, ×2); per-card Pause/Activate, configure icon (→ configure page), edit icon (modal), delete icon (modal); create/edit modal (name, keywords, category checkboxes, geographic scope, recurrence, min/max amount, active, Cancel/Save); delete-confirm modal
- API calls: none via fetch — direct Supabase
- Modals: `Modal` create/edit, `Modal` delete-confirm. Status: built

---

<a id="part-2"></a>
## PART 2 — Settings Sub-Tabs: Full Audit

### Routed settings pages (all under `src/app/(dashboard)/settings/`)

**`layout.tsx`** — shared tab strip: "General" (→ `/settings`), "Organization Setup", "Integrations", "Agents", "Notifications", "Branding", "Custom APIs", "Scraping Targets", "Billing" (owner-only), "White-Label" (owner-only). **`/settings/state-portals` has no entry in this tab strip** — it's a real page reachable only via a "Configure" link buried in the Integrations page.

**`/settings` (page.tsx, "General")** — internal (non-routed) left-sidebar switching 5 sections via React state, NOT separate routes:
- **Organization**: Input org name, "Save changes". Backed by live `organizations` read/update.
- **Team**: live roster (`profiles`), per-row role select, remove icon, `InviteModal` (email+role, shows shareable link + copy), pending-invitations list (Resend/Cancel).
- **Plan Usage**: read-only usage bars (Opportunities/Applications/AI Drafts/Agent Runs/Storage/Team Members) from `GET /api/billing/usage`, "Upgrade your plan" link when limit reached.
- **Feature Flags**: read-only list from `platform_config` (5 flags: Automated research agents, Browser automation, Email & calendar integration, Cold outreach email sending, Stripe subscription billing) — intentionally non-interactive, "managed by Benavora."
- **Danger Zone** (owner-only): text-only callout, no controls of its own (points at Team's Remove).
- API calls: `PUT/DELETE /api/users`; `POST /api/users/invite`; `GET /api/billing/usage`; direct Supabase for org/team/flags.
- Modals: `InviteModal`, `Modal` "Remove team member". Status: built (all 5 sections real, Feature Flags/Danger Zone read-only by design)

**`/settings/agents`** — 8 agent-enable toggles + Relationship Builder v2 toggle (owner/admin) + auto-draft threshold slider + max-per-night input + decision-log filter/approve/reject/pagination.
- API: `GET/PATCH /api/autonomous/config`; `GET/PATCH /api/settings/agents/relationship-builder-v2`; `GET/PATCH /api/autonomous/decisions`. Modals: none. Status: built.

**`/settings/billing`** — 6-line re-export of `(dashboard)/billing/page.tsx`, rendered directly (not redirected) so the tab strip stays visible. Same content as `/billing`. Status: built.

**`/settings/branding`** — logo upload, 3-color picker+hex, login/footer message textareas, email-branding fields, each with its own Save.
- API: none via fetch — direct Supabase (`org-branding` storage bucket, `platform_config` upsert). Modals: none. Status: built.

**`/settings/custom-apis`** — connection cards (Run Now/Pause/Activate/Delete), shared `CustomConnectorAllowlist` component, `AddConnectionModal` (name, base URL, auth type, poll schedule, Test Connection, field-mapping JSON).
- API: `GET/PATCH/DELETE /api/integrations/custom-api[/{id}]`; `POST /api/agents/custom-api`; `POST /api/integrations/custom-api/test`; allowlist endpoints. Modals: `AddConnectionModal`, delete-confirm. Status: built.

**`/settings/integrations`** — Gmail/Calendar OAuth cards, Platform-Managed sources (Grants.gov/ProPublica/State Portals w/ Run Now + Configure link), Self-Connect keys (SAM.gov, 2Captcha, read-only Resend status).
- API: `GET/POST /api/integrations/keys`; `GET /api/settings/integrations/status`; `GET /api/email/auth`, `POST /api/email/sync`; `GET /api/calendar/auth`, `POST /api/calendar/sync`; `POST /api/agents/grants-gov`, `/propublica`, `/state-portals`, `/sam-gov`. Modals: disconnect-confirm. Status: built.

**`/settings/notifications`** — per-event in-app/email checkbox table + Save.
- API: `GET/POST /api/settings/notifications`. Modals: none. Status: built.

**`/settings/organization-setup`** — 7-step onboarding progress tracker, "Resume setup"/"Review" links back into `/onboarding`.
- API: none via fetch — direct Supabase. Modals: none. Status: built.

**`/settings/scraping`** — target cards (Run Now/Pause/Activate/Delete), shared allowlist component, `AddTargetModal` (URL, what-to-look-for, schedule).
- API: `GET/PATCH/DELETE /api/integrations/scraping-targets[/{id}]`; `POST /api/agents/custom-scrape`; allowlist endpoints. Modals: `AddTargetModal`, delete-confirm. Status: built.

**`/settings/state-portals`** — read-only `PORTAL_REGISTRY` (currently just Texas) + live non-persisting preview scrape per state. **Not in the tab strip** (reachable only via Integrations page link).
- API: `GET /api/sources/state-portals?state=`. Modals: none. Status: built (intentionally minimal by design).

**`/settings/white-label`** — consultant-tier client-org access grants list, `AddClientModal` (email).
- API: `GET/DELETE/POST /api/consultant/clients`. Modals: `AddClientModal`. Status: built.

### The 19-name stakeholder audit (verbatim verdicts)

| # | Name | Verdict |
|---|---|---|
| 1 | Organization | EXISTS AS SECTION on `settings/page.tsx` — real form, live `organizations` read/update. Default-active tab. |
| 2 | Team | EXISTS AS SECTION on `settings/page.tsx` — real roster, role-change, remove, invite modal. Not its own route. |
| 3 | Plan Usage | EXISTS AS SECTION — live `GET /api/billing/usage` data. Not its own route. |
| 4 | Feature Flags | EXISTS AS SECTION — real `platform_config` reads, deliberately read-only. Not its own route. |
| 5 | Danger Zone | EXISTS AS SECTION — owner-only static callout, no controls of its own. Not its own route. |
| 6 | Organization Setup | EXISTS AS REAL PAGE — `settings/organization-setup/page.tsx`. In tab strip. Built. |
| 7 | Integrations | EXISTS AS REAL PAGE — `settings/integrations/page.tsx`. In tab strip. Built (1264 lines). |
| 8 | Agents | EXISTS AS REAL PAGE — `settings/agents/page.tsx`. In tab strip. Built. |
| 9 | Notifications | EXISTS AS REAL PAGE — `settings/notifications/page.tsx`. In tab strip. Built. |
| 10 | Branding | EXISTS AS REAL PAGE — `settings/branding/page.tsx`. In tab strip. Built. |
| 11 | Custom APIs | EXISTS AS REAL PAGE — `settings/custom-apis/page.tsx`. In tab strip. Built. |
| 12 | Scraping Targets | EXISTS AS REAL PAGE — `settings/scraping/page.tsx`. In tab strip. Built. |
| 13 | Billing | EXISTS AS REAL PAGE — `settings/billing/page.tsx` (re-exports `(dashboard)/billing`). In tab strip, owner-only. Built. |
| 14 | White-Label | EXISTS AS REAL PAGE — `settings/white-label/page.tsx`. In tab strip, owner-only. Built. |
| 15 | Compliance | **DOES NOT EXIST inside `/settings/*` at all.** Lives only as its own top-level page `(dashboard)/compliance/page.tsx`. Zero references in `settings/page.tsx`. |
| 16 | Financials | **DOES NOT EXIST inside `/settings/*`.** Top-level page `(dashboard)/financials/page.tsx`. Zero references. |
| 17 | Reports | **DOES NOT EXIST inside `/settings/*`.** Top-level page `(dashboard)/reports/page.tsx`. Zero references. |
| 18 | Alerts | **DOES NOT EXIST inside `/settings/*`.** Top-level page `(dashboard)/alerts/page.tsx`. Zero references. |
| 19 | Outcomes & Analytics | **DOES NOT EXIST inside `/settings/*`.** Top-level page at `/outcomes` (+ `/outcomes/analytics` sub-route) — note the real URL is `/outcomes`, not `/outcomes-analytics`. Zero references. |

**Confirmed**: `settings/page.tsx`/`layout.tsx` contain zero links to `/compliance`, `/financials`, `/reports`, `/alerts`, or `/outcomes` — these five are wired only into the main dashboard nav (`src/components/layout/nav-items.ts`), fully independent of Settings. There are no settings-specific duplicate/mini versions and no dead links for them — Settings simply doesn't surface them in any form.

---

<a id="part-3"></a>
## PART 3 — Marketing & Auth Pages

### / (marketing homepage)
- File: `src/app/(marketing)/page.tsx`
- Purpose: Dark "forest" hero, interactive 48-agent "neural fleet" visualization, "Three doors" (Platform/Agents/Demo), 11-step lifecycle strip, Platform grid, Solutions grid, mission callout, closing CTA.
- Interactive elements: "Book a demo" (×2, → `/demo`); "See the platform" (→ `/platform`); "Ask Benavora" (→ `/resources#ask`); static "Demo Replay" placeholder box (non-clickable); `NeuralFleetVisualization` — 9 clickable agent-family nodes opening an inline `role="dialog"` agent-inventory panel with Close; 3 door cards w/ "Explore" links; 11 lifecycle pill links; Platform/Solutions grid links; "Why Benavora" link
- API calls: none
- Modals opened: none (agent-inventory panel is an inline overlay inside `NeuralFleetVisualization`, not a separate modal component)
- Status: built

### /for-consultants
- File: wrapper → `ForConsultantsClient.tsx`
- Purpose: Agency/consultant landing page w/ live pricing calculator.
- Interactive elements: "Schedule a Demo" (×2, mailto); range slider "Number of clients" (2-20) recalculating Monthly/One-time totals
- Status: built

### /how-it-works
- File: wrapper → `HowItWorksClient.tsx`
- Purpose: 8-stage scroll-triggered pipeline walkthrough with honest "What's real today" caveats.
- Interactive elements: "Back to home"; "Start Free Trial" (nav + closing, → `/register`); 8× "What's real today" toggle; simulated (non-interactive) "Approve" cursor animation; "Back to homepage"
- Status: built

### /pricing
- File: wrapper → `PricingPageClient.tsx`
- Purpose: 3 plan cards + Monthly/Annual toggle + FAQ accordion.
- Interactive elements: Monthly/Annual toggle; 3 CTA links/mailto (Starter/Professional trial, Enterprise contact sales); 5 FAQ accordion rows
- Status: built

### /privacy
- Purpose: Static Privacy Policy (10 sections). Interactive: 3 mailto links. Status: built.

### /security
- Purpose: Static Security page (encryption, TLS, RLS, SOC2 status, GDPR). Interactive: 6 static trust badges (non-interactive), 2 mailto links. Status: built.

### /terms
- Purpose: Static Terms of Service (11 sections). Note: lists pricing figures that diverge from the live `/pricing` page's `PRICING_PLANS` values. Interactive: 1 mailto link. Status: built.

### /[...slug] (MDX catch-all)
- File: `src/app/(marketing)/[...slug]/page.tsx`
- Purpose: Static-generation catch-all reading MDX from `content/marketing/**/*.mdx`, 3 layout templates (`platform`/`solution`/`single`). `dynamicParams = false` — only 19 discovered slugs are servable:
  `/platform`, `/platform/funding-intelligence`, `/platform/opportunity-discovery`, `/platform/ai-grant-writer`, `/platform/autoapply`, `/platform/pipeline-crm`, `/platform/analytics`, `/agents`, `/solutions`, `/solutions/faith-based`, `/solutions/human-services`, `/solutions/housing`, `/solutions/veterans`, `/solutions/education`, `/solutions/community-development`, `/why-benavora`, `/trust`, `/company`, `/demo`, `/resources`
- Status: built (per-page interactive elements not itemized individually — template-driven CTAs/related-links)

### /login
- File: wrapper → `LoginPageClient.tsx`
- Interactive elements: Sign-in form (Email, Password); "Sign in" submit; "Forgot password?" link; "Create one" link
- API calls: `supabase.auth.signInWithPassword`; `POST /api/auth/log-event`
- Status: built (hard `window.location.href` redirect — documented WGR-099 cookie-timing workaround)

### /register
- File: wrapper → `RegisterPageClient.tsx`
- Interactive elements: Create-account form (Org name, Your name, Email, Password, Confirm password); "Create account" submit; "Change plan" link (if `?plan=`); "Sign in" link
- API calls: `supabase.auth.signUp`; `supabase.rpc("register_organization")`
- Status: built

### /forgot-password
- File: wrapper → `ForgotPasswordPageClient.tsx`
- Interactive elements: Email form; "Send reset link"; "Back to sign in" (×2) — deliberately anti-enumeration (same success state regardless of whether email exists)
- API calls: `supabase.auth.resetPasswordForEmail`
- Status: built

### /reset-password
- File: wrapper → `ResetPasswordPageClient.tsx`
- Interactive elements: New password + Confirm form; "Update password"; "Back to sign in"; "Request a new link" (expired-link state)
- API calls: `supabase.auth.exchangeCodeForSession`; `supabase.auth.updateUser`
- Status: built (documented WGR-133 Strict-Mode double-invoke fix)

---

<a id="part-4"></a>
## PART 4 — API Routes (341 handlers, 9 batches)

> Method-by-method, one row per exported handler. "Description" states what the handler actually does per the code, including its auth/gating mechanism.

### Batch 1 — admin/* + agents (application-cloner → disaster)

| Route | Method | Description |
|---|---|---|
| /api/activity | GET | Org activity feed combining `agent_runs`, `applications` (drafts), `opportunities`, `alerts` into one timeline (50 newest, 20/source cap). `requireRole("viewer")`. |
| /api/admin/audit-log | GET | Reads `audit_logs` newest-first w/ actor enrichment. `requireRole("admin")`; admins org-scoped, owners cross-org via service-role, filterable (orgId/action/entityType/userId/date/limit≤1000). |
| /api/admin/autoapply-ops | GET | Cross-tenant AutoApply ops dashboard — worker heartbeat, queue depth, pause flag, success/fail metrics, cost breakdown, portal block-rate, tenant activity. `requireRole("admin")`, service-role client. |
| /api/admin/campaigns/:id | GET | One `sales_campaigns` row + steps + sends. `requireRole("owner")`. |
| /api/admin/campaigns/:id | PATCH | Updates status/name/description/daily_send_target/window/timezone/filter_criteria. `requireRole("owner")`. |
| /api/admin/campaigns/:id | POST | Action dispatcher: schedule/pause/resume via `SalesCampaignEngine`. `requireRole("owner")`. |
| /api/admin/campaigns | GET | Lists all `sales_campaigns` + steps + sends (id/status). `requireRole("owner")`. |
| /api/admin/campaigns | POST | Creates a campaign via `SalesCampaignEngine.createCampaign` after field validation. `requireRole("owner")`. |
| /api/admin/command-center | GET | Cross-org Command Center snapshot via `getCommandCenterSnapshot()`. `requireRole("owner")`; force-dynamic. |
| /api/admin/domains/:id | GET | One `sending_domains` row + health/warmup via `DomainManager`. `requireRole("owner")`. |
| /api/admin/domains/:id | PATCH | Updates target_daily_limit/is_active. `requireRole("owner")`. |
| /api/admin/domains/:id | DELETE | Soft-deletes (is_active=false). `requireRole("owner")`. |
| /api/admin/domains | GET | Lists `sending_domains`. `requireRole("owner")`. |
| /api/admin/domains | POST | Adds a domain via `DomainManager.addDomain`. `requireRole("owner")`. |
| /api/admin/improvements/:id | PATCH | Approves/rejects an AG-38 proposal (status update only — "implemented" not settable here). `requireRole("admin")`, service-role, table has no RLS. |
| /api/admin/improvements | GET | Platform-wide `improvement_proposals` feed + summary counts + 7-day `agent_performance_metrics`. `requireRole("admin")`, service-role. |
| /api/admin/jobs/:id/retry | POST | Resets a failed `automation_queue` row to queued. `requireRole("admin")`, service-role. |
| /api/admin/monitor | GET | Cross-tenant `automation_queue` health snapshot w/ funder-name resolution. `requireRole("admin")`, service-role. |
| /api/admin/orgs/:id/impersonate | POST | Logs impersonation, sets 1hr `impersonation_org_id` cookie (scoped to `/admin` — doesn't change org resolution elsewhere). `requireRole("owner")`, service-role. |
| /api/admin/orgs/:id/impersonate | DELETE | Clears the impersonation cookie. `requireRole("owner")`. |
| /api/admin/orgs/:id | GET | Detailed org view — org row, subscription, KB completeness, recent agent_runs, strategic_recommendations, opportunities, autonomous config. `requireRole("owner")`, service-role. |
| /api/admin/orgs/:id | POST | Actions: run_pipeline (agent_queue ag-17), reset_onboarding, upgrade_plan (Stripe portal). `requireRole("owner")`. |
| /api/admin/orgs/:id/suspend | POST | Sets subscription_tier="suspended". `requireRole("owner")`, service-role. |
| /api/admin/orgs | GET | Platform-wide org list + subscription status + 7-day agent_runs counts. `requireRole("owner")`, service-role. |
| /api/admin/platform-metrics | GET | Cross-tenant org/user/opportunity/application/submitted counts, total awarded, signups/30d, plan breakdown, revenue estimate (hardcoded PLAN_PRICES). `requireRole("owner")`, service-role. |
| /api/admin/prospects/:id | GET | One `prospects` row. `requireRole("owner")`, service-role. |
| /api/admin/prospects/:id | PATCH | Updates status/suppressed fields. `requireRole("owner")`. |
| /api/admin/prospects/:id | DELETE | Soft-delete via `ProspectManager.suppressProspect` + status=inactive. `requireRole("owner")`. |
| /api/admin/prospects | GET | Paginated/filterable `prospects` list. `requireRole("owner")`, service-role. |
| /api/admin/prospects | POST | CSV import via `ProspectManager.importFromCsv`. `requireRole("owner")`. |
| /api/admin/prospects/stats | GET | `ProspectManager.getStats(listId)`. `requireRole("owner")`. |
| /api/admin/sales-analytics/export | GET | CSV export of sends/prospects/suppression/campaigns by `?type=`. `requireRole("owner")`, service-role. |
| /api/admin/sales-analytics | GET | Sales-outreach analytics (rates, breakdowns, top subjects, send-time performance) over 7d/30d/90d. `requireRole("owner")`, service-role. |
| /api/admin/suppression/import | POST | CSV parse + insert into `suppression_list` + mark matching `prospects` suppressed. `requireRole("owner")`, service-role. |
| /api/admin/suppression | GET | Lists `suppression_list`. `requireRole("owner")`, service-role. |
| /api/admin/suppression | POST | Inserts one email (409 on dup). `requireRole("owner")`. |
| /api/admin/system | GET | Platform-wide system health (worker heartbeats, running agent_runs, queue depths, error count, avg duration) — degrades to 200 w/ `supabase_healthy:false` on error. `requireRole("admin")`, service-role. |
| /api/admin/system | POST | `clear_stuck_jobs` — marks >2hr running agent_runs as failed. `requireRole("owner")`. |
| /api/admin/usage | GET | Org usage summary (today/7d/30d + tier limits). `requireRole("admin")`. |
| /api/admin/webhooks/email-events | POST | Resend delivery webhook — Svix HMAC-verified, 5min replay window; updates `sales_sends`, calls `UnsubscribeAgent` on bounce, suppresses on complaint. No role gate (signature-authenticated). |
| /api/admin/webhooks/email-reply | POST | Resend inbound-reply webhook, same Svix verification; resolves originating send, classifies reply intent via `UnsubscribeAgent`. No role gate. |
| /api/agents/application-cloner | POST | Clones a source application's draft into a new opportunity via `ApplicationClonerAgent`. `requireRole("writer")`, rate-limited, `maxDuration=300`. |
| /api/agents/automation/:sessionId/approve | POST | `approveAndSubmit` — resumes browser session, replays fields, submits, captures confirmation. The only automated path to a real submission (Contracts §18). `requireRole("admin")`, `maxDuration=300`. |
| /api/agents/automation/:sessionId | GET | Returns one automation session + steps + screenshots. Session-authenticated, no explicit role gate beyond auth. |
| /api/agents/automation/:sessionId | PUT | reject / update_fields / approve (approve inline-checked to owner/admin). |
| /api/agents/automation | POST | Starts a browser-automation run — creates `automation_sessions` + `submission_queue` row for the Railway worker (does NOT run Playwright inline, per WGR-167). `requireRole("writer")`, `maxDuration=300`. |
| /api/agents/campaigns/:campaignId | GET | Detailed `email_campaigns` stats (steps, contacts, open/reply/conversion rates). Session-authenticated, RLS-scoped. |
| /api/agents/campaigns/:campaignId | PUT | Updates campaign lifecycle status (draft→active→paused/completed). Role in {owner,admin,writer}. |
| /api/agents/campaigns | POST | Runs active outreach campaigns immediately via `EmailCampaignAgent.run({force:true})`. `requireRole("writer")`, gated by `feature.cold_outreach_email`. |
| /api/agents/campaigns | GET | Campaign summary + list. Session-authenticated. |
| /api/agents/competitor-intel | POST | `CompetitorIntelAgent` for a funder. `requireRole("writer")`, gated Enterprise/Consultant via `feature.competitor_intel`, `maxDuration=300`. |
| /api/agents/corporate-research | POST | `CorporateScraperAgent` — scrapes corporate giving pages. `requireRole("writer")`, `maxDuration=300`. |
| /api/agents/custom-api | POST | `CustomApiResearchAgent` (manual-trigger only). `requireRole("writer")`, `maxDuration=300`. |
| /api/agents/custom-scrape | POST | `CustomScrapeResearchAgent`. `requireRole("writer")`, `maxDuration=300`. |
| /api/agents/deadline-prediction | POST | `DeadlinePredictionAgent`. `requireRole("writer")`, rate-limited, `maxDuration=60`. |
| /api/agents/disaster | GET | Best-effort FEMA poll (failure swallowed) + 20 most recent `disaster_declarations` (shared table). `requireRole("viewer")`, `maxDuration=300`. |
| /api/agents/disaster | POST | Deploys disaster response for the org via `deployDisasterResponse`. `requireRole("writer")`, `maxDuration=300`. |

### Batch 2 — agents (discovery → usaspending)

| Route | Method | Description |
|---|---|---|
| /api/agents/discovery | POST | `runOpportunityDiscovery` (AG-17) → `discovery_matches`. Session + `x-organization-id` header. |
| /api/agents/discovery | GET | Top 10 `discovery_matches` by match_score. |
| /api/agents/eligibility | POST | `EligibilityScorer` (Agent 02); fire-and-forget chains `DraftQueueEngine.processNewOpportunities`. `writer`, rate-limited 20/min + quota. |
| /api/agents/email-parser | POST | `EmailParserAgent` classifies ≤50 emails → `email_activity`. `writer`, rate-limited 20/min + quota. |
| /api/agents/follow-up | POST | `FollowUpGeneratorAgent` for an application. `writer`, quota-checked. |
| /api/agents/form-analyzer | POST | `FormAnalyzerAgent` — Playwright scrape + Claude form analysis → `form_templates` (Playwright fails on Vercel, works locally/worker). `writer`, rate-limited 5/min. |
| /api/agents/form-filler | POST | `FormFillerAgent` — Playwright fill/submit via `form_templates`. `writer`, quota-checked. |
| /api/agents/foundation-finder | POST | `FoundationFinderAgent` scrapes free directories. `writer`. |
| /api/agents/funder-intel | POST | `FunderIntelAgent` → Claude extraction → `funder_intelligence` upsert. `writer`, rate-limited 10/min. |
| /api/agents/funder-relationship | POST | `FunderRelationshipAgent` (deterministic, non-AI). `writer`, rate-limited 200/hour. |
| /api/agents/giving-history | POST | `GivingHistoryAgent` — ProPublica 990-PF → `funder_intelligence.recent_grants`. `writer`, rate-limited 10/min. |
| /api/agents/grants-gov | POST | `GrantsGovResearchAgent` (Agent 15) against live Grants.gov. `writer`. |
| /api/agents/housing-specific | POST | `HousingSpecificScrapersAgent` — NeighborWorks + FHLB. `writer`. |
| /api/agents/hud-monitor | POST | `HudMonitorAgent` — HUD funding opportunities page. `writer`. |
| /api/agents/keyword-expansion | POST | `expandKeywords` (Claude) — suggestion-only, not saved. `writer`. |
| /api/agents/learning | POST | `RecursiveLearningAgent` (Agent 10) — extracts proven narratives from awarded drafts. `writer`, rate-limited 20/min. |
| /api/agents/morning-digest | POST | `sendMorningDigest` (AG-17 7am step). Session + org header. |
| /api/agents/morning-digest | GET | Most recent `alerts` row w/ dedup_key `morning-digest:*`. |
| /api/agents/nofa-parser | POST | `NofaParserAgent` — parses NOFA PDFs, enriches opportunity. `writer`. |
| /api/agents/outreach | POST | `ColdOutreachAgent` (Agent 11) — fetches company site, extracts contacts. `writer`, rate-limited 20/min. |
| /api/agents/playwright | POST | `PlaywrightAgent` — discover (info-only) or apply (Claude field-mapping, pauses for human approval, never auto-submits) corporate portal automation. `writer`, rate-limited 10/min. |
| /api/agents/propublica | POST | `ProPublicaMiningAgent` (Agent 17) — defaults to org's own name/state if unspecified. `writer`. |
| /api/agents/registry/:agentId/runs | GET | Paginated `agent_runs` filtered by agent_id, for Agent Log Viewer. `viewer`. |
| /api/agents/registry/configure | POST | Upserts `agent_configurations` (enabled/config) after validating agent_id exists. `writer`. |
| /api/agents/registry | GET | `agent_registry` left-joined with org's `agent_configurations`, for Agent Marketplace. `viewer`. |
| /api/agents/research-config | POST | `generateOrgResearchConfig`. `writer`. |
| /api/agents/research/quality | POST | `checkDataQuality` (read-only, org-scoped, no writes). `writer`, ≤200 ids. |
| /api/agents/research | POST | Two modes: `sources[]` (rate-limited 20/min, chains EligibilityScorer post-insert) or `agentType` (tier-gated `feature.research_agents`, single or parallel run). `writer`. |
| /api/agents/research/status | GET | `agent_runs` filtered by agentType/status/limit(≤100). Session-authenticated, no explicit role gate. |
| /api/agents/sam-gov | POST | `SamGovResearchAgent` (Agent 16) — org key from `integration_keys` w/ env fallback. `writer`. |
| /api/agents/semantic-matching | POST | `SemanticMatchingAgent`, ≤50 topN. `writer`, quota-checked. |
| /api/agents/simpler-grants | POST | `SimplerGrantsResearchAgent` against Simpler.Grants.gov. `writer`. |
| /api/agents/simulate | POST | `ImpactSimulationAgent` (AG-41) — writes `impact_simulations`, returns row. `writer`. |
| /api/agents/state-portals | POST | `StatePortalResearchAgent` (Agent 18). `writer`. |
| /api/agents/state-scrapers | POST | `StateScrapersAgent` — 5 state housing agency pages. `writer`. |
| /api/agents/success-probability | POST | `SuccessProbabilityAgent` (Agent 22, 6-factor model) → `success_probability_scores`. `writer`, rate-limited 100/hour. |
| /api/agents/tdhca | POST | `TdhcaScraperAgent`. `writer`. |
| /api/agents/usaspending | POST | `UsaspendingAgent` — pulls historical federal awards → `historical_awards`. `writer`. |

### Batch 3 — ai/*, alerts, applications/*, auth/*, autoapply/*

| Route | Method | Description |
|---|---|---|
| /api/ai/budget | POST | `BudgetAgent` generates structured budget table + narrative, grounded in KB/proven_narratives. `writer`, rate-limited 20/min + daily quota. |
| /api/ai/draft/rescore | POST | Recomputes draft confidence from KB/proven_narratives counts + `[NEEDS INPUT]` markers. No writes. `writer`. |
| /api/ai/draft | POST | `generateDraft()` narrative → `agent_runs` log; tier/usage quota (`checkTierGate`, `withUsageCheck`). `writer`. |
| /api/ai/fit-analysis | POST | Claude "should we apply" fit analysis using org profile + funder + outcomes success rate; saves to `notes`. `writer`. |
| /api/ai/humanize | POST | `runHumanizer` second-pass anti-detection rewrite → new `draft_versions` row. `writer`. |
| /api/ai/review | POST | `ReviewAgent` critique of a draft. `writer`. |
| /api/ai/summarize | POST | `GrantSummaryAgent` — extracts/patches opportunity fields from raw text. `writer`. |
| /api/ai/validate | POST | `validateOpportunity` cross-provider (Claude+Gemini) consensus → `validations` upsert. `writer`. |
| /api/alerts | GET | Regenerates alerts from live deadlines/opportunities/applications signals, upserts+prunes `alerts`. `viewer`. |
| /api/applications/:id/budget | GET/POST | Reads/writes most-recent `grant_budgets` row for the application. `viewer`/`writer`. |
| /api/applications/:id/clone | POST | Claude-adapts source draft to a new opportunity, inserts new `applications` row. `writer`. |
| /api/applications/:id/expenses | GET/POST | Lists/creates `grant_expenses`. `viewer`/`writer`. |
| /api/applications/:id/reconcile | GET | Budget-vs-actual variance → `grant_reconciliation_reports` upsert. `viewer`. |
| /api/applications/:id | PATCH | Updates only `pending_review` flag (autonomous draft dismiss). `writer`. |
| /api/assist | POST | `answerApp()` in-app assist Q&A. `viewer`. |
| /api/audit | POST | `logAudit()` with server-derived org/user/IP. `viewer` (whitelisted actions). |
| /api/auth/callback | GET | Exchanges Supabase code, calls `register_organization()` RPC, redirects to `/dashboard`. |
| /api/auth/log-event | POST | Login/logout event, stamps `last_login_at` on login. |
| /api/autoapply/ab-tests | GET/POST/DELETE | A/B test results / create variant / soft-deactivate. `viewer`/`writer`. |
| /api/autoapply/agreements/:id | GET/PUT | Single agreement / update. `viewer`/`writer`. |
| /api/autoapply/agreements | GET/POST | List / create `grant_agreements`. `viewer`/`writer`. |
| /api/autoapply/autonomous-status | GET | `org_autonomous_config` + last completed orchestrator run + pending/processing queue count. `viewer`. |
| /api/autoapply/config | GET/POST | Read `auto_queue_config` / upsert (admin). |
| /api/autoapply/controls | GET/POST/DELETE | Pause status (`owner`) / apply pause (`admin` for platform, else `owner`) / resume. |
| /api/autoapply/documents/readiness | GET | `DocumentVault.getReadinessReport`. `viewer`. |
| /api/autoapply/documents | GET/POST | List / upload (multipart) via `DocumentVault`. `viewer`/`writer`. |
| /api/autoapply/follow-ups/:id | PATCH | send_now / reschedule / cancel. `writer`. |
| /api/autoapply/follow-ups/cancel-all/:funderId | PATCH | Bulk-cancels pending follow-ups for a funder. `writer`. |
| /api/autoapply/follow-ups | GET | Lists w/ funder name + status, filterable. `viewer`. |
| /api/autoapply/follow-ups/stats | GET | Pending/sent-this-month/response-rate. `viewer`. |
| /api/autoapply/mode | GET/POST | Org autoapply_mode read/set ("autonomous" restricted to owner). `viewer`/`admin`. |
| /api/autoapply/profiles/:id | GET/PUT/DELETE | Single profile / update / soft-delete. `viewer`/`writer`. |
| /api/autoapply/profiles | GET/POST | List (enriched w/ submission stats) / create. `viewer`/`writer`. |
| /api/autoapply/queue-populate | POST | Synchronous single-org `populateQueue()` (same as nightly cron). `writer`, rate-limited. |
| /api/autoapply/queue | POST | Donor-discovery handoff or batch-mode queue insert (tier batch cap). `writer`. |
| /api/autoapply/review-queue/:id/reassign | PATCH | Reassigns via RPC, notifies assignee. `writer`. |
| /api/autoapply/review-queue/:id/resume | PATCH | Atomic RPC resume (409 if already handled). `writer`. |
| /api/autoapply/review-queue/:id/skip | PATCH | Atomic RPC skip w/ reason enum. `writer`. |
| /api/autoapply/review-queue/ambiguous/:id/resolve | PATCH | Resolves ambiguous Gmail-match candidate. `writer`. |
| /api/autoapply/review-queue | GET | Paused-for-verification + ambiguous-match tabs, org-filtered even though underlying tables are RLS-locked to service role. `writer`. |
| /api/autoapply/templates/test | POST | `StealthBrowser` dry-run fill (no submit), screenshot + resolved values. `writer`. |
| /api/autoapply/test | POST | Manual test submission queue insert. `writer`. |
| /api/autoapply/usage/keys | GET/POST/PATCH | Masked key hints / save (encrypted) / toggle own-keys flag. `viewer`/`admin`. |
| /api/autoapply/usage | GET | `UsageMeter.getUsageReport`. `viewer`. |
| /api/autoapply/webhooks | GET/POST/DELETE | List / create / delete `webhook_configs`. `viewer`/`admin`. |

### Batch 4 — automation/*, autonomous/*, billing, board, calendar, command-center, compliance, consultant, contacts, cron/*, deadlines

| Route | Method | Description |
|---|---|---|
| /api/automation/portal-credentials | GET/POST/DELETE | Read status / save (encrypted) / delete portal credentials via `PortalCredentialManager`. `viewer`/`writer`. |
| /api/automation/process | POST | `AutomationWorkerAgent` (Agent 29) processes next/specified queue item. `writer`, `maxDuration=300`. |
| /api/automation/queue | GET/POST/PATCH/PUT | List / insert (tier-gated automation level) / update level / retry failed. `writer`. |
| /api/automation/stats | GET | Queue status counts vs tier `DAILY_LIMITS`. `writer`. |
| /api/autonomous/board-packet-trigger | POST | Enqueues AG-27 for a board meeting within 48h. `writer`, rate-limited. |
| /api/autonomous/config | GET/PATCH | Org autonomy toggles/thresholds. `viewer`/`writer`. |
| /api/autonomous/decisions | GET/PATCH | List agent_decisions / record human verdict (approving an AG-25 deploy actually deploys it). `viewer`/`writer`. |
| /api/autonomous/followup-trigger | POST | Enqueues AG-28 off a pipeline-stage transition. `writer`, rate-limited. |
| /api/autonomous/grant-dna-trigger | POST | Enqueues AG-10 off a new outcome. `writer`, rate-limited. |
| /api/autonomous/knowledge-indexer-trigger | POST | Enqueues AG-29 via `enqueueKnowledgeIndexerTrigger()`. `writer`, rate-limited. |
| /api/autonomous/queue | GET/DELETE | List queued/processing agent_queue / cancel a queued item. `viewer`/`writer`. |
| /api/autonomous/track-submission | POST | `RoiOptimizerAgent.trackSubmissionVariables` (AG-39). `writer`. |
| /api/autonomous/trigger | POST | Manual enqueue of an arbitrary agentId, priority 9. `writer`, rate-limited. |
| /api/billing/check-gate | GET | Read-only `checkTierGate` preflight (agent_run/draft_generation). `viewer`. |
| /api/billing | GET/POST | Subscription+usage+invoices / checkout or portal session (audit-logged). `owner`. |
| /api/billing/usage | GET | Usage summary vs tier limits. `viewer`. |
| /api/board/:id | GET | Board member + all org's board_meeting_packets. `viewer`. |
| /api/calendar/auth | GET | Google Calendar OAuth URL. `viewer`. |
| /api/calendar/callback | GET | OAuth callback, redirects to `/settings/integrations`. Public redirect target. |
| /api/calendar/sync | POST | `GCalSyncEngine.syncDeadlinesOut`. `viewer`, `maxDuration=120`. |
| /api/command-center/layout | GET/PUT | Read/save `profiles.command_center_layout` panel order. `owner`. |
| /api/compliance/check | POST | `ComplianceChecker` agent, tier-limited. `writer`. |
| /api/compliance/events/:id | PATCH/DELETE | Mark complete / delete. `writer`. |
| /api/compliance/events | GET/POST | List / create. `viewer`/`writer`. |
| /api/compliance | GET/POST/PATCH | Merged compliance obligations (deadlines+renewals+documents+requirements) / create requirement / update status. `viewer`/`writer`. |
| /api/consultant/clients | GET/POST/DELETE | List grants / grant access by email lookup (blocks self-grant) / revoke. `admin`. |
| /api/contacts/:id/outreach/call | POST | Claude talking points → `contact_tasks` (never dials). `writer`, `maxDuration=300`. |
| /api/contacts/:id/outreach/linkedin | POST | Claude connection note (<300 chars) → `contact_tasks` (never calls LinkedIn API). `writer`, `maxDuration=300`. |
| /api/contacts/:id/outreach/mail | POST | Claude letter → PDF → Storage → `contact_tasks` (never sends physical mail). `writer`, `maxDuration=300`. |
| /api/contacts/:id/tasks | GET | Lists `contact_tasks`. `viewer`. |
| /api/contacts/tasks/:taskId/download | GET | Fresh 1hr signed PDF URL. `viewer`. |
| /api/contacts/tasks/:taskId | PATCH | Update status. `writer`. |
| /api/cron/autoapply-retry | GET | `runRetrySweep(admin)` — retries failed submissions across all orgs. CRON_SECRET-gated. |
| /api/cron/autoapply | GET | Per-org `populateQueue()` + digest email, per schedule. CRON_SECRET-gated. |
| /api/cron/campaigns | GET/POST | Sweeps orgs w/ `feature.cold_outreach_email`, runs `EmailCampaignAgent`. CRON_SECRET-gated, `maxDuration=300`. |
| /api/cron/domain-warmup | GET | Advances `WarmupEngine` per active domain. CRON_SECRET-gated, `maxDuration=120`. |
| /api/cron/draft-automation | GET/POST | Per-enabled-org: `DraftQueueEngine.processDeadlineApproaching` + `DraftAutoGenerator.processQueue`. CRON_SECRET-gated, `maxDuration=300`. |
| /api/cron/draft-queue-check | GET/POST | Lighter: `processNewOpportunities()` only. CRON_SECRET-gated, `maxDuration=120`. |
| /api/cron/email-sequences | GET/POST | `sequenceEngine.processScheduledSends()`. CRON_SECRET-gated, `maxDuration=120`. |
| /api/cron/follow-ups | GET | `processFollowUps(supabase)`. CRON_SECRET-gated, `maxDuration=60`. |
| /api/cron/grantsgov | GET/POST | Per active-search-profile org: `syncGrantsGovForOrg()`. CRON_SECRET-gated, `maxDuration=300`. |
| /api/cron/reminders | GET/POST | Sweeps all deadlines, flips reminder flags, sends Gmail reminders, `ReminderEngine` follow-ups. CRON_SECRET-gated, `maxDuration=300`. |
| /api/cron/research | GET/POST | Per-org quota-checked, due-schedule research-agent sweep (government/corporate/foundation/local), then `DraftQueueEngine.processNewOpportunities()`. CRON_SECRET-gated, `maxDuration=300`. |
| /api/cron/sales-sends | GET | `SalesCampaignEngine.processQueuedSends()`. CRON_SECRET-gated, `maxDuration=120`. |
| /api/deadlines/check | GET/POST | Dual-mode: CRON_SECRET sweeps all orgs, else session-scoped to caller's org — marks 30/14/7/3/1-day reminder flags (no email sent here). |

### Batch 5 — discovery, documents, donor-discovery/*, drafts/*, email/*

| Route | Method | Description |
|---|---|---|
| /api/discovery/pil-trigger | POST | Discovery-import webhook → `pil_prospects` + `pil_entity_aliases` (idempotent). `DISCOVERY_WEBHOOK_SECRET` bearer-gated. |
| /api/documents/assemble | POST | Builds document checklist, zips if complete, returns signed URL. `viewer`. |
| /api/documents/quota | POST | Storage-quota pre-flight before client upload. Session-authenticated. |
| /api/donor-discovery/connectors | GET/POST/DELETE | Catalog + org status (masked keys) / upsert encrypted key / delete. `viewer`/`writer`. |
| /api/donor-discovery/connectors/test | POST | Live-validates a BYO key (Apollo/Hunter/Google Places) w/o persisting. `writer`. |
| /api/donor-discovery/discover | POST | Google Places search; preview or launch (persists to `donor_discovery_directory` + creates prospects). `writer`. |
| /api/donor-discovery/geocode | POST | Cache-first geocode via `donor_discovery_geocache` + Google Geocoding. `writer`. |
| /api/donor-discovery/pipeline | GET | Prospect counts by stage + top 5/stage + org-wide avg score. `viewer`. |
| /api/donor-discovery/prospects/:id/route-to-autoapply | POST | Finds/creates funder, queues into `submission_queue`. `writer`. |
| /api/donor-discovery/prospects/:id/route-to-email | POST | Finds/creates template+sequence+enrollment for cold-donation ask. `writer`. |
| /api/donor-discovery/prospects/:id | GET/PATCH | Single prospect / update stage-notes-assignee. `viewer`/`writer`. |
| /api/donor-discovery/prospects | GET | Filterable/paginated list joined to directory. `viewer`. |
| /api/donor-discovery/requests/:id | GET | Request + live computed progress from linked prospects. `viewer`. |
| /api/donor-discovery/requests | GET/POST | List w/ live counts / create (validates geography+taxonomy shape). `viewer`/`writer`. |
| /api/donor-discovery/stats | GET | Stat-card counts (intent signals, contacted, campaigns, completed submissions). `viewer`. |
| /api/donor-discovery/taxonomy/search | GET | Typeahead over taxonomy aliases + labels w/ ancestry breadcrumb. `viewer`. |
| /api/drafts/:id/humanize | POST | Re-runs humanization (or score-only) → updates draft_content + metadata. `writer`. |
| /api/drafts/:id | GET/PATCH | Read draft / update (only while pending_review). `viewer`/`writer`. |
| /api/drafts/queue/:id | GET/PATCH/DELETE | Item detail / action dispatcher (approve may auto-queue submission if confidence high) / soft-delete. `viewer`/`writer`. |
| /api/drafts/queue/config | GET/PATCH | Read (create-if-missing) / validate+upsert automation config. `viewer`/`admin`. |
| /api/drafts/queue | GET/POST | Filterable list / manual add (dedup, priority from deadline). `writer`. |
| /api/drafts/queue/stats | GET | `DraftQueueEngine.getQueueStats`. `viewer`. |
| /api/drafts/queue/trigger | POST | On-demand process ≤3 pending items (same path as daily cron), rate-limited per user. `writer`. |
| /api/email/analytics | GET | Sent/replied, per-sequence/template reply rates, daily trend. `viewer`. |
| /api/email/auth | GET | Gmail OAuth URL. `viewer`. |
| /api/email/callback | GET | Gmail OAuth callback, verifies org match, redirects to `/settings/integrations`. Session-authenticated, no role gate. |
| /api/email/contacts | GET/POST | AI-suggested contacts / import (writer) or extract-from-thread. `viewer` base. |
| /api/email/link | POST | Bulk auto-link, single auto-link, or manual link/replace. `writer`. |
| /api/email/send | POST | Sends via Gmail/Resend, rate-limited 20/min/org, reply-threading. `writer`. |
| /api/email/sequences/:id/analytics | GET | Per-sequence funnel + daily enrollment trend. `viewer`. |
| /api/email/sequences/:id/enroll | POST | Batch enroll (dedup as "duplicate" not failure). `writer`. |
| /api/email/sequences/:id | GET/PATCH/DELETE | Sequence + steps + stats / update / complete-enrollments-then-delete. `viewer`/`writer`. |
| /api/email/sequences | GET/POST | List / create w/ steps. `viewer`/`writer`. |
| /api/email/summarize | POST | Claude Haiku thread summary. `viewer`. |
| /api/email/sync | POST | Full or incremental Gmail sync via `GmailSyncEngine`. `viewer`. |
| /api/email/templates/generate | POST | AI-generates a template (not saved). `writer`. |
| /api/email/templates | GET/POST/PATCH/DELETE | List / create (validated) / update / soft-delete. `viewer`/`writer`. |
| /api/email/threads | GET | Paginated searchable threads joined to links. `viewer`. |

### Batch 6 — financials, foundations, funders, google-nonprofit, grants, health, import, integrations/*

| Route | Method | Description |
|---|---|---|
| /api/financials/budgets | GET/POST | List / create `grant_budgets`. `viewer`/`writer`. |
| /api/financials/expenses | GET/POST | List / create `grant_expenses`. `viewer`/`writer`. |
| /api/foundations/:id/competitors | GET | **Stub** — returns `{foundationId, competitors:[]}`, no query performed. `viewer`. |
| /api/foundations/:id/profile | GET | Computes+upserts foundation profile via `computeFoundationProfile`. `viewer`. |
| /api/funders/:id/relationship-builder | GET/POST | Reads AG-19 slice / runs full `RelationshipBuilderAgent` pass. `viewer`/`writer`. |
| /api/funders/:id/relationship | GET/POST | Event-sourced score / records event + recomputes. `viewer`/`writer`. |
| /api/funders/enroll-monitoring | POST | Enqueues ≤25 funders for AG-18 reputation checks. `writer`. |
| /api/funders/import | POST | CSV import (≤10MB), category normalization, aborts >20% failure rate, best-effort reputation enrollment. `writer`. |
| /api/funders/relationship-scores | GET | Score/momentum per funder computed from events. `viewer`. |
| /api/google-nonprofit/apply | POST | Multipart submission, doc uploads to Storage, insert `google_nonprofit_applications`, best-effort confirmation email. `writer`. |
| /api/grants/:id/rescore | POST | Real Claude `EligibilityScorer.run()` re-score w/ ownership check + rate/quota limits + audit log. `writer`. |
| /api/grants/:id | GET/PATCH | Single opportunity (403 vs 404 distinction) / partial update w/ audit log. `viewer`/`writer`. |
| /api/grants | GET | Filtered/paginated opportunities list (maps to internal `opportunities` schema). `viewer`. |
| /api/health | GET | Public monitoring — DB reachability, worker heartbeat staleness, memory usage; 503 if unhealthy. |
| /api/import/csv | POST | Pre-parsed CSV upsert into `funders` via admin client. `writer`. |
| /api/integrations/custom-api/:id | PATCH/DELETE | Update active/name/schedule / delete connection. `admin`. |
| /api/integrations/custom-api/allowlist/:id | DELETE | Remove allowlist domain. `admin`. |
| /api/integrations/custom-api/allowlist | GET/POST | List / add domain (409 on dup). `viewer`/`admin`. |
| /api/integrations/custom-api | GET/POST | List (masked auth) / create (domain-allowlist-checked, encrypted). `viewer`/`admin`. |
| /api/integrations/custom-api/test | POST | SSRF-guarded live test request against supplied base_url. `admin`. |
| /api/integrations/google/calendar | GET/POST | Sync count + calendar list / sync all deadlines. `viewer`/`writer`, rate-limited 20/min. |
| /api/integrations/google/calendar/sync | POST | Single-deadline sync. `writer`. |
| /api/integrations/google/callback | GET | Exchanges code, verifies session-org match. Public redirect target. |
| /api/integrations/google | GET/POST | Connection status / consent URL. `viewer`/`admin`. |
| /api/integrations/google/sync | POST | Gmail inbox pull (≤100) + `EmailMatcherAgent`. `writer`, rate-limited 20/min. |
| /api/integrations/keys | GET/POST | Masked key hints / encrypt+upsert (pending validation). `viewer`/`admin`. |
| /api/integrations/scraping-targets/:id | PATCH/DELETE | Update active/schedule / delete. `admin`. |
| /api/integrations/scraping-targets | GET/POST | List / create (allowlist-checked, tier-limited by subscription: starter=0/professional=5/enterprise=25/consultant=unlimited). `viewer`/`admin`. |

### Batch 7 — all intelligence/*

| Route | Method | Description |
|---|---|---|
| /api/intelligence/benchmarks | GET | `OutcomeBenchmarkEngine.getBenchmarks(category,geography)`. `viewer`. |
| /api/intelligence/briefing | GET | `UnifiedIntelligenceSearch.getRelatedIntelligence()`, tier-filtered sections. `viewer`. |
| /api/intelligence/budget-patterns | GET | `BudgetPatternLibrary` template + indirect-cost guidance (Claude-backed). `viewer`, `maxDuration=300`. |
| /api/intelligence/community-need | GET/POST | Read signals / run AG-35. `viewer`/`writer`. |
| /api/intelligence/community-resources | GET | `matchResourcesForSignal()` for a signalId. `viewer`. |
| /api/intelligence/compliance | GET | `ComplianceLibrary.getRequirements()`. `viewer`. |
| /api/intelligence/corporate-prospects/:id/giving-dna | POST | `generateGivingDna` (Claude synthesis). `writer`. |
| /api/intelligence/corporate-prospects/:id | GET | Single prospect (admin client, no org scoping — shared table). `viewer`. |
| /api/intelligence/corporate-prospects | GET | Search/filter/paginate corporate_prospects. `viewer`. |
| /api/intelligence/deadline-predictions | GET | `predictDeadlines(orgId)`. Session + org header. |
| /api/intelligence/digital-twin | GET/POST | Cached twin (if onboarding-restricted) or full rebuild via `buildDigitalTwin()`. |
| /api/intelligence/donor-intent | GET/POST | Read signals / run AG-30. `viewer`/`writer`. |
| /api/intelligence/evaluation | GET | `EvaluationLibrary` frameworks+KPIs+tools. `viewer`. |
| /api/intelligence/fundability | GET/POST | Read scores / run `FundabilityScorerAgent` (single or org-wide). `viewer`/`writer`. |
| /api/intelligence/gap-analysis | GET | `computePortfolioGapAnalysis`. `viewer`. |
| /api/intelligence/grant-dna | POST | `GrantDNAScorer.scoreProposal` + `benchmarkAgainstFunded`. `writer`. |
| /api/intelligence/grant-probability | POST | `computeGrantProbability`. Session + org header. |
| /api/intelligence/ingest | POST | Ingests nih/manual/url proposal, dedupes, embeds sections. `writer`. |
| /api/intelligence/knowledge-query | POST | `queryKnowledgeEngine`. Session + org header. |
| /api/intelligence/land-banks | GET/POST | Reads housing/land-bank opportunities / `discoverLandBankOpportunities()`. `viewer`/`writer`, rate-limited. |
| /api/intelligence/learning-network | GET | Platform-wide pattern counts + org contribution/benefit heuristic. `viewer`. |
| /api/intelligence/library/search | POST | Substring OR-match search across funded proposals, ranked in-app. `viewer`. |
| /api/intelligence/logic-model | POST | `generateLogicModel` (Claude), optional save to library. `writer`. |
| /api/intelligence/match-feed | GET | `computeMatchFeed`. `viewer`. |
| /api/intelligence/need-data | GET/POST | Read need-data points / `NeedStatementEngine` live gather + generate (Claude). `viewer`/`writer`. |
| /api/intelligence/outreach/generate | POST | Claude subject/body draft w/ token placeholders. `writer`. |
| /api/intelligence/outreach/prospects | GET | Corporate prospects + best-effort intent-score join. `viewer`. |
| /api/intelligence/outreach/queue | POST | Batch or shared-draft → sequence+steps+enrollments. `writer`. |
| /api/intelligence/proposals | GET/POST | Filtered/paginated proposals + stats / manual "Add Awarded Grant Narrative". `viewer`/`owner`. |
| /api/intelligence/recommendations/explain | GET | `FunderRecommender.explainMatch`. `viewer`. |
| /api/intelligence/recommendations | GET | `FunderRecommender.recommend()`. `viewer`. |
| /api/intelligence/relationship-graph/analytics | GET | Node/edge counts, top connections, foundations, clusters. `viewer`. |
| /api/intelligence/relationship-graph | GET/POST | Graph read / request-introduction action or run AG-32. `viewer`/`writer`. |
| /api/intelligence/reputation | GET/POST/PATCH | Unread alerts / run entity-reputation sweep / update alert status. `viewer`/`writer`. |
| /api/intelligence/search | GET | `UnifiedIntelligenceSearch.search()`, tier-capped limit. `viewer`. |
| /api/intelligence/signal-monitor | POST | `runSignalMonitor` — news+990 sweep over ≤15 funders. `writer`. |
| /api/intelligence/stats | GET | Aggregate counts across intelligence tables. `viewer`. |
| /api/intelligence/strategic-advisor | GET/POST/PATCH | Pending recs / run AG-40 / update status. `viewer`/`writer`. |
| /api/intelligence/trends | GET | 12-month opportunity volume trend + funded-proposals-by-award-year panel. `viewer`. |
| /api/intelligence/twin/auto-populate | POST | `autoPopulateTwin` — BMF → Claude web search → foundation_directory/profiles → rebuild+rescore. `writer`. |
| /api/intelligence/twin/completeness | GET | `calculateTwinCompleteness()` (read-only, no rebuild). `viewer`. |

### Batch 8 — knowledge-base, marketplace, match, metrics, nav-counts, notifications, onboarding, opportunities/*, outreach/*, pil/*, platform, proposals, prospects

| Route | Method | Description |
|---|---|---|
| /api/knowledge-base | GET/PATCH | Section completeness scores / update section + rebuild digital twin. `viewer`/`writer` (blocked by demo-account restriction). |
| /api/knowledge-base/suggest | POST | Claude AI-suggestion for a KB section (no writes). `writer`. |
| /api/marketplace/listings | GET/POST | List / create (server-derived org) + runs `runMarketplaceMatching` against other orgs. `viewer`/`writer`. |
| /api/marketplace/matches/:id | PATCH | request/withdraw/approve/decline action w/ status-transition validation. `writer`. |
| /api/marketplace/matches | GET | RLS-visible matches. `viewer`. |
| /api/match/foundations | POST | `matchFunders` against `foundation_directory`. `viewer`. |
| /api/metrics | GET | Prometheus metrics text, `METRICS_SCRAPE_SECRET` bearer-gated (no user auth). |
| /api/nav-counts | GET | Badge counts (alerts/applications/documents/deadlines/drafts/recs/improvements/opportunities/pending-review/intent-signals/need-signals/queue). Session + header, no `requireRole`. |
| /api/notifications | GET/PATCH/POST | List (90-day window) / mark read / system-insert (CRON_SECRET-gated, best-effort email for urgent priority). |
| /api/onboarding/complete-setup | POST | `autoPopulateTwin` + enqueue AG-17 + welcome notification, each independently try-caught. Header auth, blocked by onboarding-edit restriction. |
| /api/onboarding/generate-narratives | POST | Claude 7-narrative + keywords draft (no DB write). Header auth, restriction-blocked. |
| /api/onboarding | GET/POST | Wizard state read / per-step writes (7 steps → organizations/programs/knowledge_base/board_members/documents/search_profiles). Header auth, restriction-blocked. |
| /api/opportunities/:id/narrative-gap-analysis | GET | `computeNarrativeGapAnalysis`. `viewer`. |
| /api/opportunities/:id/probability | GET | `computeSuccessProbability`. Session + org header. |
| /api/outreach/humanize-step | POST | `runHumanizer` on arbitrary text (no DB write). Session auth. |
| /api/outreach/sequences | GET/POST | List / create `followup_sequences`. `viewer`/`writer`. |
| /api/outreach/templates/:id/variants/:variantId | PATCH/DELETE | Activate (enforces one-active-per-template)/update / delete. `writer`. |
| /api/outreach/templates/:id/variants | GET/POST | List / create (max 3 per template). `viewer`/`writer`. |
| /api/outreach/templates | GET/POST | List (+ batched variants) / create. `viewer`/`writer`. |
| /api/pil/agents/:agentCode/runs | GET | `pil_agent_runs` for one agent. `requirePilRole("viewer")`. |
| /api/pil/agents | GET | Agent registry + in-flight run status. `requirePilRole("viewer")`. |
| /api/pil/cost/summary | GET | `getBudgetSummary(organizationId)`. `requirePilRole("viewer")`. |
| /api/pil/discover | POST | Claude → structured `DiscoveryResearchPlan` → creates `pil_research_runs` row. `requirePilRole("writer")`. |
| /api/pil/monitoring/events | GET | `getEvents(organizationId, prospectId?)`. `requirePilRole("viewer")`. |
| /api/pil/monitoring/subscribe | POST | `createSubscription` after prospect existence check. `requirePilRole("writer")`. |
| /api/pil/prospects/:id | GET | Prospect + evidence + graph nodes/edges + research runs. `requirePilRole("viewer")`. |
| /api/pil/prospects | GET/POST | Active prospects list / manual create. `requirePilRole("viewer")`/`("writer")`. |
| /api/pil/research/:runId | GET | Run + ordered steps. `requirePilRole("viewer")`. |
| /api/pil/research | GET/POST | List runs / `createResearchRun`. `requirePilRole("viewer")`/`("writer")`. |
| /api/pil/review-queue/:itemId/decision | POST | `submitReviewDecision` (409 on invalid transition). `requirePilRole("admin")`. |
| /api/pil/review-queue | GET | `getReviewQueue(organizationId, status?)`. `requirePilRole("viewer")`. |
| /api/platform/bootstrap | POST | **Self-disabling** first-owner bootstrap — 403 once a `platform_owner` already exists. No auth otherwise (intentional). |
| /api/proposals/generate-package | POST | Orchestrates in-process handlers for draft+budget+logic-model+document-assembly, aggregating success/failure. `writer`. |
| /api/prospects/acquire | POST | `acquireFromGooglePlaces` per `TARGET_SEARCHES` category → shared `corporate_prospects` table. `writer`. |

### Batch 9 — public, renewals, reports/*, schoolfunder, scraper, settings/*, sources/*, stripe, unsubscribe, users/*, webhooks/*, zoho/*

| Route | Method | Description |
|---|---|---|
| /api/public/assist | POST | Public unauthenticated Q&A, IP+session rate-limited via `computeClientKey`. |
| /api/renewals | GET | Renewals joined to opportunities/funders/applications. `viewer`. |
| /api/reports/board-report/detail | GET | `aggregateBoardReportPageData()` for the printable page. `viewer`. |
| /api/reports/board-report/executive-summary | POST | Claude ~200-word summary, tier-limited. `writer`. |
| /api/reports/board-report | GET | Lighter summary variant for the `/reports` widget. `viewer`. |
| /api/reports/board | POST | Full pipeline — Claude draft → humanize → PDF → Storage → 1hr signed URL → agent_runs log. `writer`, rate-limited 5/min. |
| /api/reports/forecast | GET/POST | Read `funding_forecasts` / run AG-26. `viewer`/`writer`. |
| /api/reports/funding-summary | GET | Aggregated pipeline/source/category/trend/top-funders. `viewer`. |
| /api/reports/impact/enhance | POST | Claude polished narrative. `writer`, tier-limited. |
| /api/reports/impact | GET/PUT | `aggregateImpactReportData` / save stories. `viewer`/`writer`. |
| /api/reports/roi | GET | AG-39 insights + in-app win-rate/word-count/budget-impact computation. `viewer`. |
| /api/reports/simulate | GET/POST | Read scenarios / run `SimulationAgent` synchronously via agent_queue row. `viewer`/`writer`. |
| /api/schoolfunder/donate | POST | Stripe PaymentIntent + `schoolfunder_donations` pending row (no webhook flips status yet, per its own comment). `viewer`. |
| /api/schoolfunder/hours | POST | Logs volunteer hours, updates denormalized funded_amount. `writer`. |
| /api/schoolfunder | GET/POST | Dashboard stats (masked donor names) / create student. `viewer`/`writer`. |
| /api/scraper/status | GET | Live `foundation_directory` enrichment-rate stats + best-effort local stats file (absent in prod/Vercel). `viewer`. |
| /api/settings/agents/relationship-builder-v2 | GET/PATCH | Read/set feature flag. `admin`. |
| /api/settings/integrations/status | GET | `{resend_configured: Boolean(env.RESEND_API_KEY)}` — no DB. `viewer`. |
| /api/settings/notifications | GET/POST | Read (defaulted) / upsert preferences. `viewer`. |
| /api/sources/grantsgov | GET | **CRON_SECRET-gated** (in `middleware.ts` SECRET_GATED_PATHS); `syncGrantsGovForOrg()` for `?orgId=`. |
| /api/sources/poll | POST | Session-auth only (NOT secret-gated); `pollFederalSources()` on-demand for caller's org. |
| /api/sources/propublica | GET | **CRON_SECRET-gated**; updates `foundation_directory` financials by EIN (no org scoping — shared table). |
| /api/sources/registry | GET | Static `FUNDING_SOURCES` catalog, seeds table if empty and org header present (NOT secret-gated). |
| /api/sources/samgov | GET | **CRON_SECRET-gated**; upserts opportunities for `?orgId=`. |
| /api/sources/state-portals | GET | `requireRole("viewer")`-gated (confirmed NOT in SECRET_GATED_PATHS per WGR-155); read-only preview, no persistence. |
| /api/stripe/create-portal-session | POST | Stripe Billing Portal redirect URL, audit-logged. `owner`. |
| /api/unsubscribe | GET/POST | Public link-token verification + HTML form / suppression-list upsert. No session gate. |
| /api/users/accept | POST | Public invite acceptance — creates confirmed auth user + profile, rolls back on failure. |
| /api/users/invite | POST | Validates role escalation limits, quota-checks, upserts 7-day invite, best-effort Gmail send. `admin`. |
| /api/users | GET/PUT/DELETE | List profiles / change role (blocks self, blocks admin→owner) / delete (blocks self, cascades via auth admin API). `viewer`/`admin`/`owner`. |
| /api/webhooks/resend | POST | **Svix HMAC-verified** (SECRET_GATED_PATHS) — updates `campaign_sends` on open/click/bounce/complaint, marks contact unresponsive. |
| /api/webhooks/stripe | POST | **Signature-verified** (SECRET_GATED_PATHS) — idempotent via `stripe_webhook_events`, dispatches to `handleWebhookEvent()`. |
| /api/zoho/auth | GET | Redirects to Zoho OAuth consent URL. `admin`. |
| /api/zoho/callback | GET | Exchanges code, verifies session-org match, redirects to `/settings`. Session-authenticated. |

**Confirmed gating detail** (per explicit task instruction): `middleware.ts`'s `SECRET_GATED_PATHS` set contains exactly `/api/sources/samgov`, `/api/sources/propublica`, `/api/sources/grantsgov`, plus the cron routes, webhook routes, and `/api/metrics` — each with its own in-handler secret check too. The sibling routes `/api/sources/poll`, `/api/sources/registry`, `/api/sources/state-portals` are explicitly NOT in that set and rely on session auth instead.

---

<a id="part-5"></a>
## PART 5 — Modal / Dialog Inventory

**Base primitive** (excluded from the table below): `src/components/ui/Modal.tsx` — the generic `Modal` (isOpen/onClose/title/description/footer/size) that nearly every named row below is built on. No shadcn `dialog.tsx` exists in this repo; this custom primitive is the equivalent. 52 files matched the initial `Dialog|Modal` grep (23 in `src/components`, 29 in `src/app`).

| Modal/Dialog Component | File | Purpose | Triggered From |
|---|---|---|---|
| `DeadlineDetailModal` (exported) | src/components/deadlines/DeadlinePill.tsx | Deadline due date/status/description popup | WeekView.tsx; CalendarGrid.tsx |
| `StageTransitionModal` (exported) | src/components/applications/StageTransitionModal.tsx | Pipeline stage transition, enforces allowed-transition graph + compliance-check gate before "submitted" | ApplicationDetail.tsx; GroupedKanban.tsx; PipelineBoard.tsx |
| `IngestModal` (exported) | src/components/intelligence/IngestModal.tsx | "Add to Library" — ingest funder award info by paste/URL | **ORPHANED — zero imports anywhere in src** |
| `StartResearchModal` (exported) | src/components/pil/StartResearchModal.tsx | Kicks off a PIL research run via `POST /api/pil/research` | intelligence/pil/prospects/[id]/page.tsx; intelligence/pil/prospects/page.tsx |
| `SubmissionPreview` (exported) | src/components/autoapply/SubmissionPreview.tsx | Full pre-submission preview (pitch, field mapping, docs, timing, safety, Confirm & Submit) | components/autoapply/QueuePanel.tsx |
| `GlobalSearch` (exported) | src/components/layout/GlobalSearch.tsx | Cmd/Ctrl+K command palette (`role="dialog"`) | components/layout/Header.tsx |
| `ConvertModal` (page-local) | src/components/outreach/OutreachContactTable.tsx | Converts cold-outreach contact → CRM funder | Same file only |
| `CancelModal` (hand-rolled) | app/(dashboard)/autoapply/follow-ups/page.tsx | Cancel one/all follow-ups | Same file only |
| `AddClientModal` (page-local) | app/(dashboard)/settings/white-label/page.tsx | Grants client-org white-label access | Same file only |
| `VideoModal` (hand-rolled) | app/(dashboard)/autoapply/recordings/page.tsx | Session-recording playback w/ speed controls | Same file only |
| `AddTargetModal` (page-local) | app/(dashboard)/settings/scraping/page.tsx | Add scraping target URL+schedule | Same file only |
| `InviteModal` (page-local) | app/(dashboard)/settings/page.tsx | Invite user by email+role, shows shareable link | Same file only |
| `WizardModal` (hand-rolled) | app/(dashboard)/autoapply/profiles/page.tsx | 5-step Request Profile creation wizard | Same file only |
| `AddConnectionModal` (page-local) | app/(dashboard)/settings/custom-apis/page.tsx | New custom API connection + test | Same file only |
| `ScanModal` (page-local) | app/(dashboard)/outreach/page.tsx | Cold Outreach Agent company scan | Same file only |
| `ReviewModal` (page-local) | app/(dashboard)/intelligence/pil/review-queue/page.tsx | Approve/reject PIL review item | Same file only |
| (inline) "Edit opportunity" | components/opportunities/OpportunityDetail.tsx | Edit via embedded `OpportunityForm` | Same file only |
| (inline) "Delete opportunity" | components/opportunities/OpportunityDetail.tsx | Delete confirm (blocked if linked applications) | Same file only |
| (inline) "Edit funder" | components/funders/FunderDetail.tsx | Edit via embedded `FunderForm` | Same file only |
| (inline) "Delete funder" | components/funders/FunderDetail.tsx | Delete confirm (cascades contacts) | Same file only |
| (inline) "Add contact" | components/funders/FunderDetail.tsx | Add contact via `ContactForm` | Same file only |
| (inline) "Delete application" | components/applications/ApplicationDetail.tsx | Delete confirm | Same file only |
| (inline) "Clone application" | components/applications/ApplicationDetail.tsx | Clone via `/api/agents/application-cloner` | Same file only |
| (inline) "Edit contact" | components/contacts/ContactDetail.tsx | Edit via `ContactForm` | Same file only |
| (inline) "Delete contact" | components/contacts/ContactDetail.tsx | Delete confirm | Same file only |
| (inline) "Link to application" | components/documents/DocumentList.tsx | Attach document to application | Same file only |
| (inline) "Compare draft versions" | components/draft-generator/DraftsHistoryPanel.tsx | Side-by-side line diff | Same file only |
| (inline) "Add/Edit board member" | components/knowledge-base/ProfileEditor.tsx | Board member sub-record form | Same file only |
| (inline) "Remove board member" | components/knowledge-base/ProfileEditor.tsx | Remove confirm | Same file only |
| (inline) "Add/Edit program" | components/knowledge-base/ProfileEditor.tsx | Program sub-record form | Same file only |
| (inline) "Delete program" | components/knowledge-base/ProfileEditor.tsx | Delete confirm | Same file only |
| (inline) "Edit narrative" | components/knowledge-base/NarrativeDetail.tsx | Edit via `NarrativeEditor` | Same file only |
| (inline) "Screenshot lightbox" | components/automation/ScreenshotViewer.tsx | Full-size screenshot viewer, Prev/Next/Download | Same file only |
| (inline) "Clear Queue confirmation" | components/autoapply/QueuePanel.tsx | Bulk-delete pending queue items | Same file only |
| (hand-rolled) "Mark Submission Complete" | components/autoapply/ManualQueue.tsx | Record manual submission confirmation# | Same file only |
| (hand-rolled) "Skip This Submission" | components/autoapply/ManualQueue.tsx | Skip reason capture | Same file only |
| (hand-rolled) "Convert to Automated Submission" | components/autoapply/ManualQueue.tsx | Type-to-confirm override | Same file only |
| (hand-rolled) "Reassign to Team Member" | components/autoapply/ManualQueue.tsx | Pick org member to take over | Same file only |
| (inline) "Clone application" | app/(dashboard)/applications/page.tsx | Clone to a target opportunity | Same file only |
| (inline) "Add Requirement" | app/(dashboard)/compliance/page.tsx | New compliance requirement via `RequirementForm` | Same file only |
| (inline) "New Compliance Event" | app/(dashboard)/compliance/page.tsx | New compliance event via `EventForm` | Same file only |
| (inline) "New Campaign" | app/(dashboard)/admin/sales-outreach/SalesOutreachClient.tsx | Build sales-outreach campaign | Same file only |
| (inline) "Add Sending Domain" | app/(dashboard)/admin/sales-outreach/SalesOutreachClient.tsx | Register sending domain + Resend key | Same file only |
| (inline) "Import Prospects" | app/(dashboard)/admin/sales-outreach/SalesOutreachClient.tsx | CSV import → new prospect list | Same file only |
| (inline) "Add to Suppression List" | app/(dashboard)/admin/sales-outreach/SalesOutreachClient.tsx | Manual suppression add | Same file only |
| (inline) "Log Agreement" | app/(dashboard)/autoapply/agreements/page.tsx | Record grant award + terms | Same file only |
| (inline) "Dossier viewer" | app/(dashboard)/autoapply/queue/page.tsx | Research dossier narrative view | Same file only |
| (inline) "Edit Pitch" | app/(dashboard)/autoapply/queue/page.tsx | Edit/copy funder pitch draft | Same file only |
| (inline) "Schedule for Later" | app/(dashboard)/autoapply/queue/page.tsx | Set future submit date/time | Same file only |
| (inline) "Skip This Submission" | app/(dashboard)/autoapply/queue/page.tsx | Remove from queue confirm | Same file only |
| (inline) "Test Template" | app/(dashboard)/autoapply/templates/page.tsx | Dry-run portal template fill+screenshot | Same file only |
| (inline) "Field Mappings detail/edit" | app/(dashboard)/autoapply/templates/page.tsx | Show/edit template field mappings | Same file only |
| (inline) "Delete scraping target" | app/(dashboard)/settings/scraping/page.tsx | Delete confirm | Same file only |
| (inline) "Remove team member" | app/(dashboard)/settings/page.tsx | Remove user org access confirm | Same file only |
| (inline) "Disconnect integration" | app/(dashboard)/settings/integrations/page.tsx | Disconnect Gmail/Calendar confirm | Same file only |
| (inline) "Delete connection" | app/(dashboard)/settings/custom-apis/page.tsx | Delete custom API connection confirm | Same file only |
| (inline) "Edit/New narrative" | app/(dashboard)/knowledge-base/narratives/page.tsx | Create/edit via `NarrativeEditor` | Same file only |
| (inline) "Delete narrative" | app/(dashboard)/knowledge-base/narratives/page.tsx | Delete confirm (blocks non-owner on proven) | Same file only |
| (inline) "Edit/New standard answer" | app/(dashboard)/knowledge-base/answers/page.tsx | Create/edit via `AnswerEditor` | Same file only |
| (inline) "Delete standard answer" | app/(dashboard)/knowledge-base/answers/page.tsx | Delete confirm | Same file only |
| (inline) "Reject draft" | app/(dashboard)/draft-generator/queue/page.tsx | Rejection reason, single or bulk | Same file only |
| (inline) "New/Edit Template" | app/(dashboard)/email/templates/page.tsx | `TemplateForm` w/ AI-gen sub-panel | Same file only |
| (inline) "New/Edit search profile" | app/(dashboard)/search-profiles/page.tsx | `SearchProfileForm` | Same file only |
| (inline) "Delete search profile" | app/(dashboard)/search-profiles/page.tsx | Delete confirm | Same file only |
| (inline) "New Email Campaign" | app/(dashboard)/email/campaigns/page.tsx | `CampaignWizard` 4-pane drip sequence builder | Same file only |
| (inline) "New outreach Template" | app/(dashboard)/outreach/templates/page.tsx | Page-local `TemplateForm` | Same file only |
| (inline) "New variant" | app/(dashboard)/outreach/templates/page.tsx | Add ≤3 named content variants | Same file only |
| (inline) "Record outcome" | app/(dashboard)/outcomes/page.tsx | `OutcomeForm` awarded/partial/denied | Same file only |
| (inline) "Connect provider" | app/(dashboard)/donor-discovery/connectors/page.tsx | API-key entry + test/save | Same file only |
| (inline) "Disconnect provider" | app/(dashboard)/donor-discovery/connectors/page.tsx | Remove stored connector key confirm | Same file only |
| (inline) "Add Funders to Queue" | app/(dashboard)/autoapply/page.tsx | Multi-select funders → AutoApply queue | Same file only |

**Methodology note**: All "Triggered From" values for named/exported components confirmed via direct grep for the exact component name across `src/app` and `src/components`. `IngestModal` is the one confirmed orphan. Every page-local named function and inline `<Modal>` block is private to its own file by construction (not exported) — spot-checked by grep.

---

<a id="part-6"></a>
## PART 6 — Cross-Cutting Findings

These surfaced incidentally while building the inventory above — worth carrying into the test-campaign scoping:

1. **Three dead-end redirect stubs**: `/outreach/campaigns`, `/outreach/campaigns/[id]`, and `/outreach/sequences` are all unconditional `redirect("/email/campaigns")` — the feature was consolidated onto Email's sequence engine, but the routes still exist and render nothing of their own. Not bugs, but any test plan that walks the full route list needs to know these three intentionally have zero UI.
2. **One orphaned modal**: `IngestModal` (`src/components/intelligence/IngestModal.tsx`) is never imported anywhere — dead code, not reachable from any page.
3. **Two confirmed dead buttons**: "Add Portal" on `/autoapply/templates` (no onClick handler) and "Change" on the Linked Entity panel of `/email` (no onClick handler) — both render visually but do nothing.
4. **Settings' 5 stakeholder-expected tabs that aren't tabs**: Organization/Team/Plan Usage/Feature Flags/Danger Zone are real, working *sections* inside `settings/page.tsx`'s client-side state, not routes — clicking them never changes the URL. A URL-based test plan (e.g. Playwright navigating to `/settings/team`) will 404; the content is only reachable by clicking the in-page sidebar.
5. **`/settings/state-portals` is a real page with no tab-strip entry** — the inverse of finding #4. It's only reachable via a "Configure" link buried inside `/settings/integrations`.
6. **Five stakeholder-named "settings" areas are fully separate top-level pages, not settings at all**: Compliance, Financials, Reports, Alerts, and Outcomes & Analytics (`/outcomes`, not `/outcomes-analytics`) live on the main dashboard nav with zero references anywhere in the settings tree.
7. **`/api/sources/*` gating is inconsistent by design, not by accident**: samgov/propublica/grantsgov are CRON_SECRET-gated; poll/registry/state-portals are session-gated. This is documented in `middleware.ts` itself (WGR-155/WGR-111) but is exactly the kind of thing a security-focused test pass would otherwise flag as a gap.
8. **`/api/foundations/:id/competitors` is a stub** — returns an empty array unconditionally, no query is performed.
9. **Two Playwright-dependent agents don't run in production**: `/api/agents/form-analyzer` and `/api/agents/form-filler` both note in-code that Playwright fails on Vercel and only works locally or via the Railway worker — any Vercel-only test pass will not be able to exercise these end-to-end.
10. **`/api/platform/bootstrap` is intentionally unauthenticated** but self-disables (403) once any `platform_owner` row exists — confirmed already fixed per prior session's memory, re-confirmed here by direct code read.
11. **The MDX catch-all (`/[...slug]`) serves 19 additional marketing pages** not separately itemized page-by-page above (platform sub-pages, solutions sub-pages, why-benavora, trust, company, demo, resources) — these are content-driven, not component-driven, so their interactive elements are template-level (3 shared templates), not page-specific.
