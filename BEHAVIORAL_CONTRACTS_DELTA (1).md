# TARRITRIX 1.0 — BEHAVIORAL_CONTRACTS.md DELTA SPECIFICATION

**Document ID:** BEHAVIORAL_CONTRACTS_DELTA
**Version:** 1.0
**Status:** DRAFT — Pending operator approval
**Authored:** 2026-05-23
**Author:** Lead Architect (Claude, acting on operator authorization)
**Operator:** Reid Whitesides
**Scope:** Surgical edits to `BEHAVIORAL_CONTRACTS.md` to add three new contracts (71, 72, 73) and amend Contract 67 to incorporate role-based ownership semantics. All edits derive from the canonical lock in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` (Document 1) and are consistent with deltas in Documents 2 through 5.

**This document is Document 6 of 8 in the governance synchronization series.** BEHAVIORAL_CONTRACTS.md is the enforcement layer. Every contract here corresponds to either DB-level constraints, CI verification scripts, or runtime checks. The contracts added here become the regulatory framework for every line of Phase 1 RBAC + A-44 code.

**Source file state at time of authoring:** `/mnt/project/BEHAVIORAL_CONTRACTS.md`, 1,458 lines, highest existing contract number = 70, last modified per project upload timestamp 2026-05-23 17:32.

**Read every diff before approving.**

---

## 1. SUMMARY OF CHANGES

This delta makes the following changes to BEHAVIORAL_CONTRACTS.md:

| # | Type | Location | Purpose |
|---|---|---|---|
| 1 | REPLACE | Lines 1182–1244 (Contract 67 full text) | Amend Contract 67 to incorporate role-based ownership semantics while preserving the original ownership-check rule as a defense-in-depth layer |
| 2 | INSERT | After line 1457 (end of Contract 70, before final blank line) | Add Contract 71 — Role-Based Access Control (RBAC) Enforcement |
| 3 | INSERT | After Contract 71 (newly added) | Add Contract 72 — Multi-User Audit Attribution |
| 4 | INSERT | After Contract 72 (newly added) | Add Contract 73 — Pre-Generation Knowledge Ingestion Requirement |

**Net effect on BEHAVIORAL_CONTRACTS.md:**
- Lines deleted: approximately 63 (Contract 67 original text being replaced with amended text)
- Lines added: approximately 670 (Contract 67 amended ~140 lines, Contracts 71/72/73 ~530 lines combined)
- Net line delta: +607 lines, ending file at ~2,065 lines

**Zero changes to:**
- Header and contract numbering preamble
- Contracts 1 through 66 (all existing contracts before 67)
- Contract 68 (which appears to be RESERVED based on the numbering gap — verified below)
- Contract 69 (INSERT Error Capture Required) — preserved unchanged
- Contract 70 (Operator Endpoint Auth Helper Requirement) — preserved unchanged

**Contract numbering integrity check (verified against source file):**

Existing contract numbers: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 38, 39, 40 (RESERVED), 41, 42 (RESERVED), 43 (RESERVED), 44 (RESERVED), 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 66, 67, 69, 70.

**Numbering gap analysis:** Contracts 31–37, 65, 68 do not appear in the source file. They may be RESERVED slots from earlier governance sessions or genuine numbering gaps. Adding new contracts as 71, 72, 73 is correct because 70 is the highest existing number and there is no risk of collision regardless of whether the lower-numbered gaps are RESERVED or absent.

---

## 2. CHANGE 1: Amend Contract 67 — Resource Ownership Verification

### 2.1 Context

Contract 67 (lines 1182–1244) currently enforces "operator owns client" via `clients.operator_id = userId` pattern. Under multi-user RBAC, this pattern is necessary but not sufficient — master_admin and senior_admin users must be able to access ALL clients (cross-tenant operator view), not just clients they happen to own via `operator_id`. VAs must be able to access all clients within their permitted action scope.

Per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 8.4, Contract 67 is **amended rather than replaced**. The original rule is preserved as a defense-in-depth layer for routes that still use the legacy pattern. The amendment adds role-based ownership semantics as the new canonical pattern.

### 2.2 Lines being replaced

Lines 1182 through 1244 (the entire Contract 67 block from heading through "Override:" line) are replaced with:

### 2.3 Replacement content

```
## Contract 67: Resource Ownership Verification (AMENDED 2026-05-23)

**Established:** 2026-05-21
**Amended:** 2026-05-23 (RBAC architecture lock per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md)

**Original rule (preserved as defense-in-depth):**

All operator API routes that accept resource identifiers (client_id, page_id, etc.) in URL parameters MUST verify the authenticated user has access to the resource before allowing access or modification.

**Amendment (2026-05-23):**

Under multi-user RBAC (Contract 71), "ownership" is expanded to mean: the authenticated user holds an active role (master_admin, senior_admin, or va) that, per the canonical permission matrix in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` Section 3, permits the requested action against the specified client. The role-permission check supersedes the legacy `operator_id = userId` ownership check for routes governed by Contract 71.

For routes that have not yet been refactored to use Contract 71 helpers, the legacy pattern remains in force as a fallback enforcement layer.

**Canonical Enforcement Pattern (Post-Amendment):**

For all NEW operator-side routes and all routes refactored after 2026-05-23, use the layered pattern:

```typescript
import { getOperatorContext } from '@/lib/auth/operator-context'; // Contract 70
import { getUserActiveRole, hasPermission } from '@/lib/auth/role-context'; // Contract 71

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  // Contract 70: Auth verification
  const { userId, supabase } = await getOperatorContext(request);

  // Contract 71: Role lookup
  const userRole = await getUserActiveRole(supabase, userId);
  if (!userRole) {
    return NextResponse.json({ error: 'No active role' }, { status: 403 });
  }

  // Contract 71: Permission check against canonical matrix
  const action = 'approve_flagged_page'; // action identifier from permission-matrix.ts
  if (!hasPermission(userRole, action)) {
    await logDeniedAction(supabase, userId, userRole, action, params.id);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Contract 67 (amended): Resource access verified by role + permission check above.
  // For master_admin and senior_admin, role grants cross-tenant operator access.
  // For va, permission matrix gates specific actions per the action argument.
  // Legacy operator_id check is NOT required when Contract 71 pattern is used.

  // Execute action
  ...

  // Contract 72: Audit log
  await supabase.from('user_actions').insert({
    acting_user_id: userId,
    acting_user_role: userRole,
    client_id: params.id,
    action_type: action,
    result: 'success',
    justification: request.justification,
    metadata: { ... }
  });
}
```

**Legacy Enforcement Pattern (Defense-in-Depth — Preserved):**

For routes not yet refactored to use Contract 71 helpers (existing routes from before the 2026-05-23 synchronization), the original Contract 67 pattern remains in force:

```typescript
// Contract 67: Verify resource ownership - operator must own this client
const { data: ownershipCheck } = await supabase
  .from('clients')
  .select('id')
  .eq('id', clientId)
  .eq('operator_id', user.id)
  .maybeSingle()

if (!ownershipCheck) {
  logger.warn('Forbidden - operator does not own client', {
    operator_id: user.id,
    client_id: clientId
  })
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

**Migration Status (as of 2026-05-23):**

Routes already refactored to use Contract 71 pattern (after the RBAC build completes Migration N+1 through N+8):
- All new routes added in the Phase 1 RBAC + A-44 build
- Existing operator routes are migrated one at a time during the Phase 1 RBAC build per the build sequence in MASTER_BUILD_SPEC.md Section 25

Routes still using legacy operator_id pattern (defense-in-depth fallback):
- All routes refactored under the original Contract 67 (2026-05-21):
  - /api/operator/clients/[id] (GET, PUT)
  - /api/operator/clients/[id]/pages/[pageId] (GET)
  - /api/operator/clients/[id]/flagged (GET)
  - /api/operator/clients/[id]/flagged/[pageId]/approve (POST)
  - /api/operator/clients/[id]/flagged/[pageId]/reject (POST)
- /api/admin/google-calendar-auth (GET) — operator auth + state generation
- /api/admin/google-calendar-auth/callback (GET) — state validation

These routes are scheduled for migration to the Contract 71 pattern during the Phase 1 RBAC build. The legacy pattern remains functional during the migration window because the existing master_admin account (auto-promoted from operator@tarritrix.test) still has its UUID populated in `clients.operator_id` for E4 Construction & Roofing. The legacy pattern works for the master_admin but not for senior_admin or VA users — which is why migration to Contract 71 pattern is required for full multi-user functionality.

**For Nested Resources:**

For routes with nested resources (pages belonging to clients), the verification chain is:
1. Contract 71 permission check for the action on the parent resource (client)
2. Verify the nested resource (page_id) belongs to the specified client via:
   ```typescript
   const { data: pageCheck } = await supabase
     .from('pages')
     .select('id')
     .eq('id', pageId)
     .eq('client_id', clientId)
     .maybeSingle();
   if (!pageCheck) return 404;
   ```

Both checks are mandatory regardless of role. Nested-resource verification prevents URL manipulation attacks where a valid client_id is paired with a page_id belonging to a different client.

**OAuth State Parameter Validation (UNCHANGED from 2026-05-21):**

OAuth flows (e.g., Google Calendar authorization, future Google Search Console authorization, future GBP authorization) MUST implement CSRF protection via state parameter:

1. **Initiation route:** Generate cryptographically random state token (crypto.randomBytes(32)), store in oauth_state_tokens table with user_id and 10-minute expiry
2. **Callback route:** Validate state parameter exists, not expired, not previously used; mark as used; associate tokens with user_id from state lookup (not from callback session)
3. **One-time-use enforcement:** State tokens marked used_at on first use, rejected on subsequent attempts

**Database Schema (oauth_state_tokens):**

Table `oauth_state_tokens`:
- state_token TEXT UNIQUE (cryptographically random)
- user_id UUID (operator initiating OAuth)
- expires_at TIMESTAMPTZ (10-minute TTL)
- used_at TIMESTAMPTZ (one-time-use marker)
- RLS enabled with operator-side role read access (per Pattern A from SCHEMA_REGISTRY.md RLS Verification section)

**Incident driving this contract (2026-05-21, preserved):**

2026-05-21 security audit revealed operator routes verified role (operator vs client) but not resource ownership. Operator A could access Operator B's clients/pages by manipulating URL parameters. OAuth routes lacked CSRF protection entirely.

**Amendment driver (2026-05-23):**

Multi-user RBAC architecture lock per operator decision 2026-05-23. The original 2026-05-21 ownership check was correct for the single-operator architecture in force at that time. Under multi-user, the same check is over-restrictive (denies senior_admin and VA access that the canonical permission matrix grants) and under-protective (the `operator_id = userId` check assumed one operator per client which no longer holds). Contract 71 layered over Contract 67 closes both gaps.

**Scope:** All operator-side API routes (`/api/operator/*`, `/api/admin/*`, `/api/agents/*` operator triggers). All OAuth flows.

**Override:** No override permitted. Missing ownership check + role check = immediate security vulnerability.
```

### 2.4 Why we preserve the legacy pattern rather than mass-refactoring

A complete refactor of all 7+ existing operator routes from legacy Contract 67 pattern to Contract 71 pattern would be a substantial code change touching every protected route. The Phase 1 RBAC build handles this refactor route-by-route during the Phase 1 RBAC + A-44 build (per MASTER_BUILD_SPEC.md Section 25 build sequence). Until that refactor completes, the legacy pattern remains functional for the master_admin account (which has its UUID populated in `clients.operator_id` for E4). The legacy pattern is gradually retired as each route is refactored.

This is a deliberate engineering trade-off: shipping the governance lock first (this synchronization), then refactoring routes incrementally with full Playwright E2E coverage per route, is safer than a single mass-refactor commit that touches all 7+ routes simultaneously. Contract 50 (Architectural Decision Durability) governs this trade-off.

---

## 3. CHANGE 2: Add Contract 71 — Role-Based Access Control (RBAC) Enforcement

### 3.1 Context

Contract 71 is the foundational enforcement contract for the multi-user role hierarchy. Every protected operator-side route handler must invoke the canonical permission check helper before executing any action. Direct role checks (e.g., `if (user.role === 'master_admin')`) bypass the canonical permission matrix and are prohibited.

### 3.2 Insertion location

Insert at the end of the file, after line 1457 (the line that reads `**Override:** No override permitted. Using anon client in operator routes = silent query failures.`). The new content is appended to the existing contract list.

### 3.3 Content to insert

```

---

## Contract 71: Role-Based Access Control (RBAC) Enforcement

**Established:** 2026-05-23
**Status:** ACTIVE upon governance commit

**Scope:** All operator-side API routes (`/api/operator/*`, `/api/admin/*`, `/api/agents/*` operator triggers). All dashboard server actions. All operator-facing UI components that conditionally render action affordances.

**Rule:** Every protected action MUST perform an explicit role-and-permission check via the canonical helper `hasPermission(role, action)` from `src/lib/auth/role-context.ts` BEFORE executing the action. Direct role checks inline in route handlers (e.g., `if (user.role === 'master_admin')`, `if (getRole(...) === 'va')`) are prohibited — the canonical permission matrix in `src/lib/auth/permission-matrix.ts` is the only source of truth for role-based access decisions.

**Required Pattern:**

```typescript
import { getOperatorContext } from '@/lib/auth/operator-context'; // Contract 70
import { getUserActiveRole, hasPermission, logDeniedAction } from '@/lib/auth/role-context';

export async function POST(request: NextRequest, ...) {
  // Step 1: Contract 70 — auth verification
  const { userId, supabase } = await getOperatorContext(request);

  // Step 2: Role lookup — query user_roles fresh, do not cache
  const userRole = await getUserActiveRole(supabase, userId);
  if (!userRole) {
    return NextResponse.json({ error: 'No active role' }, { status: 403 });
  }

  // Step 3: Permission check against canonical matrix
  const action = 'approve_flagged_page'; // ActionType identifier
  if (!hasPermission(userRole, action)) {
    await logDeniedAction(supabase, {
      acting_user_id: userId,
      acting_user_role: userRole,
      client_id: clientId,
      action_type: action,
      result: 'denied_permission',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Step 4: Execute action
  // ...

  // Step 5: Contract 72 — log success to user_actions
}
```

**Canonical Permission Matrix:**

The full permission matrix is documented in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` Section 3 (the human-readable authoritative source) and encoded in `src/lib/auth/permission-matrix.ts` (the runtime check source). A verification script (`scripts/verify-permission-matrix-sync.ts`) ensures the two stay synchronized.

**Permission Matrix Add/Remove Protocol:**

Adding a new protected action to the system requires:

1. Add a new entry to `PERMISSION_MATRIX` in `src/lib/auth/permission-matrix.ts` with the three role permissions
2. Add the corresponding row to the matrix in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` Section 3
3. Update `BLUEPRINT.md` Section 8.6.5 if the action surfaces in the Operator Command Center
4. Both updates must occur in the same commit per Contract 52 (Governance-Update Atomicity)
5. `scripts/verify-permission-matrix-sync.ts` validates synchronization

Removing an action follows the inverse protocol with the same atomicity requirement.

**Three Roles:**

- `master_admin` — platform owner, top of hierarchy
- `senior_admin` — trusted operational manager
- `va` — virtual assistant

Plus the existing `client` role for client portal users (governed by separate authentication flow per MASTER_BUILD_SPEC.md Section 6).

**Constitutional Constraints (Cannot Be Overridden by Any Role):**

The canonical permission matrix grants action permissions to roles, but several existing contracts establish constitutional constraints that no role can override:

- Contract 6 (TCPA Immutability) — DB-trigger-enforced. No role has an application-layer bypass path. Database physically rejects mutation attempts.
- Contract 9 hard gates (V9 schema validation, V10 TCPA gate, V13 similarity gate) — Permanently non-overridable per Contract 9 declaration. No role can force-publish a page failing these gates.
- Contract 18 (Evidence Authenticity HARD) — Expired credentials must not display. No override path for any role.
- Contract 45 (Review Authenticity HARD) — Review content must not be synthesized. No override path for any role.

These constraints are enforced at the database layer (Contract 6 trigger), application layer (Contracts 9, 18, 45 hard checks), or both, regardless of which role attempts the action.

**Enforcement Mechanisms:**

**Layer 1 (Pre-commit Hook):**
- Script: `scripts/verify-rbac-pattern.ts` called from `.husky/pre-commit`
- Detection: Grep for patterns `user.role ===`, `getRole(`, or role-string literal comparisons in `src/app/api/operator/`, `src/app/api/admin/`, `src/app/api/agents/`
- Action: BLOCK commit on violation. Report file:line locations and instruct using `hasPermission()` instead.

**Layer 2 (CI Verification):**
- Script: `scripts/verify-rbac-pattern.ts` runs in `pnpm verify:ci`
- Detection: Same as Layer 1
- Action: BLOCK build on violation

**Layer 3 (Runtime Audit):**
- Every `hasPermission()` failure produces a `user_actions` row with `result='denied_permission'`
- Daily report queries user_actions for spike detection per acting user (e.g., one user accumulating 50+ denied attempts in 24 hours)
- Spikes trigger a P1 advisory signal indicating potential privilege escalation attempts
- Signal payload includes acting_user_id, acting_user_role, count of denials, list of attempted action_types

**Layer 4 (Permission Matrix Sync):**
- Script: `scripts/verify-permission-matrix-sync.ts` runs in `pnpm verify:ci`
- Detection: Compares the TypeScript `PERMISSION_MATRIX` constant against the table in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` Section 3
- Action: BLOCK build if any action appears in one but not the other, or if the role permissions differ between the two

**Protected Action Inventory:**

Per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3, the initial permission matrix covers 45+ protected actions across 9 categories:

- Client management actions (Section 3.1)
- Page lifecycle actions (Section 3.2)
- Agent / automation actions (Section 3.3)
- Cost / billing actions (Section 3.4)
- Signal / alert actions (Section 3.5)
- Evidence / asset actions (Section 3.6)
- Directory & backlink actions (Section 3.7)
- Role / user management actions (Section 3.8)
- Audit / compliance actions (Section 3.9)

The inventory grows as new agents and surfaces ship. Every addition follows the Add/Remove Protocol above.

**Scope:** All protected operations across the platform. Read operations (GET requests) where the role permits broad reading (e.g., master_admin and senior_admin can read all clients) do not require a per-action hasPermission check — operator-side role membership via `user_has_operator_role(uid)` RLS suffices. Write operations and side-effect-producing operations (cost-bearing agent triggers, signal dismissals, role grants, etc.) always require hasPermission check.

**Override:** No override permitted. Direct role checks bypass the canonical matrix and are blocked at pre-commit. Architectural changes to the role taxonomy or permission scoping require an amendment to this contract via the same governance synchronization pattern that established it.

---
```

---

## 4. CHANGE 3: Add Contract 72 — Multi-User Audit Attribution

### 4.1 Context

Contract 72 establishes the canonical audit attribution requirement for the multi-user environment. Every audit-logged action captures three attributes that together produce a complete compliance trail: who acted, what role they held at the time, and which client (if applicable) the action was for.

### 4.2 Insertion location

Insert immediately after the end of Contract 71 (the `---` separator at the end of Section 3.3 content above).

### 4.3 Content to insert

```

## Contract 72: Multi-User Audit Attribution

**Established:** 2026-05-23
**Status:** ACTIVE upon governance commit

**Scope:** All audit-logged actions across the platform. Includes the `user_actions` table (canonical for new writes), `operator_actions` table (legacy, no new writes), `role_grant_audit` table (role grant events), `page_decisions` table (A-05 audit), and any future audit-logging tables.

**Rule:** Every audit log row MUST capture three attribution attributes:

1. **Acting user ID** (`acting_user_id` or equivalent column) — the authenticated user who initiated the action. UUID, NOT NULL, FK to `auth.users(id)`.
2. **Role at time of action** (`acting_user_role` or equivalent column) — the active role of that user at the moment the action was executed. Captured by querying `user_roles` fresh at action execution time, NOT relying on request-cached role state. TEXT, NOT NULL, CHECK IN the canonical role enum.
3. **Client context** (`client_id`) — the tenant the action was for. UUID, FK to `clients(id)`. Nullable ONLY for platform-level actions (e.g., role grants, platform configuration changes, cross-tenant administrative operations).

**Why "role at time of action" not "current role":**

User roles change over time. A user might be senior_admin in May 2026, demoted to VA in August 2026, and back to senior_admin in October 2026. An audit trail that records only the current role at query time would falsely attribute earlier actions to the wrong role.

Compliance audits, DSAR responses, and security investigations require knowing the role the user held WHEN THE ACTION WAS PERFORMED. This is captured by inserting the role into the audit row at write time, then never mutating it.

**Required Pattern:**

```typescript
// At action handler entry, perform fresh role query (not cached)
const userId = headers.get('x-user-id');
const userRole = await getUserActiveRole(supabase, userId);

// At action handler exit (whether success, denial, or failure)
await supabase.from('user_actions').insert({
  acting_user_id: userId,
  acting_user_role: userRole, // The role at action time, not request-cached
  client_id: clientId, // Or null for platform-level actions
  action_type: 'approve_flagged_page',
  action_target_type: 'page',
  action_target_id: pageId,
  justification: requestBody.justification, // Required for override actions
  result: result.success ? 'success' : 'failed',
  metadata: { 
    page_quality_score: 78, 
    flagged_gates: ['G3', 'G7a'],
    // ... action-specific context
  }
});
```

**Result Enum:**

The `result` column captures the outcome of the action attempt:

- `'success'` — action completed successfully
- `'denied_permission'` — Contract 71 permission check failed (role lacks permission for this action)
- `'denied_constraint'` — Contract 6 / 9 / 18 / 45 constitutional constraint blocked the action even though the role had permission
- `'failed'` — action attempted but encountered application error (database failure, network timeout, third-party API error, etc.)

Denied attempts (both `'denied_permission'` and `'denied_constraint'`) produce audit rows. This means privilege escalation attempts and constitutional override attempts both leave traces. Daily reports query for spikes per user.

**Immutability:**

`user_actions` table has NO `UPDATE` policy and NO `DELETE` policy. Audit rows are append-only. Once written, they cannot be modified. This preserves the historical accuracy of the audit trail even if the acting user's role changes later or the client record is later modified.

**Justification Requirement:**

Override actions require a justification field per Contract 72:

- Force-publish a flagged page (Contract 9 soft-gate override)
- Dismiss a P0 signal (rare; senior_admin path with master_admin review within 24 hours)
- Increase per-client or platform LLM cost cap
- Grant or revoke any role
- A-44 manual asset provision (Contract 73 master_admin override)
- A-44 ingestion block toggle (master_admin only)

Justification is captured as a TEXT field in user_actions. Application code enforces presence via `requireJustification: true` on the action handler. Missing justification on a required-justification action is logged as `result='failed'` with error reason and does not execute the action.

**Enforcement Mechanisms:**

**Layer 1 (Pre-commit Hook):**
- Script: `scripts/verify-audit-attribution.ts` called from `.husky/pre-commit`
- Detection: Grep for `user_actions` table INSERT statements and verify presence of all three required attribution columns
- Action: BLOCK commit on violation. Report file:line locations and the missing column(s).

**Layer 2 (CI Verification):**
- Script: `scripts/verify-audit-attribution.ts` runs in `pnpm verify:ci`
- Detection: Same as Layer 1, plus AST-based check for `from('user_actions').insert(...)` calls missing any of acting_user_id, acting_user_role, or required action_type
- Action: BLOCK build on violation

**Layer 3 (Database Constraints):**
- `user_actions.acting_user_id` NOT NULL constraint
- `user_actions.acting_user_role` NOT NULL constraint + CHECK constraint on enum values
- `user_actions.action_type` NOT NULL constraint
- Database rejects any INSERT missing these columns regardless of application-layer code

**Layer 4 (Append-Only Enforcement):**
- No UPDATE or DELETE policy exists on user_actions
- Service role cannot mutate existing rows (no policy granting UPDATE/DELETE)
- Audit row integrity preserved by database design, not application discipline

**Role Capture Freshness:**

Application code MUST NOT cache the role across request boundaries. Each route handler must query `user_roles` at the start of request processing. The reason: a user's role could be revoked between requests, and an action executed against a revoked role must be logged with the role at action time (which would be the revoked role's value), then the action denied at the permission check. Caching role data across requests defeats this protection.

The role lookup is a single indexed query against `user_roles WHERE user_id = ? AND revoked_at IS NULL`. Performance cost is minimal (~1 ms per request).

**Compliance Use Cases:**

DSAR (Data Subject Access Request) responses can answer "who accessed my data and when" by querying user_actions filtered by client_id. The role attribution clarifies whether the access was by master_admin (platform owner), senior_admin (trusted manager), or va (virtual assistant) — material distinction for the data subject.

Security audits can detect anomalies (a VA suddenly attempting privileged actions, a senior_admin operating outside business hours, a master_admin granting roles unexpectedly) by querying user_actions filtered by role, time window, action category, or result.

Internal performance reviews can quantify worker effort (count of successful actions per user per period, weighted by action type complexity) using user_actions data.

**Scope:** All write operations across the platform that produce side effects on client data, financial state, or platform configuration. Read operations do not require user_actions logging (read patterns are captured in `session_logs` table if needed for compliance).

**Override:** No override permitted. Missing audit attribution = compliance failure that compounds over time. Database NOT NULL constraints provide final defense.

---
```

---

## 5. CHANGE 4: Add Contract 73 — Pre-Generation Knowledge Ingestion Requirement

### 5.1 Context

Contract 73 enforces A-44 Client Knowledge Ingestion Engine as a hard prerequisite for A-02 Page Generator execution. Pages generated without ingested brand voice produce generic AI-flavored output that fails Contract 61 (AEO/Voice/Conversion Discipline) and Contract 18 (Evidence Authenticity HARD).

### 5.2 Insertion location

Insert immediately after the end of Contract 72 (the `---` separator at the end of Section 4.3 content above).

### 5.3 Content to insert

```

## Contract 73: Pre-Generation Knowledge Ingestion Requirement

**Established:** 2026-05-23
**Status:** ACTIVE upon governance commit (enforcement live when A-44 ships)

**Scope:** A-02 Page Generator and any future agent that generates client-facing page content from LLM output (A-25 AEO Engine Suite, A-26 Schema/Structured Data Orchestration Engine, A-27 Voice Search Optimization Engine, A-46 Directory Registration Agent insofar as it produces directory-listing content from LLM output).

**Rule:** A-02 (and other agents in scope) MUST NOT execute for a specific client unless that client has a row in `client_ingestion_versions` where:
- `is_current = TRUE`
- `status = 'success'` OR `status = 'manually_provided'`
- `approval_status IN ('auto_approved', 'approved', 'manually_provided')`

The check happens at agent entry, BEFORE any LLM call. Pages cannot be generated without verified ingested brand context, certifications, manufacturer badges, NAP data, and voice model — all populated by A-44.

**Required Pattern (A-02 entry):**

```typescript
// Contract 73: Verify A-44 successful ingestion exists before generating pages
const { data: ingestionStatus, error } = await supabase
  .from('client_ingestion_versions')
  .select('id, status, approval_status, version_number')
  .eq('client_id', clientId)
  .eq('is_current', true)
  .maybeSingle();

if (error) {
  // Database error — treat as Contract 73 failure for safety
  throw new ContractViolationError(
    'A-02 blocked: Contract 73 check failed with database error. client_id: ' + clientId
  );
}

if (!ingestionStatus) {
  throw new ContractViolationError(
    'A-02 blocked: Contract 73 requires successful A-44 ingestion. No current ingestion version found for client_id: ' + clientId
  );
}

if (!['success', 'manually_provided'].includes(ingestionStatus.status)) {
  throw new ContractViolationError(
    'A-02 blocked: Contract 73 requires status IN (success, manually_provided). Current status: ' + ingestionStatus.status + ' for client_id: ' + clientId
  );
}

if (!['auto_approved', 'approved', 'manually_provided'].includes(ingestionStatus.approval_status)) {
  throw new ContractViolationError(
    'A-02 blocked: Contract 73 requires approval_status IN (auto_approved, approved, manually_provided). Current approval_status: ' + ingestionStatus.approval_status + ' for client_id: ' + clientId
  );
}

// Contract 73 satisfied — A-02 may proceed
```

**Why this contract exists:**

Pages generated by A-02 without ingested context produce:

1. **Generic AI-flavored content** lacking client brand voice — Contract 61 (AEO/Voice/Conversion Discipline) violation
2. **Hallucinated or placeholder trust signals** (missing manufacturer badges, fabricated certifications, generic testimonials) — Contract 18 (Evidence Authenticity HARD) violation
3. **Inconsistent NAP data** if A-02 attempts to generate contact information without verified data from A-44's NAP extraction — risk of inconsistent business listings across pages
4. **Missed keyword opportunities** — A-44 surfaces the keyword gap analysis used by A-25 (AEO Engine) for topic targeting; without it, generated pages target generic keywords with no relevance signal

Each of these failure modes represents a brand-damaging outcome. Contract 73 prevents the outcome by gating page generation on successful prerequisite ingestion.

**Three Refresh Triggers (Reference):**

A-44 supports three refresh triggers per BLUEPRINT.md Part 10.5:

1. **Onboarding (mandatory, blocking)** — Step 9 of onboarding wizard, automatic platform-executed
2. **Quarterly CRON (CRON-03 a44-quarterly-refresh)** — daily evaluation, ±7 day jitter
3. **Manual (master_admin or senior_admin)** — Force Re-scrape button on /dashboard/clients/[id] Tab 7

Contract 73 is satisfied if ANY of the three triggers has produced a successful current version for the client. The first successful onboarding scrape is the most common path. Quarterly scrapes maintain Contract 73 satisfaction over time. Manual scrapes are used for special cases.

**Override Path (Master_Admin Only):**

Contract 73 has exactly ONE override path: master_admin manual asset provision via the dashboard. This override is used when the client's website is genuinely unscrapable (down at onboarding, robots.txt blocks all crawlers, no public site exists, client explicitly requests no crawl).

Master_admin process:

1. Navigate to `/dashboard/clients/[id]` Tab 7 Knowledge Base
2. Click "Manual Asset Provision" button (master_admin only — VAs and senior_admins do not see this button)
3. Populate required justification field with reason
4. Upload brand voice descriptors, logo files, certification badges, NAP data via the form
5. Platform creates `client_ingestion_versions` row with `approval_status='manually_provided'`, `is_current=TRUE`, `status='manually_provided'`
6. Contract 73 is satisfied for this client; A-02 unblocked
7. Action logged to user_actions with `action_type='override_a44_prerequisite'` per Contract 72

The override is visible in the audit log to all master_admin and senior_admin users. Frequent use of the override (e.g., more than 10% of clients) triggers an architectural review — the override is intended for edge cases, not a routine workaround.

**Senior_Admin Cannot Override:**

Senior_admin can trigger A-44 Force Re-scrape (per the canonical permission matrix), but cannot perform manual asset provision. Reason: manual asset provision is platform-content-provenance-bypass — only the platform owner (master_admin) accepts responsibility for asserting that manually-provided assets are accurate and authorized for use.

**VA Cannot Override:**

VAs cannot trigger A-44 (any cost-bearing or platform-content-affecting operation is master/senior only per the permission matrix). VAs cannot perform manual asset provision under any circumstances.

**Backward Compatibility — Existing Seeded Clients:**

Existing seeded clients (E4 Construction & Roofing, Tarritrix, Architectural Flashing Supply if seeded, others) that were onboarded before A-44 shipped do not have a real A-44 ingestion version. Per Migration N+8 (`seed_a44_baseline_for_existing_clients.sql`), each existing client receives a synthetic baseline row with:

- `trigger_type = 'onboarding'`
- `status = 'success'`
- `approval_status = 'auto_approved'`
- `is_current = TRUE`
- `diff_summary = {synthetic_baseline: true, note: 'Pre-A-44 era client. Real scrape pending operator interaction.'}`

The synthetic baseline satisfies Contract 73 at the database constraint level, allowing A-02 to continue running for these clients. The `clients.ingestion_synthetic_baseline = TRUE` flag marks them for a real A-44 scrape at the next operator-touched interaction. The first time a master_admin or senior_admin opens the client's dashboard after A-44 ships, a P2 advisory signal recommends triggering a real A-44 scrape ("This client was onboarded before knowledge ingestion was available. Run scrape for accurate brand voice in future page generation.").

This is a deliberate engineering compromise: rather than blocking A-02 for all existing clients until each gets a real scrape (which would halt page generation), the synthetic baseline preserves continuity while flagging the work for catch-up.

**Enforcement Mechanisms:**

**Layer 1 (A-02 Entry Check):**
- A-02 entry point performs the prerequisite check before any LLM call
- Throws `ContractViolationError` on failure
- ContractViolationError is caught by the agent execution framework (B1 Base Agent Framework) and logged to agent_events with status='failed' and error_code='CONTRACT_73_VIOLATION'

**Layer 2 (Pre-commit Hook):**
- Script: `scripts/verify-contract-73-pattern.ts` called from `.husky/pre-commit`
- Detection: Grep for A-02 entry point file (`src/agents/a-02-page-generator/index.ts` or equivalent) and verify presence of the Contract 73 check pattern
- Action: BLOCK commit if A-02 entry lacks the prerequisite check

**Layer 3 (CI Verification):**
- Script: `scripts/verify-contract-73-pattern.ts` runs in `pnpm verify:ci`
- Detection: Same as Layer 1
- Action: BLOCK build on violation

**Layer 4 (Integration Test):**
- Playwright integration test `tests/integration/contract-73-a02-blocking.spec.ts` verifies:
  - A-02 trigger for a client WITHOUT successful A-44 ingestion returns 422 with error code 'CONTRACT_73_VIOLATION'
  - A-02 trigger for a client WITH successful A-44 ingestion proceeds normally
  - A-02 trigger for a client with synthetic baseline ingestion proceeds normally (backward compatibility)
  - A-02 trigger for a client with `status='failed'` ingestion is blocked
- Test runs in `pnpm verify:ci`

**Layer 5 (Runtime Telemetry):**
- Every Contract 73 violation produces an agent_events row with status='failed' and error_code='CONTRACT_73_VIOLATION'
- Daily report queries agent_events for spike detection
- Spikes (multiple violations for the same client in a short window) indicate the client's A-44 ingestion is broken — raise P1 advisory signal

**Scope:** A-02 Page Generator (primary), and any future content-generating agent that produces client-facing page output from LLM. A-03 Schema Generator, A-04 Map Embed Generator, A-06 Internal Linker, and A-07 Sitemap Generator do NOT fall under Contract 73 because their outputs are deterministic transformations of A-02 output, not LLM-generated content. They depend on A-02 successfully running first, which itself depends on A-44 via Contract 73.

**Override:** Master_admin only via manual asset provision path per Section "Override Path" above. No override at the A-02 layer.

---
```

---

## 6. NUMBERING INTEGRITY VERIFICATION

After this delta applies, the BEHAVIORAL_CONTRACTS.md contract numbering will be:

Existing: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 38 (note: gap 31–37), 39, 40 (RESERVED), 41, 42 (RESERVED), 43 (RESERVED), 44 (RESERVED), 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 66 (note: gap at 65), 67, 69 (note: gap at 68), 70.

After this delta: + 71, 72, 73 with no further gaps introduced.

The gaps (31–37, 65, 68) are inherited from prior governance sessions. This delta does not address them. If operator wishes to retire those gaps in a future session by adding RESERVED placeholders, that is a separate governance update.

---

## 7. VERIFICATION QUERIES FOR THIS DELTA

After CC applies these edits, the following queries MUST pass before the commit is accepted:

### 7.1 Contract count check

```bash
grep -E "^## Contract 7[123]:" /path/to/BEHAVIORAL_CONTRACTS.md | wc -l
# Expected: 3 matches (Contracts 71, 72, 73)
```

### 7.2 Contract 67 amendment check

```bash
grep -E "Contract 67.*AMENDED 2026-05-23" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: 1 match

grep -E "Amended:.*2026-05-23.*RBAC architecture lock" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: 1 match
```

### 7.3 Contract 71 content check

```bash
grep -E "^## Contract 71: Role-Based Access Control" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: 1 match

grep -E "scripts/verify-rbac-pattern\.ts" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: at least 2 occurrences (declaration + enforcement description)

grep -E "scripts/verify-permission-matrix-sync\.ts" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: at least 2 occurrences
```

### 7.4 Contract 72 content check

```bash
grep -E "^## Contract 72: Multi-User Audit Attribution" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: 1 match

grep -E "acting_user_id|acting_user_role|client_id" /path/to/BEHAVIORAL_CONTRACTS.md | wc -l
# Expected: at least 15 occurrences (across the Contract 72 spec and Contract 71 reference)

grep -E "scripts/verify-audit-attribution\.ts" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: at least 2 occurrences

grep -E "result.*denied_permission|denied_constraint" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: at least 3 occurrences
```

### 7.5 Contract 73 content check

```bash
grep -E "^## Contract 73: Pre-Generation Knowledge Ingestion Requirement" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: 1 match

grep -E "client_ingestion_versions" /path/to/BEHAVIORAL_CONTRACTS.md | wc -l
# Expected: at least 5 occurrences (Contract 73 references this table extensively)

grep -E "ContractViolationError.*A-02|CONTRACT_73_VIOLATION" /path/to/BEHAVIORAL_CONTRACTS.md | wc -l
# Expected: at least 3 occurrences

grep -E "scripts/verify-contract-73-pattern\.ts" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: at least 2 occurrences

grep -E "synthetic_baseline" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: at least 2 occurrences (Contract 73 backward compatibility section)
```

### 7.6 Master_admin override path check

```bash
grep -E "Master_Admin Only|master_admin manual asset provision|override_a44_prerequisite" /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: at least 4 occurrences across Contracts 72 and 73
```

### 7.7 Cross-reference integrity check

```bash
# Every reference to ROLE_HIERARCHY_ARCHITECTURE_SPEC.md must use correct path
grep -E "ROLE_HIERARCHY_ARCHITECTURE_SPEC\.md" /path/to/BEHAVIORAL_CONTRACTS.md | wc -l
# Expected: at least 4 occurrences (Contracts 67 amended, 71, 73 references)

# Every reference to permission-matrix.ts
grep -E "src/lib/auth/permission-matrix\.ts|src/lib/auth/role-context\.ts" /path/to/BEHAVIORAL_CONTRACTS.md | wc -l
# Expected: at least 4 occurrences
```

### 7.8 Constitutional constraints preserved

```bash
# Verify Contracts 6, 9, 18, 45 still referenced as constitutional constraints in Contract 71
grep -B2 -A1 "Constitutional Constraints" /path/to/BEHAVIORAL_CONTRACTS.md | grep -E "Contract 6|Contract 9|Contract 18|Contract 45"
# Expected: at least 4 matches
```

### 7.9 Defense-in-depth language

```bash
grep -E "defense-in-depth|defense in depth" /path/to/BEHAVIORAL_CONTRACTS.md | wc -l
# Expected: at least 3 occurrences (Contract 67 amendment, Contracts 71, 72 enforcement layers)
```

### 7.10 Line count check

```bash
wc -l /path/to/BEHAVIORAL_CONTRACTS.md
# Expected: approximately 2,065 lines (1,458 + 607 net additions)
# Tolerance: ±40 lines for whitespace and formatting normalization
```

### 7.11 Contract numbering integrity

```bash
# Confirm no duplicate contract numbers introduced
grep -E "^## Contract [0-9]+:|^### CONTRACT [0-9]+" /path/to/BEHAVIORAL_CONTRACTS.md | grep -oE "[0-9]+" | sort -n | uniq -d
# Expected: zero output (no duplicates)

# Confirm highest contract number is now 73
grep -E "^## Contract [0-9]+:|^### CONTRACT [0-9]+" /path/to/BEHAVIORAL_CONTRACTS.md | grep -oE "[0-9]+" | sort -n | tail -1
# Expected: 73
```

---

## 8. APPROVAL

This document requires operator sign-off before BEHAVIORAL_CONTRACTS.md is modified in the repository.

**Operator approval format:**

- **"Approved — proceed to Document 7"** to advance to STATE_OF_THE_BUILD.md delta updates.
- **"Edits required: [list]"** to request specific revisions to this delta before approval.

After all 8 documents are approved, the CC prompt that performs the synchronized governance commit will apply this delta to BEHAVIORAL_CONTRACTS.md as one of seven file modifications in a single atomic operation.

---

**End of Document 6 of 8.**
