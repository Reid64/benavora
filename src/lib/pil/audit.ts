import { getPilClient } from "@/lib/pil/db";
import type { AuditLogEntry } from "@/lib/pil/types";

// pil_audit_log has no UPDATE/DELETE policy for any role, including owner --
// append-only by design (migration 159). Never add update/delete helpers
// here; corrections are new rows referencing the corrected row's id in
// after_state, never edits.

export async function logAction(entry: Omit<AuditLogEntry, "id" | "created_at">): Promise<void> {
  const { error } = await getPilClient().from("pil_audit_log").insert(entry);
  if (error) throw error;
}

export async function getAuditTrail(
  orgId: string,
  resourceType: string,
  resourceId: string,
): Promise<AuditLogEntry[]> {
  const { data, error } = await getPilClient()
    .from("pil_audit_log")
    .select("*")
    .eq("organization_id", orgId)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AuditLogEntry[];
}
