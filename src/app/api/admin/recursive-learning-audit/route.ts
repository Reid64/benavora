import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/recursive-learning-audit - visibility into the Recursive
// Learning Agent (Agent 10): when it fired, off which outcome, what it wrote
// to proven_narratives. Owner/admin only, same gate as /api/admin/audit-log.
// Admins see their own org; owners get the platform-wide view and may narrow
// to one org via ?orgId=.
//
// Reads agent_runs rows with agent_type='recursive_learning'. The triggering
// outcome id lives in input_params->>outcomeId (BaseAgent logs the raw
// {outcomeId} input passed to RecursiveLearningAgent.run()); resolved here
// against outcomes/applications/opportunities for a readable label, and
// against proven_narratives (by outcome_id) to show what was actually
// learned on that run.

export const runtime = "nodejs";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

interface AgentRunRow {
  id: string;
  organization_id: string;
  status: string;
  input_params: unknown;
  output_summary: string | null;
  items_found: number | null;
  items_processed: number | null;
  error_message: string | null;
  tokens_used: number | null;
  duration_ms: number | null;
  triggered_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export async function GET(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userRole } = gate;
  const isOwner = userRole === "owner";

  const reader = isOwner ? createAdminClient() : supabase;

  const url = new URL(request.url);
  const orgId = isOwner ? url.searchParams.get("orgId") : null;
  const status = url.searchParams.get("status");
  const limitParam = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

  let query = reader
    .from("agent_runs")
    .select(
      "id, organization_id, status, input_params, output_summary, items_found, items_processed, error_message, tokens_used, duration_ms, triggered_by, started_at, completed_at, created_at",
    )
    .eq("agent_type", "recursive_learning");

  if (!isOwner) query = query.eq("organization_id", organizationId);
  else if (orgId) query = query.eq("organization_id", orgId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json(
      { error: "Could not load the recursive learning audit.", code: "load_failed" },
      { status: 500 },
    );
  }
  const runs = (data ?? []) as AgentRunRow[];

  const outcomeIds = Array.from(
    new Set(
      runs
        .map((r) => {
          const params = r.input_params as { outcomeId?: unknown } | null;
          return typeof params?.outcomeId === "string" ? params.outcomeId : null;
        })
        .filter((id): id is string => id !== null),
    ),
  );

  const outcomeById = new Map<
    string,
    { application_id: string; result: string; funder_category: string | null }
  >();
  const applicationLabelById = new Map<string, string>();
  const provenByOutcomeId = new Map<
    string,
    { id: string; section_type: string | null; success_count: number | null; effectiveness_score: number | null }[]
  >();

  if (outcomeIds.length > 0) {
    const { data: outcomeRows } = await reader
      .from("outcomes")
      .select("id, application_id, result, funder_category")
      .in("id", outcomeIds);
    for (const o of (outcomeRows ?? []) as {
      id: string;
      application_id: string;
      result: string;
      funder_category: string | null;
    }[]) {
      outcomeById.set(o.id, o);
    }

    const applicationIds = Array.from(
      new Set(Array.from(outcomeById.values()).map((o) => o.application_id)),
    );
    if (applicationIds.length > 0) {
      const { data: appRows } = await reader
        .from("applications")
        .select("id, opportunity_id")
        .in("id", applicationIds);
      const opportunityIdByApp = new Map(
        (appRows ?? []).map((a) => [a.id as string, a.opportunity_id as string]),
      );
      const opportunityIds = Array.from(
        new Set(Array.from(opportunityIdByApp.values()).filter(Boolean)),
      );
      const oppNameById = new Map<string, string>();
      if (opportunityIds.length > 0) {
        const { data: oppRows } = await reader
          .from("opportunities")
          .select("id, name")
          .in("id", opportunityIds);
        for (const o of (oppRows ?? []) as { id: string; name: string }[]) {
          oppNameById.set(o.id, o.name);
        }
      }
      for (const [appId, oppId] of opportunityIdByApp.entries()) {
        applicationLabelById.set(appId, oppNameById.get(oppId) ?? "Application");
      }
    }

    const { data: provenRows } = await reader
      .from("proven_narratives")
      .select("id, outcome_id, section_type, success_count, effectiveness_score")
      .in("outcome_id", outcomeIds);
    for (const p of (provenRows ?? []) as {
      id: string;
      outcome_id: string;
      section_type: string | null;
      success_count: number | null;
      effectiveness_score: number | null;
    }[]) {
      const list = provenByOutcomeId.get(p.outcome_id) ?? [];
      list.push({
        id: p.id,
        section_type: p.section_type,
        success_count: p.success_count,
        effectiveness_score: p.effectiveness_score,
      });
      provenByOutcomeId.set(p.outcome_id, list);
    }
  }

  const triggeredByIds = Array.from(
    new Set(runs.map((r) => r.triggered_by).filter((id): id is string => Boolean(id))),
  );
  const userMap = new Map<string, { name: string | null; email: string | null }>();
  if (triggeredByIds.length > 0) {
    const { data: profiles } = await reader
      .from("profiles")
      .select("id, full_name, email")
      .in("id", triggeredByIds);
    for (const p of (profiles ?? []) as {
      id: string;
      full_name: string | null;
      email: string | null;
    }[]) {
      userMap.set(p.id, { name: p.full_name, email: p.email });
    }
  }

  const orgNameById = new Map<string, string>();
  if (isOwner) {
    const orgIds = Array.from(new Set(runs.map((r) => r.organization_id)));
    if (orgIds.length > 0) {
      const { data: orgs } = await reader
        .from("organizations")
        .select("id, name")
        .in("id", orgIds);
      for (const o of (orgs ?? []) as { id: string; name: string }[]) {
        orgNameById.set(o.id, o.name);
      }
    }
  }

  const entries = runs.map((r) => {
    const params = r.input_params as { outcomeId?: unknown } | null;
    const outcomeId = typeof params?.outcomeId === "string" ? params.outcomeId : null;
    const outcome = outcomeId ? outcomeById.get(outcomeId) : undefined;
    const triggeredBy = r.triggered_by ? userMap.get(r.triggered_by) : null;
    const provenTouched = outcomeId ? provenByOutcomeId.get(outcomeId) ?? [] : [];

    return {
      id: r.id,
      organizationId: r.organization_id,
      organizationName: isOwner ? orgNameById.get(r.organization_id) ?? null : null,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      durationMs: r.duration_ms,
      tokensUsed: r.tokens_used,
      itemsFound: r.items_found,
      itemsProcessed: r.items_processed,
      outputSummary: r.output_summary,
      errorMessage: r.error_message,
      triggeredByName: triggeredBy?.name ?? null,
      triggeredByEmail: triggeredBy?.email ?? null,
      outcomeId,
      outcomeResult: outcome?.result ?? null,
      funderCategory: outcome?.funder_category ?? null,
      applicationLabel: outcome
        ? applicationLabelById.get(outcome.application_id) ?? "Application"
        : null,
      provenNarrativesTouched: provenTouched.map((p) => ({
        id: p.id,
        sectionType: p.section_type,
        successCount: p.success_count,
        effectivenessScore: p.effectiveness_score,
      })),
    };
  });

  const organizations = isOwner
    ? Array.from(orgNameById.entries()).map(([id, name]) => ({ id, name }))
    : [];

  return NextResponse.json({
    entries,
    isOwner,
    organizations,
    summary: {
      totalRuns: entries.length,
      completed: entries.filter((e) => e.status === "completed").length,
      failed: entries.filter((e) => e.status === "failed").length,
      provenNarrativesWritten: entries.reduce(
        (sum, e) => sum + e.provenNarrativesTouched.length,
        0,
      ),
    },
  });
}
