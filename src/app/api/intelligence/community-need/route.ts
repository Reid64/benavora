import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { CommunityNeedPredictorAgent } from "@/lib/agents/community-need-predictor-agent";

// GET/POST /api/intelligence/community-need — AG-35 Community Need Predictor
// (AUTONOMOUS_PLATFORM_VISION.md §7 "Community Need Prediction";
// src/lib/agents/community-need-predictor-agent.ts). Reads/writes
// community_need_signals (migration 090_community_need_prediction.sql).
//
// GET  — the caller's org's signals, severity first (critical > high >
//        medium > low) then created_at descending. supabase-js's .order()
//        can't rank a text column by an arbitrary order, so a single
//        created_at-ordered fetch is re-sorted by severity rank here.
// POST — runs CommunityNeedPredictorAgent synchronously ("manual" trigger),
//        then returns the caller's now-current signals.

export const runtime = "nodejs";
export const maxDuration = 300;

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

interface SignalRow {
  id: string;
  severity: string | null;
  created_at: string;
  [key: string]: unknown;
}

function sortBySeverityThenCreatedAt(rows: SignalRow[]): SignalRow[] {
  return [...rows].sort((a, b) => {
    const severityDiff =
      (SEVERITY_RANK[a.severity ?? ""] ?? 9) -
      (SEVERITY_RANK[b.severity ?? ""] ?? 9);
    if (severityDiff !== 0) return severityDiff;
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("community_need_signals")
    .select("*")
    .eq("org_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load community need signals.", "db_error", 500);
  }

  return NextResponse.json({
    signals: sortBySeverityThenCreatedAt((data ?? []) as SignalRow[]),
  });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const agent = new CommunityNeedPredictorAgent(organizationId, supabase);
  const result = await agent.run("manual");

  if (!result.success) {
    return jsonError(
      result.errors[0] ?? "Community need prediction run failed.",
      "predictor_run_failed",
      500,
    );
  }

  const { data, error } = await supabase
    .from("community_need_signals")
    .select("*")
    .eq("org_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load community need signals.", "db_error", 500);
  }

  return NextResponse.json({
    signals: sortBySeverityThenCreatedAt((data ?? []) as SignalRow[]),
    itemsFound: result.itemsFound,
    itemsProcessed: result.itemsProcessed,
    errors: result.errors,
  });
}
