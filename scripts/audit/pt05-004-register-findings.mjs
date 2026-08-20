import { appendFindingRow } from "./evidence-lib.mjs";

appendFindingRow({
  id: "WGR-074",
  layer: "Auth/Admin",
  severity: "P0",
  description:
    "Admin impersonation (POST /api/admin/orgs/[id]/impersonate) is unbounded: the impersonation_org_id " +
    "cookie it sets is read by ZERO other call sites anywhere in the repo (git grep confirms; it appears " +
    "only in its own route.ts). The real authorization gate for every owner-scoped admin route, including " +
    "/admin/orgs/[id] itself, is role-only (profiles.role='owner', hasRequiredRole in role-gate.ts/" +
    "constants.ts) with no dependency on which org (if any) the caller is currently impersonating -- no " +
    "such state is ever persisted or checked server-side. An admin who has 'started impersonating' org A " +
    "can reach org B (or any of the platform's other orgs) via the exact same gate with zero additional " +
    "restriction, live-confirmed via a local-stack reproduction using the real production RLS policy on " +
    "organizations for contrast (owner A own-session read of org B correctly returns 0 rows via RLS; the " +
    "SAME owner A reaches org B fully via the admin/service-role path with 1 row returned, immediately " +
    "after nominally impersonating org A). Compounded by 'owner' being a per-org role held by 70 real " +
    "production users today, not a distinct platform-admin population (platform_admins has only 1 row).",
  evidencePath:
    "test-evidence/pt-05/privileged-access.json (admin_impersonation.bounded_to_org), " +
    "test-evidence/pt-05/pt05-004-production-investigation.json",
  reproduction:
    "node scripts/audit/pt05-004-investigate.mjs (read-only production check); " +
    "node scripts/audit/pt05-004-privileged-access.mjs (local-stack behavioral reproduction against " +
    ".pt05-local-stack); git grep -n impersonation_org_id -- src worker scripts (confirms zero read " +
    "sites outside the setter route).",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-075",
  layer: "Auth/Admin",
  severity: "P1",
  description:
    "The dedicated impersonation_log audit table (SCHEMA_REGISTRY §55) is unwritable for every real " +
    "production caller today: its admin_id column has a foreign key to platform_admins(id), but " +
    "platform_admins has only 1 row and 0 of the platform's 70 real owner-role profiles are present in " +
    "it (live-queried, read-only, against production). Every real impersonation attempt's " +
    "impersonation_log insert therefore fails with a 23503 foreign-key violation -- reproduced live " +
    "against a local-stack copy of the same real FK constraint using a real owner-role profile id " +
    "exactly the way requireRole(\"owner\")'s gate.userId supplies it in production. The route " +
    "(src/app/api/admin/orgs/[id]/impersonate/route.ts) never checks the {error} on this insert (the " +
    "result is not destructured), so the failure is silently swallowed and the caller still receives " +
    "{ ok: true }. impersonation_log has 0 rows in production today, consistent with this. A SEPARATE, " +
    "generic audit_logs write (logAudit(), no FK problem) DOES succeed per call, confirmed via the same " +
    "local reproduction, so impersonation is not fully unlogged -- but the specific, purpose-built " +
    "impersonation audit trail this feature exists to populate is broken for every real user.",
  evidencePath:
    "test-evidence/pt-05/privileged-access.json (admin_impersonation.audit_logged), " +
    "test-evidence/pt-05/pt05-004-production-investigation.json",
  reproduction:
    "node scripts/audit/pt05-004-investigate.mjs (confirms 0 of 70 owner-role profiles present in " +
    "platform_admins, impersonation_log row_count=0, live via production DATABASE_URL); " +
    "node scripts/audit/pt05-004-privileged-access.mjs (reproduces the exact impersonation_log insert " +
    "against a local FK matching production, observes 23503; reproduces the audit_logs insert, " +
    "observes success).",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-076",
  layer: "Auth/RLS",
  severity: "P3",
  description:
    "Demo-account write-protection (migration 138_demo_account_scope.sql, DEMO_ACCOUNT_SCOPE_2026-08-15.md) " +
    "re-verified live and holds. Beyond PT-06's own column/table-existence-only methodology, this pass " +
    "directly confirmed via read-only production query that all 3 real functions " +
    "(is_onboarding_edit_restricted, block_if_onboarding_edit_restricted, " +
    "block_restricted_organizations_update) and all 6 real triggers (block_restricted_write on " +
    "knowledge_base/board_members/programs/organizational_digital_twins/documents, " +
    "block_restricted_organizations_update on organizations) exist live and are wired to the correct " +
    "functions (joined tgfoid->pg_proc, not just matching trigger names). A live behavioral test against " +
    "a local reproduction of the real trigger logic (real GoTrue-authenticated sessions, real " +
    "@supabase/supabase-js writes, real production organizations RLS policy applied for realism) " +
    "confirmed: a restricted demo profile is blocked (42501) on a protected organizations column, a " +
    "whole-table-blocked table INSERT, UPDATE, and DELETE; the SAME restricted profile is correctly " +
    "ALLOWED to update a real branding column (logo_url) NOT on migration 138's protected list, per " +
    "spec §2.1's carve-out; an unrestricted negative-control profile succeeds on the identical writes; " +
    "and an independent service-role re-read confirmed every blocked attempt genuinely mutated nothing. " +
    "Migration 138 is also confirmed present in PT-06's appliedAndOnDisk bucket, not its " +
    "onDiskNotApplied bucket.",
  evidencePath:
    "test-evidence/pt-05/privileged-access.json (demo_write_protection), " +
    "test-evidence/pt-05/pt05-004-production-investigation.json",
  reproduction:
    "node scripts/audit/pt05-004-investigate.mjs (read-only production function/trigger check); " +
    "node scripts/audit/pt05-004-privileged-access.mjs (local-stack behavioral write attempts, 8/8 " +
    "pass); node scripts/audit/verify-pt05-004.mjs (gate).",
  scopeTag: "CONFIRMED-OK",
});

console.log("Appended WGR-074, WGR-075, WGR-076.");
