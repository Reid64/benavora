import type { SupabaseClient } from "@supabase/supabase-js";

export interface ExecutiveSummary {
  totalOpportunities: number;
  applicationsSubmitted: number;
  awards: number;
  denials: number;
  totalRequested: number;
  totalAwarded: number;
}

export interface PipelineStage {
  stage: string;
  count: number;
}

export interface RecentSubmission {
  opportunityName: string;
  requestedAmount: number | null;
  submittedAt: string;
  stage: string;
}

export interface RecentAward {
  opportunityName: string;
  awardedAmount: number;
  recordedAt: string;
}

export interface AgentActivityItem {
  agentType: string;
  runs: number;
  successRate: number;
}

export interface FinancialItem {
  category: string;
  requested: number;
  awarded: number;
}

export interface TrendPeriod {
  submitted: number;
  awarded: number;
  totalRequested: number;
}

export interface BoardReportData {
  dateRange: { start: string; end: string };
  organization: { name: string; ein: string | null; mission: string | null };
  executive: ExecutiveSummary;
  pipeline: PipelineStage[];
  recentSubmissions: RecentSubmission[];
  recentAwards: RecentAward[];
  agentActivity: AgentActivityItem[];
  financial: FinancialItem[];
  trend: { currentPeriod: TrendPeriod; priorPeriod: TrendPeriod };
}

export async function aggregateBoardReportData(
  supabase: SupabaseClient,
  organizationId: string,
  startDate: string,
  endDate: string,
): Promise<BoardReportData> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const durationMs = end.getTime() - start.getTime();
  const priorStart = new Date(start.getTime() - durationMs)
    .toISOString()
    .split("T")[0]!;
  const endTimestamp = endDate + "T23:59:59Z";
  const priorEndTimestamp = startDate + "T00:00:00Z";

  const [
    orgRes,
    opportunitiesRes,
    applicationsRes,
    currentOutcomesRes,
    priorOutcomesRes,
    agentRunsRes,
    recentAwardsRes,
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, ein, mission_statement")
      .eq("id", organizationId)
      .single(),

    supabase
      .from("opportunities")
      .select("id", { count: "exact" })
      .eq("organization_id", organizationId),

    supabase
      .from("applications")
      .select(
        "id, stage, requested_amount, awarded_amount, submitted_at, opportunities(name, category)",
      )
      .eq("organization_id", organizationId),

    supabase
      .from("outcomes")
      .select("id, result, awarded_amount, requested_amount, recorded_at")
      .eq("organization_id", organizationId)
      .gte("recorded_at", startDate)
      .lte("recorded_at", endTimestamp),

    supabase
      .from("outcomes")
      .select("id, result, awarded_amount, requested_amount, recorded_at")
      .eq("organization_id", organizationId)
      .gte("recorded_at", priorStart)
      .lte("recorded_at", priorEndTimestamp),

    supabase
      .from("agent_runs")
      .select("id, agent_type, status, created_at")
      .eq("organization_id", organizationId)
      .gte("created_at", startDate)
      .lte("created_at", endTimestamp),

    supabase
      .from("outcomes")
      .select("awarded_amount, recorded_at, application_id")
      .eq("organization_id", organizationId)
      .eq("result", "awarded")
      .gte("recorded_at", startDate)
      .order("recorded_at", { ascending: false })
      .limit(10),
  ]);

  const org = orgRes.data as {
    name: string;
    ein: string | null;
    mission_statement: string | null;
  } | null;

  type AppRow = {
    id: string;
    stage: string;
    requested_amount: number | null;
    awarded_amount: number | null;
    submitted_at: string | null;
    opportunities: { name: string; category: string } | null;
  };
  const allApplications = (applicationsRes.data ?? []) as unknown as AppRow[];

  type OutcomeRow = {
    id: string;
    result: string;
    awarded_amount: number | null;
    requested_amount: number | null;
    recorded_at: string;
  };
  const currentOutcomes = (currentOutcomesRes.data ?? []) as OutcomeRow[];
  const priorOutcomes = (priorOutcomesRes.data ?? []) as OutcomeRow[];

  type AgentRunRow = { id: string; agent_type: string; status: string };
  const agentRuns = (agentRunsRes.data ?? []) as AgentRunRow[];

  // Pipeline snapshot - all applications grouped by stage
  const stageCounts = new Map<string, number>();
  for (const app of allApplications) {
    if (app.stage) {
      stageCounts.set(app.stage, (stageCounts.get(app.stage) ?? 0) + 1);
    }
  }
  const pipeline: PipelineStage[] = Array.from(stageCounts.entries()).map(
    ([stage, count]) => ({ stage, count }),
  );

  // Applications submitted within the date range
  const submittedInRange = allApplications.filter(
    (a) =>
      a.submitted_at &&
      a.submitted_at >= startDate &&
      a.submitted_at <= endTimestamp,
  );

  const awards = currentOutcomes.filter((o) => o.result === "awarded").length;
  const denials = currentOutcomes.filter((o) => o.result === "denied").length;
  const totalRequested = submittedInRange.reduce(
    (sum, a) => sum + (a.requested_amount ?? 0),
    0,
  );
  const totalAwarded = currentOutcomes
    .filter((o) => o.result === "awarded")
    .reduce((sum, o) => sum + (o.awarded_amount ?? 0), 0);

  const executive: ExecutiveSummary = {
    totalOpportunities: opportunitiesRes.count ?? 0,
    applicationsSubmitted: submittedInRange.length,
    awards,
    denials,
    totalRequested,
    totalAwarded,
  };

  const recentSubmissions: RecentSubmission[] = submittedInRange
    .sort((a, b) =>
      (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""),
    )
    .slice(0, 10)
    .map((a) => ({
      opportunityName: a.opportunities?.name ?? "Unknown",
      requestedAmount: a.requested_amount,
      submittedAt: a.submitted_at ?? "",
      stage: a.stage,
    }));

  // Recent awards - enrich with opportunity name via the application join
  const awardApplicationIds = (
    (recentAwardsRes.data ?? []) as Array<{
      awarded_amount: number | null;
      recorded_at: string;
      application_id: string | null;
    }>
  ).map((o) => o.application_id);

  const enrichedAwards: RecentAward[] = [];
  if (awardApplicationIds.length > 0) {
    const { data: appRows } = await supabase
      .from("applications")
      .select("id, opportunities(name)")
      .in(
        "id",
        awardApplicationIds.filter((id): id is string => id !== null),
      );
    const appNameMap = new Map<string, string>(
      ((appRows ?? []) as unknown as Array<{
        id: string;
        opportunities: { name: string } | null;
      }>).map((r) => [r.id, r.opportunities?.name ?? "Unknown"]),
    );

    for (const o of (recentAwardsRes.data ?? []) as Array<{
      awarded_amount: number | null;
      recorded_at: string;
      application_id: string | null;
    }>) {
      enrichedAwards.push({
        opportunityName: o.application_id
          ? (appNameMap.get(o.application_id) ?? "Unknown")
          : "Unknown",
        awardedAmount: o.awarded_amount ?? 0,
        recordedAt: o.recorded_at,
      });
    }
  }

  // Agent activity grouped by type
  const agentMap = new Map<string, { total: number; success: number }>();
  for (const run of agentRuns) {
    const type = run.agent_type;
    const entry = agentMap.get(type) ?? { total: 0, success: 0 };
    entry.total++;
    if (run.status === "completed") entry.success++;
    agentMap.set(type, entry);
  }
  const agentActivity: AgentActivityItem[] = Array.from(
    agentMap.entries(),
  ).map(([agentType, { total, success }]) => ({
    agentType,
    runs: total,
    successRate: total > 0 ? Math.round((success / total) * 100) : 0,
  }));

  // Financial summary by funder category
  const catMap = new Map<string, { requested: number; awarded: number }>();
  for (const app of allApplications) {
    const cat = app.opportunities?.category ?? "uncategorized";
    const entry = catMap.get(cat) ?? { requested: 0, awarded: 0 };
    entry.requested += app.requested_amount ?? 0;
    entry.awarded += app.awarded_amount ?? 0;
    catMap.set(cat, entry);
  }
  const financial: FinancialItem[] = Array.from(catMap.entries()).map(
    ([category, { requested, awarded }]) => ({ category, requested, awarded }),
  );

  // Trend comparison: prior period outcomes
  const priorAwarded = priorOutcomes
    .filter((o) => o.result === "awarded")
    .reduce((sum, o) => sum + (o.awarded_amount ?? 0), 0);
  const priorRequested = priorOutcomes.reduce(
    (sum, o) => sum + (o.requested_amount ?? 0),
    0,
  );

  return {
    dateRange: { start: startDate, end: endDate },
    organization: {
      name: org?.name ?? "Organization",
      ein: org?.ein ?? null,
      mission: org?.mission_statement ?? null,
    },
    executive,
    pipeline,
    recentSubmissions,
    recentAwards: enrichedAwards,
    agentActivity,
    financial,
    trend: {
      currentPeriod: {
        submitted: submittedInRange.length,
        awarded: totalAwarded,
        totalRequested,
      },
      priorPeriod: {
        submitted: priorOutcomes.length,
        awarded: priorAwarded,
        totalRequested: priorRequested,
      },
    },
  };
}

