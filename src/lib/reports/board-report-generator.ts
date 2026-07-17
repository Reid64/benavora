import type { SupabaseClient } from "@supabase/supabase-js";

export interface TopFunder {
  funderId: string;
  funderName: string;
  applicationCount: number;
}

export interface UpcomingDeadline {
  opportunityId: string;
  name: string;
  deadline: string;
  funderName: string | null;
}

export interface BoardReportSummary {
  dateRange: { from: string; to: string };
  opportunitiesCreated: number;
  applicationsSubmitted: number;
  totalAwarded: number;
  outcomesRecorded: number;
  outcomesAwarded: number;
  successRate: number;
  topFunders: TopFunder[];
  upcomingDeadlines: UpcomingDeadline[];
  narrativeSummary: string;
}

type FunderJoinRow = {
  id: string;
  opportunities: {
    funder_id: string | null;
    funders: { id: string; name: string } | null;
  } | null;
};

type DeadlineRow = {
  id: string;
  name: string;
  deadline: string;
  funders: { name: string } | null;
};

type OutcomeRow = {
  result: string;
  awarded_amount: number | null;
};

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function buildNarrativeSummary(input: {
  dateFrom: string;
  dateTo: string;
  opportunitiesCreated: number;
  applicationsSubmitted: number;
  totalAwarded: number;
  outcomesRecorded: number;
  successRate: number;
  topFunders: TopFunder[];
  upcomingDeadlines: UpcomingDeadline[];
}): string {
  const {
    dateFrom,
    dateTo,
    opportunitiesCreated,
    applicationsSubmitted,
    totalAwarded,
    outcomesRecorded,
    successRate,
    topFunders,
    upcomingDeadlines,
  } = input;

  const successRatePct = Math.round(successRate * 100);

  const outcomesSentence =
    outcomesRecorded > 0
      ? `${outcomesRecorded} outcome${outcomesRecorded === 1 ? " was" : "s were"} recorded during this period, resulting in ${formatMoney(totalAwarded)} awarded and a ${successRatePct}% success rate.`
      : `No outcomes were recorded during this period.`;

  const topFunderSentence =
    topFunders.length > 0
      ? `${topFunders[0]!.funderName} led funder engagement with ${topFunders[0]!.applicationCount} application${topFunders[0]!.applicationCount === 1 ? "" : "s"}.`
      : `No funder applications were recorded in this period.`;

  const deadlineSentence =
    upcomingDeadlines.length > 0
      ? `${upcomingDeadlines.length} deadline${upcomingDeadlines.length === 1 ? "" : "s"} fall${upcomingDeadlines.length === 1 ? "s" : ""} within the next 90 days.`
      : `No deadlines fall within the next 90 days.`;

  return `Between ${dateFrom} and ${dateTo}, the organization identified ${opportunitiesCreated} new funding ${opportunitiesCreated === 1 ? "opportunity" : "opportunities"} and submitted ${applicationsSubmitted} application${applicationsSubmitted === 1 ? "" : "s"}. ${outcomesSentence} ${topFunderSentence} ${deadlineSentence}`;
}

export async function generateBoardReport(
  orgId: string,
  dateFrom: string,
  dateTo: string,
  supabase: SupabaseClient,
): Promise<BoardReportSummary> {
  const rangeEnd = `${dateTo}T23:59:59.999Z`;
  const now = new Date().toISOString();
  const in90Days = new Date(
    Date.now() + 90 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    opportunitiesRes,
    applicationsRes,
    outcomesRes,
    topFundersRes,
    upcomingDeadlinesRes,
  ] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id", { count: "exact" })
      .eq("organization_id", orgId)
      .gte("created_at", dateFrom)
      .lte("created_at", rangeEnd),

    supabase
      .from("applications")
      .select("id", { count: "exact" })
      .eq("organization_id", orgId)
      .not("submitted_at", "is", null)
      .gte("submitted_at", dateFrom)
      .lte("submitted_at", rangeEnd),

    supabase
      .from("outcomes")
      .select("result, awarded_amount")
      .eq("organization_id", orgId)
      .gte("recorded_at", dateFrom)
      .lte("recorded_at", rangeEnd),

    supabase
      .from("applications")
      .select("id, opportunities(funder_id, funders(id, name))")
      .eq("organization_id", orgId)
      .gte("created_at", dateFrom)
      .lte("created_at", rangeEnd),

    supabase
      .from("opportunities")
      .select("id, name, deadline, funders(name)")
      .eq("organization_id", orgId)
      .not("deadline", "is", null)
      .gte("deadline", now)
      .lte("deadline", in90Days)
      .order("deadline", { ascending: true }),
  ]);

  const outcomes = (outcomesRes.data ?? []) as OutcomeRow[];
  const outcomesRecorded = outcomes.length;
  const outcomesAwarded = outcomes.filter((o) => o.result === "awarded").length;
  const totalAwarded = outcomes.reduce(
    (sum, o) => sum + (o.awarded_amount ?? 0),
    0,
  );
  const successRate =
    outcomesRecorded > 0 ? outcomesAwarded / outcomesRecorded : 0;

  const funderCounts = new Map<
    string,
    { funderName: string; count: number }
  >();
  for (const row of (topFundersRes.data ?? []) as unknown as FunderJoinRow[]) {
    const funder = row.opportunities?.funders;
    if (!funder) continue;
    const entry = funderCounts.get(funder.id) ?? {
      funderName: funder.name,
      count: 0,
    };
    entry.count += 1;
    funderCounts.set(funder.id, entry);
  }
  const topFunders: TopFunder[] = Array.from(funderCounts.entries())
    .map(([funderId, { funderName, count }]) => ({
      funderId,
      funderName,
      applicationCount: count,
    }))
    .sort((a, b) => b.applicationCount - a.applicationCount)
    .slice(0, 5);

  const upcomingDeadlines: UpcomingDeadline[] = (
    (upcomingDeadlinesRes.data ?? []) as unknown as DeadlineRow[]
  ).map((row) => ({
    opportunityId: row.id,
    name: row.name,
    deadline: row.deadline,
    funderName: row.funders?.name ?? null,
  }));

  const opportunitiesCreated = opportunitiesRes.count ?? 0;
  const applicationsSubmitted = applicationsRes.count ?? 0;

  const narrativeSummary = buildNarrativeSummary({
    dateFrom,
    dateTo,
    opportunitiesCreated,
    applicationsSubmitted,
    totalAwarded,
    outcomesRecorded,
    successRate,
    topFunders,
    upcomingDeadlines,
  });

  return {
    dateRange: { from: dateFrom, to: dateTo },
    opportunitiesCreated,
    applicationsSubmitted,
    totalAwarded,
    outcomesRecorded,
    outcomesAwarded,
    successRate,
    topFunders,
    upcomingDeadlines,
    narrativeSummary,
  };
}
