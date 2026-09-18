import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchProPublicaFinancials } from "@/lib/sources/propublica-990-client";

// ProPublica 990 financial enrichment endpoint for a single foundation_directory
// row, looked up by EIN.
//
// GET /api/sources/propublica?ein=<ein>
//
// SYSTEM job: runs under the service-role admin client (Contracts §2 —
// service role is for system jobs, never user-facing routes), gated solely
// by the server-only CRON_SECRET, matching src/app/api/sources/grantsgov and
// src/app/api/sources/samgov. foundation_directory has no RLS (shared public
// reference data, migration 046) and no organization_id column, so unlike
// its siblings this route does not take an orgId param.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized.", "unauthorized", 401);
  }

  const { searchParams } = new URL(request.url);
  const ein = searchParams.get("ein");
  if (!ein) {
    return jsonError("ein is required.", "missing_ein", 400);
  }

  const financials = await fetchProPublicaFinancials(ein);
  if (!financials) {
    return jsonError("No ProPublica record found for this EIN.", "not_found", 404);
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("foundation_directory")
    .update({
      asset_amount: financials.totalAssets,
      revenue_amount: financials.totalRevenue,
    })
    .eq("ein", financials.ein)
    .select("id")
    .maybeSingle();

  if (error) {
    return jsonError("Failed to update foundation_directory.", "update_failed", 500);
  }
  if (!data) {
    return jsonError("No foundation_directory row matches this EIN.", "no_match", 404);
  }

  return NextResponse.json({
    ein: financials.ein,
    asset_amount: financials.totalAssets,
    revenue_amount: financials.totalRevenue,
  });
}
