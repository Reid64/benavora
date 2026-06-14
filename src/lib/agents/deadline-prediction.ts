// Deadline Prediction Agent - predicts future deadlines based on historical
// patterns found in the organization's opportunity records.
//
// Scans past opportunities (optionally filtered by category) to find recurring
// deadline patterns: annual (same month/day each year) or quarterly (~90-day
// cycles). Predicts the next likely deadline within the requested look-ahead
// window and assigns a confidence score derived from how many historical data
// points match the pattern.
//
// High-confidence predictions (confidence >= 0.8) are auto-written as new
// opportunity rows so they appear in the pipeline before the funder officially
// announces. These rows note in their description that they are AI-predicted
// and may be edited or removed when the funder confirms dates.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const MAX_HISTORICAL_RECORDS = 50;
const DAYS_AHEAD_DEFAULT = 365;
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

export interface DeadlinePredictionInput {
  /** Filter to a specific opportunity category. If omitted, all categories are analyzed. */
  category?: string;
  /** How many days ahead to project deadlines. Defaults to 365. */
  daysAhead?: number;
}

export interface DeadlinePrediction {
  predictedDate: string;
  confidence: number;
  patternType: "annual" | "quarterly" | "irregular";
  reasoning: string;
  basedOnCount: number;
  autoCreated: boolean;
  createdOpportunityId?: string;
}

export interface DeadlinePredictionResult {
  category: string | null;
  historicalCount: number;
  predictions: DeadlinePrediction[];
  patternSummary: string;
}

export class DeadlinePredictionAgent extends BaseAgent<
  DeadlinePredictionInput,
  DeadlinePredictionResult
> {
  readonly agentType: AgentType = "deadline_prediction";

  protected async execute(
    input: DeadlinePredictionInput,
  ): Promise<AgentExecution<DeadlinePredictionResult>> {
    const category = input.category ?? null;
    const daysAhead = input.daysAhead ?? DAYS_AHEAD_DEFAULT;

    let query = this.client
      .from("opportunities")
      .select("id, name, deadline, category")
      .eq("organization_id", this.organizationId)
      .not("deadline", "is", null)
      .order("deadline", { ascending: true })
      .limit(MAX_HISTORICAL_RECORDS);

    if (category) {
      query = query.eq("category", category);
    }

    const { data: rows, error } = await query;

    if (error) {
      throw new AgentError(
        "Failed to load historical deadlines.",
        "db_error",
      );
    }

    const validRows = (rows ?? []).filter(
      (r): r is typeof r & { deadline: string } =>
        typeof r.deadline === "string" && r.deadline.trim() !== "",
    );

    if (validRows.length < 2) {
      const patternSummary = `Insufficient historical data (${validRows.length} deadline${validRows.length === 1 ? "" : "s"} found).`;
      return {
        data: {
          category,
          historicalCount: validRows.length,
          predictions: [],
          patternSummary,
        },
        outputSummary: patternSummary,
        itemsFound: validRows.length,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    const nowMs = Date.now();
    const cutoffMs = nowMs + daysAhead * MS_PER_DAY;
    const predictions = detectPatterns(
      validRows.map((r) => r.deadline),
      nowMs,
      cutoffMs,
    );

    let createdCount = 0;
    for (const pred of predictions) {
      if (pred.confidence < HIGH_CONFIDENCE_THRESHOLD) continue;

      const opportunityName = category
        ? `Predicted: ${category} – ${pred.predictedDate}`
        : `Predicted deadline – ${pred.predictedDate}`;

      const { data: created } = await this.client
        .from("opportunities")
        .insert({
          organization_id: this.organizationId,
          name: opportunityName,
          deadline: pred.predictedDate,
          category: category ?? null,
          description: `AI-predicted deadline (${Math.round(pred.confidence * 100)}% confidence). ${pred.reasoning}`,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (created?.id) {
        pred.autoCreated = true;
        pred.createdOpportunityId = created.id as string;
        createdCount++;
      }
    }

    const categoryLabel = category ? ` for category "${category}"` : "";
    const patternSummary =
      predictions.length === 0
        ? `No patterns detected${categoryLabel} from ${validRows.length} historical deadline(s).`
        : `Detected ${predictions.length} prediction(s)${categoryLabel}; ${createdCount} auto-created (confidence ≥ ${Math.round(HIGH_CONFIDENCE_THRESHOLD * 100)}%).`;

    return {
      data: {
        category,
        historicalCount: validRows.length,
        predictions,
        patternSummary,
      },
      outputSummary: patternSummary,
      itemsFound: validRows.length,
      itemsProcessed: predictions.length,
      tokensUsed: 0,
    };
  }
}

// --- pattern detection --------------------------------------------------------

function parseDate(dateStr: string): Date | null {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

interface AnnualGroup {
  month: number;
  day: number;
  count: number;
}

function groupByMonthDay(dates: Date[]): AnnualGroup[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const month = d?.getMonth() ?? 0;
    const day = d?.getDate() ?? 1;
    const key = `${month}:${day}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([key, count]) => {
      const [mStr, dStr] = key.split(":");
      return {
        month: parseInt(mStr ?? "0", 10),
        day: parseInt(dStr ?? "1", 10),
        count,
      };
    });
}

/**
 * Returns average interval in days if dates appear on a ~90-day quarterly
 * cycle, or null if the pattern does not hold.
 */
function detectQuarterlyInterval(dates: Date[]): number | null {
  if (dates.length < 4) return null;
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1]?.getTime() ?? 0;
    const curr = dates[i]?.getTime() ?? 0;
    intervals.push((curr - prev) / MS_PER_DAY);
  }
  const totalInterval = intervals.reduce((a, b) => a + b, 0);
  const avg = totalInterval / intervals.length;
  if (avg < 75 || avg > 105) return null;
  for (const iv of intervals) {
    if (Math.abs(iv - avg) > 30) return null;
  }
  return avg;
}

function detectPatterns(
  deadlineStrings: string[],
  nowMs: number,
  cutoffMs: number,
): DeadlinePrediction[] {
  const dates = deadlineStrings
    .map(parseDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length < 2) return [];

  const predictions: DeadlinePrediction[] = [];

  // Annual pattern: same (month, day) recurring across multiple years.
  const annualGroups = groupByMonthDay(dates);
  for (const grp of annualGroups) {
    const nowDate = new Date(nowMs);
    const thisYear = nowDate?.getFullYear() ?? new Date().getFullYear();
    let candidate = new Date(thisYear, grp.month, grp.day);
    if (candidate.getTime() <= nowMs) {
      candidate = new Date(thisYear + 1, grp.month, grp.day);
    }
    if (candidate.getTime() > cutoffMs) continue;

    const monthName = MONTH_NAMES[grp.month] ?? `Month ${grp.month + 1}`;
    const confidence = Math.min(0.95, 0.55 + grp.count * 0.1);
    predictions.push({
      predictedDate: candidate.toISOString().slice(0, 10),
      confidence,
      patternType: "annual",
      reasoning: `Deadlines recur on ${monthName} ${grp.day} in ${grp.count} historical year(s).`,
      basedOnCount: grp.count,
      autoCreated: false,
    });
  }

  // Quarterly pattern: evenly spaced ~90-day cycles (only if no annual found).
  if (predictions.length === 0) {
    const avgInterval = detectQuarterlyInterval(dates);
    if (avgInterval !== null) {
      const lastDate = dates[dates.length - 1];
      const lastMs = lastDate?.getTime() ?? nowMs;
      const nextMs = lastMs + avgInterval * MS_PER_DAY;
      if (nextMs > nowMs && nextMs <= cutoffMs) {
        const confidence = Math.min(0.85, 0.5 + dates.length * 0.05);
        predictions.push({
          predictedDate: new Date(nextMs).toISOString().slice(0, 10),
          confidence,
          patternType: "quarterly",
          reasoning: `Deadlines appear every ~${Math.round(avgInterval)} days (quarterly cycle) across ${dates.length} historical records.`,
          basedOnCount: dates.length,
          autoCreated: false,
        });
      }
    }
  }

  // Irregular fallback: next known upcoming deadline within the window.
  if (predictions.length === 0) {
    for (const d of dates) {
      const ms = d?.getTime() ?? 0;
      if (ms > nowMs && ms <= cutoffMs) {
        predictions.push({
          predictedDate: d.toISOString().slice(0, 10),
          confidence: 0.3,
          patternType: "irregular",
          reasoning: `No recurring pattern detected. Returning next known upcoming deadline.`,
          basedOnCount: dates.length,
          autoCreated: false,
        });
        break;
      }
    }
  }

  return predictions.sort((a, b) =>
    a.predictedDate.localeCompare(b.predictedDate),
  );
}
