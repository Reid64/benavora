# CC PROMPT — SCHEMA_REGISTRY.md PRE-EXISTING TABLE DOCUMENTATION CORRECTION

**Target:** Claude Code on Windows, `C:\Users\manag\Documents\Tarritrix`
**Flag:** Launch CC with `claude --dangerously-skip-permissions`
**Type:** Autonomous single-prompt execution
**Outcome:** One atomic commit adding documentation for 4 pre-existing tables that exist in migrations but are absent from SCHEMA_REGISTRY.md

---

## PASTE THIS BLOCK TO CC

You are Claude Code with `--dangerously-skip-permissions`. Execute autonomously. Do not pause for confirmation.

**Mission:** Document 4 pre-existing tables in SCHEMA_REGISTRY.md. Tables exist in migration files and live database but were never documented in the canonical schema file. This commit closes that pre-existing drift gap.

**Tables to document:**
1. `page_indexation` — A-08 Indexation Tracker
2. `gsc_rate_limits` — A-08 GSC rate limiting
3. `oauth_state_tokens` — OAuth CSRF protection (Contract 67)
4. `client_gsc_credentials` — A-08 per-client GSC OAuth credentials

**Source migrations:**
- `supabase/migrations/20260520220000_a08_indexation_schema.sql` (page_indexation, gsc_rate_limits)
- `supabase/migrations/20260521120000_oauth_state_tokens.sql` (oauth_state_tokens)
- `supabase/migrations/20260522180100_add_client_gsc_credentials.sql` (client_gsc_credentials)

---

## STEP 1 — PRE-CONDITIONS

```powershell
cd C:\Users\manag\Documents\Tarritrix

$status = git status --porcelain
if ($status) {
  Write-Error "Working tree dirty. Abort."
  exit 1
}

$branch = git branch --show-current
if ($branch -ne "master") {
  Write-Error "Not on master. Currently: $branch. Abort."
  exit 1
}

Write-Host "Pre-conditions: PASS"
```

---

## STEP 2 — READ SOURCE MIGRATIONS

Read all 4 migration files. Extract the CREATE TABLE statements for each of the 4 target tables. Capture column definitions, constraints, indexes, RLS policies, and any helper functions or triggers.

You will need this content to populate the SCHEMA_REGISTRY.md additions accurately.

---

## STEP 3 — DETERMINE INSERTION LOCATION IN SCHEMA_REGISTRY.md

Read `SCHEMA_REGISTRY.md`. Locate the existing section header on line 817:

```
## 2026-05-20 TIER 2 SERVICE HUB ARCHITECTURE SCHEMA
```

This section contains tables and ALTERs from the 2026-05-20 work (service_hub_versions, hub_review_queue, link_audit_log, page_indexation, gsc_rate_limits, client_gsc_credentials, etc.).

**IMPORTANT:** The page_indexation, gsc_rate_limits, and client_gsc_credentials tables MAY already be documented in this section. Verify by searching the file for `### page_indexation`, `### gsc_rate_limits`, and `### client_gsc_credentials` headings. The verify-schema script reports them as missing from the REGISTRY, so either:

(a) They are missing entirely → add them in this section
(b) They are present but the registry table inventory list (Group 15 or Group 16) doesn't include them → add inventory entries
(c) They are present under different heading conventions → normalize the headings so verify-schema recognizes them

Run this PowerShell to determine which case applies:

```powershell
Select-String -Path SCHEMA_REGISTRY.md -Pattern '### page_indexation|### gsc_rate_limits|### client_gsc_credentials|### oauth_state_tokens'
```

Report findings. Then choose the appropriate path:

- If headings exist: investigate why verify-schema.ts doesn't find them and fix the recognition issue
- If headings don't exist: add full table documentation

---

## STEP 4 — ADD MISSING TABLE DOCUMENTATION

For each table not yet documented, add a section in SCHEMA_REGISTRY.md following the existing pattern in the file. Each table entry should include:

- Heading: `### <table_name> (Table — A-XX or context)`
- Purpose statement (1-2 sentences)
- Column list with types and constraints
- Indexes
- RLS policies (or "RLS DISABLED" with reason)
- Source migration filename

Reference the existing entries in the "2026-05-20 TIER 2 SERVICE HUB ARCHITECTURE SCHEMA" section for the exact format pattern.

**Critical:** The actual SQL DDL is in the source migration files. Read those files for canonical column types, constraints, and policies. Do not fabricate.

---

## STEP 5 — UPDATE TABLE INVENTORY HEADING IF NEEDED

The COMPLETE TABLE INVENTORY at line 48 says "(87 TABLES)". With 4 additional documented tables, the count becomes 91.

Update line 48:

```
## COMPLETE TABLE INVENTORY (91 TABLES)
```

Also add Group 17 or extend Group 15/16 with the 4 new inventory rows. Use the existing format from Group 15 and Group 16.

Determination: Since these tables are pre-existing (added 2026-05-20 and 2026-05-21/22) and not architecturally grouped with RBAC (Group 16), they likely belong in Group 15 or a dedicated Group 17 for "GSC and OAuth Infrastructure." Choose based on what fits best.

---

## STEP 6 — RUN VERIFY-SCHEMA

After edits, run:

```powershell
pnpm verify:schema
```

**Expected outcome after correction:**
```
❌ DRIFT: Tables in REGISTRY but NOT in MIGRATIONS:
   - user_roles
   - user_actions
   - role_grant_audit
   - client_ingestion_versions
```

The 4 tables we just added should NO LONGER appear in either drift list. Only the 4 RBAC tables should remain (those will be resolved by P11.1 migrations).

If verify-schema reports the 4 newly-added tables are still missing, investigation needed — likely a parser mismatch in verify-schema.ts.

If verify-schema reports new unexpected drift, investigation needed.

---

## STEP 7 — COMMIT

```powershell
git add SCHEMA_REGISTRY.md

$msg = @"
chore(governance): document pre-existing A-08 and OAuth tables in SCHEMA_REGISTRY.md

Closes pre-existing drift between supabase/migrations/ and SCHEMA_REGISTRY.md
surfaced by verify:schema. Four tables existed in migrations and live database
but were never documented in the canonical schema file:

- page_indexation (A-08 Indexation Tracker, migration 20260520220000)
- gsc_rate_limits (A-08 GSC rate limiting, migration 20260520220000)
- oauth_state_tokens (Contract 67 OAuth CSRF protection, migration 20260521120000)
- client_gsc_credentials (A-08 per-client OAuth, migration 20260522180100)

Total documented tables: 87 → 91.

No schema change. No migration change. Documentation-only commit closing
pre-existing governance hygiene gap per operator canonical rule.

Verified via pnpm verify:schema — only the expected RBAC drift remains
(user_roles, user_actions, role_grant_audit, client_ingestion_versions
to be resolved by P11.1 migrations N+1 through N+8).
"@

git commit -m $msg

if ($LASTEXITCODE -ne 0) {
  Write-Error "Commit failed."
  exit 1
}

$hash = git rev-parse HEAD
Write-Host ""
Write-Host "=== COMMIT APPLIED ==="
Write-Host "Hash: $hash"
git log -1 --stat
```

---

## STEP 8 — POST-COMMIT REPORT

Report to operator:

1. Commit hash
2. Lines added to SCHEMA_REGISTRY.md
3. New table count (should be 91)
4. Confirmation that verify:schema now reports ONLY the expected RBAC drift
5. Next action: P11.1 Migrations N+1 through N+8 generation

---

## ROLLBACK IF VERIFICATION FAILS

```powershell
git checkout SCHEMA_REGISTRY.md
```

Report failure with specific drift output.

---

**END OF PROMPT. EXECUTE AUTONOMOUSLY.**
