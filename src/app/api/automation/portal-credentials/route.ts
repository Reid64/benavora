// Portal credentials API - Phase 3 browser automation.
//
// GET  ?funderId=X   → { hasCredentials: boolean, username: string | null }
// POST body          → save credentials (writer+)
// DELETE ?funderId=X → delete credentials (writer+)
//
// organization_id is derived from the session, never from the request body
// (BEHAVIORAL_CONTRACTS §2). Credentials are encrypted at rest in platform_config
// via PortalCredentialManager (AES-256-GCM, per-org key).

import { type NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { PortalCredentialManager } from "@/lib/automation/portal-credentials";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  const funderId = req.nextUrl.searchParams.get("funderId");
  if (!funderId) return jsonError("funderId is required.", 400);

  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const mgr = new PortalCredentialManager(gate.supabase, gate.organizationId);
  try {
    const creds = await mgr.getCredentials(funderId);
    return NextResponse.json({
      hasCredentials: creds !== null,
      username: creds?.username ?? null,
    });
  } catch {
    return jsonError("Failed to load credentials.", 500);
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const { funderId, username, password } = (body ?? {}) as {
    funderId?: unknown;
    username?: unknown;
    password?: unknown;
  };

  if (
    typeof funderId !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string" ||
    !funderId.trim() ||
    !username.trim() ||
    !password
  ) {
    return jsonError(
      "funderId, username, and password are required.",
      400,
    );
  }

  const mgr = new PortalCredentialManager(gate.supabase, gate.organizationId);
  try {
    await mgr.saveCredentials(funderId.trim(), username.trim(), password);
    return NextResponse.json({ success: true });
  } catch {
    return jsonError("Failed to save credentials.", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const funderId = req.nextUrl.searchParams.get("funderId");
  if (!funderId) return jsonError("funderId is required.", 400);

  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;

  const mgr = new PortalCredentialManager(gate.supabase, gate.organizationId);
  try {
    await mgr.deleteCredentials(funderId);
    return NextResponse.json({ success: true });
  } catch {
    return jsonError("Failed to delete credentials.", 500);
  }
}
