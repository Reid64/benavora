import { NextResponse } from "next/server";

import { requirePilRole } from "@/lib/feature-flags/pil";
import { getPilClient } from "@/lib/pil/db";

// GET /api/pil/research/[runId] — full ResearchRun with its steps.

export const runtime = "nodejs";

type RouteContext = { params: { runId: string } };

export async function GET(_req: Request, { params }: RouteContext) {
  const gate = await requirePilRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const { data: run, error } = await getPilClient()
    .from("pil_research_runs")
    .select("*")
    .eq("id", params.runId)
    .eq("organization_id", organizationId)
    .single();

  if (error || !run) {
    return NextResponse.json({ error: "Research run not found." }, { status: 404 });
  }

  const { data: steps, error: stepsError } = await getPilClient()
    .from("pil_research_run_steps")
    .select("*")
    .eq("research_run_id", params.runId)
    .order("step_number", { ascending: true });

  if (stepsError) {
    return NextResponse.json({ error: "Failed to load research run steps." }, { status: 500 });
  }

  return NextResponse.json({ run, steps: steps ?? [] });
}
