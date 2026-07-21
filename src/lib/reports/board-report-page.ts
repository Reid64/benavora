import type { SupabaseClient } from "@supabase/supabase-js";

import { aggregateBoardReportData, type BoardReportData } from "@/lib/reports/board-report";

// Data aggregator for the in-app printable board report page
// (/reports/board-report, backed by /api/reports/board-report/detail and
// /api/reports/board-report/executive-summary). Distinct from
// board-report-generator.ts (the lighter GET /api/reports/board-report
// summary widget on /reports) and board-report.ts + pdf-generator.ts (the
// POST /api/reports/board PDF-download flow) — this page renders its own
// printable HTML layout instead of a PDF, so it needs a richer aggregate
// than either existing shape provides (agent activity split into runs vs.
// drafts vs. discoveries, a 60-day deadline table, and strategic_recommendations).

export interface KeyWin {
  opportunityName: string;
  funderName: string | null;
  category: string | null;
  awardedAmount: number;
  recordedAt: string;
}

export interface UpcomingDeadlineRow {
  opportunityId: string;
  name: string;
  funderName: string | null;
  deadline: string;
  amountMax: number | null;
  probabilityScore: number | null;
  recommendation: string | null;
}

export interface AiPlatformActivity {
  agentRuns: number;
  draftsGenerated: number;
  opportunitiesDiscovered: number;
}

export interface RecommendedAction {
  id: string;
  category: string;
  title: string;
  recommendation: string;
  reasoning: string;
  urgency: string;
  confidenceScore: number | null;
  generatedAt: string;
}

export interface BoardReportPageData {
  core: BoardReportData;
  keyWins: KeyWin[];
  upcomingDeadlines: UpcomingDeadlineRow[];
  aiActivity: AiPlatformActivity;
  recommendedActions: RecommendedAction[];
}

interface OutcomeAwardRow {
  id: string;
  awarded_amount: number | null;
  recorded_at: string;
  application_id: string | null;
}

interface ApplicationJoinRow {
  id: string;
  opportunities: {
    name: string;
    category: string | null;
    funders: { name: string } | null;
  } | null;
}

interface OpportunityDeadlineRow {
  id: string;
  name: string;
  deadline: string;
  amount_max: number | null;
  probability_score: number | null;
  recommendation: string | null;
  funders: { name: string } | null;
}

interface StrategicRecommendationRow {
  id: string;
  recommendation_category: string;
  title: string;
  recommendation: string;
  reasoning: string;
  urgency: string;
  confidence_score: number | null;
  generated_at: string;
}

export async function aggregateBoardReportPageData(
  supabase: SupabaseClient,
  organizationId: string,
  startDate: string,
  endDate: string,
): Promise<BoardReportPageData> {
  const endTimestamp = endDate + "T23:59:59Z";
  const now = new Date().toISOString();
  const in60Days = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const [core, keyWinsRes, deadlinesRes, draftsRes, discoveredRes, recommendationsRes] = await Promise.all([
    aggregateBoardReportData(supabase, organizationId, startDate, endDate),

    supabase
      .from("outcomes")
      .select("id, awarded_amount, recorded_at, application_id")
      .eq("organization_id", organizationId)
      .eq("result", "awarded")
      .gte("recorded_at", startDate)
      .lte("recorded_at", endTimestamp)
      .order("recorded_at", { ascending: false })
      .limit(10),

    supabase
      .from("opportunities")
      .select("id, name, deadline, amount_max, probability_score, recommendation, funders(name)")
      .eq("organization_id", organizationId)
      .not("deadline", "is", null)
      .gte("deadline", now)
      .lte("deadline", in60Days)
      .order("deadline", { ascending: true })
      .limit(15),

    supabase
      .from("draft_versions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", startDate)
      .lte("created_at", endTimestamp),

    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("discovered_at", startDate)
      .lte("discovered_at", endTimestamp),

    supabase
      .from("strategic_recommendations")
      .select("id, recommendation_category, title, recommendation, reasoning, urgency, confidence_score, generated_at")
      .eq("org_id", organizationId)
      .eq("status", "pending")
      .in("urgency", ["immediate", "urgent"])
      .order("generated_at", { ascending: false })
      .limit(20),
  ]);

  // Key wins — enrich awarded outcomes with opportunity name / category / funder.
  const awardRows = (keyWinsRes.data ?? []) as OutcomeAwardRow[];
  const applicationIds = awardRows
    .map((r) => r.application_id)
    .filter((id): id is string => id !== null);

  let keyWins: KeyWin[] = [];
  if (applicationIds.length > 0) {
    const { data: appRows } = await supabase
      .from("applications")
      .select("id, opportunities(name, category, funders(name))")
      .in("id", applicationIds);
    const appMap = new Map(
      ((appRows ?? []) as unknown as ApplicationJoinRow[]).map((r) => [r.id, r.opportunities]),
    );
    keyWins = awardRows.map((row) => {
      const opp = row.application_id ? appMap.get(row.application_id) : null;
      return {
        opportunityName: opp?.name ?? "Unknown Opportunity",
        funderName: opp?.funders?.name ?? null,
        category: opp?.category ?? null,
        awardedAmount: row.awarded_amount ?? 0,
        recordedAt: row.recorded_at,
      };
    });
  }

  const upcomingDeadlines: UpcomingDeadlineRow[] = (
    (deadlinesRes.data ?? []) as unknown as OpportunityDeadlineRow[]
  ).map((row) => ({
    opportunityId: row.id,
    name: row.name,
    funderName: row.funders?.name ?? null,
    deadline: row.deadline,
    amountMax: row.amount_max,
    probabilityScore: row.probability_score,
    recommendation: row.recommendation,
  }));

  const aiActivity: AiPlatformActivity = {
    agentRuns: core.agentActivity.reduce((sum, a) => sum + a.runs, 0),
    draftsGenerated: draftsRes.count ?? 0,
    opportunitiesDiscovered: discoveredRes.count ?? 0,
  };

  const recommendedActions: RecommendedAction[] = (
    (recommendationsRes.data ?? []) as StrategicRecommendationRow[]
  ).map((row) => ({
    id: row.id,
    category: row.recommendation_category,
    title: row.title,
    recommendation: row.recommendation,
    reasoning: row.reasoning,
    urgency: row.urgency,
    confidenceScore: row.confidence_score,
    generatedAt: row.generated_at,
  }));

  return { core, keyWins, upcomingDeadlines, aiActivity, recommendedActions };
}

export function buildExecutiveSummaryPrompt(data: BoardReportPageData): string {
  const { core, keyWins, upcomingDeadlines, aiActivity, recommendedActions } = data;

  const winRate =
    core.executive.awards + core.executive.denials > 0
      ? Math.round((core.executive.awards / (core.executive.awards + core.executive.denials)) * 100)
      : 0;

  const winsSummary = keyWins
    .slice(0, 5)
    .map((w) => `  - ${w.opportunityName}${w.funderName ? ` (${w.funderName})` : ""} — $${w.awardedAmount.toLocaleString()}`)
    .join("\n");

  const deadlinesSummary = upcomingDeadlines
    .slice(0, 5)
    .map((d) => `  - ${d.name}${d.funderName ? ` (${d.funderName})` : ""} — due ${d.deadline.split("T")[0]}`)
    .join("\n");

  const actionsSummary = recommendedActions
    .slice(0, 5)
    .map((a) => `  - [${a.urgency}] ${a.title}`)
    .join("\n");

  return `You are an expert nonprofit consultant writing a board-ready executive summary. Write exactly one paragraph of approximately 200 words summarizing this reporting period's fundraising performance for the board of directors. Be specific with numbers, professional in tone, and prose only (no bullet points, no headers). Return only the paragraph text, nothing else.

ORGANIZATION: ${core.organization.name}
REPORT PERIOD: ${core.dateRange.start} to ${core.dateRange.end}
${core.organization.mission ? `MISSION: ${core.organization.mission}` : ""}

KEY METRICS:
  Applications Submitted: ${core.executive.applicationsSubmitted}
  Awards: ${core.executive.awards} | Denials: ${core.executive.denials} | Win Rate: ${winRate}%
  Total Requested: $${core.executive.totalRequested.toLocaleString()}
  Total Awarded: $${core.executive.totalAwarded.toLocaleString()}

KEY WINS:
${winsSummary || "  None this period."}

UPCOMING DEADLINES (next 60 days):
${deadlinesSummary || "  None in the next 60 days."}

AI PLATFORM ACTIVITY:
  ${aiActivity.agentRuns} agent runs, ${aiActivity.draftsGenerated} drafts generated, ${aiActivity.opportunitiesDiscovered} opportunities discovered.

RECOMMENDED BOARD ACTIONS:
${actionsSummary || "  None flagged as immediate/urgent."}`;
}
