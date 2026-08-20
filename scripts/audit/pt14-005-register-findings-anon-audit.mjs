// PT-14-005 -- register findings from the table-by-table RLS + storage anon
// audit (pt14-004-anon-rls-storage-audit.mjs, test-evidence/pt-14/rls-anon-audit.json)
// into WIRING_GAP_REGISTER.md as WGR-115 through WGR-119.
//
// Usage: node scripts/audit/pt14-005-register-findings-anon-audit.mjs
import { appendFindingRow } from "./evidence-lib.mjs";

const rows = [
  {
    id: "WGR-115",
    layer: "Data/Security",
    severity: "P3",
    description:
      "MASTER_BACKLOG.md §1.1's 8 named anon-exposed tables (platform_admins, organizational_digital_twins, opportunity_probability_scores, donor_discovery_directory, autoapply_submissions, submission_queue, form_templates, request_profiles) re-checked live, individually, with the real anon key, against production RIGHT NOW -- not re-reading either the 2026-07-30 finding or the later 2026-08-03/08-06 remediation claims. Extended to ALL 184 tables in PT-06's live schema, not just the 8 named ones. RESULT: 0 of 184 tables return real data to an unauthenticated anon-key request. All 8 disputed Tier-1.1 tables resolved CONFIRMED_FIXED_LIVE -- the later remediation claim was correct, MASTER_BACKLOG's July 30 finding is now stale. Verdict breakdown: 77 ANON_BLOCKED_NO_GRANT (base table privilege revoked), 55 ANON_BLOCKED_BY_RLS (grant present, RLS correctly filters to zero rows against a real, verified-nonzero service-role row count), 52 TABLE_EMPTY_INCONCLUSIVE-from-data but each individually resolved via a DB-level grant+RLS+policy fallback check (0 of the 52 flagged as at-risk).",
    evidencePath: "test-evidence/pt-14/rls-anon-audit.json (tables, disputed_items_resolution)",
    reproduction: "node scripts/audit/pt14-004-anon-rls-storage-audit.mjs; node scripts/audit/verify-pt14-002.mjs",
    scopeTag: "CONFIRMED-OK",
  },
  {
    id: "WGR-116",
    layer: "Storage/Security",
    severity: "P3",
    description:
      "MASTER_BACKLOG.md §1.2's 5 disputed non-public buckets (session-recordings, org-b1ab7402-..., documents, autoapply-screenshots, org-documents) re-checked live: storage.buckets, pg_policies on storage.objects, and information_schema grants all queried fresh over a read-only DATABASE_URL connection, plus a real anon POST /storage/v1/object/list attempt and (for documents/org-b1ab7402/autoapply-screenshots, which turned out to hold real objects, resolving STORAGE_POLICY_AUDIT.md's own documented '0 objects, can't distinguish locked-down from empty' ambiguity) a real anon GET download attempt against the real object path. RESULT: all 5 are db_policy_verdict=ZERO_POLICY_DEFAULT_DENY (RLS enabled, zero policy applies to public/anon on storage.objects) and anon is genuinely blocked live -- 3 confirmed against real objects (401/400 on download, 0 objects via LIST despite the service-role list finding real content), 2 (session-recordings, org-documents) confirmed safe-by-default-deny via the DB-level check since they hold no objects today to test empirically. nofa-pdfs's read=public/write=unscoped-authenticated pattern (§1.2 #13) is unchanged and was never disputed as a bug, only flagged for a one-line intentionality confirmation from Reid -- still open, not resolved by this audit.",
    evidencePath: "test-evidence/pt-14/rls-anon-audit.json (buckets, disputed_items_resolution)",
    reproduction: "node scripts/audit/pt14-004-anon-rls-storage-audit.mjs; node scripts/audit/verify-pt14-002.mjs",
    scopeTag: "CONFIRMED-OK",
  },
  {
    id: "WGR-117",
    layer: "Storage/Security",
    severity: "P2",
    description:
      "New finding, not in MASTER_BACKLOG's original 6-bucket list: a 7th live bucket, `org-branding`, exists in production storage.buckets today (created after 2026-07-30) with public=true and the identical policy shape as nofa-pdfs -- SELECT open to public (role, no TO clause), INSERT/UPDATE scoped TO authenticated but with no organization_id/owner check in the WITH CHECK clause, meaning any authenticated user from any org can insert or overwrite any object in this bucket, not just their own org's branding assets. Plausibly intentional (branding logos may be intended to render publicly on marketing pages) but, like nofa-pdfs (§1.2 #13), needs the same one-line intentionality confirmation from Reid rather than being assumed safe.",
    evidencePath: "test-evidence/pt-14/rls-anon-audit.json (buckets.org-branding, beyond_scope_findings.new_buckets_not_in_master_backlogs_original_six)",
    reproduction: "node scripts/audit/pt14-004-anon-rls-storage-audit.mjs -- see buckets['org-branding'].db_policies_applicable_to_this_bucket",
    scopeTag: "PENDING-SCOPE",
  },
  {
    id: "WGR-118",
    layer: "Data/Security",
    severity: "P2",
    description:
      "Beyond the task's literal read-only scope, but surfaced by the same DB-level grant query: 107 of 184 public-schema tables still carry an unrevoked default PostgreSQL PUBLIC INSERT/UPDATE/DELETE grant to the anon role (same root cause as the already-documented 'Public schema default ACLs auto-grant anon+authenticated full CRUD' pattern). Live-verified this is NOT currently exploitable: for every one of the 107, the applicable RLS write policy's predicate references current_org_id()/auth.uid()/auth.role()='authenticated' -- all of which evaluate to NULL/false for an unauthenticated anon caller (auth.uid() has no JWT sub claim for the anon key), so 0/107 were found with a policy that would actually pass for anon. This is real, live-verified defense-in-depth debt, not a live P0: protection currently depends entirely on every write policy's predicate staying correct, rather than the grant itself being absent (which is how the already-remediated read-side tables in WGR-115 are protected). Recommend revoking the stale INSERT/UPDATE/DELETE grants the same way the 2026-08-06 remediation revoked stale SELECT grants.",
    evidencePath: "test-evidence/pt-14/rls-anon-audit.json (beyond_scope_findings.anon_write_grant_analysis, 107 entries, all policy_appears_to_neutralize_anon=true)",
    reproduction: "node scripts/audit/pt14-004-anon-rls-storage-audit.mjs -- see beyond_scope_findings.anon_write_grant_analysis",
    scopeTag: "CONFIRMED-BROKEN",
  },
  {
    id: "WGR-119",
    layer: "Data/Security",
    severity: "P2",
    description:
      "Full public-schema RPC surface enumerated live via pg_proc + has_function_privilege('anon', ..., 'EXECUTE') (NOT live-invoked one by one -- several are real mutating functions, e.g. resume_paused_submission_queue_item, skip_paused_submission_queue_item, reassign_paused_submission_queue_item, increment_usage_tracking, donor_discovery_upsert_directory/_record, donor_discovery_increment_api_spend, and blindly calling them with the anon key would risk corrupting real production state, which enumeration does not require). RESULT: all 47 real functions have EXECUTE granted to anon -- PostgreSQL's default PUBLIC EXECUTE grant, never revoked for any of them, same root cause as WGR-118. 5 are SECURITY DEFINER (current_org_id, is_onboarding_edit_restricted, marketplace_listing_owned_by_org, marketplace_org_has_match_on_listing, register_organization) -- all read-only predicate helpers except register_organization, which was not investigated further this pass. The mutating SECURITY INVOKER functions run AS the anon role if called anonymously, so are subject to the same table-level grants/RLS already checked in WGR-115/118 (e.g. resume_paused_submission_queue_item would fail immediately -- submission_queue has zero anon grants at all) -- but this was confirmed by cross-referencing the underlying tables' own grant state, not by actually invoking any RPC. Recommend revoking anon EXECUTE on every mutating RPC as defense in depth, matching WGR-118's recommendation.",
    evidencePath: "test-evidence/pt-14/rls-anon-audit.json (rpcs, 47 entries)",
    reproduction: "node scripts/audit/pt14-004-anon-rls-storage-audit.mjs -- see rpcs[] and cross-reference each mutating function's target table in tables{}",
    scopeTag: "CONFIRMED-BROKEN",
  },
];

for (const row of rows) {
  appendFindingRow(row);
  console.log(`Appended ${row.id}`);
}
console.log(`Done -- appended ${rows.length} rows to WIRING_GAP_REGISTER.md`);
