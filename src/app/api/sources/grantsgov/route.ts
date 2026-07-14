import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { syncGrantsGovForOrg } from "@/lib/sources/grantsgov-sync";

// Grants.gov opportunity polling endpoint.
//
// GET /api/sources/grantsgov?orgId=<uuid>&keywords=housing,shelter
//
// SYSTEM job: runs under the service-role admin client (Contracts §2 — service
// role is for system jobs, never user-facing routes), so it is gated solely by
// the server-only CRON_SECRET, matching src/app/api/cron/research/route.ts.
// Every query is manually scoped to orgId — RLS does not protect service-role
// queries.
//
// keywords is optional: when omitted, the org's active search_profiles
// keywords are used instead (see src/lib/sources/grantsgov-sync.ts, which also
// backs the daily /api/cron/grantsgov sweep and the manual
// `pnpm poll:grantsgov` script). Results are deduplicated by Grants.gov's
// external opportunity id (encoded into the stored opportunity's url, since
// `opportunities` has no dedicated external_id column) and either inserted as
// new rows or used to update the matching existing row.

export const runtime = "nodejs";
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
  const orgId = searchParams.get("orgId");
  if (!orgId) {
    return jsonError("orgId is required.", "missing_org_id", 400);
  }

  const keywordsParam = searchParams.get("keywords");
  const explicitKeywords = keywordsParam
    ? keywordsParam.split(",").map((k) => k.trim()).filter(Boolean)
    : undefined;

  const admin = createAdminClient();

  try {
    const result = await syncGrantsGovForOrg(admin, orgId, explicitKeywords);
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Sync failed.",
      "sync_failed",
      500,
    );
  }
}
