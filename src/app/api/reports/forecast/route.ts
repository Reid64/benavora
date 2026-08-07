import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { FundingForecastAgent } from "@/lib/agents/funding-forecast-agent";

// GET/POST /api/reports/forecast — AG-26 Funding Forecast Agent
// (src/lib/agents/funding-forecast-agent.ts). AG-26 has no event/queue
// trigger of its own — its only production trigger is
// runFundingForecastMonthlyPipeline() in worker/autonomous-orchestrator.ts,
// gated on the 1st of the month at 4AM America/Chicago. This route is a
// second, independent on-demand trigger (same relationship AG-25's
// /api/agents/disaster POST has to its own absent schedule, and AG-41's
// /api/agents/simulate has to its deliberately-absent schedule) — it does
// not touch or bypass the monthly cron gate. Backs the /reports/forecast
// dashboard page (FEATURE_REGISTRY_v2.md row #133).
//
// FundingForecastAgent.run() takes only a triggerSource (unlike
// SimulationAgent, it has no scenario-input parameter to stage via
// agent_queue first) — it computes deterministically from this org's real
// opportunities/scores/outcomes and writes both funding_forecasts rows
// (90_day, 12_month) directly. Claude call inside generateNarratives() can
// run close to a minute — maxDuration=300 per BLUEPRINT_v2.md §8.1.

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const agent = new FundingForecastAgent(organizationId, supabase);
  const result = await agent.run("manual");

  if (!result.success) {
    return jsonError(
      result.errors[0] ?? "Funding forecast generation failed.",
      "forecast_failed",
      500,
    );
  }

  const { data, error } = await supabase
    .from("funding_forecasts")
    .select("*")
    .eq("org_id", organizationId)
    .order("forecast_date", { ascending: false })
    .order("forecast_period", { ascending: true });

  if (error) {
    return jsonError(
      "Forecast completed but the resulting rows could not be loaded.",
      "forecast_load_failed",
      500,
    );
  }

  return NextResponse.json({ forecasts: data ?? [] });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("funding_forecasts")
    .select("*")
    .eq("org_id", organizationId)
    .order("forecast_date", { ascending: false })
    .order("forecast_period", { ascending: true });

  if (error) {
    return jsonError("Failed to load funding forecasts.", "db_error", 500);
  }

  return NextResponse.json({ forecasts: data ?? [] });
}
