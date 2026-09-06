// GET /api/agency/clients — list the client organizations linked to the
// authenticated agency's own account (migration 176: agencies +
// agency_client_organizations). organization_id is derived from the
// session via requireRole(), never trusted from the request.
//
// The 403 "not_an_agency" branch below is a defense-in-depth check, not the
// real security boundary — list_agency_client_organizations() itself
// re-verifies current_org_id() and the agencies row before returning
// anything (176_agency_tenancy.sql), so even if this branch were removed a
// forged/foreign organization_id still can't read another agency's rows.

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

  const { data: clients, error } = await supabase.rpc(
    "list_agency_client_organizations",
    { p_agency_org_id: organizationId },
  );

  if (error) {
    return NextResponse.json(
      { error: "Failed to load linked client organizations." },
      { status: 500 },
    );
  }

  return NextResponse.json({ clients: clients ?? [] });
}
