import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { populateQueue } from "@/lib/autoapply/auto-queue-populator";
import { sendAutoapplyDigest } from "@/lib/autoapply/digest-email";

export const runtime = "nodejs";
export const maxDuration = 60;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const SCHEDULE_INTERVALS: Record<string, number> = {
  nightly: DAY_MS,
  twice_daily: 12 * HOUR_MS,
  weekly: 7 * DAY_MS,
};

function isDue(lastRunAt: string | null, scheduleKey: string): boolean {
  const intervalMs = SCHEDULE_INTERVALS[scheduleKey] ?? DAY_MS;
  if (!lastRunAt) return true;
  const t = Date.parse(lastRunAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= intervalMs;
}

async function runAutoQueue(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: configs, error: configError } = await admin
    .from("auto_queue_config")
    .select("*")
    .eq("enabled", true);

  if (configError) {
    return NextResponse.json({ error: "Could not load configs.", code: "load_failed" }, { status: 500 });
  }

  const rows = configs ?? [];
  const results: Array<{
    org_id: string;
    status: "queued" | "skipped_schedule" | "error";
    queued?: number;
    skipped?: number;
    error?: string;
  }> = [];

  for (const config of rows) {
    const orgId = config.organization_id;

    if (!isDue(config.last_run_at, config.schedule)) {
      results.push({ org_id: orgId, status: "skipped_schedule" });
      continue;
    }

    try {
      const digestSince = config.last_run_at ? new Date(config.last_run_at) : new Date(Date.now() - DAY_MS);

      const result = await populateQueue({
        organizationId: orgId,
        supabase: admin,
        maxItems: config.max_per_batch,
        dry_run: false,
        filters: {
          categories: config.categories ?? undefined,
          geographicScope: config.geographic_scope ?? undefined,
          excludeFunderIds: config.exclusion_list ?? undefined,
        },
      });

      await admin
        .from("auto_queue_config")
        .update({
          last_run_at: new Date().toISOString(),
          last_run_queued: result.queued,
          last_run_skipped: result.skipped,
        })
        .eq("organization_id", orgId);

      await sendAutoapplyDigest({ organizationId: orgId, supabase: admin, since: digestSince });

      console.info(`Auto-queue for org ${orgId}: queued ${result.queued}, skipped ${result.skipped}`);
      results.push({ org_id: orgId, status: "queued", queued: result.queued, skipped: result.skipped });
    } catch (err) {
      results.push({
        org_id: orgId,
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    processed: results.filter((r) => r.status === "queued").length,
    results,
  });
}

export async function GET(request: Request) {
  return runAutoQueue(request);
}
