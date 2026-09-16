import { NextResponse } from "next/server";

import { requirePilRole } from "@/lib/feature-flags/pil";
import { getPilClient } from "@/lib/pil/db";
import { createResearchRun } from "@/lib/pil/workflow";
import { orchestrateResearchRun } from "@/lib/pil/research-orchestrator";

// GET /api/pil/research — list the org's research runs, newest first. Added
// for the PIL dashboard's run monitor (intelligence/pil/research), which has
// no other way to enumerate runs — GET /api/pil/research/[runId] only ever
// returns one run.
// POST /api/pil/research — starts a Prospect Intelligence research run.
// (The task spec described this as POST /api/pil/research/start, but a
// Next.js route file at src/app/api/pil/research/route.ts only ever serves
// requests to /api/pil/research itself — a distinct /start path would need
// its own route.ts under a /start subdirectory. This keeps the one route
// this file can actually serve.)

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requirePilRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const { data, error } = await getPilClient()
    .from("pil_research_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load research runs.", "load_failed", 500);
  }

  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(request: Request) {
  const gate = await requirePilRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId, userId } = gate;

  let body: { prospectId?: string; goal?: string; runType?: string; depthTarget?: number };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  if (!body.goal) {
    return jsonError("goal is required.", "missing_goal", 400);
  }

  const run = await createResearchRun({
    orgId: organizationId,
    prospectId: body.prospectId ?? null,
    runType: body.runType,
    goal: body.goal,
    depthTarget: body.depthTarget,
    triggeredBy: userId,
  });

  // PIL_WIRING_AUDIT.md (2026-09-15) found orchestrateResearchRun() had zero
  // callers -- a manual trigger created this row and it then sat in
  // "planning" forever until the next /api/cron/pil-research poll (up to 10
  // minutes away). Drive it inline so a manual trigger works immediately;
  // the cron poller remains the reliable path for runs that don't finish
  // (or aren't started) within this route's maxDuration. orchestrateResearchRun
  // already persists its own failure state internally, so a throw here would
  // only mean the DB write for that failure state itself errored -- still
  // return the run id so the caller can poll GET /api/pil/research/[runId].
  let finalStatus = run.status;
  try {
    const finished = await orchestrateResearchRun(run.id);
    finalStatus = finished.status;
  } catch (err) {
    console.error("pil/research: orchestrateResearchRun threw unexpectedly", err);
  }

  return NextResponse.json({ runId: run.id, status: finalStatus });
}
