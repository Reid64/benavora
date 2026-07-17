// Predicts a deadline for every one of an organization's opportunities that
// doesn't have one on file yet (opportunities.deadline IS NULL).
//
// Preference order per opportunity:
//   1. Funder history - if this org has past opportunities from the same
//      funder that DO have a deadline, average their day-of-year and predict
//      the next occurrence of that day. Confidence scales with sample size.
//   2. Category default - government_grant assumes a federal fiscal
//      year-end deadline (Sept 30); private_foundation assumes the nearest
//      calendar-quarter end; corporate_* categories assume a rolling
//      ~90-day review cycle. All other categories fall back to the same
//      rolling estimate at low confidence.
//
// This is deliberately a separate, simpler heuristic from
// src/lib/agents/deadline-prediction.ts (which detects annual/quarterly
// patterns across ALL of an org's opportunities and auto-creates predicted
// opportunity rows). This module predicts a deadline for one existing
// undated opportunity at a time and never writes to the database itself.

const MS_PER_DAY = 86_400_000;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface DeadlinePredictionResult {
  opportunityId: string;
  opportunityTitle: string;
  predictedDeadline: string;
  confidence: number;
  basis: string;
}

type OpportunityRow = {
  id: string;
  name: string;
  funder_id: string | null;
  category: string | null;
};

type FunderDeadlineRow = {
  funder_id: string | null;
  deadline: string | null;
};

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / MS_PER_DAY) + 1;
}

function dateFromDayOfYear(year: number, day: number): Date {
  return new Date(Date.UTC(year, 0, 1) + (day - 1) * MS_PER_DAY);
}

function nextOccurrenceOfDayOfYear(today: Date, avgDay: number): Date {
  const year = today.getUTCFullYear();
  let candidate = dateFromDayOfYear(year, avgDay);
  if (candidate.getTime() <= today.getTime()) {
    candidate = dateFromDayOfYear(year + 1, avgDay);
  }
  return candidate;
}

function nextOccurrenceOfMonthDay(today: Date, month: number, day: number): Date {
  const year = today.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getTime() <= today.getTime()) {
    candidate = new Date(Date.UTC(year + 1, month - 1, day));
  }
  return candidate;
}

function nextQuarterEnd(today: Date): Date {
  const quarterEndMonths = [3, 6, 9, 12];
  const year = today.getUTCFullYear();
  for (const month of quarterEndMonths) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const candidate = new Date(Date.UTC(year, month - 1, lastDay));
    if (candidate.getTime() > today.getTime()) return candidate;
  }
  const lastDayNextQ1 = new Date(Date.UTC(year + 1, 3, 0)).getUTCDate();
  return new Date(Date.UTC(year + 1, 2, lastDayNextQ1));
}

function rollingEstimate(today: Date): Date {
  return new Date(today.getTime() + 90 * MS_PER_DAY);
}

function formatMonthDay(d: Date): string {
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface CategoryDefault {
  confidence: number;
  next: (today: Date) => Date;
  describe: (predicted: Date) => string;
}

const CATEGORY_DEFAULTS: Record<string, CategoryDefault> = {
  government_grant: {
    confidence: 0.4,
    next: (today) => nextOccurrenceOfMonthDay(today, 9, 30),
    describe: () =>
      "No deadline history with this funder. Government/federal grants commonly close at fiscal year-end (Sept 30) - using that pattern.",
  },
  private_foundation: {
    confidence: 0.3,
    next: nextQuarterEnd,
    describe: (predicted) =>
      `No deadline history with this funder. Private foundation deadlines commonly fall at calendar-quarter end - predicting the nearest one (${formatMonthDay(predicted)}).`,
  },
  corporate_donation: {
    confidence: 0.2,
    next: rollingEstimate,
    describe: () =>
      "No deadline history with this funder. Corporate giving programs commonly accept rolling applications - estimating a 90-day review cycle.",
  },
  corporate_sponsorship: {
    confidence: 0.2,
    next: rollingEstimate,
    describe: () =>
      "No deadline history with this funder. Corporate sponsorships commonly run on a rolling basis - estimating a 90-day review cycle.",
  },
  corporate_foundation: {
    confidence: 0.25,
    next: rollingEstimate,
    describe: () =>
      "No deadline history with this funder. Corporate foundations commonly accept rolling applications - estimating a 90-day review cycle.",
  },
};

const GENERIC_DEFAULT: CategoryDefault = {
  confidence: 0.15,
  next: rollingEstimate,
  describe: () =>
    "No deadline history with this funder and no category-specific deadline pattern on file - estimating a 90-day rolling cycle as a low-confidence placeholder.",
};

/**
 * Predicts a deadline for every opportunity in `orgId` that doesn't have one
 * yet. `supabase` is intentionally untyped (`any`) so this module works with
 * either the browser or server Supabase client without fighting the
 * generated Database generic on ad-hoc `.select()` column lists.
 */
export async function predictDeadlines(
  orgId: string,
  supabase: any,
): Promise<DeadlinePredictionResult[]> {
  const { data: undated } = await supabase
    .from("opportunities")
    .select("id, name, funder_id, category")
    .eq("organization_id", orgId)
    .is("deadline", null);

  const opportunities = (undated ?? []) as OpportunityRow[];
  if (opportunities.length === 0) return [];

  const funderIds = Array.from(
    new Set(
      opportunities
        .map((o) => o.funder_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const funderDayHistory = new Map<string, number[]>();
  if (funderIds.length > 0) {
    const { data: dated } = await supabase
      .from("opportunities")
      .select("funder_id, deadline")
      .eq("organization_id", orgId)
      .not("deadline", "is", null)
      .in("funder_id", funderIds);

    for (const row of (dated ?? []) as FunderDeadlineRow[]) {
      if (!row.funder_id || !row.deadline) continue;
      const parsed = new Date(row.deadline);
      if (Number.isNaN(parsed.getTime())) continue;
      const days = funderDayHistory.get(row.funder_id) ?? [];
      days.push(dayOfYear(parsed));
      funderDayHistory.set(row.funder_id, days);
    }
  }

  const today = new Date();
  const results: DeadlinePredictionResult[] = [];

  for (const opp of opportunities) {
    const history = opp.funder_id ? funderDayHistory.get(opp.funder_id) : undefined;

    if (history && history.length > 0) {
      const avgDay = Math.round(
        history.reduce((a, b) => a + b, 0) / history.length,
      );
      const predicted = nextOccurrenceOfDayOfYear(today, avgDay);
      const confidence = Math.min(0.9, 0.4 + history.length * 0.15);
      results.push({
        opportunityId: opp.id,
        opportunityTitle: opp.name,
        predictedDeadline: toISODate(predicted),
        confidence,
        basis: `Based on ${history.length} past deadline${history.length === 1 ? "" : "s"} from this funder, averaging around ${formatMonthDay(predicted)}.`,
      });
      continue;
    }

    const rule = (opp.category && CATEGORY_DEFAULTS[opp.category]) || GENERIC_DEFAULT;
    const predicted = rule.next(today);
    results.push({
      opportunityId: opp.id,
      opportunityTitle: opp.name,
      predictedDeadline: toISODate(predicted),
      confidence: rule.confidence,
      basis: rule.describe(predicted),
    });
  }

  return results.sort((a, b) => a.predictedDeadline.localeCompare(b.predictedDeadline));
}
