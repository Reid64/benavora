# TARRITRIX 1.0 — MASTER_BUILD_SPEC.md DELTA SPECIFICATION

**Document ID:** MASTER_BUILD_SPEC_DELTA
**Version:** 1.0
**Status:** DRAFT — Pending operator approval
**Authored:** 2026-05-23
**Author:** Lead Architect (Claude, acting on operator authorization)
**Operator:** Reid Whitesides
**Scope:** Surgical edits to `MASTER_BUILD_SPEC.md` to propagate the RBAC architecture and A-44 phase relocation locked in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` (Document 1) and consistent with BLUEPRINT.md changes specified in `BLUEPRINT_DELTA.md` (Document 2).

**This document is Document 3 of 8 in the governance synchronization series.** It describes every edit that must be made to `MASTER_BUILD_SPEC.md` and presents each one as an exact before/after diff with line-anchored references. No edits to MASTER_BUILD_SPEC.md occur in the repo until this document is approved.

**Source file state at time of authoring:** `/mnt/project/MASTER_BUILD_SPEC.md`, 1,142 lines, last modified per project upload timestamp 2026-05-23 17:32.

**Critical context — MASTER_BUILD_SPEC.md per Document 1 Section 11.1 hierarchy is "canonical, supersedes all" for build sequencing.** Edits here are propagation-critical. Errors here would propagate into every subsequent build session that reads this file for sequencing direction.

**Read every diff before approving.** Approval of this document authorizes the CC prompt that performs the edits as part of the single atomic governance commit.

---

## 1. SUMMARY OF CHANGES

This delta makes the following changes to MASTER_BUILD_SPEC.md:

| # | Type | Location | Purpose |
|---|---|---|---|
| 1 | REPLACE | Lines 24–38 (Section 1 Agents list) | Update Phase 1 agent count from 14 to 15, add A-44 in correct sequence position |
| 2 | REPLACE | Lines 52–60 (Section 1 Systems list) | Add RBAC system and role-aware UI to the Phase 1 systems list |
| 3 | REPLACE | Lines 216–222 (Section 6 Authentication Flow) | Replace role-routing logic to query `user_roles` table instead of `user_metadata.role` |
| 4 | REPLACE | Lines 292–295 (Section 7 Header) | Expand the role badge specification with multi-role detail |
| 5 | INSERT | After line 295 (end of Section 7 Header) | Add Section 7.X "Role-Aware Rendering Rules" with per-zone conditional rendering specification |
| 6 | INSERT | After line 290 (end of Section 7 Sidebar Nav) | Add "Users" sidebar item (master_admin-only) and "Audit Log" item (master/senior only) |
| 7 | INSERT | After line 364 (end of Tab 6 Integrations) | Add Tab 7: Knowledge Base for per-client A-44 surface |
| 8 | REPLACE | Lines 369–379 (Flagged Pages Queue) | Add reviewer assignment columns and role-aware action availability |
| 9 | REPLACE | Lines 402–406 (Page Actions) | Add role-gated action availability notes |
| 10 | REPLACE | Lines 408–421 (8-Step Wizard) | Update to 9-step wizard incorporating A-44 ingestion as automatic Step 9 |
| 11 | INSERT | After line 1010 (end of Operator Geo-Grid panel) | Add Phase 1 dashboard scope additions: Users surface, Audit Log surface, Knowledge Base tab |
| 12 | REPLACE | Lines 1025–1036 (Phase 1 Dashboard Exit Criteria) | Add RBAC and A-44 exit criteria items |
| 13 | INSERT | After line 1140 (end of Section 24) | Add Section 25 "RBAC and A-44 Phase 1 Cross-Reference" |

**Net effect on MASTER_BUILD_SPEC.md:**
- Lines deleted: approximately 60
- Lines added: approximately 290
- Net line delta: +230 lines, ending file at ~1,372 lines

**Zero changes to:**
- Section 0 (Reading order)
- Section 2 (Color palette locked)
- Section 3 (Typography locked)
- Section 4 (Logo locked)
- Section 5 (Surface 1: Marketing Landing Page)
- Section 9 (Surface 5: Client Portal Login DEPRECATED)
- Section 10 (Surface 6: Client Portal) — client portal is unaffected by operator-side RBAC
- Section 10A (API Route Inventory) — handled separately in code-level updates
- Section 11 (Recommendations Engine)
- Section 12 (Real-Time Polling)
- Section 13 (Advisory Signals System)
- Section 14 (Tenant Health Scoring)
- Section 15 (Stripe Products)
- Section 16 (Google Calendar API)
- Section 17 (GBP API Application)
- Section 18 (Anti-Failure Protections)
- Section 19 (Six Laws)
- Section 20 (Phase 1 Exit Criteria) — separate from Section 23 dashboard exit criteria
- Section 21 (Per-Page Analytics)
- Section 22 (Geo-Grid Visualization)
- Section 24 (Detailed Specification Cross-References)
- Phase 1.5 section

---

## 2. CHANGE 1: Update Phase 1 Agent Count and Sequence

### 2.1 Context

Section 1 (lines 22–66) declares the Phase 1 scope. The agent list currently shows 14 agents. With A-44 relocated from Phase 1.5 to Phase 1 per Document 1 Section 7, the count becomes 15 and A-44 must appear in correct sequence position (after A-01 Intake Processor, before A-10 Content Profile Builder, per BLUEPRINT.md Section 4.2 updated pipeline).

### 2.2 Lines being replaced

Lines 24 through 38 currently read:

```
### Agents (14)
A-01 Intake Processor
A-02 Page Generator
A-03 Schema Generator
A-04 Map Embed Generator
A-05 Page Validator (15 gates)
A-06 Internal Link Builder
A-07 Sitemap Generator
A-08 Indexation Tracker
A-09 Conversion Handler
A-10 Content Profile Builder (with heatmap)
A-11 Content Refresh Engine
A-14 Review Velocity Engine
A-18 Job Evidence Ingestion Engine
A-19 Universal Integration Hub
```

### 2.3 Replacement content

```
### Agents (15)
A-01 Intake Processor
A-44 Client Knowledge Ingestion Engine (relocated from Phase 1.5 per operator decision 2026-05-23 — see ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 7 and BLUEPRINT.md Part 10.5 for canonical specification)
A-02 Page Generator (blocked from execution per Contract 73 until A-44 produces successful current ingestion version for the client)
A-03 Schema Generator
A-04 Map Embed Generator
A-05 Page Validator (15 gates)
A-06 Internal Link Builder
A-07 Sitemap Generator
A-08 Indexation Tracker
A-09 Conversion Handler
A-10 Content Profile Builder (with heatmap)
A-11 Content Refresh Engine
A-14 Review Velocity Engine
A-18 Job Evidence Ingestion Engine
A-19 Universal Integration Hub
```

### 2.4 Why A-44 sits between A-01 and A-02 in this list

Per the BLUEPRINT.md Section 4.2 updated post-onboarding pipeline (Document 2 Change 3), the execution order is A-01 → A-44 → A-10 → A-02 → A-03 → A-04 → A-05 → A-06 → A-07. The agent list in this section is ordered by execution sequence, not alphabetically. A-44 must appear immediately after A-01 to reflect that it executes before A-02. The note on A-02 cross-references Contract 73 to make the dependency explicit at the spec level.

---

## 3. CHANGE 2: Add RBAC to Phase 1 Systems List

### 3.1 Context

Section 1 Systems subsection (lines 52–60) enumerates the Phase 1 systems that must ship. RBAC is a new Phase 1 system per operator decision 2026-05-23. The Personalized Demo Engine T1 (already in scope per AGENTS.md) is not affected. The new entries add RBAC and the related governance.

### 3.2 Lines being replaced

Lines 52 through 60 currently read:

```
### Systems
- 8-step onboarding wizard
- Stripe billing (3 tiers, recreate at correct amounts)
- Recommendations Engine (Next Best Actions)
- Real-time polling (30-second intervals on command center)
- Advisory signals system (per-tenant warnings)
- Tenant health scoring (composite per client)
- GBP API application (write copy, user submits)
- Marketing demo form -> Google Calendar API integration
```

### 3.3 Replacement content

```
### Systems
- 9-step onboarding wizard (8 manual operator steps plus automatic Step 9 A-44 knowledge ingestion — see BLUEPRINT.md Section 4.1 Step 9 for full specification)
- Stripe billing (4 tiers — Starter/Growth/Authority/Dominance — at locked amounts per Part 9.2 of BLUEPRINT.md)
- Recommendations Engine (Next Best Actions)
- Real-time polling (30-second intervals on command center)
- Advisory signals system (per-tenant warnings)
- Tenant health scoring (composite per client)
- GBP API application (write copy, user submits)
- Marketing demo form → Google Calendar API integration
- Role-Based Access Control (RBAC) system per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md (three operator-side roles: master_admin, senior_admin, va; canonical permission matrix encoded in src/lib/auth/permission-matrix.ts; Contracts 71, 72, 73 enforce)
- Multi-user audit attribution captured via user_actions table with three-attribute logging (acting_user_id, acting_user_role, client_id)
- A-44 Client Knowledge Ingestion Engine with quarterly refresh CRON (CRON-03 a44-quarterly-refresh, ±7 day jitter)
```

### 3.4 Side notes on this change

- The "3 tiers" reference in the original line 54 was already inconsistent with Part 9 of BLUEPRINT.md (which canonicalized 4 tiers including Dominance). Correcting this in passing.
- The Personalized Demo Engine and other already-locked systems are not in this list because the list is intentionally Phase 1 scope, not a complete system inventory. No change there.

---

## 4. CHANGE 3: Update Unified Login Authentication Flow

### 4.1 Context

Section 6 (Surface 2: Unified Login, lines 201–227) describes the authentication flow. The current flow queries `clients` table for role routing. Per Document 1 Section 5.1, the flow must instead query the new `user_roles` table.

### 4.2 Lines being replaced

Lines 216 through 222 currently read:

```
### Authentication Flow
1. User submits email + password to Supabase Auth
2. On success, query `clients` table:
   - If `client_user_id = auth.uid()` → redirect to `/portal`
   - Else if `operator_id = auth.uid()` → redirect to `/dashboard`
   - Else → error: "Account not found"
3. RLS policies enforce tenant isolation at database layer
```

### 4.3 Replacement content

```
### Authentication Flow
1. User submits email + password to Supabase Auth
2. On success, query `user_roles` table:
   - SELECT role FROM user_roles WHERE user_id = auth.uid() AND revoked_at IS NULL LIMIT 1
3. Branch on role result:
   - role = 'client' → redirect to `/portal`
   - role IN ('master_admin', 'senior_admin', 'va') → redirect to `/dashboard`
   - No active role row → error: "Account inactive. Contact platform owner."
4. RLS policies enforce tenant isolation at database layer per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 6

### Authentication Flow Migration Note
Prior flow (pre-2026-05-23) queried `clients` table directly to determine role via `client_user_id` vs `operator_id` lookup. The new flow queries the dedicated `user_roles` table created in Migration N+1. The legacy `clients.client_user_id` column remains in use for RLS policies on client portal data (a client portal user's auth.uid() lookup to find their client_id row) but is no longer the source of truth for role determination at login. Migration N+2 (`seed_user_roles_from_auth_users.sql`) ensures every existing auth.users row has a corresponding user_roles row before this new flow activates.

Contract 8 (Middleware Auth Passthrough Only) remains in force. Middleware does not perform the role lookup — the role lookup happens in the login route handler and any subsequent role-gated route handler. Middleware continues to only validate the Bearer token and set the x-user-id header.
```

### 4.4 Why we don't change Contract 8 or the middleware

Per Contract 8, middleware is auth passthrough only with no role logic, and Contract 8 amendment is not on the table. The role lookup happens in the login route handler (server action) and in every protected route handler via the `getUserActiveRole()` helper from `src/lib/auth/role-context.ts`. This preserves Contract 8 unchanged.

---

## 5. CHANGE 4: Expand Header Role Badge Specification

### 5.1 Context

Section 7 Header (lines 292–295) currently says "User avatar + email + role badge" — the role badge is referenced but not specified. With three operator-side roles, the badge needs explicit visual treatment so the implementation is unambiguous.

### 5.2 Lines being replaced

Lines 292 through 295 currently read:

```
### Header
- Page title (e.g., "Command Center")
- User avatar + email + role badge
- Notifications bell (count of unread alerts)
```

### 5.3 Replacement content

```
### Header
- Page title (e.g., "Command Center")
- User avatar + email
- Role badge with role-specific styling:
  - master_admin: red background (#DC2626) with white text "Master Admin"
  - senior_admin: blue background (#2563EB) with white text "Senior Admin"
  - va: gray background (#475569) with white text "VA"
- Role badge tooltip on hover: brief summary of the role's action scope per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3
- Notifications bell (count of unread alerts) — VAs see only alerts within VA action scope (P3 signals, evidence-related events); master_admin and senior_admin see all alerts
```

### 5.4 Why color choices

Red for master_admin signals authority. Blue for senior_admin signals trusted operational level. Gray for VA signals neutral operational level. The colors are chosen to integrate with the locked dashboard palette (#1A2238 background, #F5F1E8 primary text) without clashing. Red is reserved at the platform-wide level for master_admin specifically — it must NOT be used for any other UI affordance going forward to keep the role badge unambiguous on first glance.

---

## 6. CHANGE 5: Add Role-Aware Rendering Rules Section

### 6.1 Context

Section 7 (Operator Command Center) ends at line 295. A new subsection is needed to specify exactly how each zone renders for each role. This complements but does not duplicate BLUEPRINT.md Section 8.6.5 (added in Document 2 Change 4) — MASTER_BUILD_SPEC.md is the canonical build-direction file, so the same content lives here in build-spec form.

### 6.2 Insertion location

Insert immediately after line 295 (after the Notifications bell line) and before line 297 (the `---` separator).

### 6.3 Content to insert

```

### Role-Aware Rendering Rules

The 4-zone layout (Zones 1–4 above) renders for all three operator-side roles. Conditional rendering applies to specific affordances within each zone per the canonical permission matrix (ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3). Contract 71 enforces that every protected action call invokes `hasPermission(role, action)` from `src/lib/auth/role-context.ts` before executing.

**Zone 1 (Top Stat Strip, 6 cards):**
All three roles see all six cards as read-only displays. No conditional rendering applies — KPI visibility is universal.

**Zone 2 (Real-time Activity Feed):**
All three roles see the feed. Filter chips are universal. No conditional rendering applies.

**Zone 3 Panels:**
- **Next Best Actions Panel:** VAs see only items where the recommended action is within VA permission scope. Items requiring master_admin or senior_admin authority are filtered out for VAs so the panel does not create expectations the role cannot fulfill. Master_admin and senior_admin see the full panel.
- **Tenant Health Panel:** All roles see the full panel. Drill-down navigation respects the permission matrix.
- **Advisory Signals Panel:** All roles see the panel. Dismiss button availability is role-gated:
  - VAs can dismiss only P3 (informational) signals
  - Senior_admin can dismiss P0, P1, P2, P3 signals (P0 dismissals require justification referencing resolution commit hash or migration ID and are flagged for master_admin review within 24 hours)
  - Master_admin can dismiss all signal severities

**Zone 4 (Bottom Row Charts):**
All three roles see the charts. No conditional rendering applies.

**Action Button Rendering Convention:**
- *Hide entirely* — actions the role concept does not include (e.g., role management UI invisible to non-master_admin)
- *Disable with tooltip* — actions the role might expect but lacks permission for (e.g., VA sees a disabled "Approve flagged page" button with tooltip "Requires senior_admin role")

Rationale: disable-with-tooltip for affordances the role might expect to use (preserving discoverability and escalation awareness), hide-entirely for surfaces the role should not need to know exist (preserving cognitive simplicity for that role's typical workflow).

```

---

## 7. CHANGE 6: Add Users and Audit Log to Sidebar Nav

### 7.1 Context

Section 7 Sidebar Nav (lines 281–290) currently lists 9 nav items. Two new items are needed:

- **Users** — master_admin only, links to `/dashboard/users` for role grant/revocation
- **Audit Log** — master_admin and senior_admin only, links to `/dashboard/audit` for user_actions log

These are added in logical position adjacent to existing items.

### 7.2 Lines being replaced

Lines 281 through 290 currently read:

```
### Sidebar Nav (always visible)
- Command Center (active)
- Clients
- Pages (cross-tenant browser)
- Agents (status of all 14 + 2 crons + manual trigger)
- Compliance (DSARs, TCPA records, sub-processors)
- Billing (Stripe revenue, invoices)
- Storm Intelligence (Phase 3 placeholder, locked icon)
- Settings
- Logout
```

### 7.3 Replacement content

```
### Sidebar Nav (visibility is role-conditional per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 9.3)
- Command Center (active) — visible to: master_admin, senior_admin, va
- Clients — visible to: master_admin, senior_admin, va
- Pages (cross-tenant browser) — visible to: master_admin, senior_admin, va
- Agents (status of all 15 + 3 crons + manual trigger; trigger buttons gated per permission matrix) — visible to: master_admin, senior_admin, va
- Compliance (DSARs, TCPA records, sub-processors) — visible to: master_admin, senior_admin (hidden from va)
- Billing (Stripe revenue, invoices) — visible to: master_admin, senior_admin (hidden from va)
- Audit Log (user_actions across platform, filterable) — visible to: master_admin, senior_admin (hidden from va; va sees only own session log via /dashboard/profile)
- Users (role grants, revocations, user list) — visible to: master_admin only (hidden entirely from senior_admin and va)
- Storm Intelligence (Phase 3 placeholder, locked icon) — visible to: master_admin, senior_admin, va
- Settings — visible to: master_admin, senior_admin, va (settings scope per role)
- Logout — visible to all roles
```

### 7.4 Notes on the count update

The original line said "14 agents + 2 crons" — both numbers have changed. After this synchronization: 15 agents (A-44 added to Phase 1) and 3 CRONs (CRON-03 a44-quarterly-refresh added per BLUEPRINT.md Part 10.5). The Agents nav item description updates accordingly.

---

## 8. CHANGE 7: Add Knowledge Base Tab to Client Detail

### 8.1 Context

Section 8 Client Detail Tabs (lines 327–365) currently documents 6 tabs (Overview, Pages, Profile Data, Activity, Billing, Integrations). A 7th tab is needed for A-44 knowledge base management.

### 8.2 Insertion location

Insert immediately after line 364 (end of "Tab 6: Integrations" content) and before line 366 ("### Flagged Pages Queue").

### 8.3 Content to insert

```

**Tab 7: Knowledge Base (NEW — Phase 1)**
A-44 Client Knowledge Ingestion Engine management surface for this client. Visible to all three operator-side roles; action availability gated per permission matrix.

*Current Version Section:*
- Version number and date of current `client_ingestion_versions` row
- Source URL crawled, scrape duration, asset count by type (logos, badges, certifications, testimonials, photos)
- Brand voice summary (tone of voice, voice descriptors)
- NAP data captured (verified vs. intake form)
- Keyword gap summary

*Version History Section:*
- Reverse-chronological table of all prior `client_ingestion_versions` rows
- Per row: version number, trigger type (onboarding / manual / quarterly_cron / signal_detected), status, diff severity, approved_by, approval timestamp
- Click row to expand and view diff_summary JSONB rendered as readable field-by-field deltas

*Pending Diff Approval Panel (only renders when diff_severity = 'material' or 'breaking' awaiting approval):*
- Side-by-side comparison of current version vs. proposed new version per critical field (logo, NAP, license, certifications, manufacturer badges)
- "Approve" button — visible to master_admin and senior_admin; promotes proposed version to is_current=TRUE
- "Reject" button — visible to master_admin and senior_admin; marks proposed version as rejected, preserves as historical row
- Required justification field on either action

*Force Re-scrape Section:*
- "Force Re-scrape" button visible to master_admin and senior_admin (VAs see disabled with tooltip "Requires senior_admin role")
- Required justification field (examples: "Client relaunched site," "New certifications announced," "NAP data correction")
- Triggers A-44 immediately, bypasses quarterly schedule, resets next_ingestion_scheduled_at after completion

*Manual Asset Provision Section (master_admin only):*
- "Manual Asset Provision" button visible to master_admin only (Contract 73 override path)
- Form for uploading brand voice descriptors, logo files, certification badges, NAP data manually when client website is unscrapable
- Required justification field
- Creates client_ingestion_versions row with approval_status='manually_provided', is_current=TRUE
- Logs action_type='override_a44_prerequisite' to user_actions per Contract 72

*Block A-44 Section (master_admin only):*
- Toggle visible to master_admin only
- Sets clients.ingestion_blocked = TRUE with required reason (e.g., "Client requested no automated crawls")
- When blocked, quarterly CRON skips this client
- Unblock requires master_admin action with justification

**Data sources:**
- client_ingestion_versions (all queries)
- client_ingested_assets (current version's assets)
- client_brand_voice_model (current version's voice model)
- client_keyword_gap_analysis (current version's keyword gaps)
- clients.ingestion_blocked, clients.current_ingestion_version_id, clients.last_ingestion_at, clients.next_ingestion_scheduled_at

```

### 8.4 Why a dedicated tab vs. inline in Profile Data

A-44 outputs are substantial (asset libraries, version history, diff approval workflow) and operationally distinct from the Profile Data tab (business address, cities×services matrix, evidence inventory). Co-locating them would create visual clutter on the Profile Data tab and conflate two different concepts: client-provided data (Profile Data) vs. platform-scraped data (Knowledge Base). The tab separation is the correct UX architecture.

---

## 9. CHANGE 8: Add Reviewer Assignment to Flagged Pages Queue

### 9.1 Context

Section 8 Flagged Pages Queue (lines 366–379) currently shows columns and operator override actions without role attribution or reviewer assignment. Per Document 1 Section 4.5.3, flagged pages support a 30-minute review lease pattern with `assigned_reviewer_id`, `assigned_reviewer_at`, `assigned_reviewer_role` columns on the pages table.

### 9.2 Lines being replaced

Lines 366 through 379 currently read:

```
### Flagged Pages Queue (/dashboard/clients/[id]/flagged) — Built
**Purpose:** Operator review queue for pages flagged by A-05 Gate 15 custom rules or low quality scores.

**Table Columns:**
- Page slug
- Flagged reason (quality gate failure description)
- Quality score (0-100)
- Flagged timestamp
- Actions: Approve anyway, Request regeneration, Delete page

**Operator Override:**
- Approve button → sets page.status = 'queued' (bypasses flag)
- Logged in operator_actions table with required justification field
- Justification examples: “Tier-specific terminology acceptable”, “Client requested language”
```

### 9.3 Replacement content

```
### Flagged Pages Queue (/dashboard/clients/[id]/flagged) — Built (RBAC updates pending)
**Purpose:** Review queue for pages flagged by A-05 Gate 15 custom rules or low quality scores. Visible to all three operator-side roles; review actions gated per permission matrix.

**Table Columns:**
- Page slug
- Flagged reason (quality gate failure description)
- Quality score (0-100)
- Flagged timestamp
- Assigned reviewer (name and role badge if `pages.assigned_reviewer_id` is set and lease has not expired)
- Lease expiration (timestamp when 30-minute assignment lease ends; empty if unassigned)
- Actions per row (rendered conditionally per current user's role):
  - Claim (visible if unassigned or current user already holds the lease) — sets assigned_reviewer fields with 30-minute lease
  - Release (visible if current user holds the lease) — clears assigned_reviewer fields
  - Approve (visible to master_admin and senior_admin; disabled for va with tooltip "Requires senior_admin")
  - Reject and regenerate (visible to master_admin and senior_admin; disabled for va)
  - Add comment / note (visible to all roles including va — note-taking is not a decision)
  - Force reassign (visible to master_admin only, dropdown to reassign existing claim)
  - Delete page (visible to master_admin and senior_admin; soft-delete only — hard delete is master_admin-only per permission matrix)

**Action Logging (Contract 72 — three-attribute audit attribution):**
- Approve button → sets page.status = 'queued' (bypasses flag); logs to user_actions with acting_user_id, acting_user_role, client_id, action_type='approve_flagged_page', justification, result
- Reject button → logs to user_actions with action_type='reject_flagged_page' and adds row to page_generation_queue with retry_count++
- Comment action → logs to user_actions with action_type='add_flagged_page_comment'
- Force reassign → logs to user_actions with action_type='force_reassign_flagged_page_reviewer'
- All actions require justification field per the action's classification (override actions strictly required, comment actions optional)

**Lease semantics:**
- 30-minute soft-lock from `pages.assigned_reviewer_at`
- Lease auto-expires after 30 minutes; expired leases revert page to unassigned
- Same reviewer can re-claim by clicking Claim again (resets the 30-minute lease)
- VAs can claim flagged pages for visibility and note preparation but cannot perform approve/reject (still gated by permission matrix at the action level — claim does not grant approval authority)

**Migration note:** This section updates the spec for the existing /dashboard/clients/[id]/flagged route. The route is already built (commit 803b3a9) but does not yet implement reviewer assignment columns or role-gated action availability. The Phase 1 RBAC build (per Section 23 below as updated by Change 11) implements these additions.
```

---

## 10. CHANGE 9: Update Single Page Detail Actions with Role Gating

### 10.1 Context

Section 8 Single Page Detail (lines 381–406) lists the page actions available from `/dashboard/clients/[id]/pages/[pageId]`. These actions need role gating notes per the canonical permission matrix.

### 10.2 Lines being replaced

Lines 402 through 406 currently read:

```
**Page Actions:**
- Force publish (bypasses pending gates)
- Request regeneration (adds to page_generation_queue with retry_count++)
- Delete page (soft delete: status = 'deleted')
- View public URL (opens published page in new tab)
```

### 10.3 Replacement content

```
**Page Actions (rendered conditionally per current user's role per permission matrix):**
- Force publish (bypasses pending soft gates only — HARD gates G1, G2, G10, G13 remain non-overridable per Contract 9 regardless of role)
  - Visible to: master_admin, senior_admin
  - Disabled with tooltip "Requires senior_admin" for: va
- Request regeneration (adds to page_generation_queue with retry_count++)
  - Visible to: master_admin, senior_admin
  - Disabled for: va
- Soft-delete page (status = 'deleted', row preserved)
  - Visible to: master_admin, senior_admin
- Hard-delete page (DB row removal)
  - Visible to: master_admin only
- Add comment / note (no decision; informational)
  - Visible to: all roles including va
- View public URL (opens published page in new tab)
  - Visible to: all roles
- Force-publish override against HARD gate (constitutional)
  - Visible to: no role (HARD gates per Contract 9 are non-overridable)
  - Attempts to do so via API return 403 with error code 'HARD_GATE_OVERRIDE_FORBIDDEN'

**Action Logging (Contract 72):** All override actions (force-publish, soft-delete, hard-delete) require justification field and log to user_actions with three-attribute attribution.
```

---

## 11. CHANGE 10: Update 8-Step Wizard to 9-Step

### 11.1 Context

Section 8 "8-Step Wizard" (lines 408–421) describes the wizard. With A-44 added as automatic Step 9 per BLUEPRINT.md Section 4.1 Step 9 (Document 2 Change 2), the wizard is functionally a 9-step process even though Step 9 is platform-executed not operator-driven.

### 11.2 Lines being replaced

Lines 408 through 421 currently read:

```
### 8-Step Wizard (/dashboard/clients/new) — STUB ONLY
**Current State:** Basic scaffold with step navigation, no actual form fields or mutations.

**Phase 1 Specification (not yet built):**
1. Business Information (name, address, phone, email, industry)
2. Service Area (state, counties, zip codes)
3. Cities × Services Selection (matrix UI, tier limit enforcement)
4. Evidence Upload (photos, case studies, certifications via R2 presigned upload)
5. Consent Collection (TCPA checkbox, ToS acceptance, DPA signature, GBP auth, call tracking consent)
6. Google Authorization (OAuth flow for GBP + GCS, per-client GCP project setup)
7. Payment & Signature (Stripe checkout session + DocuSign envelope for service agreement)
8. Integration Setup (ServiceTitan/Jobber/etc OAuth or webhook config)

**Exit Criteria:** Client record created with status = 'onboarding', progresses to 'active' after step 8 completion.
```

### 11.3 Replacement content

```
### 9-Step Onboarding Wizard (/dashboard/clients/new) — STUB ONLY (Phase 1 build pending)
**Current State:** Basic scaffold with step navigation, no actual form fields or mutations. Stub does not yet include Step 9.

**Phase 1 Specification (not yet built):**

Operator-driven steps (8 manual steps requiring master_admin or senior_admin):
1. Business Information (name, address, phone, email, industry)
2. Service Area (state, counties, zip codes, business website URL — captured here for use by Step 9)
3. Cities × Services Selection (matrix UI, tier limit enforcement)
4. Evidence Upload (photos, case studies, certifications via R2 presigned upload)
5. Consent Collection (TCPA checkbox, ToS acceptance, DPA signature, GBP auth, call tracking consent)
6. Google Authorization (OAuth flow for GBP + GCS, per-client GCP project setup)
7. Payment & Signature (Stripe checkout session + DocuSign envelope for service agreement)
8. Integration Setup (ServiceTitan/Jobber/etc OAuth or webhook config)

Platform-executed step (1 automatic step, no operator input required):
9. Knowledge Ingestion (Automatic): Platform triggers A-44 Client Knowledge Ingestion Engine using the website URL captured in Step 2. A-44 crawls the client's website, extracts brand voice, manufacturer badges, certifications, NAP data, and asset library. Creates client_ingestion_versions row with trigger_type='onboarding', approval_status='auto_approved', is_current=TRUE. See BLUEPRINT.md Section 4.1 Step 9 and Part 10.5 for full A-44 specification.

**Permission gating:**
- All 8 operator-driven steps require master_admin or senior_admin role (per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3.1 "create_client" and "complete_onboarding" actions)
- VAs cannot initiate or complete the wizard
- Step 9 is platform-executed and does not require human action

**Exit Criteria:**
- Steps 1–8 complete: clients.status transitions from null/draft to 'onboarding'
- Step 7 (Payment) success: clients.status transitions to 'active'
- Step 9 (A-44) success: client_ingestion_versions row with is_current=TRUE exists; clients.current_ingestion_version_id populated; Contract 73 satisfied; A-02 unblocked
- Step 9 failure: clients.status remains 'active' but A-02 remains blocked; P2 advisory signal raised; master_admin or senior_admin must retry A-44 or apply manual asset provision override per Contract 73

**Step 9 failure recovery paths:**
1. Operator opens Tab 7 Knowledge Base on /dashboard/clients/[id] and clicks Force Re-scrape (master_admin or senior_admin)
2. Operator applies Manual Asset Provision override (master_admin only)
3. Operator blocks A-44 for the client via Tab 7 Block A-44 toggle (master_admin only, requires reason)

In all three recovery paths, the action is logged to user_actions per Contract 72.
```

---

## 12. CHANGE 11: Add Phase 1 Dashboard Scope Additions

### 12.1 Context

Section 23 (Phase 1 Dashboard Build Spec, lines 943–1037) declares the authorized dashboard scope. Per the RBAC architecture lock, three new surfaces are added to Phase 1 scope: Users management page, Audit Log page, and Knowledge Base tab. The existing 7-item build order is extended with these additions.

### 12.2 Insertion location

Insert immediately after line 1010 (end of "Operator Geo-Grid Layer 1b panel" description) and before line 1011 (which begins "### Phase 1 Dashboard Scope — EXPLICITLY DEFERRED").

### 12.3 Content to insert

```

**Phase 1 RBAC and A-44 Dashboard Surfaces (NEW per 2026-05-23 synchronization):**

**Users Management Page (`/dashboard/users`) — master_admin only:**
- Lists all platform users (auth.users joined with user_roles) with current role, granted_at, last login, total action count, denied-attempt count
- Filterable by role, sortable by last login or action count
- "Grant Role" button opens modal for inviting new user or promoting existing user (master_admin can grant any role; senior_admin can grant only va role via a separate senior-accessible form on a different surface)
- "Revoke Role" button on each user row with required justification field
- Per-user drill-down to full user_actions log for that user
- Data sources: auth.users, user_roles, user_actions, role_grant_audit

**Audit Log Page (`/dashboard/audit`) — master_admin and senior_admin only:**
- Reverse-chronological table of user_actions across the entire platform
- Columns: timestamp, acting_user (name + email + role badge for the role they held at action time), client (if applicable), action_type, result (success / denied_permission / denied_constraint / failed), justification, metadata expand
- Filters: acting_user, role at time of action, client, action_type, result, date range
- Export to CSV for compliance reporting
- Per-row expand to view full metadata JSONB
- Data sources: user_actions, auth.users, clients, user_roles

**Knowledge Base Tab (within `/dashboard/clients/[id]`) — visible to all three operator-side roles:**
- Per-client A-44 management surface — full specification in Section 8 Tab 7 above
- Force Re-scrape button visible to master_admin and senior_admin
- Manual Asset Provision visible to master_admin only
- Block A-44 toggle visible to master_admin only
- Diff approval panel visible to master_admin and senior_admin when pending diffs exist
- Data sources: client_ingestion_versions, client_ingested_assets, client_brand_voice_model, client_keyword_gap_analysis

These three surfaces are part of Phase 1 dashboard scope and required for Phase 1 exit.

**Updated Build Order (Mandatory Sequence — append to existing 1–7 list):**
8. **User Management Page** (`/dashboard/users`) — master_admin-only role grant and revocation interface
9. **Audit Log Page** (`/dashboard/audit`) — user_actions log with filtering and export
10. **Knowledge Base Tab** (within `/dashboard/clients/[id]` as Tab 7) — A-44 management per client

Items 8–10 build after Items 5–7 (Operator Command Center KPI strip, Zone 4 charts, Geo-Grid Layer 1b panel) per the existing operator-surfaces-second priority. Items 8 and 9 unblock the RBAC architecture in production; Item 10 unblocks A-44 operational management.

```

### 12.4 Why these three surfaces are non-deferrable

- **Users Management Page**: Without it, role grants must be done via direct database manipulation, which violates Contract 71 (no direct role checks bypassing the canonical pattern) and creates audit gaps (no role_grant_audit rows generated from manual SQL inserts unless the script explicitly creates them).
- **Audit Log Page**: Without it, master_admin cannot fulfill compliance obligations (DSAR responses requiring "who did what when" audit trails) and senior_admin cannot perform delegated oversight of VAs.
- **Knowledge Base Tab**: Without it, A-44 failures and quarterly diff approvals have no operator-facing surface. Failures would surface only via P2 signals with no remediation UI.

---

## 13. CHANGE 12: Update Phase 1 Dashboard Exit Criteria

### 13.1 Context

Section 23 Phase 1 Dashboard Exit Criteria (lines 1025–1036) currently lists 10 criteria. RBAC and A-44 criteria must be added.

### 13.2 Lines being replaced

Lines 1025 through 1036 currently read:

```
### Phase 1 Dashboard Exit Criteria
- [ ] Migration 006 applied (service_area_heatmaps extensions verified via information_schema)
- [ ] Client Portal KPI strip rendering 8 real metrics from existing tables (no placeholders)
- [ ] Client Portal Geo-Grid Layer 1b functional with E4 seeded data
- [ ] Client Portal monthly growth timeline rendering 90 days of real data
- [ ] Client Portal lead performance panel sortable, TCPA-compliant
- [ ] Operator Command Center KPI strip rendering 6 real metrics (no placeholders)
- [ ] Operator Zone 4 charts rendering real 30-day data
- [ ] Operator Geo-Grid Layer 1b functional cross-tenant
- [ ] All Phase 1 dashboard surfaces pass Six Laws verification (SCHEMA, API, UI, DATA, WIRING, VERIFICATION)
- [ ] Vercel production deployment Ready status
- [ ] Visual sweep diff vs 2026-05-16 baseline confirms 0 placeholder strings on dashboard routes
```

### 13.3 Replacement content

```
### Phase 1 Dashboard Exit Criteria
- [ ] Migration 006 applied (service_area_heatmaps extensions verified via information_schema)
- [ ] Client Portal KPI strip rendering 8 real metrics from existing tables (no placeholders)
- [ ] Client Portal Geo-Grid Layer 1b functional with E4 seeded data
- [ ] Client Portal monthly growth timeline rendering 90 days of real data
- [ ] Client Portal lead performance panel sortable, TCPA-compliant
- [ ] Operator Command Center KPI strip rendering 6 real metrics (no placeholders)
- [ ] Operator Zone 4 charts rendering real 30-day data
- [ ] Operator Geo-Grid Layer 1b functional cross-tenant
- [ ] All Phase 1 dashboard surfaces pass Six Laws verification (SCHEMA, API, UI, DATA, WIRING, VERIFICATION)
- [ ] Vercel production deployment Ready status
- [ ] Visual sweep diff vs 2026-05-16 baseline confirms 0 placeholder strings on dashboard routes
- [ ] **RBAC Migrations N+1 through N+8 applied** (user_roles, user_actions, role_grant_audit, client_ingestion_versions tables created; existing operator account auto-promoted to master_admin; existing operator_actions rows backfilled with role_at_time_of_action='operator_legacy'; synthetic A-44 baseline rows created for existing seeded clients)
- [ ] **Contract 71 enforcement script active** (scripts/verify-rbac-pattern.ts runs in pnpm verify:ci and blocks builds on direct role checks)
- [ ] **Contract 72 enforcement script active** (scripts/verify-audit-attribution.ts runs in pnpm verify:ci and blocks builds on missing audit attribution)
- [ ] **Contract 73 enforcement active** (A-02 entry point checks for client_ingestion_versions current row with status='success' before execution; failure throws ContractViolationError)
- [ ] **Users Management Page functional** (/dashboard/users renders for master_admin only; role grant and revocation work end-to-end; role_grant_audit rows created on every grant/revoke)
- [ ] **Audit Log Page functional** (/dashboard/audit renders for master_admin and senior_admin; user_actions filterable and exportable; VAs receive 403 on direct navigation)
- [ ] **Knowledge Base Tab functional** (/dashboard/clients/[id] Tab 7 renders for all three operator-side roles; action availability gated per permission matrix; Force Re-scrape works end-to-end; Manual Asset Provision works for master_admin)
- [ ] **A-44 Client Knowledge Ingestion Engine functional** (executes at Step 9 of onboarding; creates client_ingestion_versions row; populates client_ingested_assets, client_brand_voice_model, client_keyword_gap_analysis; LLM cost stays under $0.55 per scrape; Contract 73 enforced at A-02 entry)
- [ ] **CRON-03 a44-quarterly-refresh operational** (pg_cron schedule active; processes clients with next_ingestion_scheduled_at <= NOW(); diff classification working; auto-approves none/minor diffs; queues material/breaking diffs for approval)
- [ ] **Role-aware UI rendering verified** across all dashboard surfaces (Playwright E2E tests confirm VA sees disabled action buttons, master_admin sees Users sidebar item, senior_admin sees Audit Log sidebar item)
- [ ] **Multi-user audit attribution verified** (every user_actions row has acting_user_id, acting_user_role, and client_id where applicable populated; integration test asserts NOT NULL constraints)
- [ ] **Three-attribute attribution preserved over time** (test asserts that role_at_time_of_action captured at insert is not modified when user_roles changes for that user)
```

---

## 14. CHANGE 13: Add Section 25 "RBAC and A-44 Phase 1 Cross-Reference"

### 14.1 Context

MASTER_BUILD_SPEC.md ends at line 1142 with the closing of Section 24 (Detailed Specification Cross-References). A new Section 25 is added to provide a build-direction summary of the 2026-05-23 governance synchronization and serve as the entry point for future Claude Code sessions reading MASTER_BUILD_SPEC.md as their canonical build direction.

### 14.2 Insertion location

Insert at the end of the file, after line 1142.

### 14.3 Content to insert

```

---

## 25. RBAC AND A-44 PHASE 1 CROSS-REFERENCE (2026-05-23 GOVERNANCE SYNCHRONIZATION)

### Purpose
This section is the build-direction entry point for the multi-user role hierarchy and A-44 Client Knowledge Ingestion Engine functionality added to Phase 1 scope per the 2026-05-23 governance synchronization. All build sessions touching RBAC or A-44 surfaces must read this section first.

### Canonical Source of Truth
**`docs/architecture/ROLE_HIERARCHY_ARCHITECTURE_SPEC.md`** is the canonical specification. This Section 25 is a build-direction summary, not a replacement.

### Role Taxonomy (Phase 1)
Three operator-side roles plus the existing client role:
- master_admin (platform owner, top of hierarchy)
- senior_admin (trusted operational manager)
- va (virtual assistant)
- client (existing client portal role, unchanged)

### Permission Scoping
Global, not per-client. Encoded in `src/lib/auth/permission-matrix.ts`. Permission check helper: `hasPermission(role, action)` from `src/lib/auth/role-context.ts`. Contract 71 enforces use of the helper.

### Audit Attribution
Three attributes per audit log row: acting_user_id, acting_user_role (preserved historically, not mutated), client_id. Logged to user_actions table. Contract 72 enforces.

### A-44 Client Knowledge Ingestion Engine
Phase 1 mandatory prerequisite for A-02. Three refresh triggers: onboarding (mandatory, blocking), quarterly CRON (CRON-03 a44-quarterly-refresh with ±7 day jitter), manual trigger (master_admin or senior_admin). Contract 73 enforces. Full specification in BLUEPRINT.md Part 10.5 and ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 7.

### Build Sequence (Order of Operations for RBAC and A-44 Phase 1 Build)

The RBAC and A-44 build subdivides into 14 ordered work items. The dependency chain is strict — earlier items must complete before later items can begin.

1. **Migration N+1**: Create user_roles, role_grant_audit tables with RLS policies and indexes
2. **Migration N+2**: Seed user_roles from existing auth.users (operator → master_admin promotion)
3. **Migration N+3**: Create user_actions table with RLS, NOT NULL constraints on attribution columns
4. **Migration N+4**: Create client_ingestion_versions table with RLS, partial unique index for is_current
5. **Migration N+5**: Add ingestion tracking columns to clients (current_ingestion_version_id, last_ingestion_at, next_ingestion_scheduled_at, ingestion_blocked, ingestion_block_reason)
6. **Migration N+6**: Add role_at_time_of_action to operator_actions, backfill 'operator_legacy'
7. **Migration N+7**: Add assigned_reviewer columns to pages
8. **Migration N+8**: Seed synthetic A-44 baseline rows for existing clients
9. **Library: src/lib/auth/permission-matrix.ts**: Encode canonical permission matrix from ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3
10. **Library: src/lib/auth/role-context.ts**: Implement getUserActiveRole, hasPermission, logUserAction, logDeniedAction helpers
11. **Verification scripts**: scripts/verify-rbac-pattern.ts, scripts/verify-audit-attribution.ts, scripts/verify-permission-matrix-sync.ts; wire into pnpm verify:ci
12. **Authentication flow refactor**: Update /login route handler to query user_roles instead of clients table for role determination
13. **Existing operator API route refactor**: Refactor all routes under /api/operator/ to use role-context helpers; route-by-route audit
14. **New UI surfaces**: /dashboard/users (master_admin), /dashboard/audit (master/senior), /dashboard/clients/[id] Tab 7 Knowledge Base (all roles, role-gated actions)
15. **A-44 agent build**: Implement A-44 with three-trigger model, diff detection, version management
16. **CRON-03 implementation**: Schedule via pg_cron, implement queue and worker
17. **End-to-end Playwright tests**: Role-aware rendering, multi-user audit attribution, A-44 workflow

### Critical Contract Enforcements at Build Time

Build sessions implementing RBAC and A-44 must respect these contracts (read full text in BEHAVIORAL_CONTRACTS.md):

- **Contract 8** (Middleware Auth Passthrough Only) — UNCHANGED. Middleware does not perform role lookups. Role checks happen in route handlers.
- **Contract 67** (Resource Ownership Verification) — AMENDED. Ownership semantics now incorporate role-based access. See ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 8.4.
- **Contract 70** (Operator Endpoint Auth Helper Requirement) — UNCHANGED. getOperatorContext() still required. Layered with new role check via getUserActiveRole().
- **Contract 71** (RBAC Enforcement) — NEW. Every protected route handler must invoke hasPermission() before action execution. Direct role checks forbidden.
- **Contract 72** (Multi-User Audit Attribution) — NEW. Every audit log row captures acting_user_id, acting_user_role, client_id.
- **Contract 73** (Pre-Generation Knowledge Ingestion Requirement) — NEW. A-02 cannot execute without successful A-44 current version.

### Backward Compatibility
- Existing operator@tarritrix.test account auto-promoted to master_admin during Migration N+2.
- Existing clients.operator_id pointers preserved; semantically now means "the master_admin or senior_admin ultimately accountable for this client."
- Existing operator_actions rows backfilled with role_at_time_of_action = 'operator_legacy'.
- Existing seeded clients (E4 Construction & Roofing, and any others) receive synthetic A-44 baseline rows via Migration N+8 so Contract 73 is satisfied at the database constraint level and A-02 continues running without interruption. ingestion_synthetic_baseline = TRUE flag marks them for real A-44 scrape at next operator interaction.

### Six Laws Compliance at Phase 1 Exit
Every RBAC and A-44 surface must pass:
1. SCHEMA — migrations applied, indexes created, RLS policies active
2. API — route handlers using getUserActiveRole and hasPermission, returning consistent error shapes
3. UI — role-aware rendering verified across all three operator-side roles
4. DATA — real data flowing through user_actions, client_ingestion_versions, role_grant_audit
5. WIRING — UI invokes API which invokes helpers which check matrix; no shortcuts
6. VERIFICATION — Playwright E2E for role isolation, vitest for permission matrix, verify:ci scripts blocking direct role checks

```

---

## 15. VERIFICATION QUERIES FOR THIS DELTA

After CC applies these edits, the following queries MUST pass before the commit is accepted:

### 15.1 Phase 1 agent count check

```bash
grep -E "^### Agents \(15\)" /path/to/MASTER_BUILD_SPEC.md
# Expected: 1 match

grep -E "^### Agents \(14\)" /path/to/MASTER_BUILD_SPEC.md
# Expected: zero matches (old count removed)
```

### 15.2 A-44 Phase 1 placement check

```bash
grep -E "A-44.*Client Knowledge Ingestion" /path/to/MASTER_BUILD_SPEC.md | wc -l
# Expected: at least 4 occurrences

grep -E "A-44.*Phase 1\.5" /path/to/MASTER_BUILD_SPEC.md
# Expected: zero matches
```

### 15.3 Authentication flow update check

```bash
grep -i "user_roles" /path/to/MASTER_BUILD_SPEC.md | wc -l
# Expected: at least 10 occurrences across Section 6 and Section 25

grep -A2 "User submits email" /path/to/MASTER_BUILD_SPEC.md | grep "user_roles"
# Expected: at least 1 match
```

### 15.4 RBAC content presence check

```bash
grep -E "master_admin|senior_admin" /path/to/MASTER_BUILD_SPEC.md | wc -l
# Expected: at least 50 occurrences

grep -E "Contract 71|Contract 72|Contract 73" /path/to/MASTER_BUILD_SPEC.md | wc -l
# Expected: at least 10 occurrences
```

### 15.5 New sidebar items check

```bash
grep -E "Users.*master_admin only|Audit Log.*master_admin.*senior_admin" /path/to/MASTER_BUILD_SPEC.md | wc -l
# Expected: at least 2 matches
```

### 15.6 New tab and surface check

```bash
grep -E "Tab 7.*Knowledge Base|/dashboard/users|/dashboard/audit" /path/to/MASTER_BUILD_SPEC.md | wc -l
# Expected: at least 5 matches
```

### 15.7 Phase 1 exit criteria additions check

```bash
grep -E "RBAC Migrations|Contract 7[123] enforcement|Knowledge Base Tab functional" /path/to/MASTER_BUILD_SPEC.md | wc -l
# Expected: at least 6 matches
```

### 15.8 Line count check

```bash
wc -l /path/to/MASTER_BUILD_SPEC.md
# Expected: approximately 1,372 lines (1,142 + 230 net additions)
# Tolerance: ±30 lines for whitespace and formatting normalization
```

### 15.9 Cross-reference integrity check

```bash
# Every reference to ROLE_HIERARCHY_ARCHITECTURE_SPEC.md must point to the correct path
grep -E "ROLE_HIERARCHY_ARCHITECTURE_SPEC\.md" /path/to/MASTER_BUILD_SPEC.md | wc -l
# Expected: at least 6 occurrences

# Every reference to BLUEPRINT.md sections must use correct numbering
grep -E "BLUEPRINT\.md.*Part 10\.5|BLUEPRINT\.md.*Section 4\.1|BLUEPRINT\.md.*Part 11" /path/to/MASTER_BUILD_SPEC.md | wc -l
# Expected: at least 5 occurrences
```

---

## 16. APPROVAL

This document requires operator sign-off before MASTER_BUILD_SPEC.md is modified in the repository.

**Operator approval format:**

- **"Approved — proceed to Document 4"** to advance to SCHEMA_REGISTRY.md delta updates.
- **"Edits required: [list]"** to request specific revisions to this delta before approval.

After all 8 documents are approved, the CC prompt that performs the synchronized governance commit will apply this delta to MASTER_BUILD_SPEC.md as one of seven file modifications in a single atomic operation.

---

**End of Document 3 of 8.**
