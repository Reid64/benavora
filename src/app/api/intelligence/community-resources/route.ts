import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { matchResourcesForSignal } from "@/lib/intelligence/resource-matcher";

// GET /api/intelligence/community-resources?signalId=<uuid> — row #226
// Community Resource Graph MVP: ranks this org's real funders/open
// opportunities/active programs against one real community_need_signals
// row (AG-35's real output, migration 090). See resource-matcher.ts's
// header for why this is a keyword+geo ranked list, not a graph
// traversal over pig_nodes/pig_edges (a different, unrelated graph).

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const signalId = new URL(request.url).searchParams.get("signalId");
  if (!signalId) {
    return jsonError("signalId query parameter is required.", "missing_signal_id", 400);
  }

  const { data: signal, error: signalError } = await supabase
    .from("community_need_signals")
    .select(
      "id, signal_source, signal_category, signal_description, geographic_area, severity",
    )
    .eq("id", signalId)
    .eq("org_id", organizationId)
    .maybeSingle();

  if (signalError) {
    return jsonError("Failed to load the community need signal.", "db_error", 500);
  }
  if (!signal) {
    return jsonError("Community need signal not found.", "signal_not_found", 404);
  }

  const matches = await matchResourcesForSignal(supabase, organizationId, {
    signal_source: signal.signal_source,
    signal_category: signal.signal_category,
    signal_description: signal.signal_description,
    geographic_area: signal.geographic_area,
  });

  return NextResponse.json({ signal, matches });
}
