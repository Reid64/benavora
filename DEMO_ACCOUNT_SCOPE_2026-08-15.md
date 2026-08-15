# Demo Account Scope Spec — FAITH Foundation (org `b1ab7402-dfc2-4712-869f-70ea3566cc1d`)
## Date: 2026-08-15 | Status: SPEC — implementation not yet built
## Purpose: define exactly what a demo login account may and may not write, so a
## demo can be given FULL functional navigability (trigger AutoApply, generate
## drafts, click every feature) against real FAITH Foundation production data,
## without any risk of corrupting that org's already-onboarded identity.

This document is the result of reading the *real, current* code (not docs, not
memory) for (1) the role/permission system and (2) every table/column the
onboarding flow actually writes. Both research passes are cited by file:line
below. This is the spec the next build prompt implements against — treat every
listed field/table as load-bearing; a missed one is a real data-corruption risk
against a live nonprofit's production account, not a toy-feature gap.

---

## 1. The real role/permission system, as it exists today

### 1.1 Roles that actually exist

- `profiles.role` — Postgres enum `user_role`: `'owner' | 'admin' | 'writer' | 'viewer'`.
  Defined `supabase/migrations/001_initial_schema.sql:22`, applied to `profiles` at
  line 139. Mirrored in `src/types/database.ts:5363` and re-declared client-safe at
  `src/lib/utils/constants.ts:70-83` as `USER_ROLES` / `ROLE_HIERARCHY`
  (`owner:4, admin:3, writer:2, viewer:1`).
- `platform_admins.platform_role` — a **completely separate** enum (`platform_owner
  | staff_admin | staff_support | staff_readonly`), `supabase/migrations/
  056_four_tier_admin_system.sql:5`. Unrelated to `profiles.role`. Not usable for
  this task — irrelevant to org-scoped demo access.
- No `'consultant'`, `'member'`, `'demo'`, or any other role value exists anywhere
  in the live schema or code. `src/supabase/migrations/` (the second migration
  track) defines no role enum at all.
- **No existing demo/restricted/read-only account concept anywhere.** Confirmed by
  grep across both migration tracks and all of `src/` for `is_demo`, `demo_mode`,
  `restricted`, `read_only` — zero real hits (only false positives: HTML `readOnly`
  attrs, TS `readonly` modifier, an unrelated test helper name, a query-string
  param). This has to be built from scratch.

### 1.2 How writes are actually gated today

- `hasRequiredRole(role, requiredRole)` (`src/lib/utils/constants.ts:86-92`) — pure
  rank comparison against `ROLE_HIERARCHY`. A **single linear ordering**: every
  check is "is my rank ≥ this required rank."
- `requireRole(requiredRole)` (`src/lib/auth/role-gate.ts`) — the dominant
  server-side API gate, used at 100+ `src/app/api/**` call sites. Queries
  `profiles.role` fresh on every call (no caching), returns a 403 `NextResponse`
  if the rank check fails.
- `canEdit()` / `canDeleteFunder()` (`src/lib/hooks/useProfile.ts:73-82`) and
  `canEditMember()` (`settings/page.tsx:536-541`) are **UI-rendering-only**
  convenience checks — not authoritative. The real barrier, when one exists, is
  the API route's own `requireRole()` call.
- **`middleware.ts` does zero role-based route gating.** It only authenticates,
  resolves `profiles.role`, injects `x-user-role`/`x-organization-id` headers, and
  redirects incomplete orgs to `/onboarding`. All role enforcement is delegated to
  individual routes/components downstream.
- **RLS is org-scoped only — never role-scoped — on every table checked.**
  `organizations`, `knowledge_base`, `board_members`, and
  `organizational_digital_twins` (RLS added late, migration
  `116_organizational_digital_twins_rls_hardening.sql`, after two earlier attempts
  in `093_digital_twins.sql` and `src/supabase/migrations/
  094_twin_powered_draft_generation.sql` never actually landed) all use the
  identical `organization_id = current_org_id()` pattern with **no role
  predicate**. Every org member, regardless of role, passes RLS on these tables.
  Role-gating is 100% an application-code responsibility where it exists at all.

### 1.3 A pre-existing gap this spec must not inherit

**`POST /api/onboarding`, `/api/onboarding/complete-setup`, and
`/api/onboarding/generate-narratives` — the routes that write `organizations`'
core profile fields — have `requireRole()` gate at all today.** They only check
that `x-organization-id`/`x-user-id` headers are present. Since RLS on
`organizations` is org-scoped only, **any authenticated member of an org,
including a `viewer`, can currently rewrite that org's name/EIN/mission
statement/etc. via these routes** — a real bug independent of this task, but one
this spec's protection must not silently assume is already closed. (Contrast:
the sibling `PATCH /api/knowledge-base`, which writes overlapping `organizations`
columns, correctly requires `"writer"` — the onboarding routes are the outlier.)

**Also found, adjacent but out of scope to fix here:** `/api/admin/orgs/*`
(platform-admin surface) gates on `requireRole("owner")` — i.e. *any org's own
owner* — not on `platform_admins`/`platform_role` membership, and uses a
service-role client with no org filter. This means today, any org-owner can hit
cross-tenant admin routes for *other* orgs' ids. Confirms and independently
re-verifies existing memory `benavora-platform-admin-vs-platform-admins-table`.
**Implication for this spec: do not grant the demo account `role='owner'`** — that
would hand it the same broken cross-tenant admin surface as a side effect,
completely outside this task's intent. Recommended role: `'writer'` (§3).

---

## 2. "Onboarding information" — the real, exhaustive write scope

Source: full read of `src/app/(dashboard)/onboarding/page.tsx`,
`src/app/api/onboarding/route.ts`, `src/app/api/onboarding/complete-setup/
route.ts`, `src/lib/intelligence/digital-twin-builder.ts`,
`src/lib/intelligence/twin-auto-populate.ts`, `src/app/api/knowledge-base/
route.ts`, `src/lib/knowledge-base/profile.ts`, `src/app/(dashboard)/
knowledge-base/edit/page.tsx`, `src/app/(dashboard)/settings/page.tsx`, and the
shared `src/components/documents/DocumentUploader.tsx`. (A second, dead
"BLUEPRINT" onboarding system — `src/components/onboarding/OnboardingWizard.tsx`,
`src/lib/onboarding.ts` — is imported nowhere and is not part of the live flow;
ignored below.)

**Critical finding: onboarding is fully re-enterable after completion.**
`middleware.ts` only redirects *incomplete* orgs *to* `/onboarding` — nothing
blocks a completed org from returning. `Settings → Organization Setup`
(`settings/organization-setup/page.tsx:173-180`) surfaces a one-click "Review"
deep link (`/onboarding?step=N`) for every step once `onboarding_completed` is
true, and every step's "Save & Continue" still POSTs to the same live-writing
route. **Blocking only the first-run wizard would not protect anything** — the
identical write surface is reachable at any time for a "completed" org.

### 2.1 `organizations` — protected columns

Written by onboarding step 1/7 (`api/onboarding/route.ts:199-211, 468-496`),
**and** by the overlapping `PATCH /api/knowledge-base` path (`knowledge-base/
route.ts:232-247`, field set from `src/lib/knowledge-base/profile.ts:161-175`,
exposed via the Knowledge Base Editor `knowledge-base/edit/page.tsx`), **and** by
`autoPopulateTwin()` (`twin-auto-populate.ts:311-315`), **and** by a direct
client-side write from `settings/page.tsx:335-338` (see §2.7 — this one bypasses
API routes entirely).

| Column | Written by |
|---|---|
| `name` | onboarding step 1; Settings → Organization (direct client write) |
| `ein` | onboarding step 1; KB Editor |
| `tax_status` | onboarding step 1; KB Editor |
| `mission_statement` | onboarding step 1; KB Editor |
| `vision_statement` | KB Editor |
| `founding_date` | KB Editor |
| `founder_name` | KB Editor |
| `founder_bio` | KB Editor |
| `service_area` | onboarding step 1; KB Editor |
| `target_population` | onboarding step 1; KB Editor |
| `annual_budget` | KB Editor; `autoPopulateTwin()` |
| `total_staff` | KB Editor |
| `total_volunteers` | KB Editor |
| `extended_profile` (jsonb) | KB Editor |
| `onboarding_step` | onboarding steps 1-7 |
| `onboarding_progress` | onboarding steps 1-7 |
| `onboarding_completed` | onboarding step 7 / skip shortcut |
| `onboarding_completed_at` | onboarding step 7 |

**Not found to be written by onboarding or the KB Editor in this research** (and
therefore **not** in the protected list — treat as ordinary Settings fields the
demo may edit, e.g. branding): `logo_url`, `primary_color`, `secondary_color`,
`accent_color` (all written only by Settings → Branding), plus any
`address_line*/city/state/zip/phone/website/dba` columns present in the schema —
none of these appeared in either agent's trace of actual writes. If a later audit
finds a write path to these that this research missed, add them to the protected
list before shipping.

### 2.2 `programs` — full protection recommended

Onboarding step 2 inserts `organization_id, name, description, budget,
beneficiaries_served, status` (idempotent by name, `route.ts:216-253`). Also
fully CRUD'd by the KB Editor's `ProgramsSection` (`knowledge-base/edit/
page.tsx:1195-1246`, adds `impact_metrics`). No separate "operational" pathway
exists for programs outside onboarding/KB-editing — this is roster data, not a
day-to-day feature surface. **Recommend: block INSERT/UPDATE/DELETE entirely**
for a restricted profile.

### 2.3 `knowledge_base` — full protection recommended

Onboarding step 3 inserts org-profile rows (`organization_id, category, title,
content, keywords, created_by`, `route.ts:255-330`); step 4 adds a synthesized
`capacity`-category "Board Leadership & Governance" entry. The exact set of
`category` enum values onboarding uses was not fully enumerated by this research
pass (verify against `knowledge_base_category`'s 11 values at implementation
time if a category-scoped block is attempted instead — see below). Also written
by the KB Editor's narrative/answer pages, and read (not written) by
`buildDigitalTwin()`.

This table also holds `is_proven` narrative content that live draft generation
depends on (`src/lib/drafts/generator.ts`) — a demo corrupting or deleting a
proven, production-tested narrative block is exactly the kind of failure this
task exists to prevent. A category-based split (protect only onboarding-created
categories, allow the rest) is possible but adds real complexity for uncertain
benefit, since the category list isn't fully confirmed. **Recommend: block
INSERT/UPDATE/DELETE entirely** for a restricted profile — the demo does not
need to author new knowledge-base content to demonstrate AutoApply/draft
generation, which only *read* this table.

### 2.4 `board_members` — full protection recommended

Onboarding step 4 inserts `organization_id, name, title, bio, email,
is_active` (idempotent by name, `route.ts:332-360`). Also CRUD'd by the KB
Editor's `LeadershipSection` (`name, title, bio, is_active` — no `email` field
exposed there, so `email` is onboarding/`autoPopulateTwin`-only), and inserted by
`autoPopulateTwin()` from IRS BMF/web-search leadership data. This is roster
data for a real nonprofit's real board — a demo must never be able to add,
edit, or remove a board member. **Recommend: block INSERT/UPDATE/DELETE
entirely.**

### 2.5 `organizational_digital_twins` — full protection recommended

**Never written directly by the onboarding wizard.** Populated once by
`autoPopulateTwin()` → `buildDigitalTwin()`, fired from `POST /api/onboarding/
complete-setup` (`complete-setup/route.ts:46-54`) right after step 7. Upserts
`mission, service_areas, programs, financial_profile, board_composition,
proven_narrative_patterns, key_strengths, twin_completeness_score,
last_rebuilt_at` (`digital-twin-builder.ts:184-200`).

**Important operational finding: this table is rebuilt as a side effect of a
plain GET request.** `GET /api/intelligence/digital-twin` calls
`buildDigitalTwin()` on every page view (`src/app/api/intelligence/
digital-twin/route.ts:46`), and `PATCH /api/knowledge-base` also rebuilds it on
every KB Editor save. **This table is not onboarding-exclusive — it is a
continuously-rebuilt derived view of `organizations` + `knowledge_base` +
`board_members` + `outcomes` + `applications`.** Since the demo will legitimately
generate applications/outcomes/drafts (§ Tier 2 below), simply *reading* this
page is safe and even desirable to demo. The actual risk is the GET route's
write side-effect running with a stale/wrong snapshot for a restricted profile,
or the KB-editor-triggered rebuild path being reachable (it isn't, once §2.1/2.3
are blocked upstream, since `PATCH /api/knowledge-base` itself must be blocked
wholesale for restricted profiles — see §2.7). **Recommend: block direct
INSERT/UPDATE (i.e. this table's own upsert) for a restricted profile**, and
either no-op or serve a cached read on the GET route's rebuild attempt rather
than writing a fresh upsert.

### 2.6 `documents` — full protection recommended

Onboarding step 5 inserts `organization_id, file_name, storage_path, category,
description, file_size, mime_type, uploaded_by` (`route.ts:396-419`), uploading
to Storage bucket `"documents"` at `${org.id}/${category}/...`. The shared
`DocumentUploader` component (used by both `/documents` and the KB Editor's
Financial section) inserts the same row shape (plus `expiration_date`) into a
**different** bucket, `org-{organizationId}`. No discriminator exists between
"onboarding-authored" and "later, ordinary" document rows. Uploading a document
also writes real bytes to a real Storage bucket tied to the real org.
**Recommend: block `documents` INSERT/UPDATE/DELETE entirely** for a restricted
profile — testing the document-upload UI is not among the demo's stated goals
(AutoApply, draft generation, general navigation), and this is the cleanest way
to avoid depositing demo clutter into a production Storage bucket.

### 2.7 Every write surface that must be covered — not just `POST /api/onboarding`

Per §2.1-2.6, blocking `POST /api/onboarding` alone is **not sufficient**. The
full set of code paths that reach protected tables/columns:

| Path | Reaches | Currently role-gated? |
|---|---|---|
| `POST /api/onboarding` | `organizations`, `programs`, `knowledge_base`, `board_members`, `documents` | **No** (§1.3) |
| `POST /api/onboarding/complete-setup` | `organizational_digital_twins`, `agent_queue` (new discovery job — fine, see Tier 2), welcome email | **No** |
| `POST /api/onboarding/generate-narratives` | `knowledge_base`-adjacent | **No** |
| `PATCH /api/knowledge-base` | `organizations` (extended profile), `programs`, `board_members`, triggers `buildDigitalTwin()` | Yes — `requireRole("writer")`, but no restricted-profile check |
| `GET /api/intelligence/digital-twin` | `organizational_digital_twins` (write side-effect of a GET) | N/A — needs its own guard regardless of role |
| `settings/page.tsx:335-338` | `organizations.name` | **No API route at all — direct client-side Supabase call**, bypasses every app-layer check that only lives in API routes |

The last row is the load-bearing finding for §3: **at least one real write path
to a protected column never touches an API route**, so any implementation that
only adds guard clauses to API routes has a proven hole. Enforcement must exist
at the database layer to be actually reliable, not just as defense in depth.

### 2.8 Tier 2 — explicitly NOT protected, must remain fully writable

This is what "full functional navigability — can trigger real actions" requires
and is unaffected by any of the above: `applications`, `draft_versions`,
`submission_queue`, `automation_queue`, `automation_sessions`, `agent_queue`,
`agent_runs`, `agent_decisions`, `pipeline_history`, `outcomes`, `notes`,
`alerts`, `deadlines`, `search_profiles`, `donor_discovery_*`, `autoapply_*`,
opportunity pipeline-stage changes, and every other table not listed in §2.1-2.6.
Running AutoApply, generating a draft, moving an application through the
pipeline, and creating/editing a search profile are all real, intended, allowed
production side effects for this demo account — the point of the exercise is
that they work against real data. Define the block as a **deny-list** (protect
the six items above), not an allow-list — do not try to enumerate all ~130
tables as "allowed."

---

## 3. Implementation approach — recommendation

### 3.1 Two options considered

**Option A — new `user_role` enum value (e.g. `'demo'`).** Rejected:
- `hasRequiredRole()` is a single linear rank comparison
(`ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[required]`). The demo needs
*writer-level* access for almost everything (Tier 2) but *below-viewer* access
for six specific tables (Tier 1) — that is not expressible as one rank on one
axis. Every one of the 100+ `requireRole()` call sites would need to special-case
the new value anyway, which defeats the purpose of adding a role to avoid
special-casing.
- `ALTER TYPE user_role ADD VALUE` cannot run in the same transaction as its
  first use, and per `STANDING_DIRECTIVES.md` DIRECTIVE-017, multi-statement DDL
  against this project must be split into separate `psql -f` calls to avoid
  silent partial-apply — extra operational risk for a narrow, single-purpose
  need. This codebase has already been burned by enum-drift bugs once (the
  `agent_type` enum-gap saga, see project memory) — avoid repeating the pattern.
- It does nothing to solve the §2.7 direct-client-write gap, since that path
  never calls `requireRole()` at all.

**Option B — boolean flag on `profiles`, layered on an existing role
(recommended).**
- Add `profiles.restricted_onboarding_edit boolean NOT NULL DEFAULT false`.
- Give the demo account `role = 'writer'` (full Tier 2 write access, and
  explicitly *not* `'owner'`/`'admin'` — avoids inheriting the broken
  cross-tenant admin surface noted in §1.3, and avoids team-management/
  danger-zone/funder-delete capability the demo doesn't need) **plus**
  `restricted_onboarding_edit = true`.
- This cleanly expresses "full normal write access, minus a fixed named set of
  tables" without touching the existing linear role hierarchy or its 100+
  call sites.
- Purely additive migration (single `ALTER TABLE ADD COLUMN ... DEFAULT false`),
  trivially reversible, zero risk to any existing profile (all default to
  `false`, i.e. unchanged behavior).

**This fits the codebase's existing patterns better than a new role, and Option
B is the recommended approach.**

### 3.2 Enforcement must be two-layered — app-layer guard clauses are not enough

Because §2.7 found a real write path that bypasses API routes entirely (direct
client-side Supabase call), and because §1.3 found that some of the very routes
that need to enforce this today have **zero** existing role gate to extend, the
authoritative enforcement point must be the **database**, with app-layer guard
clauses added as a first-layer UX nicety (clean 403 + message) on top:

1. **DB layer (authoritative, closes the §2.7 gap):**
   - A `SECURITY DEFINER` SQL function, e.g. `is_onboarding_edit_restricted()`,
     reading `profiles.restricted_onboarding_edit` for `auth.uid()` — same
     pattern as the existing `current_org_id()` helper
     (`001_initial_schema.sql:86-94`).
   - `BEFORE INSERT OR UPDATE OR DELETE` triggers on `knowledge_base`,
     `board_members`, `programs`, `organizational_digital_twins`, and
     `documents` that `RAISE EXCEPTION` when
     `is_onboarding_edit_restricted()` is true. Full-table protection, matching
     §2.2-§2.6's "block entirely" recommendation — no column-level nuance
     needed on these five.
   - A `BEFORE UPDATE` trigger on `organizations` that, only for a restricted
     profile, compares `OLD` vs `NEW` for exactly the column list in §2.1 and
     `RAISE EXCEPTION` if any changed — while letting unrelated columns
     (`logo_url`, brand colors, etc.) pass through untouched. This is the one
     table that needs column-level (not whole-table) protection, since it's a
     single row with both protected and unprotected fields.
   - This is the layer that actually guarantees correctness — it fires
     regardless of whether a future code change adds a new write path, an API
     route forgets its guard clause, or a client-side call bypasses routes
     entirely (exactly the §2.7 case).
2. **App layer (defense in depth / UX):** add explicit
   `restricted_onboarding_edit` checks — mirroring the existing `requireRole()`
   guard-clause pattern — to `POST /api/onboarding`, `/api/onboarding/
   complete-setup`, `/api/onboarding/generate-narratives` (all three currently
   have zero role gate — this is new code, not an extension), `PATCH /api/
   knowledge-base` (extend the existing `requireRole("writer")` gate), and make
   `GET /api/intelligence/digital-twin`'s rebuild-on-read either skip the write
   or serve a cached twin for a restricted profile. This layer exists so the
   demo UI gets a clean 4xx + message instead of a raw Postgres trigger
   exception bubbling up, but it is **not** a substitute for the DB layer.
3. Separately, converting `settings/page.tsx:335-338`'s direct client write to
   go through a gated API route is good hygiene but **not required for
   correctness** — the `organizations` trigger in (1) protects it either way.

### 3.3 Migration numbering

Next-free migration number in `supabase/migrations/` as of this research is
**138** (highest existing: `137_funder_signal_monitoring.sql`). Re-verify this at
implementation time before naming the new file — per project memory, task-given
migration numbers routinely collide with real state by the time they're acted
on.

---

## 4. Summary checklist for the implementing prompt

- [ ] Migration: `profiles.restricted_onboarding_edit boolean NOT NULL DEFAULT false`
- [ ] Migration: `is_onboarding_edit_restricted()` SQL function
- [ ] Migration: full-block triggers on `knowledge_base`, `board_members`,
      `programs`, `organizational_digital_twins`, `documents`
- [ ] Migration: column-scoped block trigger on `organizations` for exactly the
      §2.1 column list
- [ ] Verify next-free migration number (was 138 at spec time — recheck)
- [ ] App-layer guard clauses: `POST /api/onboarding`, `/api/onboarding/
      complete-setup`, `/api/onboarding/generate-narratives` (new checks — these
      routes have no role gate today), `PATCH /api/knowledge-base` (extend
      existing gate), `GET /api/intelligence/digital-twin` (skip/no-op the
      rebuild write)
- [ ] Create the actual demo `profiles` row for FAITH Foundation
      (`b1ab7402-dfc2-4712-869f-70ea3566cc1d`) with `role='writer'`,
      `restricted_onboarding_edit=true`
- [ ] Do NOT set `role='owner'` or `'admin'` (§1.3, §3.1)
- [ ] Manual verification pass: log in as the demo account and confirm (a)
      AutoApply/draft-generation/pipeline actions succeed, (b) every write in
      §2.1-§2.6 is rejected with a clean error, including via the direct
      `settings/page.tsx` org-name path specifically (the one that proves the
      DB-layer enforcement, not just the app-layer one, is doing the work)
