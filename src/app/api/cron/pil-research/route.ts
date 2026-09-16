import { NextResponse } from "next/server";

import { pollAndOrchestratePendingRuns } from "@/lib/pil/research-orchestrator";

// PIL research-run poller (Phase 5.3). PIL_WIRING_AUDIT.md (2026-09-15) found
// orchestrateResearchRun()/pollAndOrchestratePendingRuns() had zero callers
// anywhere in src/ or worker/ -- every pil_research_runs row (including ones
// a human manually triggered via POST /api/pil/research or /api/pil/discover)
// just sat in "planning"/"running" forever. This is the reliable, resumable
// driver: orchestrateResearchRun() checkpoints per-family progress in
// structured_plan, so a run that doesn't finish inside one invocation picks
// up where it left off on the next poll rather than restarting.
//
// Rows only exist for orgs that passed isPilEnabledForOrg()'s LaunchDarkly
// rollout gate at creation time (every route that calls createResearchRun()
// checks it first) -- this poller does not need its own separate org gate.
//
// limit is kept modest (not "all pending runs") to bound a single
// invocation's runtime given maxDuration below and this route's 10-minute
// schedule (vercel.json).

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
}

async function runPoll(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });
  }

  const results = await pollAndOrchestratePendingRuns({ limit: 5 });

  const byStatus = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    polled: results.length,
    by_status: byStatus,
    run_ids: results.map((r) => r.runId),
  });
}

export async function GET(request: Request) {
  return runPoll(request);
}

export async function POST(request: Request) {
  return runPoll(request);
}
