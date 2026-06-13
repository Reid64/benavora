import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getAuthUrl, getConnection } from "@/lib/integrations/google/auth";

// Google integration status + connect (BLUEPRINT Phase 4, Contracts §19).
//
//   GET  → { connected: boolean, email: string | null } for the caller's org
//          (any authenticated role - read access).
//   POST → { authUrl } to start the OAuth consent flow. Connecting an
//          integration is a settings-level action, so owner/admin only (task §6).
//
// Both authenticate via the session and derive organization_id server-side from
// the profile - never from the request body (Contracts §2, §16).

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  try {
    const connection = await getConnection(gate.organizationId, gate.supabase);
    return NextResponse.json(connection);
  } catch {
    return jsonError(
      "Could not load the Google connection.",
      "load_failed",
      500,
    );
  }
}

export async function POST() {
  // Connecting Google is a settings action - owner/admin only (task §6).
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  try {
    const authUrl = getAuthUrl(gate.organizationId);
    return NextResponse.json({ authUrl });
  } catch {
    // Most likely a missing GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI configuration.
    return jsonError(
      "Google integration is not configured on the server.",
      "not_configured",
      500,
    );
  }
}
