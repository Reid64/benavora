# TARRITRIX 1.0 — ROLE HIERARCHY ARCHITECTURE SPECIFICATION

**Document ID:** ROLE_HIERARCHY_ARCHITECTURE_SPEC
**Version:** 1.0
**Status:** DRAFT — Pending operator approval
**Authored:** 2026-05-23
**Author:** Lead Architect (Claude, acting on operator authorization)
**Operator:** Reid Whitesides
**Scope:** Multi-user role hierarchy with global role assignment, per-action permission scoping, multi-attribute audit attribution, and A-44 phase relocation. Single source of truth for all subsequent governance updates in the synchronization pass.

**This document is the master design specification.** All subsequent governance file updates (BLUEPRINT.md, MASTER_BUILD_SPEC.md, SCHEMA_REGISTRY.md, AGENTS.md, BEHAVIORAL_CONTRACTS.md, STATE_OF_THE_BUILD.md) derive from this document. If this document is wrong, the rest of the synchronization will propagate the error. If this document is approved, the rest follows mechanically.

**Read this entire document before approving.**

---

## 1. PROBLEM STATEMENT

Tarritrix 1.0 is currently architected as a single-operator system. The codebase assumes one operator account per platform installation. The `clients.operator_id` column is a single UUID. Contract 67 (Resource Ownership Verification) enforces "operator owns client" via `WHERE operator_id = userId`. All auth flows route on `user_metadata.role` being either `operator` or `client`. There is no concept of teammates, delegates, virtual assistants, or role hierarchy.

This is incompatible with operator's stated business model: multiple people (master admin, senior admin, virtual assistants) working on a single client in the same day, with differentiated permission scopes and full audit attribution.

This specification introduces a three-role taxonomy with global role assignment, per-role permission scopes for every protected action in the system, multi-attribute audit attribution capturing acting user, role at time of action, and client context, and a phase relocation of A-44 Client Knowledge Ingestion Engine from Phase 1.5 to Phase 1 as a prerequisite for A-02 Page Generator.

The architecture is designed for backward compatibility with the existing E4 Construction & Roofing seeded client. The existing operator account `operator@tarritrix.test` (auth UUID `aaaaaaaa-0000-0000-0000-000000000001`) is auto-promoted to `master_admin` during migration. No data loss. No breaking changes to existing API contracts beyond the additive role check layer.

---

## 2. ROLE TAXONOMY

Three roles. Final. No additional roles will be added in Phase 1.

### 2.1 `master_admin`

**Definition:** Platform owner. Top of the hierarchy. Can perform every action the system permits, subject only to permanent constitutional constraints (Contracts 6, 9 hard gates, 18, 45).

**Typical population:** One user. Operator (Reid). The schema permits more than one master_admin user to exist concurrently, in case operator brings on a co-founder or technical partner. No singleton enforcement.

**Authorization for grant:** Master_admin status is granted only by another master_admin. The first master_admin is established by the migration that auto-promotes the existing operator account. After that, all role grants flow through master_admin authority.

**Constitutional constraints master_admin cannot override:**

- Contract 6 (TCPA Immutability): DB-trigger-enforced. Master_admin has no application-layer bypass. Database physically rejects mutation attempts.
- Contract 9 hard gates (V9 schema validation, V10 TCPA gate, V13 similarity gate): Permanently non-overridable per Contract 9 declaration. Master_admin cannot force-publish a page failing these gates.
- Contract 18 (Evidence Authenticity HARD): Expired credentials must not display. No master_admin override path.
- Contract 45 (Review Authenticity HARD): Review content must not be synthesized. No master_admin override path.

All other operations within the system are master_admin-permitted with justification logging.

### 2.2 `senior_admin`

**Definition:** Trusted operational manager. Can execute substantive work on any client. Can drive page generation, approve flagged pages, manage client profiles, and dismiss most signals. Cannot make decisions that affect billing, role assignments, or permanent destructive actions.

**Typical population:** Zero or more users. Operator decides hiring. Population is small (1-10) because senior_admin has near-master authority.

**Authorization for grant:** Granted only by master_admin.

### 2.3 `va`

**Definition:** Virtual assistant. Can execute high-volume, low-risk operational tasks. Designed for delegated work that should not require master attention. Cannot trigger expensive operations, override quality gates, or modify financial/billing state.

**Typical population:** Several users. Operator can scale VA workforce as client load grows.

**Authorization for grant:** Granted by master_admin or senior_admin. (Senior_admin is permitted to grant VA role to streamline hiring of new VAs without requiring master attention for every new contractor.)

### 2.4 Role grant authority matrix

| Role being granted | Required granter |
|---|---|
| master_admin | master_admin only |
| senior_admin | master_admin only |
| va | master_admin OR senior_admin |

Role revocations follow the same authority — only a master_admin can revoke another master_admin or a senior_admin. A senior_admin can revoke a VA they granted.

---

## 3. PERMISSION MATRIX (CANONICAL)

This is the durable definition of which role can perform which action. Every protected action in the system MUST appear in this matrix or it is an unspecified action and must be added before code references it.

Legend: ✅ = permitted, ❌ = denied, 🔒 = denied with override path documented in Section 3.5.

### 3.1 Client management actions

| Action | master_admin | senior_admin | va |
|---|---|---|---|
| View any client's data (read) | ✅ | ✅ | ✅ |
| Create new client (start onboarding wizard) | ✅ | ✅ | ❌ |
| Complete onboarding (transition client to active) | ✅ | ✅ | ❌ |
| Update client business profile (address, phone, services, cities) | ✅ | ✅ | ❌ |
| Change client tier (Starter/Growth/Authority/Dominance) | ✅ | ❌ | ❌ |
| Suspend client (status → suspended) | ✅ | ✅ | ❌ |
| Soft-delete client (status → churned) | ✅ | ❌ | ❌ |
| Reassign client owner (`operator_id` update) | ✅ | ❌ | ❌ |

### 3.2 Page lifecycle actions

| Action | master_admin | senior_admin | va |
|---|---|---|---|
| View any page (read) | ✅ | ✅ | ✅ |
| Trigger A-02 page generation | ✅ | ✅ | ❌ |
| Approve flagged page (override soft gate failure) | ✅ | ✅ | ❌ |
| Reject flagged page and request regeneration | ✅ | ✅ | ❌ |
| Force-publish page (override soft gates) | ✅ | ✅ | ❌ |
| Override hard gate (Contract 9 V9/V10/V13) | ❌ | ❌ | ❌ |
| Soft-delete page (status → deleted) | ✅ | ✅ | ❌ |
| Hard-delete page (DB row removal) | ✅ | ❌ | ❌ |
| Add comment/note to flagged page (no decision) | ✅ | ✅ | ✅ |

### 3.3 Agent / automation actions

| Action | master_admin | senior_admin | va |
|---|---|---|---|
| Trigger A-01 Intake Processor | ✅ | ✅ | ❌ |
| Trigger A-02 Page Generator (LLM cost) | ✅ | ✅ | ❌ |
| Trigger A-07 Sitemap Generator (deterministic, $0) | ✅ | ✅ | ✅ |
| Trigger A-08 Indexation Tracker (read-only, $0) | ✅ | ✅ | ✅ |
| Trigger A-44 Client Knowledge Ingestion (re-scrape) | ✅ | ✅ | ❌ |
| Trigger A-45 Backlink Intelligence (read-only) | ✅ | ✅ | ✅ |
| Trigger A-46 Directory Registration | ✅ | ✅ | ✅ |
| Manually publish from queue (bypass drip) | ✅ | ✅ | ❌ |
| Pause all agent execution for a tenant | ✅ | ✅ | ❌ |

### 3.4 Cost / billing actions

| Action | master_admin | senior_admin | va |
|---|---|---|---|
| View per-client LLM cost data | ✅ | ✅ | ✅ |
| View platform-wide LLM cost data | ✅ | ✅ | ✅ |
| Increase per-client LLM daily cost cap | ✅ | ❌ | ❌ |
| Increase platform-wide LLM daily cost cap | ✅ | ❌ | ❌ |
| View Stripe billing data | ✅ | ✅ | ❌ |
| Trigger Stripe invoice generation | ✅ | ❌ | ❌ |
| Process refund | ✅ | ❌ | ❌ |
| Change pricing tier | ✅ | ❌ | ❌ |

### 3.5 Signal / alert actions

| Action | master_admin | senior_admin | va |
|---|---|---|---|
| View advisory signals | ✅ | ✅ | ✅ |
| Dismiss P3 (informational) signal | ✅ | ✅ | ✅ |
| Dismiss P2 (action soon) signal | ✅ | ✅ | ❌ |
| Dismiss P1 (immediate attention) signal | ✅ | ✅ | ❌ |
| Dismiss P0 (blocking) signal | ✅ | 🔒 | ❌ |
| Acknowledge DSAR request | ✅ | ✅ | ✅ |
| Mark DSAR request complete | ✅ | ✅ | ❌ |
| Resolve A-42 penalty pattern freeze | ✅ | ❌ | ❌ |

**3.5.1 P0 dismissal override path:** Senior_admin may dismiss P0 signals only when the underlying condition has been verifiably resolved (e.g., cross-tenant leak repaired by migration). Justification must reference the resolution commit hash or migration ID. P0 dismissals by senior_admin are flagged for master_admin review within 24 hours via tenant_signals.

### 3.6 Evidence / asset actions

| Action | master_admin | senior_admin | va |
|---|---|---|---|
| Upload job evidence photos | ✅ | ✅ | ✅ |
| Tag / categorize evidence | ✅ | ✅ | ✅ |
| Delete evidence photo | ✅ | ✅ | ❌ |
| Approve A-44 re-scrape diff (new logo, new claims) | ✅ | ✅ | ❌ |
| Reject A-44 re-scrape diff | ✅ | ✅ | ❌ |
| Upload manual evidence override (admin import) | ✅ | ✅ | ❌ |

### 3.7 Directory & backlink actions

These are the additional VA capabilities operator specified.

| Action | master_admin | senior_admin | va |
|---|---|---|---|
| Submit client to directory listing (A-46) | ✅ | ✅ | ✅ |
| Track directory submission status | ✅ | ✅ | ✅ |
| View backlink inventory (A-45 read-only) | ✅ | ✅ | ✅ |
| Generate backlink outreach template draft | ✅ | ✅ | ✅ |
| Request disavow recommendation (advisory, client submits manually) | ✅ | ✅ | ✅ |
| Initiate any black-hat backlink operation | ❌ | ❌ | ❌ |

Contract 60 (Backlink Operations Strict Whitelist) is permanent. No role can execute black-hat operations.

### 3.8 Role / user management actions

| Action | master_admin | senior_admin | va |
|---|---|---|---|
| Grant master_admin role | ✅ | ❌ | ❌ |
| Grant senior_admin role | ✅ | ❌ | ❌ |
| Grant va role | ✅ | ✅ | ❌ |
| Revoke master_admin role (from another user) | ✅ | ❌ | ❌ |
| Revoke senior_admin role | ✅ | ❌ | ❌ |
| Revoke va role | ✅ | ✅* | ❌ |
| View own role assignment | ✅ | ✅ | ✅ |
| View all role assignments (audit) | ✅ | ✅ | ❌ |

*Senior_admin may revoke only VAs they originally granted, or VAs granted by a master_admin who has authorized senior to manage that VA via `user_roles.granted_by`.

### 3.9 Audit / compliance actions

| Action | master_admin | senior_admin | va |
|---|---|---|---|
| View audit log (operator_actions and successor) | ✅ | ✅ | ❌ |
| Export audit log for compliance | ✅ | ✅ | ❌ |
| View security_events | ✅ | ❌ | ❌ |
| View session_logs (all users) | ✅ | ❌ | ❌ |
| View own session_logs | ✅ | ✅ | ✅ |

---

## 4. SCHEMA ADDITIONS

### 4.1 New table: `user_roles`

Stores the role assignment for every authenticated user in the platform. One row per user. Role is global (not per-client).

```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('master_admin', 'senior_admin', 'va', 'client')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_roles_one_active_per_user UNIQUE (user_id) WHERE revoked_at IS NULL
);

CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role) WHERE revoked_at IS NULL;
```

**Design notes:**

- Soft-delete via `revoked_at` rather than DELETE. Audit trail must preserve role history. Reconstruction of "who held what role on what date" must be possible for any past timestamp.
- Partial unique index `user_roles_one_active_per_user` ensures a user has exactly one active role at any time. To change a role, the existing row is marked revoked and a new row inserted.
- The role `'client'` is included in the CHECK constraint so this table serves as the single source of truth for ALL user roles, not just operator-side roles. Existing client portal users (e.g., `client@e4construction.test`) get `role='client'` rows.

### 4.2 New table: `user_actions`

Replaces `operator_actions` with role-aware audit attribution. Operator_actions is preserved for historical data but deprecated for new writes — every new audit-logged action goes to user_actions.

```sql
CREATE TABLE user_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  acting_user_id UUID NOT NULL REFERENCES auth.users(id),
  acting_user_role TEXT NOT NULL CHECK (acting_user_role IN ('master_admin', 'senior_admin', 'va')),
  client_id UUID REFERENCES clients(id),
  action_type TEXT NOT NULL,
  action_target_type TEXT,
  action_target_id UUID,
  justification TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  result TEXT NOT NULL CHECK (result IN ('success', 'denied_permission', 'denied_constraint', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_actions_acting_user ON user_actions(acting_user_id);
CREATE INDEX idx_user_actions_client_id ON user_actions(client_id);
CREATE INDEX idx_user_actions_action_type ON user_actions(action_type);
CREATE INDEX idx_user_actions_created_at ON user_actions(created_at DESC);
CREATE INDEX idx_user_actions_role_at_time ON user_actions(acting_user_role);
```

**Design notes:**

- `acting_user_role` captures the role AT THE TIME OF ACTION, not the user's current role. This is critical because user roles change over time. A DSAR audit might need to show "Jane Doe, acting as senior_admin on 2026-05-23, approved page X" even if Jane was demoted to VA in 2026-08.
- `result` enum captures permission denial outcomes. When a VA attempts an action they lack permission for, the attempt is logged with `result='denied_permission'`. This produces an audit trail of attempted privilege escalations.
- `justification` is required for any override action (force-publish, P0 dismissal, cap increase, role grant). Enforced at API layer via `requireJustification: true` on the action handler.

### 4.3 New table: `role_grant_audit`

Dedicated table for role grant and revocation events. Subset of user_actions but separately indexed for compliance queries ("who granted master_admin to whom, when").

```sql
CREATE TABLE role_grant_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL CHECK (event_type IN ('granted', 'revoked')),
  target_user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL,
  granted_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  granted_by_role TEXT NOT NULL,
  justification TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_role_grant_audit_target ON role_grant_audit(target_user_id);
CREATE INDEX idx_role_grant_audit_granter ON role_grant_audit(granted_by_user_id);
```

### 4.4 New table: `client_ingestion_versions`

Supports A-44 versioning for the quarterly refresh model. Tracks every successful scrape as a versioned snapshot.

```sql
CREATE TABLE client_ingestion_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  scrape_started_at TIMESTAMPTZ NOT NULL,
  scrape_completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'success', 'failed', 'partial')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('onboarding', 'manual', 'quarterly_cron', 'signal_detected')),
  triggered_by_user_id UUID REFERENCES auth.users(id),
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status TEXT CHECK (approval_status IN ('auto_approved', 'pending_approval', 'approved', 'rejected')),
  approved_by_user_id UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  approval_role TEXT,
  diff_summary JSONB,
  diff_severity TEXT CHECK (diff_severity IN ('none', 'minor', 'material', 'breaking')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, version_number)
);

CREATE INDEX idx_client_ingestion_versions_client ON client_ingestion_versions(client_id);
CREATE INDEX idx_client_ingestion_versions_current ON client_ingestion_versions(client_id) WHERE is_current = TRUE;
CREATE INDEX idx_client_ingestion_versions_pending ON client_ingestion_versions(client_id) WHERE approval_status = 'pending_approval';
```

**Design notes:**

- `is_current` boolean identifies the version A-02 reads when generating new pages. Only one row per client may have `is_current = TRUE`. Enforced via partial unique index.
- `approval_status` flow:
  - `auto_approved`: First-ever scrape at onboarding. No prior version to diff against. Automatically becomes current.
  - `pending_approval`: Subsequent scrape with `diff_severity IN ('material', 'breaking')`. Requires master_admin or senior_admin to review and approve before becoming current. A-02 continues using the previous current version.
  - `approved`: Operator reviewed and accepted. Becomes current; previous version marked `is_current = FALSE`.
  - `rejected`: Operator reviewed and rejected. Version stays as historical record but never becomes current.
- `diff_severity` heuristic (computed by A-44):
  - `none`: No detectable changes from prior version.
  - `minor`: Text-only changes to non-critical sections (about page rewording).
  - `material`: Logo changed, primary phone changed, NAP data changed, certifications added/removed, new manufacturer badges, or service descriptions substantially rewritten.
  - `breaking`: Domain change, complete brand voice shift, removal of previously claimed certifications.
- For `diff_severity = none` or `diff_severity = minor`: auto-approved, becomes current immediately.
- For `diff_severity = material` or `diff_severity = breaking`: requires manual approval.

### 4.5 Column additions to existing tables

#### 4.5.1 `clients` table additions

```sql
ALTER TABLE clients
  ADD COLUMN current_ingestion_version_id UUID REFERENCES client_ingestion_versions(id),
  ADD COLUMN last_ingestion_at TIMESTAMPTZ,
  ADD COLUMN next_ingestion_scheduled_at TIMESTAMPTZ,
  ADD COLUMN ingestion_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN ingestion_block_reason TEXT;
```

- `current_ingestion_version_id`: Foreign key to the row in `client_ingestion_versions` where `is_current = TRUE`. Denormalized for fast A-02 lookup.
- `last_ingestion_at`: Timestamp of last successful scrape completion.
- `next_ingestion_scheduled_at`: When the quarterly CRON should next attempt this client. Jittered ±7 days at insert.
- `ingestion_blocked`: True if A-44 should not run for this client (e.g., client opted out, robots.txt blocks crawl, repeated failures). Master_admin only can unblock.
- `ingestion_block_reason`: Human-readable explanation.

#### 4.5.2 Audit attribution columns on existing override-capable tables

Tables where existing operator override actions occur need a role-at-time-of-action column added so legacy data does not lose attribution context. The existing `operator_id` column is preserved (it identifies the acting user). The new column records the role.

```sql
ALTER TABLE operator_actions
  ADD COLUMN role_at_time_of_action TEXT CHECK (role_at_time_of_action IN ('master_admin', 'senior_admin', 'va', 'operator_legacy'));

-- Backfill existing rows with 'operator_legacy' to indicate pre-RBAC era
UPDATE operator_actions
SET role_at_time_of_action = 'operator_legacy'
WHERE role_at_time_of_action IS NULL;

ALTER TABLE operator_actions
  ALTER COLUMN role_at_time_of_action SET NOT NULL;
```

The `'operator_legacy'` value is reserved for backfilled rows from before the RBAC migration. After the RBAC migration ships, all new `operator_actions` writes (which will be deprecated in favor of `user_actions`) must use one of the three real roles.

#### 4.5.3 Assignee tracking on flagged pages

Even though the master spec preserves single-owner client semantics (Issue 3 Option A), individual flagged page reviews can be claimed by a senior_admin or VA for triage. This is workflow assignment, not ownership reassignment.

```sql
ALTER TABLE pages
  ADD COLUMN assigned_reviewer_id UUID REFERENCES auth.users(id),
  ADD COLUMN assigned_reviewer_at TIMESTAMPTZ,
  ADD COLUMN assigned_reviewer_role TEXT;
```

When a senior_admin or VA opens a flagged page from the queue, the page is soft-locked to them for 30 minutes (lease pattern) so two reviewers don't double-action the same flagged page. The lease auto-expires; the assignee can manually release; or a master_admin can force-reassign.

### 4.6 Migration sequence

Migrations applied in this order in a single deployment window:

1. **Migration N+1: `create_user_roles_table.sql`** — Creates user_roles, role_grant_audit. Indexes. RLS policies (see Section 6).
2. **Migration N+2: `seed_user_roles_from_auth_users.sql`** — Reads existing `auth.users.user_metadata.role` for every user. Inserts user_roles rows mapping:
   - `user_metadata.role = 'operator'` → user_roles row with `role='master_admin'`, `granted_by=<system>`, `granted_at=<migration timestamp>`. This auto-promotes the existing operator account to master_admin per Issue 1 confirmation.
   - `user_metadata.role = 'client'` → user_roles row with `role='client'`.
3. **Migration N+3: `create_user_actions_table.sql`** — Creates user_actions with all indexes and RLS.
4. **Migration N+4: `create_client_ingestion_versions_table.sql`** — Creates client_ingestion_versions with indexes and RLS.
5. **Migration N+5: `alter_clients_add_ingestion_columns.sql`** — Adds ingestion tracking columns to clients.
6. **Migration N+6: `alter_operator_actions_add_role.sql`** — Adds role_at_time_of_action with backfill to `operator_legacy`.
7. **Migration N+7: `alter_pages_add_reviewer_assignment.sql`** — Adds assigned_reviewer_id and related columns.
8. **Migration N+8: `seed_a44_baseline_for_existing_clients.sql`** — For existing seeded clients (E4 Construction, Tarritrix, Architectural Flashing Supply if seeded), creates synthetic `client_ingestion_versions` rows with `trigger_type='onboarding'`, `approval_status='auto_approved'`, `is_current=TRUE`, and empty `client_ingested_assets` payloads. This satisfies Contract 73 (Pre-Generation Knowledge Ingestion Requirement) backward compatibility without forcing a real scrape of clients who were onboarded before A-44 existed. A flag in clients table (`ingestion_synthetic_baseline = TRUE`) marks these clients as needing a real A-44 scrape during their next operator-touched interaction.

Migration timestamps will be claimed contiguously in the `supabase/migrations/` filename namespace at implementation time. Exact timestamp slot is reserved at the moment of migration generation per SCHEMA_REGISTRY.md naming convention.

### 4.7 Updated table count

After this migration set:
- Tables added: 3 (user_roles, user_actions, role_grant_audit, client_ingestion_versions) — *correction: 4 tables added*
- Columns added to existing tables: 9 (5 on clients, 1 on operator_actions, 3 on pages)
- Total system tables after migration: 87 (current 83 + 4 new)

---

## 5. AUTHENTICATION & AUTHORIZATION FLOW CHANGES

### 5.1 Login flow

Current flow (per MASTER_BUILD_SPEC.md Section 6):

1. User submits email + password to Supabase Auth.
2. On success, query `clients` table:
   - If `client_user_id = auth.uid()` → redirect to `/portal`
   - Else if `operator_id = auth.uid()` → redirect to `/dashboard`
   - Else → error.

Updated flow:

1. User submits email + password to Supabase Auth.
2. On success, query `user_roles` table where `user_id = auth.uid()` AND `revoked_at IS NULL`.
3. Branch on role:
   - `role = 'client'` → query `clients.client_user_id` → redirect to `/portal`.
   - `role IN ('master_admin', 'senior_admin', 'va')` → redirect to `/dashboard`.
   - No active role row → error: "Account inactive. Contact platform owner."

### 5.2 Middleware

Per Contract 8, middleware.ts is auth passthrough only. No role logic in middleware. The middleware continues to set `x-user-id` header after validating the Bearer token. Role check happens at the route handler layer, not middleware.

This preserves Contract 8 (Middleware Auth Passthrough Only) — no patches required.

### 5.3 Route handler pattern

Every protected operator-side route MUST perform a three-step authorization check:

```typescript
// Step 1: Auth verification (already exists via Contract 70)
const { userId, supabase } = await getOperatorContext(request);

// Step 2: Role lookup (NEW — Contract 71)
const userRole = await getUserActiveRole(supabase, userId);
if (!userRole) {
  return NextResponse.json({ error: 'No active role' }, { status: 403 });
}

// Step 3: Permission check against canonical matrix (NEW — Contract 71)
const action = 'approve_flagged_page'; // action identifier
if (!hasPermission(userRole, action)) {
  await logDeniedAction(supabase, userId, userRole, action, clientId);
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// Step 4: Resource ownership (per amended Contract 67)
// For multi-user-per-client, ownership = "user has any active role that includes
// access to this client". master_admin and senior_admin have global client access.
// VAs have global client access (read + permitted write actions).
// Client role users see only their own client_user_id-linked client.

// Step 5: Action execution + audit log to user_actions
const result = await executeAction(...);
await logUserAction(supabase, {
  acting_user_id: userId,
  acting_user_role: userRole,
  client_id: clientId,
  action_type: action,
  result: result.success ? 'success' : 'failed',
  justification: request.justification,
  metadata: { ... }
});
```

This pattern is encoded in a new helper `src/lib/auth/role-context.ts` exporting `getUserActiveRole()`, `hasPermission()`, `logUserAction()`, and `logDeniedAction()`. Contract 71 enforces use of this helper across all operator-side routes (analogous to how Contract 70 enforces `getOperatorContext()`).

### 5.4 Permission matrix as code

The canonical permission matrix from Section 3 is encoded as a TypeScript constant in `src/lib/auth/permission-matrix.ts`:

```typescript
export const PERMISSION_MATRIX: Record<ActionType, RolePermission> = {
  view_client_read: { master_admin: true, senior_admin: true, va: true },
  create_client: { master_admin: true, senior_admin: true, va: false },
  trigger_a02_page_generation: { master_admin: true, senior_admin: true, va: false },
  approve_flagged_page: { master_admin: true, senior_admin: true, va: false },
  override_hard_gate: { master_admin: false, senior_admin: false, va: false }, // Constitutional
  grant_master_admin_role: { master_admin: true, senior_admin: false, va: false },
  // ... full matrix
};
```

The TypeScript constant is the runtime check source. The matrix in Section 3 of this document is the human-readable authoritative source. Whenever the matrix changes, both must update in the same commit (Contract 52 atomicity).

A verification script `scripts/verify-permission-matrix-sync.ts` checks that every action in the TypeScript matrix has a corresponding row in this document, and vice versa. Runs in `pnpm verify:ci`. Blocks builds on drift.

---

## 6. ROW-LEVEL SECURITY (RLS) POLICIES

### 6.1 Strategy

The existing RLS pattern (`client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid())`) is single-operator-aware. Under multi-user, we need RLS that grants access to any user with an active operator-side role.

New RLS helper function:

```sql
CREATE OR REPLACE FUNCTION user_has_operator_role(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = uid
      AND role IN ('master_admin', 'senior_admin', 'va')
      AND revoked_at IS NULL
  )
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
```

Used in RLS policies:

```sql
-- Updated RLS policy on clients table
CREATE POLICY "operator_side_users_can_read_all_clients" ON clients
  FOR SELECT
  USING (user_has_operator_role(auth.uid()));

-- Client portal users still see only their own client
CREATE POLICY "client_self_select" ON clients
  FOR SELECT
  USING (client_user_id = auth.uid());
```

### 6.2 Write policies

Read access is broad for operator-side roles (master_admin, senior_admin, va all can read). Write access is narrower and gated at the application layer via the permission matrix, not RLS. This is intentional: application-layer permission checks produce auditable rejection events; RLS rejection is silent and doesn't capture justification context for compliance.

The database remains the second line of defense. RLS policies on WRITE operations check for operator-side role (any of three) — finer-grained per-action enforcement happens in the route handler.

### 6.3 user_roles table RLS

```sql
-- Anyone with operator-side role can read role assignments (audit visibility)
CREATE POLICY "operator_side_users_can_read_user_roles" ON user_roles
  FOR SELECT
  USING (user_has_operator_role(auth.uid()));

-- Users can always read their own role
CREATE POLICY "users_can_read_own_role" ON user_roles
  FOR SELECT
  USING (user_id = auth.uid());

-- Only master_admin can write to user_roles (insert, update, delete)
CREATE POLICY "only_master_admin_can_modify_roles" ON user_roles
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'master_admin'
        AND ur.revoked_at IS NULL
    )
  );
```

Note: the senior_admin VA-grant capability is enforced at the application layer (the route handler checks for `granted_by` and validates senior_admin can grant VA per Section 2.4 matrix). RLS at the database level grants master_admin-only write. The application enforces the senior_admin escalation path by inserting role grants via a server action that runs with elevated privileges after validating senior_admin authority.

### 6.4 user_actions table RLS

```sql
CREATE POLICY "operator_side_users_can_read_audit_log" ON user_actions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('master_admin', 'senior_admin')
        AND ur.revoked_at IS NULL
    )
  );

CREATE POLICY "users_can_read_own_actions" ON user_actions
  FOR SELECT
  USING (acting_user_id = auth.uid());

-- Inserts only via service role / route handler (no direct user inserts)
-- No UPDATE policy — audit rows are immutable
-- No DELETE policy — audit rows are permanent
```

---

## 7. A-44 PHASE RELOCATION

### 7.1 Phase change

A-44 Client Knowledge Ingestion Engine moves from Phase 1.5 to Phase 1.

**Rationale:** Operator decision 2026-05-23. Page generation cannot proceed for a new client without first ingesting their existing brand voice, logo, contact information, manufacturer badges, and trust signals. Generating pages without ingested context produces generic AI-flavored output that lacks brand consistency and trust signals — the exact failure mode Contract 61 (AEO/Voice/Conversion Discipline) is designed to prevent.

**Sequence impact:** Phase 1 agent build order updates from:

`B1 → B2 → B3 → A-01 → A-18 → A-02 → A-03 → A-04 → A-05 → ...`

to:

`B1 → B2 → B3 → A-01 → A-44 → A-18 → A-02 → A-03 → A-04 → A-05 → ...`

A-44 inserts immediately after A-01 (intake completes, client record exists) and before A-02 (which now depends on A-44 output).

### 7.2 Refresh model (the answer to operator's question)

A-44 implements three refresh triggers:

**Trigger 1 — Onboarding (mandatory, blocking):**

- Fires automatically as the final step of the 8-step onboarding wizard.
- Master_admin or senior_admin who completes onboarding kicks off A-44.
- A-02 cannot run for this client until A-44 produces a `client_ingestion_versions` row with `status='success'` and `is_current=TRUE`.
- Contract 73 enforces this.

**Trigger 2 — Quarterly CRON (automatic):**

- New CRON job: `CRON-03 a44-quarterly-refresh`. Schedule: daily, evaluates `clients.next_ingestion_scheduled_at <= NOW()`.
- For each due client, queues an A-44 re-scrape via stack_jobs.
- After successful scrape, computes diff against current version. If diff severity is `none` or `minor`, auto-approves and rolls over. If `material` or `breaking`, queues for operator approval and surfaces P1 advisory signal.
- After scrape completion (success or failure), `next_ingestion_scheduled_at` is set to `NOW() + INTERVAL '90 days' + INTERVAL '<random ±7 days>'` to jitter the population. Prevents quarterly-refresh thundering herd.

**Trigger 3 — Manual (master_admin or senior_admin):**

- Dashboard button: "Force re-scrape client website." Available on `/dashboard/clients/[id]` page in a new "Knowledge Base" tab.
- Justification field required ("Client relaunched site," "New certifications mentioned," etc.).
- Triggers A-44 immediately, bypassing the quarterly schedule. After completion, `next_ingestion_scheduled_at` is reset to NOW() + 90 days from the manual scrape completion.
- VA cannot trigger this.

**Trigger 4 — Signal-driven (deferred to Phase 1.5):**

- Future addition: when A-08 Indexation Tracker detects substantial sitemap changes on client's domain (sitemap last_modified delta >20%, or canonical URL shifts), auto-queue A-44 re-scrape.
- This requires sitemap-change detection logic in A-08 that doesn't currently exist. Out of scope for Phase 1 to keep A-44 ship date compressed.
- Spec'd here so operator awareness exists. Build in Phase 1.5.

### 7.3 Storage and versioning

- All scrape outputs persist in `client_ingested_assets`, `client_brand_voice_model`, `client_keyword_gap_analysis` (existing A-44 tables, unchanged).
- Each scrape creates a new row in `client_ingestion_versions` (Section 4.4) tracking the version metadata.
- A-02 always reads from the `current_ingestion_version_id` referenced from `clients`. Historical pages do not retroactively change when a new version becomes current — they continue rendering with the assets that were current at their publish time (handled via versioning columns to be added to `evidence_items` and asset reference tables in a follow-on migration).

### 7.4 Diff detection algorithm

A-44 post-scrape diff computation (deterministic, no LLM):

1. Hash the new scrape's primary fields (logo URL, brand_name, NAP data, license numbers, list of certifications, list of manufacturer badges).
2. Compare to the current version's hashes.
3. Classify:
   - All hashes identical → `diff_severity = 'none'`.
   - Only "non-critical" fields changed (about page text, testimonial wording) → `diff_severity = 'minor'`.
   - Critical fields changed (logo, NAP, license, certifications, manufacturer badges added/removed) → `diff_severity = 'material'`.
   - Domain itself changed or all critical fields differ → `diff_severity = 'breaking'`.
4. Write the diff_summary JSONB with field-by-field deltas for operator review UI.

### 7.5 Failure handling

If A-44 scrape fails (site down, robots.txt blocks, parse error):

- `client_ingestion_versions` row created with `status='failed'`, `failure_reason='<details>'`.
- Existing current version remains current. A-02 continues with stale data.
- P2 advisory signal raised: "Quarterly knowledge ingestion failed for [client name]. Retry scheduled."
- Exponential backoff retry: +1 day, +3 days, +7 days. After 7 days of failures, escalate to P1 signal.
- Master_admin can manually block A-44 for a client via `clients.ingestion_blocked = TRUE` with reason (e.g., "Client requested no automated crawls").

### 7.6 Backward compatibility for existing clients

Existing seeded clients (E4 Construction, and any others present before A-44 ships) have no `client_ingestion_versions` rows and no A-44 ingestion data. Per Section 4.6 Migration N+8, a synthetic baseline row is created for each existing client:

- `trigger_type = 'onboarding'`
- `approval_status = 'auto_approved'`
- `is_current = TRUE`
- Empty asset payloads
- `clients.ingestion_synthetic_baseline = TRUE` flag set

This satisfies Contract 73 (Pre-Generation Knowledge Ingestion Requirement) at the database constraint level, allowing A-02 to continue running for existing clients. The first time a master_admin or senior_admin opens the existing client's dashboard after A-44 ships, a P2 advisory signal recommends triggering a real A-44 scrape ("This client was onboarded before knowledge ingestion was available. Run scrape for accurate brand voice in future page generation.").

### 7.7 Override for A-44 prerequisite

Edge case: client's website is genuinely unscrapable (down at onboarding, robots.txt blocks all crawlers, no public site exists). Operator wants to proceed with manual content provision and skip A-44.

**Override path (master_admin only, Contract 73 single override):**

Master_admin can mark a client's `client_ingestion_versions` row as `approval_status='manually_provided'` with required justification field, manually upload assets via dashboard form, and set `is_current=TRUE` on that row. This satisfies Contract 73 by treating the manual upload as a valid version. The override is logged in `user_actions` with `action_type='override_a44_prerequisite'` and surfaced in the audit log.

This is the only override path for Contract 73.

---

## 8. NEW BEHAVIORAL CONTRACTS

### 8.1 Contract 71 — Role-Based Access Control (RBAC) Enforcement

**Status:** Will be ACTIVE upon governance commit.

**Scope:** All operator-side API routes under `/api/operator/*` and `/api/admin/*`. All dashboard server actions. All agent triggers.

**Rule:** Every protected action MUST perform an explicit role-and-permission check via the `hasPermission(role, action)` helper from `src/lib/auth/role-context.ts` BEFORE executing the action. Direct role checks (e.g., `if (user.role === 'master_admin')`) inline in route handlers are forbidden — the canonical permission matrix is the only source of truth.

**Required pattern:** See Section 5.3 of this document.

**Enforcement:**

- **Layer 1 (Pre-commit hook):** Script `scripts/verify-rbac-pattern.ts` greps for `user.role ===` or `getRole(` calls in operator route handlers. Any direct role check that bypasses `hasPermission()` blocks the commit.
- **Layer 2 (CI verification):** Same script runs in `pnpm verify:ci`. Blocks builds.
- **Layer 3 (Runtime audit):** Every denied action is logged to `user_actions` with `result='denied_permission'`. A daily report compares the denied-action rate per role to a baseline; spikes trigger a P1 signal indicating potential privilege escalation attempts.

**Override:** No override permitted.

### 8.2 Contract 72 — Multi-User Audit Attribution

**Status:** Will be ACTIVE upon governance commit.

**Scope:** All audit-logged actions across the platform. Includes user_actions, operator_actions (legacy table), role_grant_audit, page_decisions, and any future audit tables.

**Rule:** Every audit log row MUST capture three attribution attributes:

1. **Acting user ID** (`acting_user_id` or equivalent column) — the authenticated user who initiated the action.
2. **Role at time of action** (`acting_user_role` or equivalent column) — the active role of that user at the moment the action was executed, captured by querying user_roles at action time, not relying on cached client state.
3. **Client context** (`client_id`) — the tenant the action was for, NULL only if the action is platform-level (e.g., role grant).

**Required pattern:**

```typescript
// At action handler entry:
const userId = headers.get('x-user-id');
const role = await getUserActiveRole(supabase, userId); // Fresh query, not cached

// At action handler exit (success or failure):
await supabase.from('user_actions').insert({
  acting_user_id: userId,
  acting_user_role: role, // The role at action time, not request-cached
  client_id: clientId,
  action_type: 'approve_flagged_page',
  action_target_type: 'page',
  action_target_id: pageId,
  justification: requestBody.justification,
  result: result.success ? 'success' : 'failed',
  metadata: { ... }
});
```

**Enforcement:**

- **Layer 1 (Pre-commit):** Script `scripts/verify-audit-attribution.ts` greps for `user_actions` inserts and verifies all three columns are populated. Inserts missing any of the three attribution columns block commits.
- **Layer 2 (CI):** Same script in `verify:ci`.
- **Layer 3 (DB constraint):** Table CHECK constraints ensure NOT NULL on `acting_user_id`, `acting_user_role`. `client_id` is NULLABLE only because role grants are platform-level.

**Override:** No override permitted. Missing attribution = compliance audit failure.

### 8.3 Contract 73 — Pre-Generation Knowledge Ingestion Requirement

**Status:** Will be ACTIVE upon governance commit.

**Scope:** A-02 Page Generator and any agent that generates new client-facing page content.

**Rule:** A-02 MUST NOT execute for a client unless that client has a row in `client_ingestion_versions` where `is_current = TRUE` AND `status = 'success'` (or `'manually_provided'` per the Section 7.7 override).

**Required pattern:** A-02 entry point performs this check first:

```typescript
const ingestionStatus = await supabase
  .from('client_ingestion_versions')
  .select('id, status, approval_status')
  .eq('client_id', clientId)
  .eq('is_current', true)
  .maybeSingle();

if (!ingestionStatus.data ||
    !['success', 'manually_provided'].includes(ingestionStatus.data.status) ||
    !['auto_approved', 'approved', 'manually_provided'].includes(ingestionStatus.data.approval_status)) {
  throw new ContractViolationError('A-02 blocked: Contract 73 requires successful A-44 ingestion');
}
```

**Override:** Master_admin only, via the manual-provision override path documented in Section 7.7. Justification mandatory. Logged.

**Failure mode this closes:** Pages generated without ingested brand voice and trust signals produce generic AI-flavored output. Without manufacturer badges, certifications, or correct NAP data ingested first, pages render with placeholder or hallucinated trust signals — a Contract 18 (Evidence Authenticity) violation and a brand-damaging outcome.

### 8.4 Contract 67 amendment

Contract 67 (Resource Ownership Verification) is AMENDED rather than replaced. New text:

**Original rule (preserved):** Operator API routes accepting resource identifiers (client_id, page_id) in URL parameters must verify the authenticated operator owns the resource before allowing access or modification.

**Amendment (added 2026-05-23):** Under multi-user RBAC (Contract 71), "ownership" is expanded to mean: the authenticated user holds an active role (master_admin, senior_admin, or va) that, per the permission matrix in ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3, permits the requested action against the specified client. The role-permission check supersedes the legacy `operator_id = userId` ownership check for routes governed by Contract 71.

**Migration note:** Existing routes refactored to use `hasPermission()` from Contract 71 automatically satisfy the amended Contract 67. The legacy `operator_id` ownership check is preserved for routes not yet refactored as a defense-in-depth measure, but the new pattern is canonical for all new code.

---

## 9. UI / DASHBOARD IMPLICATIONS

### 9.1 Role-aware UI rendering

Every dashboard component that exposes a protected action must render conditionally based on the current user's role. Pattern:

```tsx
import { useCurrentUserRole } from '@/lib/auth/use-current-user-role';
import { hasPermission } from '@/lib/auth/permission-matrix';

const { role } = useCurrentUserRole();
const canApprove = hasPermission(role, 'approve_flagged_page');

return (
  <div>
    {canApprove && <button onClick={handleApprove}>Approve</button>}
    {!canApprove && <button disabled title="Requires senior_admin">Approve (locked)</button>}
  </div>
);
```

VAs see the dashboard with disabled or hidden buttons for actions they can't perform. The justification for hiding vs. disabling:

- **Hide entirely:** Actions that are absent from the workflow concept for that role. Example: role management UI is not shown to senior_admin or VA at all.
- **Disable with tooltip:** Actions the user might expect to be able to perform but cannot. Example: VAs see the "Approve flagged page" button disabled with tooltip "Requires senior_admin role." This is more discoverable than hiding — VA understands the action exists, knows who to escalate to.

### 9.2 Role badge in header

The dashboard header displays the user's email and a role badge:

- master_admin: red badge "Master Admin"
- senior_admin: blue badge "Senior Admin"
- va: gray badge "VA"

This is a constant reminder of current authority level. Hovering reveals the action scope summary.

### 9.3 User management UI (master_admin only)

New page at `/dashboard/users` (master_admin-only access). Lists all platform users with their current role, last login, action count, denied-attempt count. Master_admin can:

- Grant new role to a user.
- Revoke an existing role.
- View full audit trail per user.

Master_admin sees this page in the sidebar. Senior_admin and VA do not see the sidebar link at all.

### 9.4 Flagged page queue assignment UI

New surface on `/dashboard/clients/[id]/flagged`:

- Each flagged page row shows the assigned_reviewer if any (name + role badge).
- "Claim" button next to each row. Clicking claims the page (sets assigned_reviewer = current user, lease 30 min).
- "Release" button if already assigned to current user.
- Master_admin sees "Force reassign" dropdown to override an existing assignment.
- VAs can claim flagged pages for visibility / preparation work but cannot perform approve/reject (still gated by permission matrix at the action level).

---

## 10. MIGRATION OF EXISTING DATA

### 10.1 Existing operator account

Per Issue 1 confirmation: existing `operator@tarritrix.test` (auth UUID `aaaaaaaa-0000-0000-0000-000000000001`) is automatically promoted to `master_admin` during migration. Specifically:

```sql
-- Within Migration N+2: seed_user_roles_from_auth_users.sql
INSERT INTO user_roles (user_id, role, granted_by, granted_at)
SELECT
  id AS user_id,
  CASE
    WHEN raw_user_meta_data->>'role' = 'operator' THEN 'master_admin'
    WHEN raw_user_meta_data->>'role' = 'client' THEN 'client'
    ELSE 'va' -- Conservative default; should not occur in current data
  END AS role,
  '00000000-0000-0000-0000-000000000001'::uuid AS granted_by, -- System
  NOW() AS granted_at
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM user_roles WHERE revoked_at IS NULL);
```

### 10.2 Existing E4 Construction client ownership

`clients.operator_id` for E4 currently points to the operator account UUID. This pointer is preserved unchanged. Per Issue 3 Option A, `operator_id` continues to mean "the ultimate accountable owner of this client" — which is now the master_admin who owns the platform.

No data migration needed on the clients table beyond the new ingestion-tracking columns.

### 10.3 Existing operator_actions rows

Per Section 4.5.2, all existing rows in `operator_actions` are backfilled with `role_at_time_of_action = 'operator_legacy'`. This value is reserved as a marker indicating pre-RBAC era data. The application treats `operator_legacy` rows as informational; they cannot be queried for role-specific compliance reporting (because the role was unitary at that time).

### 10.4 No existing A-44 data

A-44 has not yet been built. There is no existing A-44 data to migrate. The Migration N+8 step seeds synthetic baseline rows for existing clients (E4 and any others) so that A-02 continues to run for them per Section 7.6.

---

## 11. SYNCHRONIZATION TO OTHER GOVERNANCE FILES

This section enumerates every change that must propagate from this spec to the other governance files. Each downstream file update will be its own document delivery (Documents 2 through 8).

### 11.1 BLUEPRINT.md changes

- **Part 4 (Client Onboarding Workflow):** Add new Step 9: "A-44 Knowledge Ingestion (automatic post-onboarding-completion)" describing the mandatory scrape before A-02 unlock.
- **Part 8 (2026-05-05 additions):** New subsection 8.6.5 "Role Hierarchy and Multi-User Operations" with role taxonomy reference.
- **Section on A-44:** Update phase designation Phase 1.5 → Phase 1. Update trigger from "one-time at onboarding, quarterly refresh" → reference the three-trigger model in this spec.
- **New Part 10 "RBAC Architecture":** Cross-reference to this spec for full detail.

### 11.2 MASTER_BUILD_SPEC.md changes

- **Section 6 (Unified Login):** Update authentication flow per Section 5.1 of this spec.
- **Section 7 (Operator Command Center):** Update header description to include role badge per Section 9.2. Update sidebar to conditionally show "Users" link for master_admin per Section 9.3.
- **Section 8 (Client Management):** Update flagged pages queue spec to include reviewer assignment per Section 9.4.
- **New Section 7.X "Knowledge Base Tab":** Add description of the per-client A-44 management tab with "Force re-scrape" button.
- **Phase 1 Dashboard Scope section:** Add A-44 dashboard surfaces to the build scope.

### 11.3 SCHEMA_REGISTRY.md changes

- Add 4 new tables to inventory: user_roles, user_actions, role_grant_audit, client_ingestion_versions.
- Update Group numbering: add Group 16 "RBAC & Knowledge Ingestion" (Tables 84-87).
- Document column additions to clients, operator_actions, pages.
- Update RLS verification section with new policies from Section 6 of this spec.
- Update total table count to 87.

### 11.4 AGENTS.md changes

- **A-44 entry:** Change `Phase: 1.5` to `Phase: 1`. Update cadence section per Section 7 of this spec. Add reference to Contract 73.
- **A-02 entry:** Add prerequisite: "Cannot run until A-44 successful ingestion exists for client (Contract 73)."
- **Phase 1 Agent Build Status section:** Add A-44 to the Phase 1 agent list (currently shows 14 agents, will become 15).
- **WHAT YOU ARE NOT (executor permissions):** Add: "You are not permitted to bypass A-44 ingestion check when implementing A-02 (Contract 73 violation)."
- **Build sequence:** Update sequence to insert A-44 between A-01 and A-18.

### 11.5 BEHAVIORAL_CONTRACTS.md changes

- Add Contract 71 (full text from Section 8.1 of this spec).
- Add Contract 72 (full text from Section 8.2).
- Add Contract 73 (full text from Section 8.3).
- Amend Contract 67 (full amendment text from Section 8.4).
- Update Contract 41 (LLM Cost Governance) to acknowledge that LLM cost cap adjustments are master_admin-only per Section 3.4 of this spec.

### 11.6 STATE_OF_THE_BUILD.md changes

- New session log entry: "2026-05-23 — RBAC Architecture Lock and A-44 Phase Relocation."
- Close out the "Agent Trigger Resource Ownership (Discovered 2026-05-21)" deferral by noting Contract 71 now resolves it.
- Update Phase 1 agent build status to include A-44.
- Update agent build sequence section.
- Add RBAC scope to Phase 1 Dashboard Scope.
- Update table count to 87.

---

## 12. VERIFICATION PROTOCOL

Before any code touches the repo, the following audit runs against the final synchronized governance file set:

### 12.1 Cross-reference grep audit

For each new identifier introduced in this spec, grep every governance file and confirm consistent presence:

- `master_admin` — must appear in: ROLE_HIERARCHY_ARCHITECTURE_SPEC, BLUEPRINT, MASTER_BUILD_SPEC, SCHEMA_REGISTRY, AGENTS, BEHAVIORAL_CONTRACTS, STATE_OF_THE_BUILD.
- `senior_admin` — same.
- `va` (in role context) — same.
- `user_roles` (table name) — must appear in: SCHEMA_REGISTRY (definition), MASTER_BUILD_SPEC (auth flow), BEHAVIORAL_CONTRACTS (Contracts 71, 72), STATE_OF_THE_BUILD (session log).
- `user_actions` (table name) — same.
- `role_grant_audit` (table name) — same.
- `client_ingestion_versions` (table name) — must appear in: SCHEMA_REGISTRY, AGENTS (A-44), BEHAVIORAL_CONTRACTS (Contract 73), STATE_OF_THE_BUILD.
- `Contract 71`, `Contract 72`, `Contract 73` — must appear in: BEHAVIORAL_CONTRACTS (definition), STATE_OF_THE_BUILD (active contracts list), AGENTS (enforcement reference).
- `A-44` with `Phase: 1` — must appear in: AGENTS, BLUEPRINT, MASTER_BUILD_SPEC, STATE_OF_THE_BUILD. No remaining `Phase: 1.5` references to A-44.

### 12.2 Contradiction sweep

For each statement of fact, search for and resolve any contradicting statement still present in any file:

- "single-operator" or "one operator per client" — must be removed or qualified as legacy.
- "operator_actions" as the canonical audit table — must be qualified as legacy; user_actions is canonical going forward.
- "A-44 Phase 1.5" — zero remaining instances.
- "single-tenant operator design" (in deferral notes) — must be marked resolved by Contract 71.

### 12.3 Schema drift check

- Every new table has migration filename slot reserved and SQL skeleton documented.
- Every new column has migration filename slot and ALTER statement documented.
- No referenced table or column exists in any governance file that lacks a definition in SCHEMA_REGISTRY.

### 12.4 Contract chain check

- Each new contract references its enforcement script path (even if the script is a stub plan).
- Contract 67 amendment is internally consistent — does not conflict with the original rule.

### 12.5 Operator sign-off

This document is delivered as both Markdown and .docx. Operator reads, edits if needed, approves. Sign-off is captured in STATE_OF_THE_BUILD as a session log entry.

Only after operator sign-off does Document 2 begin.

---

## 13. RISKS AND MITIGATIONS

### 13.1 Risk: Migration complexity

**Risk:** 8 migrations applied in a single deployment window. Any one failure leaves the database in an inconsistent state.

**Mitigation:** Migrations are designed to be idempotent. Each migration uses `IF NOT EXISTS` for tables/indexes, `ON CONFLICT DO NOTHING` for seed inserts, and `DROP IF EXISTS` for policy reseeds. Migration N+8 (synthetic baseline) is data-only and safe to retry. The migrations are applied via `supabase db push` against a staging environment first, verified, then applied to production.

### 13.2 Risk: VA scope creep

**Risk:** Over time, operator may expand VA permissions reactively, eroding the principle of least privilege.

**Mitigation:** Permission matrix changes require the same governance commit pattern as schema changes (Contract 52 atomicity). Each VA permission addition must be justified in the commit message and reflected in this spec.

### 13.3 Risk: A-44 quarterly refresh storms

**Risk:** If many clients onboard in a short window, their 90-day refreshes pile up on the same days.

**Mitigation:** ±7 day jitter on `next_ingestion_scheduled_at` distributes load. Concurrency cap on A-44 stack_job workers prevents simultaneous scrapes. If still problematic, expand jitter to ±14 days.

### 13.4 Risk: Material diff approval bottleneck

**Risk:** If many clients have material site changes simultaneously, the operator review queue could overflow.

**Mitigation:** Senior_admins are authorized to approve A-44 diff approvals (Section 3.6). This parallelizes the approval work. The material-diff queue is sorted by client tier (Dominance first) so high-value clients get attention first.

### 13.5 Risk: Forgotten action types

**Risk:** The permission matrix in Section 3 covers known protected actions. New actions added later may be implemented without corresponding matrix entries, creating implicit permission grants.

**Mitigation:** Contract 71 enforcement script (`verify-rbac-pattern.ts`) checks that every protected handler invokes `hasPermission(role, action)`. If an action identifier is used in code that doesn't exist in the matrix, the verification script raises an explicit error: "Action `<x>` used in code but not in permission matrix." Operator must add the action to the matrix before the code can ship.

---

## 14. APPROVAL

This document requires operator sign-off before downstream governance files are updated.

**Operator approval format:** Operator responds with either:

- **"Approved — proceed to Document 2"** to advance to BLUEPRINT.md delta updates.
- **"Edits required: [list]"** to request specific revisions before approval.

Operator may also request specific clarifications or expansions on any section.

After approval, this document is committed to the repository at `docs/architecture/ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` as part of the final synchronized governance commit.

---

**End of Document 1 of 8.**
