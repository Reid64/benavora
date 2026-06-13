// Audit logging (BLUEPRINT Phase 5 / Behavioral Contracts §24).
//
// SERVER-ONLY. Append-only record of who did what, when, to which entity, and
// from where. Audit logs are NEVER updated or deleted (Contracts §24); this
// module only ever inserts.
//
// Callers pass their own Supabase client (session client in routes, admin client
// where there is no session - e.g. the Stripe webhook), and may pass the inbound
// Request so the client IP and user agent are captured from its headers. Writes
// are best-effort: an audit failure must never block or mask the operation it
// records.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Enums, Json } from "@/types/database";

export type AuditAction = Enums<"audit_action">;

export interface LogAuditParams {
  organizationId: string;
  /** Acting user's profile id; null for system/unauthenticated actions. */
  userId?: string | null;
  action: AuditAction;
  /** What kind of thing was acted on: 'funder', 'application', 'user', etc. */
  entityType?: string | null;
  /** The acted-on row's id, when applicable. */
  entityId?: string | null;
  /** Extra structured context (no secrets - this table is broadly readable). */
  details?: Record<string, unknown> | null;
  /** Inbound request, used to capture IP + user agent from its headers. */
  request?: Request | null;
}

/**
 * Extract the originating client IP from proxy headers. Vercel/most proxies set
 * `x-forwarded-for` (a comma-separated list, client first); fall back to
 * `x-real-ip`. Returns null when neither is present.
 */
function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return headers.get("x-real-ip");
}

/**
 * Insert an audit log row (Contracts §24). Best-effort - never throws; a logging
 * failure is swallowed so it can't break the audited operation.
 *
 *   await logAudit(supabase, {
 *     organizationId, userId, action: "role_change",
 *     entityType: "user", entityId: targetId,
 *     details: { from, to }, request,
 *   });
 */
export async function logAudit(
  client: SupabaseClient,
  params: LogAuditParams,
): Promise<void> {
  try {
    const headers = params.request?.headers;
    await client.from("audit_logs").insert({
      organization_id: params.organizationId,
      user_id: params.userId ?? null,
      action: params.action,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      details: (params.details ?? {}) as Json,
      ip_address: headers ? clientIpFrom(headers) : null,
      user_agent: headers?.get("user-agent") ?? null,
    });
  } catch {
    // Audit logging is best-effort and must never surface to the caller.
  }
}
