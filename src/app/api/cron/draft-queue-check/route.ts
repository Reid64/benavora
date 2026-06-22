import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { DraftQueueEngine } from "@/lib/drafts/draft-queue-engine";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

// Draft queue check cron (BEHAVIORAL_CONTRACTS §28, CLAUDE.md §AUTONOMOUS).
// Runs after research completes (triggered externally or on a schedule) to scan
// newly discovered opportunities and queue eligible ones for auto-drafting.
//
// This is lighter-weight than draft-automation: it only calls
// processNewOpportunities() — no draft generation. Draft generation happens in
// the heavier draft-automation cron or the auto-generator triggered inline.

export const runtime = "nodejs";
export const maxDuration = 120;

type TypedClient = SupabaseClient<Database>;

interface OrgReport {
  organizationId: string;
  queued: number;
  skipped_low_score: number;
  skipped_excluded: number;
  skipped_duplicate: number;
  error?: string;
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

async function getEnabledOrgIds(admin: TypedClient): Promise<string[]> {
  const { data, error } = await admin
    .from("draft_automation_config")
    .select("organization_id")
    .eq("is_enabled", true);

  if (error || !data) return [];

  return Array.from(
    new Set(
      (data as Array<{ organization_id: string }>)
        .map((r) => r.organization_id)
        .filter(Boolean),
    ),
  );
}

async function processOrg(
  admin: TypedClient,
  organizationId: string,
): Promise<OrgReport> {
  const base: OrgReport = {
    organizationId,
    queued: 0,
    skipped_low_score: 0,
    skipped_excluded: 0,
    skipped_duplicate: 0,
  };

  try {
    const engine = new DraftQueueEngine(admin);
    const result = await engine.processNewOpportunities(organizationId);
    base.queued = result.queued;
    base.skipped_low_score = result.skipped_low_score;
    base.skipped_excluded = result.skipped_excluded;
    base.skipped_duplicate = result.skipped_duplicate;
  } catch (err: unknown) {
    base.error = err instanceof Error ? err.message : "Unknown error.";
  }

  return base;
}

async function runCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized.", "unauthorized", 401);
  }

  const admin = createAdminClient();
  const orgIds = await getEnabledOrgIds(admin);

  const reports: OrgReport[] = [];
  for (const orgId of orgIds) {
    const report = await processOrg(admin, orgId);
    reports.push(report);
  }

  const totalQueued = reports.reduce((s, r) => s + r.queued, 0);

  return NextResponse.json({
    mode: "cron",
    organizationsScanned: orgIds.length,
    totalQueued,
    organizations: reports,
  });
}

export async function GET(request: Request) {
  return runCron(request);
}

export async function POST(request: Request) {
  return runCron(request);
}
