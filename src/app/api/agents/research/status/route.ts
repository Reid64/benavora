import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { AgentRunStatus, AgentType } from "@/types/agents";

// Research run status feed (AGENTS.md §15, BLUEPRINT §3.1 "Research").
//
// GET returns the organization's most recent agent_runs for the run-history
// table on the Research page. Authenticates via the session and derives
// organization_id server-side from the profile - never from the request
// (Contracts §2, §16); RLS is the second barrier on the query.
//
// Query params (all optional):
//   - agentType: filter to one agent_type enum value
//   - status:    filter to one agent_run_status enum value
//   - limit:     max rows (default 20, clamped to 1..100)

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const AGENT_TYPES: ReadonlySet<string> = new Set<AgentType>([
  "corporate_research",
  "foundation_research",
  "government_research",
  "local_sponsorship",
  "eligibility_scoring",
  "deadline_extraction",
  "grant_summary",
  "fit_analysis",
  "narrative_drafting",
  "budget_builder",
  "compliance_check",
  "review",
  "final_assembly",
  "recursive_learning",
  "cold_outreach",
]);

const RUN_STATUSES: ReadonlySet<string> = new Set<AgentRunStatus>([
  "pending",
  "running",
  "completed",
  "failed",
]);

const RUN_COLUMNS =
  "id, agent_type, status, items_found, items_processed, duration_ms, error_message, created_at";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profile.organization_id as string;

  const url = new URL(request.url);
  const agentTypeParam = url.searchParams.get("agentType");
  const statusParam = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");

  if (agentTypeParam && !AGENT_TYPES.has(agentTypeParam)) {
    return jsonError("Invalid agentType.", "invalid_input", 400);
  }
  if (statusParam && !RUN_STATUSES.has(statusParam)) {
    return jsonError("Invalid status.", "invalid_input", 400);
  }

  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return jsonError("Invalid limit.", "invalid_input", 400);
    }
    limit = Math.min(Math.floor(parsed), MAX_LIMIT);
  }

  let query = supabase
    .from("agent_runs")
    .select(RUN_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (agentTypeParam) query = query.eq("agent_type", agentTypeParam);
  if (statusParam) query = query.eq("status", statusParam);

  const { data, error } = await query;
  if (error) {
    return jsonError("Could not load agent runs.", "load_failed", 500);
  }

  return NextResponse.json({ runs: data ?? [] });
}
