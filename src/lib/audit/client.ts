// Client-side audit helpers (Behavioral Contracts §24).
//
// Thin fire-and-forget wrappers used by client components to record audited
// actions they perform directly against Supabase (document upload/delete,
// stage transitions, settings edits) and authentication events. The server
// endpoints derive the actor + tenant from the session and stamp IP/user agent,
// so these only carry the action context. Failures are swallowed - auditing must
// never disrupt the user's action.

export type ClientAuditAction =
  | "create"
  | "update"
  | "delete"
  | "export"
  | "submission";

export interface RecordAuditInput {
  action: ClientAuditAction;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

/** Record a client-initiated audit event (best-effort, never throws). */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      keepalive: true,
    });
  } catch {
    // best-effort
  }
}

/**
 * Record a login/logout event (best-effort, never throws).
 *
 * Callers on the login path await this before redirecting, so it carries a
 * hard timeout - without one, a server-side hang here would strand the user
 * on "Signing in..." with the sign-in itself already having succeeded.
 */
export async function recordAuthEvent(
  event: "login" | "logout",
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch("/api/auth/log-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
      signal: controller.signal,
    });
  } catch {
    // best-effort
  } finally {
    clearTimeout(timeout);
  }
}
