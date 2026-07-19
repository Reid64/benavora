import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireRole } from "@/lib/auth/role-gate";
import { StrategicAdvisorAgent } from "@/lib/agents/strategic-advisor-agent";

// GET/POST/PATCH /api/intelligence/strategic-advisor — AG-40 Strategic
// Advisor (AUTONOMOUS_PLATFORM_VISION.md Phase 5, "AI Strategic Advisor";
// src/lib/agents/strategic-advisor-agent.ts). The capstone agent that
// synthesizes every other agent's output into a prioritized, proactive
// recommendation list written to strategic_recommendations (migration
// 086_strategic_advisor.sql).
//
// GET   — pending recommendations for the caller's org, urgency first
//         (immediate > urgent > normal > low) then confidence_score
//         descending. supabase-js's .order() has no way to rank a text
//         column by an arbitrary order, so a single confidence-ordered
//         fetch is re-sorted by urgency rank here.
// POST  — runs StrategicAdvisorAgent synchronously ("manual" trigger),
//         then returns the caller's now-current pending recommendations.
// PATCH { id, status } — updates one recommendation's status, scoped to
//         org_id so a forged id from another org silently no-ops. Sets
//         actioned_at when the new status is "actioned" (column exists
//         specifically for that per the migration).

export const runtime = "nodejs";
export const maxDuration = 300;

const URGENCY_RANK: Record<string, number> = {
  immediate: 0,
  urgent: 1,
  normal: 2,
  low: 3,
};

const VALID_STATUSES = ["pending", "actioned", "dismissed", "snoozed"];

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

interface RecommendationRow {
  id: string;
  urgency: string;
  confidence_score: number | null;
  [key: string]: unknown;
}

function sortByUrgencyThenConfidence(
  rows: RecommendationRow[],
): RecommendationRow[] {
  return [...rows].sort((a, b) => {
    const urgencyDiff =
      (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9);
    if (urgencyDiff !== 0) return urgencyDiff;
    return (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
  });
}

async function loadPendingRecommendations(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ rows: RecommendationRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("strategic_recommendations")
    .select("*")
    .eq("org_id", organizationId)
    .eq("status", "pending")
    .order("confidence_score", { ascending: false });

  if (error) {
    return { rows: [], error: error.message };
  }

  return {
    rows: sortByUrgencyThenConfidence((data ?? []) as RecommendationRow[]),
    error: null,
  };
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { rows, error } = await loadPendingRecommendations(
    supabase,
    organizationId,
  );
  if (error) {
    return jsonError("Failed to load strategic recommendations.", "db_error", 500);
  }

  return NextResponse.json({ recommendations: rows });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const agent = new StrategicAdvisorAgent(organizationId, supabase);
  const result = await agent.run("manual");

  if (!result.success) {
    return jsonError(
      result.errors[0] ?? "Strategic advisor run failed.",
      "advisor_run_failed",
      500,
    );
  }

  const { rows, error } = await loadPendingRecommendations(
    supabase,
    organizationId,
  );
  if (error) {
    return jsonError("Failed to load strategic recommendations.", "db_error", 500);
  }

  return NextResponse.json({
    recommendations: rows,
    itemsFound: result.itemsFound,
    itemsProcessed: result.itemsProcessed,
  });
}

export async function PATCH(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { id, status } = (body ?? {}) as { id?: unknown; status?: unknown };

  if (typeof id !== "string" || id.trim() === "") {
    return jsonError("id is required.", "invalid_input", 400);
  }
  if (typeof status !== "string" || !VALID_STATUSES.includes(status)) {
    return jsonError(
      `status must be one of: ${VALID_STATUSES.join(", ")}.`,
      "invalid_input",
      400,
    );
  }

  const update: Record<string, unknown> = { status };
  if (status === "actioned") {
    update.actioned_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("strategic_recommendations")
    .update(update)
    .eq("id", id.trim())
    .eq("org_id", organizationId);

  if (error) {
    return jsonError("Failed to update the recommendation.", "db_error", 500);
  }

  return NextResponse.json({ success: true });
}
