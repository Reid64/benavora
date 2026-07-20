import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET /api/autoapply/autonomous-status — read-only summary for the AutoApply
// controls page and the main AutoApply dashboard: this org's
// org_autonomous_config toggle values for the AutoApply overnight orchestrator
// (migration 092), the most recent completed run of that orchestrator, and
// how many autonomous-mode items are currently sitting in submission_queue.
//
// Real-schema note: the task spec's literal agent_type ("autoapply_autonomous")
// does not match the enum value migration 092 actually added
// ("autoapply_autonomous_orchestrator" — see
// worker/autoapply-autonomous-orchestrator.ts, the only writer of these rows).
// This route queries the real value so it actually finds rows.

export const runtime = "nodejs";

const AUTOAPPLY_AUTONOMOUS_AGENT_TYPE = "autoapply_autonomous_orchestrator";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const [configRes, lastRunRes, queueCountRes] = await Promise.all([
    supabase
      .from("org_autonomous_config")
      .select("auto_autoapply_enabled, max_nightly_autoapply_submissions")
      .eq("org_id", organizationId)
      .maybeSingle(),
    supabase
      .from("agent_runs")
      .select("completed_at, items_queued, items_processed")
      .eq("organization_id", organizationId)
      .eq("agent_type", AUTOAPPLY_AUTONOMOUS_AGENT_TYPE)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("submission_queue")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("automation_mode", "autonomous")
      .in("status", ["pending", "processing"]),
  ]);

  if (configRes.error) {
    return jsonError("Could not load autonomous AutoApply status.", "load_failed", 500);
  }

  const config = configRes.data as {
    auto_autoapply_enabled: boolean | null;
    max_nightly_autoapply_submissions: number | null;
  } | null;

  const lastRun = lastRunRes.data as {
    completed_at: string | null;
    items_queued: number | null;
    items_processed: number | null;
  } | null;

  return NextResponse.json({
    auto_autoapply_enabled: config?.auto_autoapply_enabled ?? false,
    max_nightly_autoapply_submissions: config?.max_nightly_autoapply_submissions ?? 50,
    last_run: lastRun
      ? {
          completed_at: lastRun.completed_at,
          count: lastRun.items_queued ?? lastRun.items_processed ?? 0,
        }
      : null,
    tonight_queue_count: queueCountRes.count ?? 0,
  });
}
