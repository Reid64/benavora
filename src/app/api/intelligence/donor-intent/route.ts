import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { DonorIntentMonitorAgent } from "@/lib/agents/donor-intent-monitor-agent";

// GET/POST /api/intelligence/donor-intent — AG-30 Donor Intent Monitor
// (AUTONOMOUS_PLATFORM_VISION.md §7 "AI Donor Intent Engine";
// src/lib/agents/donor-intent-monitor-agent.ts). Reads/writes
// corporate_intent_signals (migration 093_donor_intent_engine.sql).
//
// GET  — the caller's org's signals, intent_score descending then
//        created_at descending (matches idx_intent_signals_org). Accepts
//        an optional ?minScore= query param to filter low-score signals
//        out at the DB layer rather than client-side.
// POST — runs DonorIntentMonitorAgent synchronously ("manual" trigger),
//        then returns the caller's now-current signals.

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const minScoreParam = searchParams.get("minScore");
  const minScore = minScoreParam !== null ? Number(minScoreParam) : null;

  let query = supabase
    .from("corporate_intent_signals")
    .select("*")
    .eq("org_id", organizationId);

  if (minScore !== null && Number.isFinite(minScore)) {
    query = query.gte("intent_score", minScore);
  }

  const { data, error } = await query
    .order("intent_score", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load donor intent signals.", "db_error", 500);
  }

  return NextResponse.json({ signals: data ?? [] });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const agent = new DonorIntentMonitorAgent(organizationId, supabase);
  const result = await agent.run("manual");

  if (!result.success) {
    return jsonError(
      result.errors[0] ?? "Donor intent monitoring run failed.",
      "monitor_run_failed",
      500,
    );
  }

  const { data, error } = await supabase
    .from("corporate_intent_signals")
    .select("*")
    .eq("org_id", organizationId)
    .order("intent_score", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load donor intent signals.", "db_error", 500);
  }

  return NextResponse.json({
    signals: data ?? [],
    itemsFound: result.itemsFound,
    itemsProcessed: result.itemsProcessed,
    itemsQueued: result.itemsQueued,
    errors: result.errors,
  });
}
