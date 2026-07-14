import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { computeSuccessProbability } from "@/lib/intelligence/success-probability";
import { isUuid } from "@/lib/grants/grants-service";

// GET /api/opportunities/[id]/probability?orgId=...
//
// organization_id is derived from the session (Six Laws Law 2), never from
// the request. The `orgId` query param is accepted for the caller to state
// which org they expect to be querying, but it's only used to detect a
// stale/mismatched client - if it disagrees with the session's org, the
// request is rejected rather than trusted.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

type RouteContext = { params: { id: string } };

export async function GET(request: Request, { params }: RouteContext) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const id = params.id;
  if (!isUuid(id)) {
    return jsonError("Opportunity not found.", "NOT_FOUND", 404);
  }

  const requestedOrgId = new URL(request.url).searchParams.get("orgId");
  if (requestedOrgId && requestedOrgId !== organizationId) {
    return jsonError(
      "orgId does not match the authenticated organization.",
      "FORBIDDEN",
      403,
    );
  }

  try {
    const result = await computeSuccessProbability(organizationId, id, supabase);
    return NextResponse.json({ data: result });
  } catch {
    return jsonError("Opportunity not found.", "NOT_FOUND", 404);
  }
}
