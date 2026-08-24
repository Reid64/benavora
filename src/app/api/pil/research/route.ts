import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createResearchRun } from "@/lib/pil/workflow";

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

export async function POST(request: Request) {
  const gate = await requireRole("writer");
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

  return NextResponse.json({ runId: run.id, status: run.status });
}
