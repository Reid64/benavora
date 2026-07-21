// GET/POST /api/intelligence/land-banks — surfaces opportunities discovered by
// discoverLandBankOpportunities() (src/lib/sources/land-bank-client.ts).
//
// Deviations from the task-given spec, checked against real schema (this
// project's established practice — see land-bank-client.ts's own header for
// the same kind of finding): `opportunities` has no `funder_type` column, so
// GET filters on the real columns instead — `source ilike '%land_bank%'` (set
// by discoverLandBankOpportunities on insert) OR `category = 'housing_grant'`
// (the real funder_category enum value used for land-bank-authority-sourced
// rows). POST calls discoverLandBankOpportunities() directly rather than
// routing through agent_queue with agentId 'ag-02-opportunity-discovery' —
// that id has no case in worker/autonomous-orchestrator.ts's routeQueueItem()
// switch (see AGENTS_v2.md §1.3's documented chain-routing gap) and would
// queue, retry 3x, and fail silently; this standalone function is the actual,
// working discovery entry point.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { discoverLandBankOpportunities } from "@/lib/sources/land-bank-client";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("organization_id", organizationId)
    .or("source.ilike.%land_bank%,category.eq.housing_grant")
    .order("deadline", { ascending: true, nullsFirst: false });

  if (error) {
    return jsonError("Failed to load land bank opportunities.", "DB_ERROR", 500);
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  if (!checkRateLimit(`land-bank-discovery:${userId}`)) {
    return jsonError(
      "Too many discovery runs. Try again in a bit.",
      "rate_limited",
      429,
    );
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("city, state")
    .eq("id", organizationId)
    .single();

  if (orgError || !org) {
    return jsonError("Could not resolve your organization.", "no_org", 500);
  }

  const results = await discoverLandBankOpportunities(
    { city: org.city ?? "", state: org.state ?? "" },
    organizationId,
    supabase,
  );

  return NextResponse.json({ discovered: results.length, data: results });
}
