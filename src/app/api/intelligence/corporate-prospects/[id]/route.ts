// GET /api/intelligence/corporate-prospects/[id] — Corporate Giving DNA profile
// for a single corporate_prospects row (FEATURE_REGISTRY_v2.md row #92).
//
// corporate_prospects (SCHEMA_REGISTRY_v2.md #36) has no organization_id — it's
// a shared, cross-org table with no confirmed RLS policy. Reads go through the
// service-role admin client rather than the session-scoped client, same
// precedent as GET /api/intelligence/outreach/prospects.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("corporate_prospects")
    .select(
      [
        "id",
        "legal_name",
        "dba_name",
        "ein",
        "duns_number",
        "website",
        "phone",
        "email",
        "address_street",
        "address_city",
        "address_state",
        "address_zip",
        "naics_code",
        "naics_description",
        "sic_code",
        "industry_category",
        "employee_count_estimate",
        "revenue_estimate",
        "location_count",
        "geographic_footprint",
        "ownership_type",
        "is_family_owned",
        "is_veteran_owned",
        "is_minority_owned",
        "is_woman_owned",
        "parent_company_id",
        "source_adapters",
        "first_seen_at",
        "last_verified_at",
        "enrichment",
        "enrichment_version",
        "enrichment_completed_at",
        "scores",
        "scores_computed_at",
        "giving_dna",
        "created_at",
        "updated_at",
      ].join(", "),
    )
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    return jsonError("Could not load this prospect.", 500);
  }
  if (!data) {
    return jsonError("Prospect not found.", 404);
  }

  return NextResponse.json({ prospect: data });
}
