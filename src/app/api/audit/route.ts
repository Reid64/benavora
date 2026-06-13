import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { logAudit, type AuditAction } from "@/lib/audit/logger";

// Client-initiated audit recorder (BLUEPRINT Phase 5 / Behavioral Contracts §24).
//
// Several audited operations happen in client components that talk to Supabase
// directly (document upload/delete, application stage transitions, settings
// edits). Those can't write an audit row server-side on their own, so they POST
// here afterward. This endpoint derives organization_id and the acting user from
// the SESSION (never the body - Contracts §2) and stamps the real client IP and
// user agent from the request headers.
//
// Trust model: the action/entity are reported by the client, but the actor and
// tenant are server-derived and RLS-scoped, and the table is append-only
// (Contracts §24). The set of actions accepted here is restricted to the data
// mutations a client legitimately performs; privileged events (role_change,
// billing_change, invite, login/logout) are logged server-side at their source.
//
//   POST { action, entityType?, entityId?, details? } → 204

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Actions a client component may record for itself. */
const CLIENT_ACTIONS = new Set<AuditAction>([
  "create",
  "update",
  "delete",
  "export",
  "submission",
]);

export async function POST(request: Request) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }
  const { action, entityType, entityId, details } = (body ?? {}) as {
    action?: unknown;
    entityType?: unknown;
    entityId?: unknown;
    details?: unknown;
  };

  if (
    typeof action !== "string" ||
    !CLIENT_ACTIONS.has(action as AuditAction)
  ) {
    return jsonError("A valid audit action is required.", "invalid_input", 400);
  }

  await logAudit(supabase, {
    organizationId: profile.organization_id as string,
    userId: profile.id as string,
    action: action as AuditAction,
    entityType: typeof entityType === "string" ? entityType : null,
    entityId: typeof entityId === "string" ? entityId : null,
    details:
      details && typeof details === "object"
        ? (details as Record<string, unknown>)
        : null,
    request,
  });

  return new NextResponse(null, { status: 204 });
}
