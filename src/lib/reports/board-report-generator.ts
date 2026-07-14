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
  topFunders: TopFunder[];
  upcomingDeadlines: UpcomingDeadline[];
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
      .select("id, awarded_amount")
      .eq("organization_id", orgId)
      .not("submitted_at", "is", null)
      .gte("submitted_at", dateFrom)
      .lte("submitted_at", rangeEnd),

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

  const applications = (applicationsRes.data ?? []) as Array<{
    id: string;
    awarded_amount: number | null;
  }>;
  const totalAwarded = applications.reduce(
    (sum, a) => sum + (a.awarded_amount ?? 0),
    0,
  );

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

  return {
    dateRange: { from: dateFrom, to: dateTo },
    opportunitiesCreated: opportunitiesRes.count ?? 0,
    applicationsSubmitted: applications.length,
    totalAwarded,
    topFunders,
    upcomingDeadlines,
  };
}
