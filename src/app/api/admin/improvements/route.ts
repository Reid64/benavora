// GET /api/admin/improvements — platform-wide improvement proposals feed for
// the AG-38 Self-Improvement Agent review UI (/admin/improvements). Reads
// improvement_proposals and agent_performance_metrics (migration
// 087_continuous_improvement.sql), both platform-wide tables with no RLS —
// gated at the app layer via requireRole, same precedent as
// /api/admin/monitor and /api/admin/platform-metrics: requireRole
// authenticates + confirms rank, then every query runs on the service-role
// client (src/lib/supabase/admin.ts) with no organization_id filter.
//
// Returns proposals (optionally filtered by ?status=), summary stats for the
// header stat row, and a 7-day-aggregated agent_performance_metrics table —
// one response for the whole page rather than three separate routes, since
// none of that data is org-scoped or needs independent refresh cadences.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["proposed", "approved", "rejected", "implemented", "rolled_back"];
const METRICS_LOOKBACK_DAYS = 7;

interface ProposalRow {
  id: string;
  proposal_type: string;
  title: string;
  description: string;
  evidence: string;
  expected_impact: string;
  risk_level: string | null;
  status: string;
  confidence_score: number | null;
  proposed_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  implemented_at: string | null;
}

interface MetricRow {
  agent_id: string;
  runs_total: number;
  runs_successful: number;
  avg_confidence_score: number | null;
  decisions_requiring_review: number | null;
  decisions_auto_approved: number | null;
}

function utcDateKey(daysAgo: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  return d.toISOString().slice(0, 10);
}

function startOfCurrentMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function GET(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");

  let proposalsQuery = admin
    .from("improvement_proposals")
    .select(
      "id, proposal_type, title, description, evidence, expected_impact, risk_level, status, confidence_score, proposed_at, reviewed_at, reviewed_by, implemented_at",
    )
    .order("proposed_at", { ascending: false });

  if (statusFilter && VALID_STATUSES.includes(statusFilter)) {
    proposalsQuery = proposalsQuery.eq("status", statusFilter);
  }

  const [
    { data: proposalRows, error: proposalsError },
    { count: totalProposed },
    { count: awaitingReview },
    { count: approvedThisMonth },
    { count: implementedCount },
    { data: metricRows, error: metricsError },
  ] = await Promise.all([
    proposalsQuery,
    admin.from("improvement_proposals").select("id", { count: "exact", head: true }),
    admin
      .from("improvement_proposals")
      .select("id", { count: "exact", head: true })
      .eq("status", "proposed"),
    admin
      .from("improvement_proposals")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .gte("reviewed_at", startOfCurrentMonthISO()),
    admin
      .from("improvement_proposals")
      .select("id", { count: "exact", head: true })
      .eq("status", "implemented"),
    admin
      .from("agent_performance_metrics")
      .select("agent_id, runs_total, runs_successful, avg_confidence_score, decisions_requiring_review, decisions_auto_approved")
      .gte("metric_date", utcDateKey(METRICS_LOOKBACK_DAYS - 1)),
  ]);

  if (proposalsError) {
    return NextResponse.json(
      { error: "Failed to load improvement proposals.", code: "db_error" },
      { status: 500 },
    );
  }
  if (metricsError) {
    return NextResponse.json(
      { error: "Failed to load agent performance metrics.", code: "db_error" },
      { status: 500 },
    );
  }

  interface Agg {
    runsTotal: number;
    runsSuccessful: number;
    confidenceWeightedSum: number;
    confidenceWeight: number;
    requiringReview: number;
    autoApproved: number;
  }
  const aggregates = new Map<string, Agg>();
  for (const row of (metricRows ?? []) as MetricRow[]) {
    const agg = aggregates.get(row.agent_id) ?? {
      runsTotal: 0,
      runsSuccessful: 0,
      confidenceWeightedSum: 0,
      confidenceWeight: 0,
      requiringReview: 0,
      autoApproved: 0,
    };
    agg.runsTotal += row.runs_total;
    agg.runsSuccessful += row.runs_successful;
    if (row.avg_confidence_score !== null && row.runs_total > 0) {
      agg.confidenceWeightedSum += row.avg_confidence_score * row.runs_total;
      agg.confidenceWeight += row.runs_total;
    }
    agg.requiringReview += row.decisions_requiring_review ?? 0;
    agg.autoApproved += row.decisions_auto_approved ?? 0;
    aggregates.set(row.agent_id, agg);
  }

  const agentMetrics = Array.from(aggregates.entries())
    .map(([agentId, agg]) => {
      const totalDecisions = agg.requiringReview + agg.autoApproved;
      return {
        agentId,
        runsTotal: agg.runsTotal,
        successRate: agg.runsTotal > 0 ? agg.runsSuccessful / agg.runsTotal : null,
        avgConfidence:
          agg.confidenceWeight > 0
            ? Number((agg.confidenceWeightedSum / agg.confidenceWeight).toFixed(1))
            : null,
        decisionsPerRun: agg.runsTotal > 0 ? Number((totalDecisions / agg.runsTotal).toFixed(2)) : null,
        reviewRate: totalDecisions > 0 ? agg.requiringReview / totalDecisions : null,
      };
    })
    .sort((a, b) => b.runsTotal - a.runsTotal);

  return NextResponse.json({
    proposals: (proposalRows ?? []) as ProposalRow[],
    stats: {
      totalProposed: totalProposed ?? 0,
      awaitingReview: awaitingReview ?? 0,
      approvedThisMonth: approvedThisMonth ?? 0,
      implemented: implementedCount ?? 0,
    },
    agentMetrics,
  });
}
