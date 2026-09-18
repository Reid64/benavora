import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  listActiveGrantsGovOrgIds,
  syncGrantsGovForOrg,
} from "@/lib/sources/grantsgov-sync";

// Daily Grants.gov sweep (BEHAVIORAL_CONTRACTS §33 scheduling matrix —
// "Grants.gov=daily"; §17 poll frequency max once per 24h per search profile).
// Vercel Cron hits this GET daily (see vercel.json); it sweeps every
// organization with at least one active search profile, reusing each org's
// own profile keywords via `syncGrantsGovForOrg` — the same sync used by the
// on-demand `/api/sources/grantsgov` route and the manual
// `pnpm poll:grantsgov` script (src/lib/sources/grantsgov-sync.ts).
//
// SYSTEM job: service-role admin client, gated solely by the server-only
// CRON_SECRET (Contracts §2). Every query is organization_id-scoped manually —
// RLS does not protect service-role queries.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

interface OrgResult {
  organizationId: string;
  newCount: number;
  updatedCount: number;
  keywordsSearched: number;
  error?: string;
}

async function runSweep(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized.", "unauthorized", 401);
  }

  const admin = createAdminClient();
  const orgIds = await listActiveGrantsGovOrgIds(admin);

  // Sequential, not parallel — mirrors /api/cron/research's posture so one
  // org's Grants.gov calls never overlap with another's within this sweep.
  const results: OrgResult[] = [];
  for (const organizationId of orgIds) {
    try {
      const result = await syncGrantsGovForOrg(admin, organizationId);
      results.push({ organizationId, ...result });
    } catch (err) {
      results.push({
        organizationId,
        newCount: 0,
        updatedCount: 0,
        keywordsSearched: 0,
        error: err instanceof Error ? err.message : "Sync failed.",
      });
    }
  }

  return NextResponse.json({
    mode: "cron",
    organizationsScanned: orgIds.length,
    newCount: results.reduce((sum, r) => sum + r.newCount, 0),
    updatedCount: results.reduce((sum, r) => sum + r.updatedCount, 0),
    organizations: results,
  });
}

// Vercel Cron issues GET. POST is accepted too for manual/ops invocation
// behind the same secret (matches /api/cron/research).
export async function GET(request: Request) {
  return runSweep(request);
}

export async function POST(request: Request) {
  return runSweep(request);
}
