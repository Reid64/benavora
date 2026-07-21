import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

// GET/POST /api/admin/system — platform-wide system health for the
// /admin/system dashboard. GET is admin-or-owner (same gate as the existing
// /api/admin/monitor); the destructive POST action is owner-only.
export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

type WorkerStatusRow = {
  id: string;
  worker_id: string;
  status: string;
  last_heartbeat_at: string;
  started_at: string;
  items_processed: number;
  items_failed: number;
  version: string | null;
};

type RunningAgentRow = {
  id: string;
  organization_id: string;
  agent_type: string;
  started_at: string | null;
  created_at: string;
};

type OrgLite = { id: string; name: string };

export async function GET() {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // This route doubles as the Supabase connectivity check: if any of these
  // queries throws, the platform's own DB connection is unhealthy, which is
  // itself the signal the "Supabase connection status" card exists to show —
  // so it's reported as a degraded 200, not a 500.
  let results;
  try {
    results = await Promise.all([
      admin
        .from("worker_status")
        .select(
          "id, worker_id, status, last_heartbeat_at, started_at, items_processed, items_failed, version",
        )
        .order("last_heartbeat_at", { ascending: false }),
      admin
        .from("agent_runs")
        .select("id, organization_id, agent_type, started_at, created_at")
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("submission_queue")
        .select("id", { count: "exact", head: true })
        .in("status", ["queued", "processing"]),
      admin
        .from("agent_queue")
        .select("id", { count: "exact", head: true })
        .in("status", ["queued", "processing"]),
      admin
        .from("donor_discovery_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      admin
        .from("system_errors")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since24h),
      admin
        .from("agent_runs")
        .select("duration_ms")
        .gte("created_at", since24h)
        .not("duration_ms", "is", null),
      admin.from("organizations").select("id, name"),
    ]);
  } catch {
    return NextResponse.json({
      supabase_healthy: false,
      workers: [],
      running_agents: [],
      queue_depths: { submission_queue: 0, agent_queue: 0, donor_discovery_requests: 0 },
      error_count_24h: 0,
      avg_agent_run_duration_ms_24h: null,
    });
  }

  const [
    workerStatusRes,
    runningAgentsRes,
    submissionQueueDepthRes,
    agentQueueDepthRes,
    ddRequestsDepthRes,
    errors24hRes,
    agentRuns24hRes,
    orgsRes,
  ] = results;

  const orgNameById = new Map(
    ((orgsRes?.data ?? []) as OrgLite[]).map((o) => [o.id, o.name]),
  );

  const runningAgents = ((runningAgentsRes?.data ?? []) as RunningAgentRow[]).map(
    (row) => ({
      ...row,
      organization_name: orgNameById.get(row.organization_id) ?? "Unknown org",
    }),
  );

  const durations = (
    (agentRuns24hRes?.data ?? []) as { duration_ms: number | null }[]
  )
    .map((r) => r.duration_ms)
    .filter((v): v is number => typeof v === "number");
  const avgAgentRunDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((sum, v) => sum + v, 0) / durations.length)
      : null;

  const now = Date.now();
  const workers = ((workerStatusRes?.data ?? []) as WorkerStatusRow[]).map((w) => {
    const ageMs = now - new Date(w.last_heartbeat_at).getTime();
    return {
      ...w,
      // A worker with no heartbeat in 5+ minutes is treated as unresponsive
      // regardless of its own last-written `status` field.
      isStale: ageMs > 5 * 60 * 1000,
    };
  });

  return NextResponse.json({
    supabase_healthy: true,
    workers,
    running_agents: runningAgents,
    queue_depths: {
      submission_queue: submissionQueueDepthRes?.count ?? 0,
      agent_queue: agentQueueDepthRes?.count ?? 0,
      donor_discovery_requests: ddRequestsDepthRes?.count ?? 0,
    },
    error_count_24h: errors24hRes?.count ?? 0,
    // No API-latency instrumentation exists anywhere in this codebase (grep
    // confirmed no response_time/api_latency tracking table) — average
    // agent_runs.duration_ms over the last 24h is the closest real,
    // non-fabricated timing signal available, so it's surfaced as its own
    // honestly-labeled field rather than mislabeled as "API response time".
    avg_agent_run_duration_ms_24h: avgAgentRunDurationMs,
  });
}

export async function POST(request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }
  const { action } = (body ?? {}) as { action?: unknown };

  if (action !== "clear_stuck_jobs") {
    return jsonError("Unknown action.", "invalid_action", 400);
  }

  const admin = createAdminClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("agent_runs")
    .update({
      status: "failed",
      error_message: "Cleared as stuck by platform admin (running > 2 hours).",
      completed_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("created_at", twoHoursAgo)
    .select("id");

  if (error) {
    return jsonError("Could not clear stuck jobs.", "clear_failed", 500);
  }

  return NextResponse.json({ ok: true, clearedCount: (data ?? []).length });
}
