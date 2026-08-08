// Donation Recommendation Marketplace — Matches list (FEATURE_REGISTRY_v2.md
// rows #121-125). GET returns every match row visible to the caller's org
// (RLS: its own requests, plus incoming requests against its own listings —
// see marketplace_matches_org_select, migration 125).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  const { data, error } = await supabase
    .from("marketplace_matches")
    .select(
      "id, listing_id, organization_id, match_reason, status, requested_at, responded_at, created_at, " +
        "organizations:organization_id ( name ), " +
        "marketplace_listings:listing_id ( id, title, category, organization_id, status )",
    )
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load matches.", "load_failed", 500);
  }

  return NextResponse.json({ data: data ?? [] });
}
