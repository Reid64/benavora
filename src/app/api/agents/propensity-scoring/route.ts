// AG-22 Propensity Scoring route — POST /api/agents/propensity-scoring
//
// AG-22 (src/lib/agents/ag-22-propensity-scoring.ts) already runs
// automatically per-prospect via worker/enrichment-processor.ts's
// triggerScoreEngine(), right after a corporate_prospects row's
// enrichment_completed_at is stamped. This route is the manual/backfill path
// that was missing: it lets an operator (re)score a specific prospect, or
// sweep the backlog of already-enriched-but-never-scored prospects (the
// "only 1/49 scored" gap — every prospect enriched before AG-22 was wired
// up, or whose automatic trigger silently failed, has enrichment_completed_at
// set but scores_computed_at still null and no way to retry).
//
// Body: { prospect_id: string } for a single prospect, or
//       { prospect_ids?: string[]; limit?: number } for a batch run — when
//       prospect_ids is omitted, the batch scorer queries the next `limit`
//       (default 10, max 25) unscored-but-enriched prospects itself.
// Query: ?batch=true forces batch mode even when the body also has a single
//       prospect_id.
//
// corporate_prospects is a shared, cross-org reference table with no
// organization_id column (107_corporate_prospects.sql: "NO RLS: shared
// public/cross-org reference data, same convention as foundation_directory").
// This route does not add per-org filtering to that table — there is no such
// column to filter on, and doing so would contradict the documented design.
// organizationId here is only the audit-trail value on the agent_runs row
// this run logs under (Contracts §15: agents never fail/run silently).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { AgentError } from "@/lib/agents/base-agent";
import {
  PropensityBatchScorer,
  PropensityScoringAgent,
} from "@/lib/agents/ag-22-propensity-scoring";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const {
    prospect_id: prospectId,
    prospect_ids: prospectIds,
    limit,
  } = (body ?? {}) as {
    prospect_id?: unknown;
    prospect_ids?: unknown;
    limit?: unknown;
  };

  const url = new URL(request.url);
  const batchMode =
    url.searchParams.get("batch") === "true" ||
    (Array.isArray(prospectIds) && prospectIds.length > 0) ||
    (typeof prospectId !== "string" && limit !== undefined);

  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) return overLimit;

  try {
    if (!batchMode) {
      if (typeof prospectId !== "string" || prospectId.trim() === "") {
        return jsonError(
          "prospect_id is required for a single-prospect run, or pass prospect_ids/batch=true for a batch run.",
          "invalid_input",
          400,
        );
      }

      const agent = new PropensityScoringAgent({
        client: supabase,
        organizationId,
        triggeredBy: userId,
      });
      const outcome = await agent.run({ prospectId: prospectId.trim() });
      return NextResponse.json({ data: outcome.data, agent_run_id: outcome.runId });
    }

    const cleanIds = Array.isArray(prospectIds)
      ? prospectIds.filter((v): v is string => typeof v === "string" && v.trim() !== "")
      : undefined;
    const cleanLimit = typeof limit === "number" ? limit : undefined;

    const scorer = new PropensityBatchScorer({
      client: supabase,
      organizationId,
      triggeredBy: userId,
    });
    const outcome = await scorer.run({ prospectIds: cleanIds, limit: cleanLimit });
    return NextResponse.json({ data: outcome.data, agent_run_id: outcome.runId });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    return jsonError(
      "Propensity scoring agent failed. Please try again.",
      "agent_failed",
      500,
    );
  }
}
