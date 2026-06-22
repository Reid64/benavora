import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { DraftQueueEngine } from "@/lib/drafts/draft-queue-engine";
import { DraftAutoGenerator } from "@/lib/drafts/auto-generator";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

// Daily draft automation cron (BEHAVIORAL_CONTRACTS §28, CLAUDE.md §DEPLOYMENT).
// Vercel Cron hits GET daily at 06:00 CT (11:00 UTC). For every org with draft
// automation enabled, this route:
//   1. Queues items for opportunities whose deadlines are approaching.
//   2. Runs the auto-generator to produce drafts for pending queue items.
//
// maxDuration 300 is required because draft generation via the Anthropic API can
// take up to ~180 s per item (CLAUDE.md memory: AI routes need maxDuration 300).

export const runtime = "nodejs";
export const maxDuration = 300;

type TypedClient = SupabaseClient<Database>;

interface OrgReport {
  organizationId: string;
  deadline_queued: number;
  deadline_skipped_low_score: number;
  deadline_skipped_excluded: number;
  deadline_skipped_duplicate: number;
  generated: number;
  failed: number;
  skipped_limit: number;
  remaining_budget: number;
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
    deadline_queued: 0,
    deadline_skipped_low_score: 0,
    deadline_skipped_excluded: 0,
    deadline_skipped_duplicate: 0,
    generated: 0,
    failed: 0,
    skipped_limit: 0,
    remaining_budget: 0,
  };

  try {
    const engine = new DraftQueueEngine(admin);
    const generator = new DraftAutoGenerator(admin);

    const deadlineResult = await engine.processDeadlineApproaching(organizationId);
    base.deadline_queued = deadlineResult.queued;
    base.deadline_skipped_low_score = deadlineResult.skipped_low_score;
    base.deadline_skipped_excluded = deadlineResult.skipped_excluded;
    base.deadline_skipped_duplicate = deadlineResult.skipped_duplicate;

    const genResult = await generator.processQueue(organizationId);
    base.generated = genResult.generated;
    base.failed = genResult.failed;
    base.skipped_limit = genResult.skipped_limit;
    base.remaining_budget = genResult.remaining_budget;
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

  const totalGenerated = reports.reduce((s, r) => s + r.generated, 0);
  const totalQueued = reports.reduce((s, r) => s + r.deadline_queued, 0);

  return NextResponse.json({
    mode: "cron",
    organizationsProcessed: orgIds.length,
    totalDeadlineQueued: totalQueued,
    totalGenerated,
    organizations: reports,
  });
}

export async function GET(request: Request) {
  return runCron(request);
}

export async function POST(request: Request) {
  return runCron(request);
}
