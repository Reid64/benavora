// GET /api/agency/dashboard — cross-client aggregate counts for the Agency
// command center (migration 176). Returns COUNTS ONLY (application counts,
// upcoming-deadline counts, pipeline-stage counts) per linked client
// organization — never draft content, notes, contacts, or documents. See
// agency_client_aggregate_counts() in 176_agency_tenancy.sql for the
// SECURITY DEFINER guard that makes this safe to expose across orgs.

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: agency, error: agencyError } = await supabase
    .from("agencies")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (agencyError) {
    return NextResponse.json(
      { error: "Could not verify agency account." },
      { status: 500 },
    );
  }
  if (!agency) {
    return NextResponse.json(
      { error: "This account is not an Agency-tier account.", code: "not_an_agency" },
      { status: 403 },
    );
  }

  const { data: rows, error } = await supabase.rpc(
    "agency_client_aggregate_counts",
    { p_agency_org_id: organizationId },
  );

  if (error) {
    return NextResponse.json(
      { error: "Failed to load command center data." },
      { status: 500 },
    );
  }

  return NextResponse.json({ clients: rows ?? [] });
}
