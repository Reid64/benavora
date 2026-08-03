import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  ImpactSimulationAgent,
  SCENARIO_TYPES,
  type ScenarioType,
} from "@/lib/agents/impact-simulation-agent";

// POST /api/agents/simulate — AG-41 Impact Simulation Agent
// (AGENTS_v2.md §5, AG-41). This is the spec's own one real trigger for
// this agent — manual only, no schedule, no queue (see the agent file's
// header for why an autonomous trigger would be wrong for this specific
// agent). ImpactSimulationAgent.run()'s Claude call can take close to a
// minute — maxDuration=300 per BLUEPRINT_v2.md §8.1, same convention as
// every other AI-calling route in this codebase.
//
// organizationId is derived server-side from the caller's session via
// requireRole(), never from the request body (Behavioral Contracts §2) —
// the same pattern every other write-triggering agent route in this
// codebase already follows (see src/app/api/reports/simulate/route.ts for
// AG-37's identical convention).

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Minimal shape validation per scenario_type, matching the exact required
 * fields the agent's own compute*() methods enforce (AGENTS_v2.md §5,
 * AG-41's Process section) — done here too so an obviously-malformed
 * request 400s immediately rather than spending an agent_runs row and a
 * Claude call on a doomed run. This does not replace the agent's own
 * validation (defense in depth — ImpactSimulationAgent is also directly
 * callable outside this route), it just avoids the wasted round-trip for
 * the one real caller. */
function validateScenarioParams(
  scenarioType: ScenarioType,
  params: Record<string, unknown>,
): string | null {
  switch (scenarioType) {
    case "lose_funder":
      if (typeof params.funderId !== "string" || params.funderId.trim() === "") {
        return "scenario_params.funderId (a string) is required for lose_funder.";
      }
      return null;
    case "gain_funder":
      if (
        typeof params.estimatedAnnualAmount !== "number" ||
        !Number.isFinite(params.estimatedAnnualAmount) ||
        params.estimatedAnnualAmount <= 0
      ) {
        return "scenario_params.estimatedAnnualAmount (a positive number) is required for gain_funder.";
      }
      return null;
    case "program_expansion":
      if (
        typeof params.newProgramAnnualBudget !== "number" ||
        !Number.isFinite(params.newProgramAnnualBudget) ||
        params.newProgramAnnualBudget <= 0
      ) {
        return "scenario_params.newProgramAnnualBudget (a positive number) is required for program_expansion.";
      }
      if (
        typeof params.additionalStaffCount !== "number" ||
        !Number.isFinite(params.additionalStaffCount) ||
        params.additionalStaffCount < 0
      ) {
        return "scenario_params.additionalStaffCount (a non-negative number) is required for program_expansion.";
      }
      return null;
    case "budget_cut":
      if (
        typeof params.cutPercentage !== "number" ||
        !Number.isFinite(params.cutPercentage) ||
        params.cutPercentage <= 0 ||
        params.cutPercentage > 100
      ) {
        return "scenario_params.cutPercentage (a number in (0, 100]) is required for budget_cut.";
      }
      return null;
  }
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { scenario_type, scenario_params } = (body ?? {}) as {
    scenario_type?: unknown;
    scenario_params?: unknown;
  };

  if (
    typeof scenario_type !== "string" ||
    !(SCENARIO_TYPES as readonly string[]).includes(scenario_type)
  ) {
    return jsonError(
      `scenario_type must be one of: ${SCENARIO_TYPES.join(", ")}.`,
      "invalid_scenario_type",
      400,
    );
  }
  const scenarioType = scenario_type as ScenarioType;

  const params =
    scenario_params && typeof scenario_params === "object"
      ? (scenario_params as Record<string, unknown>)
      : {};

  const paramError = validateScenarioParams(scenarioType, params);
  if (paramError) {
    return jsonError(paramError, "invalid_scenario_params", 400);
  }

  const agent = new ImpactSimulationAgent(organizationId, supabase);
  const result = await agent.run("manual", scenarioType, params, userId);

  if (!result.success || result.decisions.length === 0) {
    return jsonError(
      result.errors[0] ?? "Simulation run did not produce a result.",
      "simulation_failed",
      500,
    );
  }

  const simulationId = result.decisions[0];
  const { data: simulation, error: simulationError } = await supabase
    .from("impact_simulations")
    .select("*")
    .eq("id", simulationId)
    .single();

  if (simulationError || !simulation) {
    return jsonError(
      "Simulation completed but the record could not be loaded.",
      "simulation_load_failed",
      500,
    );
  }

  return NextResponse.json({ simulation });
}
