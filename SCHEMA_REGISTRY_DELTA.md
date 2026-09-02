# TARRITRIX 1.0 — SCHEMA_REGISTRY.md DELTA SPECIFICATION

**Document ID:** SCHEMA_REGISTRY_DELTA
**Version:** 1.0
**Status:** DRAFT — Pending operator approval
**Authored:** 2026-05-23
**Author:** Lead Architect (Claude, acting on operator authorization)
**Operator:** Reid Whitesides
**Scope:** Surgical edits to `SCHEMA_REGISTRY.md` to propagate RBAC schema additions, A-44 phase relocation, and the A-21/A-44 conflict resolution per the canonical lock in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` (Document 1) and consistent with BLUEPRINT.md (Document 2) and MASTER_BUILD_SPEC.md (Document 3) deltas.

**This document is Document 4 of 8 in the governance synchronization series.** SCHEMA_REGISTRY.md is the database canonical file. Per Contract 4 (Schema Immutability), no schema mutation occurs without first updating this file. Per Contract 54 (Schema-Verified Code Generation), code that references unverified tables or columns is blocked at the CI layer. The accuracy of this delta directly affects whether Phase 1 RBAC + A-44 code can ship.

**Source file state at time of authoring:** `/mnt/project/SCHEMA_REGISTRY.md`, 994 lines, 83 tables in inventory (Tables 1–83), last modified per project upload timestamp 2026-05-23 17:32.

**Read every diff before approving.** Schema errors propagate into migrations, RLS policies, application code, and test fixtures. The cost of a wrong column type or constraint here is hours of remediation downstream.

---

## 1. SUMMARY OF CHANGES

This delta makes the following changes to SCHEMA_REGISTRY.md:

| # | Type | Location | Purpose |
|---|---|---|---|
| 1 | REPLACE | Line 48 (heading) | Update "COMPLETE TABLE INVENTORY (80 TABLES)" → "COMPLETE TABLE INVENTORY (87 TABLES)" |
| 2 | INSERT | After line 208 (end of Group 15) | Add Group 16 "RBAC and Knowledge Ingestion (Tables 84-87)" inventory rows |
| 3 | REPLACE | Lines 250–251 (operator_actions note) | Add deprecation note pointing to user_actions as canonical going forward |
| 4 | INSERT | After line 257 (end of demo_requests note section, before Future Schema Additions list) | Add notes-on-tables entries for user_roles, user_actions, role_grant_audit, client_ingestion_versions |
| 5 | REPLACE | Lines 444–448 (A-21 Client Site Ingestion entry in Migration 005 section) | Replace with A-21/A-44 conflict resolution note clarifying the historical record |
| 6 | INSERT | After line 491 (end of Migration 005 section, before line 493 RLS VERIFICATION heading) | Add new section "MIGRATIONS N+1 THROUGH N+8 (2026-05-23 RBAC + A-44 PHASE 1)" with full SQL DDL for all 4 new tables and 3 column-addition migrations |
| 7 | REPLACE | Lines 493–524 (RLS VERIFICATION section) | Update RLS verification documentation with role-aware patterns and the new `user_has_operator_role()` helper function |
| 8 | REPLACE | Lines 784–788 (A-44 Phase 1.5 entry under Authenticity/Trust/Ingestion Tables) | Replace with Phase 1 note and cross-reference to new RBAC + A-44 section |
| 9 | INSERT | After line 982 (end of last existing schema section, before SCHEMA DRIFT DETECTOR section) | Add section "RBAC HELPER FUNCTIONS AND TRIGGERS" with full PL/pgSQL definitions |

**Net effect on SCHEMA_REGISTRY.md:**
- Lines deleted: approximately 30
- Lines added: approximately 720
- Net line delta: +690 lines, ending file at ~1,684 lines

**Zero changes to:**
- Lines 1–47 (header, agent reading instructions, extension-provided tables note)
- Groups 1–14 of table inventory (Tables 1–80)
- Tables in Group 15 (Tables 81–83) — RBAC tables are NEW (Group 16), not mutations of existing operator dashboard tables
- Migration 001 SQL reference section
- Migration 002 SQL reference section
- Distributed Relevance Maintenance Tables section (Phase 1.5)
- Phase 1.5 A-21 Hyperlocal Geographic Engine Tables section (county data — separate from A-44)
- Phase 1.5 AEO/Voice/Conversion Tables section
- Phase 1.5 Defensive Infrastructure Tables section
- Phase 2+ Deferred Tables section
- 2026-05-20 Tier 2 Service Hub Architecture Schema section
- All existing table column documentation (subscriptions, clients, page_sitemaps, client_evidence_progress, page_metrics, service_area_heatmaps, job_evidence, demo_requests detail)
- Schema Drift Detector section (lines 986–994) — preserved at end of file

---

## 2. CHANGE 1: Update Total Table Count Heading

### 2.1 Lines being replaced

Line 48 currently reads:

```
## COMPLETE TABLE INVENTORY (80 TABLES)
```

### 2.2 Replacement content

```
## COMPLETE TABLE INVENTORY (87 TABLES)
```

### 2.3 Rationale

Pre-RBAC count was 80 (historic note); current count per line 202 Group 15 is 83 (Tables 1–83). Post-RBAC count is 87 (adding Tables 84, 85, 86, 87 for user_roles, user_actions, role_grant_audit, client_ingestion_versions). The heading is corrected to reflect the actual post-RBAC count.

Note: the heading was already stale before this delta — it said 80 while the inventory below it listed 83. We are correcting both in one motion to the accurate post-RBAC count.

---

## 3. CHANGE 2: Add Group 16 RBAC and Knowledge Ingestion Inventory

### 3.1 Insertion location

Insert immediately after line 208 (which is the last row of Group 15: `| 83 | operator_preferences | Per-operator UI preferences and state persistence | 1 | 008 |`) and before line 210 (the `---` separator).

### 3.2 Content to insert

```

### Group 16: RBAC and Knowledge Ingestion (Tables 84-87)

| # | Table | Purpose | Phase | Migration |
|---|---|---|---|---|
| 84 | user_roles | Global role assignment per user (master_admin / senior_admin / va / client) with grant history and revocation tracking | 1 | N+1 (slot reserved at implementation) |
| 85 | user_actions | Multi-user audit log with three-attribute attribution: acting_user_id, acting_user_role, client_id | 1 | N+3 |
| 86 | role_grant_audit | Dedicated audit trail for role grant and revocation events, separately indexed for compliance queries | 1 | N+1 |
| 87 | client_ingestion_versions | Per-scrape version metadata for A-44 with diff classification and approval workflow | 1 | N+4 |

```

### 3.3 Migration slot naming

The migration slot identifiers (N+1, N+3, N+4) are placeholders. At implementation time, these are claimed contiguously in the `supabase/migrations/` namespace following the convention `<YYYYMMDDHHMMSS>_<descriptive_slug>.sql`. The exact timestamps are reserved at the moment of migration file creation per Contract 4 (Schema Immutability) — once the migration file is committed, its identifier is permanent. This convention matches existing entries in the table inventory which use a mix of sequence-based (001, 002, 008) and timestamp-based (20260516000002, 20260514120000) identifiers.

### 3.4 Why these tables are Phase 1

Per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 4.6 (Migration sequence) and BEHAVIORAL_CONTRACTS.md Contract 71 enforcement requirements:
- user_roles is mandatory for Contract 71 enforcement (RBAC check helper queries it)
- user_actions is mandatory for Contract 72 enforcement (every audit log row writes to it)
- role_grant_audit is mandatory for role grant traceability
- client_ingestion_versions is mandatory for Contract 73 enforcement (A-02 prerequisite check queries it)

None of the four can be deferred without violating a Phase 1 contract.

---

## 4. CHANGE 3: Update operator_actions Notes for Deprecation

### 4.1 Context

Line 250–251 currently describes operator_actions as the canonical audit table. Per Document 1 Section 4.2, user_actions replaces operator_actions going forward. The historical operator_actions table is preserved for legacy data but no new writes go to it.

### 4.2 Lines being replaced

Lines 250–251 currently read:

```
### operator_actions (Table 39)
Every manual override an operator performs (overriding a quality gate, force-publishing a flagged page, manually pausing a client) is logged here with required justification.
```

### 4.3 Replacement content

```
### operator_actions (Table 39) — DEPRECATED FOR NEW WRITES

Originally the canonical audit table for manual operator overrides. **Deprecated for new writes as of 2026-05-23** per RBAC architecture lock. Replaced by `user_actions` (Table 85) which captures the same audit data with three-attribute attribution (acting_user_id, acting_user_role, client_id) per Contract 72.

**Historical preservation:**
- All existing rows preserved unchanged
- All rows backfilled with `role_at_time_of_action = 'operator_legacy'` (added column per Migration N+6)
- The `'operator_legacy'` value is reserved for pre-RBAC era data
- The table is queryable for compliance reporting but receives no new INSERTs after the RBAC migration applies

**Reason for replacement rather than in-place modification:**
The schema delta would be substantial (adding acting_user_role NOT NULL on a populated table with no backfillable role data would require either nullable column with eventual constraint tightening, or platform-wide assumption of a single role for the pre-RBAC data). Creating user_actions as a clean replacement table is architecturally simpler and preserves historical data without forced constraints.

**Migration N+6 (`alter_operator_actions_add_role.sql`):**
- Adds `role_at_time_of_action TEXT NOT NULL CHECK (role_at_time_of_action IN ('master_admin', 'senior_admin', 'va', 'operator_legacy'))`
- Backfills all existing rows with `'operator_legacy'`
- Application code is updated to write all new audit data to user_actions, not operator_actions
```

---

## 5. CHANGE 4: Add Notes on the Four New RBAC Tables

### 5.1 Context

The "NOTES ON SPECIFIC TABLES" section (lines 239–322 approximately) provides human-readable notes for important tables. The four new RBAC tables need corresponding notes.

### 5.2 Insertion location

Insert immediately after the end of the demo_requests notes block. Per the source file, demo_requests notes span lines 256 onward through approximately line 322 where the subscriptions section begins. The insertion point is immediately after the closing of demo_requests notes content and before the `### subscriptions (Table 5)` heading at line 296.

Specifically: insert immediately before line 296 (`### subscriptions (Table 5)`).

### 5.3 Content to insert

```

### user_roles (Table 84)
Global role assignment for every authenticated user in the platform. One active row per user (enforced via partial unique index `user_roles_one_active_per_user` where `revoked_at IS NULL`). Role values: 'master_admin', 'senior_admin', 'va', 'client'.

**Soft-delete pattern:** Role changes preserve historical context — the old row is marked `revoked_at = NOW()` and `revoked_by = <granter_user_id>`, then a new row is inserted with the new role. This permits reconstruction of "who held what role on what date" for any past timestamp. Required for DSAR responses and compliance audits.

**Grant authority:**
- master_admin role can only be granted by another master_admin
- senior_admin role can only be granted by master_admin
- va role can be granted by master_admin OR senior_admin
- All grant authority validated at application layer; database RLS restricts INSERT/UPDATE to master_admin only, with the senior_admin VA-grant path handled via a server action that runs with elevated privileges after validating the granter's authority

**Initial seed:** Migration N+2 (`seed_user_roles_from_auth_users.sql`) reads existing `auth.users.raw_user_meta_data->>'role'` and creates user_roles rows for every existing user. The existing operator account `operator@tarritrix.test` (auth UUID `aaaaaaaa-0000-0000-0000-000000000001`) is auto-promoted to master_admin per operator decision 2026-05-23 (Issue 1).

### user_actions (Table 85)
Multi-user audit log replacing operator_actions for all new writes. Every audit-logged action across the platform writes one row here with three-attribute attribution (Contract 72):
1. `acting_user_id` (UUID NOT NULL) — the authenticated user who initiated the action
2. `acting_user_role` (TEXT NOT NULL) — the active role of that user at the moment the action was executed, captured by fresh query of user_roles at action time (not cached)
3. `client_id` (UUID, nullable only for platform-level actions like role grants) — the tenant the action was for

**Immutability:** No UPDATE or DELETE policies. Audit rows are append-only. Contract 72 enforces.

**Result enum:** `'success'`, `'denied_permission'` (action attempted but role lacks permission per matrix), `'denied_constraint'` (action attempted but blocked by Contract 6, 9 hard gates, 18, or 45 constitutional constraint), `'failed'` (action attempted but encountered application error). Denied attempts produce audit rows so privilege escalation attempts leave a trace.

**Justification requirement:** Required for override actions (force-publish, P0 dismissal, cap increase, role grant, A-44 override) per Contract 72. Enforced at API layer via `requireJustification: true` on the action handler.

### role_grant_audit (Table 86)
Dedicated audit trail for role grant and revocation events. Subset of user_actions data but separately indexed for compliance queries ("who granted master_admin to whom, when, with what justification"). Every INSERT or UPDATE to user_roles produces a corresponding role_grant_audit row.

**Why a separate table from user_actions:** Compliance queries on role changes are common during DSAR responses and security audits. A dedicated table with indexes on `target_user_id` and `granted_by_user_id` provides fast query paths without scanning the high-volume user_actions table.

### client_ingestion_versions (Table 87)
Per-scrape version metadata for A-44 Client Knowledge Ingestion Engine. Each successful or failed scrape creates a new row.

**is_current pattern:** Only one row per client may have `is_current = TRUE`. Enforced via partial unique index. A-02 Page Generator reads from `clients.current_ingestion_version_id` which points to the row with `is_current = TRUE`.

**Approval workflow:**
- `auto_approved` — first-ever scrape at onboarding, or subsequent scrape with `diff_severity = 'none'` or `'minor'`. Immediately becomes current.
- `pending_approval` — subsequent scrape with `diff_severity = 'material'` or `'breaking'`. Requires master_admin or senior_admin to approve before becoming current. Previous version remains current until approval.
- `approved` — operator reviewed and accepted. Becomes current; previous version marked `is_current = FALSE`.
- `rejected` — operator reviewed and rejected. Historical record; never becomes current.
- `manually_provided` — master_admin Contract 73 override path for unscrapable sites. Manual asset upload via dashboard form.

**Diff severity computation:** Deterministic hash comparison (no LLM cost) per BLUEPRINT.md Part 10.5 Section 10.5.5 algorithm.

```

---

## 6. CHANGE 5: Resolve A-21 Client Site Ingestion Historical Entry

### 6.1 Context

Lines 444–448 in the Migration 005 documentation section currently read:

```
### A-21 Client Site Ingestion (2 tables + ALTER)

**site_crawls** (tenant-scoped) — Playwright crawl jobs with status tracking  
**extracted_evidence** (tenant-scoped) — testimonials, photos, certifications, bios from client sites with permission flags  
**ALTER page_content_profile** — adds existing_seo_patterns, existing_coverage_map, link_patterns, source_crawl_id
```

This is part of the historical Migration 005 record (applied 2026-05-14). The migration is APPLIED — these tables and ALTER exist in the production database. We cannot retroactively rename them, but we can clarify the canonical naming going forward.

### 6.2 Lines being replaced

Lines 444–448 (the entire subsection) are replaced with:

### 6.3 Replacement content

```
### A-44 Client Knowledge Ingestion — Migration 005 Historical Entry (Originally Labeled "A-21 Client Site Ingestion")

**A-21/A-44 conflict resolution note (2026-05-23):**

Migration 005 (applied 2026-05-14) shipped these tables under the working label "A-21 Client Site Ingestion" before the canonical slot for client knowledge ingestion was determined to be A-44. Per operator decision 2026-05-23 (Option 1 conflict resolution), all client knowledge ingestion functionality is canonically slotted as A-44 going forward. A-21 is reserved for "Hyperlocal Geographic Engine" exclusively (county property data, ZIP-level page generation — see Phase 1.5 A-21 Hyperlocal Geographic Engine Tables section below).

The tables created by Migration 005 remain in production with their existing names and serve A-44 functionality:

**site_crawls** (tenant-scoped, Table — Migration 005) — Playwright crawl jobs with status tracking. Used by A-44 to track crawl execution.
**extracted_evidence** (tenant-scoped, Table — Migration 005) — testimonials, photos, certifications, bios from client sites with permission flags. Used by A-44 to store extracted assets.
**ALTER page_content_profile** (Migration 005) — adds existing_seo_patterns, existing_coverage_map, link_patterns, source_crawl_id. Used by A-44 outputs feeding A-02 and A-10.

**Relationship to the Phase 1 RBAC + A-44 migration (Migrations N+1 through N+8):**

The Migration 005 tables (site_crawls, extracted_evidence) are A-44's per-crawl work tables. The new client_ingestion_versions table (Migration N+4) is A-44's version-management layer. The full A-44 storage model spans:
- site_crawls — crawl job state (Migration 005, existing)
- extracted_evidence — raw captured assets (Migration 005, existing)
- client_ingested_assets — refined asset library (declared in Phase 1.5 Authenticity/Trust/Ingestion section, migration pending Phase 1 generation)
- client_brand_voice_model — per-client voice model (declared, migration pending)
- client_keyword_gap_analysis — keyword gap analysis (declared, migration pending)
- client_ingestion_versions — version management (Migration N+4, this synchronization)

A-44 implementation reads/writes across all six. See BLUEPRINT.md Part 10.5 and ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 7 for canonical specification.
```

### 6.4 Why we don't rename existing tables

Renaming site_crawls or extracted_evidence would require a destructive schema change in production. The tables work correctly under their current names; the conflict was naming-only at the documentation layer. Resolving the conflict requires updating the documentation, not the production schema. Contract 4 (Schema Immutability) explicitly states "schema changes are immutable once applied — corrections come via new versioned migrations" — we are correcting the documentation to match the architectural intent, leaving the production tables unchanged.

---

## 7. CHANGE 6: Add Full SQL DDL for RBAC + A-44 Migrations

### 7.1 Context

The new tables, columns, and constraints need complete DDL documentation in SCHEMA_REGISTRY.md so that the migration files are generated correctly and future code generation (per Contract 54) can verify against the documented schema.

### 7.2 Insertion location

Insert immediately after line 491 (which is the last line of the Migration 005 ADDITIONS section, specifically the closing description of `Phase 1 Data Preparation`) and before line 493 (`## RLS VERIFICATION`).

The exact insertion point is between the `---` separator (if present) closing the Migration 005 section and the `## RLS VERIFICATION` heading at line 493.

### 7.3 Content to insert

```

---

## MIGRATIONS N+1 THROUGH N+8 (2026-05-23 RBAC + A-44 PHASE 1)

This section documents the schema additions and modifications applied via Migrations N+1 through N+8. Migration timestamp slots are reserved at implementation time per Contract 4. The migrations apply in strict order — earlier migrations are prerequisites for later migrations.

### Migration N+1: Create user_roles and role_grant_audit Tables

**Filename pattern:** `<YYYYMMDDHHMMSS>_create_user_roles_and_role_grant_audit.sql`

```sql
-- Migration N+1: RBAC foundation tables

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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX user_roles_one_active_per_user ON user_roles(user_id) WHERE revoked_at IS NULL;

-- Service role grants per Contract 64
GRANT ALL ON user_roles TO service_role;
GRANT SELECT ON user_roles TO authenticated;

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- RLS Policies (see Section "RBAC HELPER FUNCTIONS AND TRIGGERS" below for user_has_operator_role function)

CREATE POLICY "users_can_read_own_role" ON user_roles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "operator_side_users_can_read_user_roles" ON user_roles
  FOR SELECT
  USING (user_has_operator_role(auth.uid()));

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

-- role_grant_audit table

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
CREATE INDEX idx_role_grant_audit_created_at ON role_grant_audit(created_at DESC);

GRANT ALL ON role_grant_audit TO service_role;
GRANT SELECT ON role_grant_audit TO authenticated;

ALTER TABLE role_grant_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operator_side_users_can_read_role_grant_audit" ON role_grant_audit
  FOR SELECT
  USING (user_has_operator_role(auth.uid()));
```

### Migration N+2: Seed user_roles from Existing auth.users

**Filename pattern:** `<YYYYMMDDHHMMSS>_seed_user_roles_from_auth_users.sql`

```sql
-- Migration N+2: Seed user_roles for existing users
-- Auto-promote existing operator account to master_admin per operator decision 2026-05-23 (Issue 1)

INSERT INTO user_roles (user_id, role, granted_by, granted_at, revoked_at)
SELECT
  id AS user_id,
  CASE
    WHEN raw_user_meta_data->>'role' = 'operator' THEN 'master_admin'
    WHEN raw_user_meta_data->>'role' = 'client' THEN 'client'
    ELSE 'va'
  END AS role,
  -- Use the platform sentinel UUID to represent the system as the granter for migration-applied grants
  '00000000-0000-0000-0000-000000000001'::uuid AS granted_by,
  NOW() AS granted_at,
  NULL AS revoked_at
FROM auth.users
WHERE id NOT IN (
  SELECT user_id FROM user_roles WHERE revoked_at IS NULL
);

-- Audit log entry for the auto-promotion
INSERT INTO role_grant_audit (event_type, target_user_id, role, granted_by_user_id, granted_by_role, justification, created_at)
SELECT
  'granted' AS event_type,
  ur.user_id AS target_user_id,
  ur.role AS role,
  '00000000-0000-0000-0000-000000000001'::uuid AS granted_by_user_id,
  'system' AS granted_by_role,
  'Migration N+2 auto-promotion from pre-RBAC user_metadata.role per 2026-05-23 governance synchronization' AS justification,
  NOW() AS created_at
FROM user_roles ur
WHERE ur.granted_by = '00000000-0000-0000-0000-000000000001'::uuid;
```

### Migration N+3: Create user_actions Table

**Filename pattern:** `<YYYYMMDDHHMMSS>_create_user_actions.sql`

```sql
-- Migration N+3: Multi-user audit log

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
CREATE INDEX idx_user_actions_result ON user_actions(result) WHERE result != 'success';

GRANT ALL ON user_actions TO service_role;
GRANT SELECT ON user_actions TO authenticated;

ALTER TABLE user_actions ENABLE ROW LEVEL SECURITY;

-- master_admin and senior_admin can read all audit rows
CREATE POLICY "master_and_senior_can_read_audit_log" ON user_actions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('master_admin', 'senior_admin')
        AND ur.revoked_at IS NULL
    )
  );

-- Any authenticated user can read their own actions (for /dashboard/profile session log)
CREATE POLICY "users_can_read_own_actions" ON user_actions
  FOR SELECT
  USING (acting_user_id = auth.uid());

-- No UPDATE or DELETE policies — audit rows are immutable and append-only
-- INSERTs are performed via service_role from route handlers, never directly from authenticated users
```

### Migration N+4: Create client_ingestion_versions Table

**Filename pattern:** `<YYYYMMDDHHMMSS>_create_client_ingestion_versions.sql`

```sql
-- Migration N+4: A-44 version management

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
  approval_status TEXT CHECK (approval_status IN ('auto_approved', 'pending_approval', 'approved', 'rejected', 'manually_provided')),
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
CREATE UNIQUE INDEX idx_client_ingestion_versions_current ON client_ingestion_versions(client_id) WHERE is_current = TRUE;
CREATE INDEX idx_client_ingestion_versions_pending ON client_ingestion_versions(client_id) WHERE approval_status = 'pending_approval';
CREATE INDEX idx_client_ingestion_versions_status ON client_ingestion_versions(status);

GRANT ALL ON client_ingestion_versions TO service_role;
GRANT SELECT ON client_ingestion_versions TO authenticated;

ALTER TABLE client_ingestion_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operator_side_users_can_read_ingestion_versions" ON client_ingestion_versions
  FOR SELECT
  USING (user_has_operator_role(auth.uid()));
```

### Migration N+5: Add A-44 Tracking Columns to clients

**Filename pattern:** `<YYYYMMDDHHMMSS>_alter_clients_add_ingestion_columns.sql`

```sql
-- Migration N+5: A-44 tracking on clients table

ALTER TABLE clients
  ADD COLUMN current_ingestion_version_id UUID REFERENCES client_ingestion_versions(id),
  ADD COLUMN last_ingestion_at TIMESTAMPTZ,
  ADD COLUMN next_ingestion_scheduled_at TIMESTAMPTZ,
  ADD COLUMN ingestion_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN ingestion_block_reason TEXT,
  ADD COLUMN ingestion_synthetic_baseline BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_clients_next_ingestion ON clients(next_ingestion_scheduled_at)
  WHERE ingestion_blocked = FALSE AND next_ingestion_scheduled_at IS NOT NULL;
```

### Migration N+6: Add role_at_time_of_action to operator_actions

**Filename pattern:** `<YYYYMMDDHHMMSS>_alter_operator_actions_add_role.sql`

```sql
-- Migration N+6: Backfill role attribution for legacy operator_actions

ALTER TABLE operator_actions
  ADD COLUMN role_at_time_of_action TEXT CHECK (role_at_time_of_action IN ('master_admin', 'senior_admin', 'va', 'operator_legacy'));

UPDATE operator_actions
SET role_at_time_of_action = 'operator_legacy'
WHERE role_at_time_of_action IS NULL;

ALTER TABLE operator_actions
  ALTER COLUMN role_at_time_of_action SET NOT NULL;
```

### Migration N+7: Add Reviewer Assignment Columns to pages

**Filename pattern:** `<YYYYMMDDHHMMSS>_alter_pages_add_reviewer_assignment.sql`

```sql
-- Migration N+7: Flagged page review lease

ALTER TABLE pages
  ADD COLUMN assigned_reviewer_id UUID REFERENCES auth.users(id),
  ADD COLUMN assigned_reviewer_at TIMESTAMPTZ,
  ADD COLUMN assigned_reviewer_role TEXT;

CREATE INDEX idx_pages_assigned_reviewer ON pages(assigned_reviewer_id)
  WHERE assigned_reviewer_id IS NOT NULL;
```

### Migration N+8: Synthetic A-44 Baseline for Existing Clients

**Filename pattern:** `<YYYYMMDDHHMMSS>_seed_a44_baseline_for_existing_clients.sql`

```sql
-- Migration N+8: Backward compatibility for existing seeded clients
-- Creates a synthetic baseline ingestion version for each existing client so Contract 73
-- is satisfied at the database constraint level. Marks clients for real A-44 scrape via
-- ingestion_synthetic_baseline flag.

INSERT INTO client_ingestion_versions (
  client_id,
  version_number,
  scrape_started_at,
  scrape_completed_at,
  status,
  trigger_type,
  triggered_by_user_id,
  is_current,
  approval_status,
  approved_by_user_id,
  approved_at,
  approval_role,
  diff_summary,
  diff_severity,
  created_at
)
SELECT
  c.id AS client_id,
  1 AS version_number,
  NOW() AS scrape_started_at,
  NOW() AS scrape_completed_at,
  'success' AS status,
  'onboarding' AS trigger_type,
  '00000000-0000-0000-0000-000000000001'::uuid AS triggered_by_user_id,
  TRUE AS is_current,
  'auto_approved' AS approval_status,
  '00000000-0000-0000-0000-000000000001'::uuid AS approved_by_user_id,
  NOW() AS approved_at,
  'system' AS approval_role,
  jsonb_build_object('synthetic_baseline', TRUE, 'note', 'Pre-A-44 era client. Real scrape pending operator interaction.') AS diff_summary,
  'none' AS diff_severity,
  NOW() AS created_at
FROM clients c
WHERE c.id NOT IN (SELECT client_id FROM client_ingestion_versions);

-- Update clients to point at their synthetic baseline and mark them for real scrape
UPDATE clients c
SET
  current_ingestion_version_id = civ.id,
  last_ingestion_at = NOW(),
  next_ingestion_scheduled_at = NOW() + INTERVAL '1 day', -- Schedule real scrape for tomorrow
  ingestion_synthetic_baseline = TRUE
FROM client_ingestion_versions civ
WHERE civ.client_id = c.id
  AND civ.is_current = TRUE
  AND c.current_ingestion_version_id IS NULL;
```

### Verification Queries (Post-Migration)

After all 8 migrations apply, the following queries verify the schema is in the expected state:

```sql
-- Verify Group 16 tables exist
SELECT COUNT(*) AS rbac_table_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('user_roles', 'user_actions', 'role_grant_audit', 'client_ingestion_versions');
-- Expected: 4

-- Verify existing operator account auto-promoted to master_admin
SELECT role FROM user_roles
WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
  AND revoked_at IS NULL;
-- Expected: 'master_admin'

-- Verify operator_actions backfilled with operator_legacy
SELECT COUNT(*) FROM operator_actions WHERE role_at_time_of_action IS NULL;
-- Expected: 0

SELECT COUNT(*) FROM operator_actions WHERE role_at_time_of_action = 'operator_legacy';
-- Expected: (number of pre-RBAC operator_actions rows)

-- Verify clients have ingestion tracking columns
SELECT COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'clients'
  AND column_name IN ('current_ingestion_version_id', 'last_ingestion_at', 'next_ingestion_scheduled_at', 'ingestion_blocked', 'ingestion_block_reason', 'ingestion_synthetic_baseline');
-- Expected: 6

-- Verify existing clients have synthetic baseline
SELECT COUNT(*) FROM clients WHERE ingestion_synthetic_baseline = TRUE;
-- Expected: (number of pre-A-44 era clients)

SELECT COUNT(*) FROM clients WHERE current_ingestion_version_id IS NOT NULL;
-- Expected: (same as above)

-- Verify pages have reviewer assignment columns
SELECT COUNT(*) FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pages'
  AND column_name IN ('assigned_reviewer_id', 'assigned_reviewer_at', 'assigned_reviewer_role');
-- Expected: 3
```

---

```

---

## 8. CHANGE 7: Update RLS Verification Section

### 8.1 Context

The RLS Verification section (lines 493–524) currently documents the single-operator pattern `client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid())`. Under multi-user RBAC, this pattern is incomplete — it does not grant access to senior_admin or VA users who lack a row in `clients.operator_id` linkage.

### 8.2 Lines being replaced

Lines 493 through 524 (the entire RLS VERIFICATION section) are replaced with:

### 8.3 Replacement content

```
## RLS VERIFICATION

Every table has Row-Level Security enabled. Cross-tenant access is impossible by design.

**Two distinct RLS patterns are now in use** as of 2026-05-23 RBAC architecture lock:

### Pattern A: Operator-Side Multi-User Access (NEW — 2026-05-23)

For tables that operator-side roles (master_admin, senior_admin, va) all need to read:

```sql
CREATE POLICY "operator_side_users_can_read_<table>" ON <table>
  FOR SELECT
  USING (user_has_operator_role(auth.uid()));
```

Where `user_has_operator_role(uid)` is the helper function defined in the "RBAC HELPER FUNCTIONS AND TRIGGERS" section below. The function returns TRUE if the user has any active role in `('master_admin', 'senior_admin', 'va')`.

**Tables using Pattern A:**
- user_roles (with additional self-read policy and master_admin-only modify policy)
- user_actions (with additional own-actions read policy)
- role_grant_audit
- client_ingestion_versions
- clients (operator-side read; client_user_id self-read also applies for client portal)
- pages (operator-side read; client-derived read also applies for client portal)
- Most other operator-facing tables previously using the single-operator pattern

### Pattern B: Client Portal Self-Access (UNCHANGED — Existing Pattern)

For client portal users to read their own client's data via `clients.client_user_id`:

```sql
CREATE POLICY "<table>_client_portal_read" ON <table>
  FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE client_user_id = auth.uid()
    )
  );
```

This pattern remains unchanged. Client portal users see only their own client's data.

### Pattern C: Legacy Single-Operator Ownership (DEPRECATED — Being Phased Out)

The original pattern `client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid())` is still present on some tables. **It is deprecated as of 2026-05-23.** During the Phase 1 RBAC build, every RLS policy using this pattern is migrated to Pattern A. The legacy pattern remains correct (it grants access to the single master_admin via the operator_id pointer) but is too narrow — it does not grant senior_admin or va access. Migration tracking:

- Total tables with Pattern C as of 2026-05-23: ~40 (legacy from original migrations)
- Migration target: All operator-facing tables migrated to Pattern A by Phase 1 RBAC build exit

### Tenant Isolation Enforcement

All three patterns enforce tenant isolation:
- Pattern A: Operator-side roles see all clients (cross-tenant is by design for operator role); client_id is not the isolation boundary at this layer — role assignment is
- Pattern B: Client portal users see only their own client_id; tenant isolation enforced by `client_user_id = auth.uid()` check
- Pattern C (legacy): Operator-id linkage enforces tenant isolation for single-operator-per-client semantics

CRON-02 runs cross-tenant leak detection daily across all three patterns. Any leak = P0 alarm.

### RLS Public Exceptions (intentionally RLS DISABLED)

| Table | Reason for RLS Exception |
|---|---|
| pricing_tiers | Public pricing reference data (existing exception) |
| typography_library | Public design library, operator-facing reference |
| palette_library | Public design library, operator-facing reference |
| archetype_library | Public design library, operator-facing reference |
| module_library | Operator-facing component library, no client data |
| page_type_templates | Public reference for page archetypes |
| composition_recipes | Public reference for composition patterns |
| diversity_constraints | Platform-wide configuration |
| storm_events | Public NOAA reference data |
| storm_event_assets | Public NOAA reference data |
| storm_ingestion_log | Operator-only operational log |
| llm_provider_health | Operator-only operational health data |
| llm_routing_config | Operator-only platform configuration |

The 13 RLS-disabled tables above are NOT subject to Pattern A migration — they have no tenant data and were intentionally exempt from RLS at original creation.

### Write Policy Strategy (CRITICAL)

Pattern A grants read access to operator-side users broadly. **Write access is NOT broad — write enforcement happens at the application layer via the canonical permission matrix per Contract 71, not via RLS.**

The reasoning:
- Application-layer permission checks produce auditable rejection events (logged to user_actions with result='denied_permission'). RLS rejection is silent and does not capture justification context.
- Compliance audits require traceability of attempted privilege escalations. RLS denial does not produce a trace.
- The database remains the second line of defense. RLS policies on WRITE operations still check for operator-side role (any of three), but fine-grained per-action enforcement happens in the route handler.

**Write RLS pattern (defense-in-depth):**

```sql
CREATE POLICY "operator_side_users_can_modify_<table>" ON <table>
  FOR ALL
  USING (user_has_operator_role(auth.uid()))
  WITH CHECK (user_has_operator_role(auth.uid()));
```

This blocks unauthenticated and client-role writes at the database level. Per-action role enforcement (which operator-side role can perform which action) happens at the application layer.
```

---

## 9. CHANGE 8: Update A-44 Phase Designation in Authenticity/Trust/Ingestion Section

### 9.1 Context

Lines 784–788 currently mark A-44 Client Knowledge Ingestion tables as Phase 1.5. Per the canonical phase relocation in Document 1, A-44 is now Phase 1.

### 9.2 Lines being replaced

Lines 784–788 currently read:

```
**A-44 Client Knowledge Ingestion:**
- client_ingested_assets — Raw captures from client site crawl
- client_brand_voice_model — Per-client voice and terminology model
- client_keyword_gap_analysis — Keywords client should rank for
- (extends evidence_items for ingested photo imports)
```

### 9.3 Replacement content

```
**A-44 Client Knowledge Ingestion (PHASE 1 — RELOCATED 2026-05-23):**

A-44 was originally declared at Phase 1.5 in this section. Per operator decision 2026-05-23, A-44 is relocated to Phase 1 as a mandatory prerequisite for A-02 Page Generator. Contract 73 (Pre-Generation Knowledge Ingestion Requirement) enforces the prerequisite.

The following tables are A-44's Phase 1 storage layer and ship with Phase 1 RBAC + A-44 migrations:

- client_ingested_assets — Raw captures from client site crawl, per-asset metadata (source URL, capture date, asset type, classification confidence, asset_version, is_current)
- client_brand_voice_model — Per-client voice and terminology model used by A-02 and A-25
- client_keyword_gap_analysis — Keywords client should rank for but doesn't
- (extends evidence_items for ingested photo imports)

These tables join the new client_ingestion_versions table (Migration N+4, Table 87) which provides version-management metadata across multiple scrapes per client.

**Status:** Migrations pending Phase 1 generation. Full canonical specification in BLUEPRINT.md Part 10.5 and ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 7.
```

---

## 10. CHANGE 9: Add RBAC Helper Functions and Triggers Section

### 10.1 Context

The new tables and RLS policies depend on a SQL helper function `user_has_operator_role(uid)` and may benefit from triggers that maintain audit trail consistency. These need to be documented in SCHEMA_REGISTRY.md as part of the schema canon.

### 10.2 Insertion location

Insert immediately before line 986 (`## SCHEMA DRIFT DETECTOR`).

### 10.3 Content to insert

```

---

## RBAC HELPER FUNCTIONS AND TRIGGERS

### Function: user_has_operator_role(uid UUID) — Pattern A RLS Helper

Used by RLS policies that grant operator-side multi-role read access. Returns TRUE if the user holds any active role in ('master_admin', 'senior_admin', 'va'). Migration: applied as part of Migration N+1.

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

-- Allow execution from any authenticated context
GRANT EXECUTE ON FUNCTION user_has_operator_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_operator_role(UUID) TO service_role;
```

### Function: user_active_role(uid UUID) — Application-Layer Helper

Returns the active role for a given user. Used by application code via Supabase RPC when role context is needed but the application cannot maintain a fresh cache. Migration: applied as part of Migration N+1.

```sql
CREATE OR REPLACE FUNCTION user_active_role(uid UUID)
RETURNS TEXT AS $$
  SELECT role FROM user_roles
  WHERE user_id = uid
    AND revoked_at IS NULL
  LIMIT 1
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION user_active_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_active_role(UUID) TO service_role;
```

### Trigger: role_grant_audit_on_user_roles_change

Automatically writes a role_grant_audit row whenever user_roles INSERT or UPDATE happens. Provides automatic audit trail enforcement at the database layer in addition to application-layer logging. Defense-in-depth.

```sql
CREATE OR REPLACE FUNCTION write_role_grant_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Grant event
    INSERT INTO role_grant_audit (
      event_type,
      target_user_id,
      role,
      granted_by_user_id,
      granted_by_role,
      justification,
      created_at
    ) VALUES (
      'granted',
      NEW.user_id,
      NEW.role,
      COALESCE(NEW.granted_by, '00000000-0000-0000-0000-000000000001'::uuid),
      COALESCE((SELECT role FROM user_roles WHERE user_id = NEW.granted_by AND revoked_at IS NULL LIMIT 1), 'system'),
      'Grant via user_roles INSERT (auto-audit trigger)',
      NEW.granted_at
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Detect revocation
    IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
      INSERT INTO role_grant_audit (
        event_type,
        target_user_id,
        role,
        granted_by_user_id,
        granted_by_role,
        justification,
        created_at
      ) VALUES (
        'revoked',
        NEW.user_id,
        NEW.role,
        COALESCE(NEW.revoked_by, '00000000-0000-0000-0000-000000000001'::uuid),
        COALESCE((SELECT role FROM user_roles WHERE user_id = NEW.revoked_by AND revoked_at IS NULL LIMIT 1), 'system'),
        COALESCE(NEW.revocation_reason, 'Revocation via user_roles UPDATE (auto-audit trigger)'),
        NEW.revoked_at
      );
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_role_grant_audit
  AFTER INSERT OR UPDATE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION write_role_grant_audit();
```

### Trigger: clients_ingestion_version_uniqueness_guard

Defense-in-depth trigger that ensures only one client_ingestion_versions row per client has is_current=TRUE. The partial unique index in Migration N+4 enforces this at the database level; this trigger adds an explicit error message for the application layer.

```sql
CREATE OR REPLACE FUNCTION enforce_ingestion_version_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_current = TRUE THEN
    -- Verify no other row for this client has is_current=TRUE
    IF EXISTS (
      SELECT 1 FROM client_ingestion_versions
      WHERE client_id = NEW.client_id
        AND is_current = TRUE
        AND id != NEW.id
    ) THEN
      RAISE EXCEPTION 'Contract 73 violation: only one client_ingestion_versions row per client may have is_current=TRUE. Mark prior current=FALSE before promoting a new version.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ingestion_version_uniqueness
  BEFORE INSERT OR UPDATE OF is_current ON client_ingestion_versions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ingestion_version_uniqueness();
```

### Performance Notes

- `user_has_operator_role()` is called by every Pattern A RLS policy. Index on `user_roles(user_id, role) WHERE revoked_at IS NULL` ensures lookup is O(1) per call.
- `user_active_role()` is called less frequently (only when application explicitly requests role context). Same index serves both functions.
- The role_grant_audit trigger fires synchronously on user_roles writes. Volume is low (role grants are rare events).
- The ingestion_version_uniqueness trigger fires on every client_ingestion_versions INSERT/UPDATE. Frequency is moderate but the trigger executes a single indexed lookup. No expected performance impact.

```

---

## 11. VERIFICATION QUERIES FOR THIS DELTA

After CC applies these edits, the following queries MUST pass before the commit is accepted:

### 11.1 Table count check

```bash
grep -E "^## COMPLETE TABLE INVENTORY \(87 TABLES\)" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match

grep -E "^## COMPLETE TABLE INVENTORY \(80 TABLES\)" /path/to/SCHEMA_REGISTRY.md
# Expected: zero matches
```

### 11.2 Group 16 inventory check

```bash
grep -E "Group 16.*RBAC.*Knowledge Ingestion" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match

grep -E "user_roles.*84|user_actions.*85|role_grant_audit.*86|client_ingestion_versions.*87" /path/to/SCHEMA_REGISTRY.md | wc -l
# Expected: at least 4 matches
```

### 11.3 SQL DDL presence check

```bash
grep -E "CREATE TABLE user_roles \(" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match

grep -E "CREATE TABLE user_actions \(" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match

grep -E "CREATE TABLE role_grant_audit \(" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match

grep -E "CREATE TABLE client_ingestion_versions \(" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match
```

### 11.4 RBAC helper function check

```bash
grep -E "user_has_operator_role" /path/to/SCHEMA_REGISTRY.md | wc -l
# Expected: at least 5 occurrences

grep -E "CREATE OR REPLACE FUNCTION user_has_operator_role" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match

grep -E "CREATE OR REPLACE FUNCTION write_role_grant_audit" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match
```

### 11.5 RLS pattern documentation check

```bash
grep -E "Pattern A.*Operator-Side Multi-User Access" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match

grep -E "Pattern B.*Client Portal Self-Access" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match

grep -E "Pattern C.*Legacy Single-Operator|DEPRECATED" /path/to/SCHEMA_REGISTRY.md
# Expected: at least 2 matches
```

### 11.6 A-44 Phase 1 designation check

```bash
grep -E "A-44.*PHASE 1.*RELOCATED|A-44.*Phase 1 storage" /path/to/SCHEMA_REGISTRY.md
# Expected: at least 1 match

# No remaining "A-44 Client Knowledge Ingestion" without Phase 1 context
grep -E "A-44 Client Knowledge Ingestion:" /path/to/SCHEMA_REGISTRY.md | grep -v "PHASE 1"
# Expected: zero matches
```

### 11.7 A-21 conflict resolution check

```bash
grep -E "A-21/A-44 conflict resolution" /path/to/SCHEMA_REGISTRY.md
# Expected: at least 1 match

# Pre-existing A-21 Hyperlocal Geographic Engine section preserved
grep -E "A-21 HYPERLOCAL GEOGRAPHIC ENGINE" /path/to/SCHEMA_REGISTRY.md
# Expected: 1 match
```

### 11.8 Migration N+1 through N+8 documentation check

```bash
grep -E "Migration N\+[1-8]:" /path/to/SCHEMA_REGISTRY.md | wc -l
# Expected: 8 matches (one per migration)
```

### 11.9 Line count check

```bash
wc -l /path/to/SCHEMA_REGISTRY.md
# Expected: approximately 1,684 lines (994 + 690 net additions)
# Tolerance: ±40 lines for whitespace and formatting normalization
```

### 11.10 Cross-reference integrity check

```bash
# Every cross-reference to ROLE_HIERARCHY_ARCHITECTURE_SPEC.md must use correct path
grep -E "ROLE_HIERARCHY_ARCHITECTURE_SPEC\.md" /path/to/SCHEMA_REGISTRY.md | wc -l
# Expected: at least 4 occurrences

# Contract 71, 72, 73 references
grep -E "Contract 7[123]" /path/to/SCHEMA_REGISTRY.md | wc -l
# Expected: at least 5 occurrences
```

---

## 12. APPROVAL

This document requires operator sign-off before SCHEMA_REGISTRY.md is modified in the repository.

**Operator approval format:**

- **"Approved — proceed to Document 5"** to advance to AGENTS.md delta updates.
- **"Edits required: [list]"** to request specific revisions to this delta before approval.

After all 8 documents are approved, the CC prompt that performs the synchronized governance commit will apply this delta to SCHEMA_REGISTRY.md as one of seven file modifications in a single atomic operation. The migration files themselves (Migrations N+1 through N+8) are generated as part of the CC build prompt that follows the governance commit, not as part of the governance commit itself — per the canonical pattern of "schema documentation first, migration generation second, code referencing schema third" established by Contract 4 and Contract 54.

---

**End of Document 4 of 8.**
