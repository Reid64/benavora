import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { SimulationAgent } from "@/lib/agents/simulation-agent";

// POST/GET /api/reports/simulate — AG-37 Simulation Agent
// (AUTONOMOUS_PLATFORM_VISION.md Phase 4 "Predictive Fundraising Simulator",
// src/lib/agents/simulation-agent.ts). Claude call inside SimulationAgent.run()
// can run close to a minute — maxDuration=300 per BLUEPRINT_v2.md §8.1.
//
// SimulationAgent.run() has no direct-input parameter (AutonomousAgent's
// signature only takes triggerSource) — per the agent file's own header
// comment, the established convention is to hand it a scenario spec via an
// agent_queue row already marked "processing" for this (org_id, agent_id)
// pair, which loadScenarioInput() reads back out. This route creates that
// row itself (status inserted directly as "processing", never "queued" —
// this call is synchronous, not something the background queue processor
// should also try to claim) rather than going through the async
// /api/autonomous/trigger path, since the caller needs the finished
// simulation_scenarios row back in the same request.

export const runtime = "nodejs";
export const maxDuration = 300;

const SCENARIO_TYPES = [
  "board_expansion",
  "staff_hire",
  "geographic_expansion",
  "new_program",
  "budget_increase",
  "partnership",
] as const;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { scenarioType, variables } = (body ?? {}) as {
    scenarioType?: unknown;
    variables?: unknown;
  };

  if (
    typeof scenarioType !== "string" ||
    !(SCENARIO_TYPES as readonly string[]).includes(scenarioType)
  ) {
    return jsonError(
      `scenarioType must be one of: ${SCENARIO_TYPES.join(", ")}.`,
      "invalid_input",
      400,
    );
  }

  const { data: queueRow, error: queueError } = await supabase
    .from("agent_queue")
    .insert({
      org_id: organizationId,
      agent_id: "ag-37-simulation",
      priority: 5,
      status: "processing",
      trigger_source: "manual",
      input_payload: {
        scenarioType,
        variables: variables && typeof variables === "object" ? variables : {},
      },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (queueError || !queueRow) {
    return jsonError("Could not start the simulation run.", "queue_failed", 500);
  }
  const queueItemId = (queueRow as { id: string }).id;

  const agent = new SimulationAgent(organizationId, supabase);
  const result = await agent.run("manual");

  await supabase
    .from("agent_queue")
    .update({
      status: result.success ? "completed" : "failed",
      completed_at: new Date().toISOString(),
      error_message: result.success ? null : (result.errors[0] ?? null),
    })
    .eq("id", queueItemId);

  if (!result.success || result.decisions.length === 0) {
    return jsonError(
      result.errors[0] ?? "Simulation run did not produce a result.",
      "simulation_failed",
      500,
    );
  }

  const scenarioId = result.decisions[0];
  const { data: scenario, error: scenarioError } = await supabase
    .from("simulation_scenarios")
    .select("*")
    .eq("id", scenarioId)
    .single();

  if (scenarioError || !scenario) {
    return jsonError(
      "Simulation completed but the scenario record could not be loaded.",
      "scenario_load_failed",
      500,
    );
  }

  return NextResponse.json({ scenario });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("simulation_scenarios")
    .select("*")
    .eq("org_id", organizationId)
    .order("generated_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load past simulations.", "db_error", 500);
  }

  return NextResponse.json({ scenarios: data ?? [] });
}
