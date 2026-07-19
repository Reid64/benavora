import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { FundabilityScorerAgent } from "@/lib/agents/fundability-scorer-agent";

// GET/POST /api/intelligence/fundability — AG-29 Fundability Scorer
// (AUTONOMOUS_PLATFORM_VISION.md §"Fundability Intelligence Score";
// src/lib/agents/fundability-scorer-agent.ts). Reads/writes fundability_scores
// (migration 091_fundability_intelligence_score.sql).
//
// GET  — ?opportunityId= optional. With it: this org's scores for that one
//        opportunity, most recent first. Without it: every fundability_scores
//        row for the org, most recent first (org-wide history/audit view).
// POST — { opportunityId? } optional. With an opportunityId: scores just that
//        one opportunity by seeding a single-item agent_queue "processing" row
//        (mirrors the shape worker/*'s real queue processor claims - see
//        FundabilityScorerAgent.loadChainScope()) and running the agent with
//        triggerSource "chain" so the user-requested opportunity is guaranteed
//        to be the one scored, rather than whatever the org-wide stale sweep
//        happens to pick. Without one: runs the agent's own default org-wide
//        scope ("manual" trigger, up to its internal per-run cap).

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

interface FundabilityScoreRow {
  id: string;
  opportunity_id: string | null;
  generated_at: string | null;
  [key: string]: unknown;
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const opportunityId = new URL(request.url).searchParams.get("opportunityId");

  let query = supabase
    .from("fundability_scores")
    .select("*")
    .eq("org_id", organizationId)
    .order("generated_at", { ascending: false });

  if (opportunityId) {
    query = query.eq("opportunity_id", opportunityId);
  }

  const { data, error } = await query;

  if (error) {
    return jsonError("Failed to load fundability scores.", "db_error", 500);
  }

  return NextResponse.json({ scores: (data ?? []) as FundabilityScoreRow[] });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { opportunityId } = (body ?? {}) as { opportunityId?: unknown };
  const targetOpportunityId =
    typeof opportunityId === "string" && opportunityId.trim() !== ""
      ? opportunityId.trim()
      : null;

  const agent = new FundabilityScorerAgent(organizationId, supabase);

  if (targetOpportunityId) {
    const { data: opportunity, error: oppError } = await supabase
      .from("opportunities")
      .select("id")
      .eq("id", targetOpportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (oppError || !opportunity) {
      return jsonError("Opportunity not found.", "not_found", 404);
    }

    const { data: queueRow, error: queueError } = await supabase
      .from("agent_queue")
      .insert({
        org_id: organizationId,
        agent_id: "ag-29-fundability",
        status: "processing",
        trigger_source: "manual",
        input_payload: { opportunityIds: [targetOpportunityId] },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (queueError || !queueRow) {
      return jsonError(
        "Failed to queue fundability analysis.",
        "queue_insert_failed",
        500,
      );
    }

    const result = await agent.run("chain");

    await supabase
      .from("agent_queue")
      .update({
        status: result.success ? "completed" : "failed",
        completed_at: new Date().toISOString(),
        error_message: result.errors[0] ?? null,
      })
      .eq("id", (queueRow as { id: string }).id);

    if (!result.success) {
      return jsonError(
        result.errors[0] ?? "Fundability analysis failed.",
        "fundability_run_failed",
        500,
      );
    }
  } else {
    const result = await agent.run("manual");
    if (!result.success) {
      return jsonError(
        result.errors[0] ?? "Fundability analysis failed.",
        "fundability_run_failed",
        500,
      );
    }
  }

  let query = supabase
    .from("fundability_scores")
    .select("*")
    .eq("org_id", organizationId)
    .order("generated_at", { ascending: false });

  if (targetOpportunityId) {
    query = query.eq("opportunity_id", targetOpportunityId);
  }

  const { data, error } = await query;

  if (error) {
    return jsonError("Failed to load fundability scores.", "db_error", 500);
  }

  return NextResponse.json({ scores: (data ?? []) as FundabilityScoreRow[] });
}
