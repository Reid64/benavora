// Disaster Response Agent trigger (PLATFORM_VISION_ARCHITECTURE.md Pillar 10,
// AGENTS_v2.md AG-25).
//
// GET  — polls FEMA for recent declarations, inserts any not yet seen into
//        disaster_declarations, then returns the most recent declarations on
//        record (shared, non-org-scoped table) for the Disaster Response
//        dashboard feed.
// POST — deploys a disaster response for the caller's org against one
//        declaration. organization_id is always derived server-side from the
//        caller's profile (Behavioral Contracts §2), never from the body.
//
// Body (POST): { declarationId: string }
// Response (GET):  { newDeclarations: number, declarations: DisasterDeclaration[] }
// Response (POST): { declarationId, orgId, matchedFunds, alertCreated }

import { NextRequest, NextResponse } from "next/server";

import {
  deployDisasterResponse,
  pollFEMADeclarations,
} from "@/lib/agents/disaster-response-agent";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  try {
    const pollResult = await pollFEMADeclarations(supabase);
    const { data: declarations, error } = await supabase
      .from("disaster_declarations")
      .select(
        "id, fema_disaster_number, disaster_type, incident_type, affected_states, declaration_date, incident_begin_date, response_deployed, response_deployed_at",
      )
      .order("declaration_date", { ascending: false })
      .limit(20);
    if (error) {
      return jsonError(error.message, "fetch_failed", 500);
    }
    return NextResponse.json({
      newDeclarations: pollResult.newCount,
      declarations: declarations ?? [],
    });
  } catch {
    return jsonError("FEMA poll failed. Please try again.", "poll_failed", 502);
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", "bad_request", 400);
  }

  const parsed = body as { declarationId?: unknown };
  const declarationId =
    typeof parsed.declarationId === "string" && parsed.declarationId.trim()
      ? parsed.declarationId.trim()
      : "";

  if (!declarationId) {
    return jsonError("declarationId is required.", "no_declaration", 400);
  }

  try {
    const result = await deployDisasterResponse(
      declarationId,
      organizationId,
      supabase,
    );
    return NextResponse.json(result);
  } catch {
    return jsonError(
      "Disaster response deployment failed. Please try again.",
      "deploy_failed",
      500,
    );
  }
}
