import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { callClaude } from "@/lib/ai/claude";
import { createResearchRun, advanceRunState } from "@/lib/pil/workflow";

// POST /api/pil/discover — natural-language prospect discovery. Translates a
// free-text request into a structured ResearchPlan via the Claude API, then
// starts a pil_research_runs row carrying that plan. pil_research_runs has no
// dedicated columns for the plan's individual fields (intent, geography,
// cause_taxonomy, etc.) -- they are folded into structured_plan the same way
// every other planning call in this codebase does it (see workflow.ts's own
// header note and BEN-SUP-01's advanceRunState(..., { agent_family }) call).

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export interface DiscoveryResearchPlan {
  intent: string;
  entities: string[];
  geography: string[];
  time_horizon: string | null;
  cause_taxonomy: string[];
  inclusion_criteria: string[];
  exclusion_criteria: string[];
  required_evidence: string[];
  depth: "shallow" | "standard" | "deep";
  candidate_limit: number;
  data_source_plan: string[];
  agent_assignments: string[];
  tool_budgets: Record<string, number>;
  confidence_threshold: number;
  ranking_methodology: string;
  stop_conditions: string[];
}

const PLAN_SYSTEM_PROMPT = `You are the Research Strategy translator for the Benavora Prospect Intelligence Layer.
Convert the user's natural-language prospect-discovery request into a single, strict JSON object -- no prose, no markdown code fences -- with EXACTLY these keys:
intent (string), entities (string[]), geography (string[]), time_horizon (string or null), cause_taxonomy (string[]), inclusion_criteria (string[]), exclusion_criteria (string[]), required_evidence (string[]), depth ("shallow" | "standard" | "deep"), candidate_limit (integer), data_source_plan (string[]), agent_assignments (string[]), tool_budgets (an object mapping tool name to a number), confidence_threshold (number between 0 and 1), ranking_methodology (string), stop_conditions (string[]).
Output only the JSON object and nothing else.`;

function parsePlan(text: string): DiscoveryResearchPlan | null {
  const trimmed = text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as DiscoveryResearchPlan;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId, userId } = gate;

  let body: { query?: string; limit?: number };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
    return jsonError("query is required.", "missing_query", 400);
  }

  const userPrompt = `Discovery request: "${body.query}"${body.limit ? `\nRequested candidate limit: ${body.limit}` : ""}`;

  let claudeResponse;
  try {
    claudeResponse = await callClaude({ prompt: userPrompt, system: PLAN_SYSTEM_PROMPT, temperature: 0 });
  } catch {
    return jsonError("Failed to reach the model gateway.", "model_gateway_error", 502);
  }

  const plan = parsePlan(claudeResponse.text);
  if (!plan) {
    return jsonError("Model did not return a valid research plan.", "invalid_plan", 502);
  }
  if (body.limit && !plan.candidate_limit) {
    plan.candidate_limit = body.limit;
  }

  const run = await createResearchRun({
    orgId: organizationId,
    prospectId: null,
    runType: "discovery",
    goal: body.query,
    triggeredBy: userId,
  });
  await advanceRunState(run.id, "running", { natural_language_plan: plan });

  return NextResponse.json({ runId: run.id, plan });
}
