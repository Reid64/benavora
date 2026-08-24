import { createAdminClient } from "@/lib/supabase/admin";

// Service-role Supabase wrapper for the Prospect Intelligence Layer tables
// (supabase/migrations/150-162_pil_*.sql). SERVER-ONLY, same rule as
// createAdminClient itself: bypasses RLS, so every org-scoped helper below
// filters by organization_id itself rather than relying on RLS to do it.
//
// Every pil_* table's tenant column is `organization_id`, not `org_id` --
// confirmed against all 12 PIL-01 migration files. Filtering on `org_id`
// would silently match zero rows on every one of these tables.
export function getPilClient() {
  return createAdminClient();
}

export function pilProspects(orgId: string) {
  return getPilClient().from("pil_prospects").select("*").eq("organization_id", orgId);
}

export function pilEvidence(orgId: string) {
  return getPilClient().from("pil_evidence").select("*").eq("organization_id", orgId);
}

export function pilResearchRuns(orgId: string) {
  return getPilClient().from("pil_research_runs").select("*").eq("organization_id", orgId);
}

// pil_agent_registry is platform-level shared (identical across every
// tenant, seeded by migration 155) -- no organization_id column exists on
// this table, so this helper is intentionally not org-scoped.
export function pilAgentRegistry() {
  return getPilClient().from("pil_agent_registry").select("*");
}

// pil_source_registry is likewise platform-level shared (migration 157) --
// no organization_id column, not org-scoped.
export function pilSources() {
  return getPilClient().from("pil_source_registry").select("*");
}

export function pilCostLedger(orgId: string) {
  return getPilClient().from("pil_cost_ledger").select("*").eq("organization_id", orgId);
}

export function pilAuditLog(orgId: string) {
  return getPilClient().from("pil_audit_log").select("*").eq("organization_id", orgId);
}

export function pilHumanReview(orgId: string) {
  return getPilClient().from("pil_human_review_queue").select("*").eq("organization_id", orgId);
}

export function pilMonitoring(orgId: string) {
  return getPilClient().from("pil_monitoring_events").select("*").eq("organization_id", orgId);
}
