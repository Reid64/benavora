import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import type { Enums } from "@/types/database";

// GET /api/reports/roi — AG-39 ROI Optimizer read surface
// (AUTONOMOUS_PLATFORM_VISION.md Phase 5 "ROI Optimization Engine",
// src/lib/agents/roi-optimizer-agent.ts). Returns the persisted roi_insights
// rows AG-39's monthly run() writes, plus a deterministic aggregation over
// submission_variables joined to outcomes for the chart/stat surfaces on
// /reports/roi. The aggregation here is plain arithmetic, not a second
// Claude call — AG-39 already owns the "is this pattern significant" call
// via roi_insights; this route just summarizes the raw records for display.

type OutcomeResult = Enums<"outcome_result">;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_TO_SUN_ORDER = [1, 2, 3, 4, 5, 6, 0];

const WORD_COUNT_BUCKETS: Array<{ min: number; max: number | null; label: string }> = [
  { min: 0, max: 500, label: "0-500" },
  { min: 500, max: 1000, label: "500-1000" },
  { min: 1000, max: 1500, label: "1000-1500" },
  { min: 1500, max: 2000, label: "1500-2000" },
  { min: 2000, max: 2500, label: "2000-2500" },
  { min: 2500, max: null, label: "2500+" },
];

interface SubmissionVariableRow {
  application_id: string;
  submission_day_of_week: number | null;
  word_count: number | null;
  attachment_count: number | null;
  has_budget: boolean | null;
  has_logic_model: boolean | null;
}

interface OutcomeRow {
  application_id: string;
  result: OutcomeResult;
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function winRate(awarded: number, decided: number): number | null {
  return decided > 0 ? awarded / decided : null;
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const [insightsResult, variablesResult, outcomesResult] = await Promise.all([
    supabase
      .from("roi_insights")
      .select("*")
      .eq("org_id", organizationId)
      .order("generated_at", { ascending: false }),
    supabase
      .from("submission_variables")
      .select(
        "application_id, submission_day_of_week, word_count, attachment_count, has_budget, has_logic_model",
      )
      .eq("org_id", organizationId),
    supabase
      .from("outcomes")
      .select("application_id, result")
      .eq("organization_id", organizationId),
  ]);

  if (insightsResult.error) {
    return jsonError("Failed to load ROI insights.", "db_error", 500);
  }
  if (variablesResult.error || outcomesResult.error) {
    return jsonError("Failed to load submission variable stats.", "db_error", 500);
  }

  const variables = (variablesResult.data ?? []) as SubmissionVariableRow[];
  const outcomeByApplication = new Map<string, OutcomeResult>();
  for (const o of (outcomesResult.data ?? []) as OutcomeRow[]) {
    outcomeByApplication.set(o.application_id, o.result);
  }

  const decided = variables
    .map((v) => ({ ...v, result: outcomeByApplication.get(v.application_id) ?? null }))
    .filter((v): v is SubmissionVariableRow & { result: OutcomeResult } => v.result !== null);

  const awardedCount = decided.filter((v) => v.result === "awarded").length;
  const overallWinRate = winRate(awardedCount, decided.length);

  // Win rate by day of week, Mon -> Sun
  const winRateByDay = MON_TO_SUN_ORDER.map((day) => {
    const dayRows = decided.filter((v) => v.submission_day_of_week === day);
    const dayAwarded = dayRows.filter((v) => v.result === "awarded").length;
    return {
      day,
      label: DAY_LABELS[day]!,
      winRate: winRate(dayAwarded, dayRows.length),
      sampleSize: dayRows.length,
    };
  });

  const bestSubmissionDay =
    winRateByDay
      .filter((d) => d.sampleSize > 0 && d.winRate !== null)
      .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0] ?? null;

  // Word count: winners vs losers averages, plus bucketed win-rate distribution
  const wordCountWinners = decided
    .filter((v) => v.result === "awarded" && v.word_count !== null)
    .map((v) => v.word_count as number);
  const wordCountLosers = decided
    .filter((v) => v.result === "denied" && v.word_count !== null)
    .map((v) => v.word_count as number);

  const wordCountBuckets = WORD_COUNT_BUCKETS.map((bucket) => {
    const bucketRows = decided.filter(
      (v) =>
        v.word_count !== null &&
        v.word_count >= bucket.min &&
        (bucket.max === null || v.word_count < bucket.max),
    );
    const bucketAwarded = bucketRows.filter((v) => v.result === "awarded").length;
    return {
      label: bucket.label,
      winRate: winRate(bucketAwarded, bucketRows.length),
      sampleSize: bucketRows.length,
    };
  });

  const optimalWordCountRange =
    wordCountBuckets
      .filter((b) => b.sampleSize >= 2 && b.winRate !== null)
      .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0] ?? null;

  // Attachment / component correlation: budget included vs not, logic model vs not
  function withVsWithout(flag: (v: SubmissionVariableRow) => boolean | null) {
    const withFlag = decided.filter((v) => flag(v) === true);
    const withoutFlag = decided.filter((v) => flag(v) === false);
    return {
      withRate: winRate(withFlag.filter((v) => v.result === "awarded").length, withFlag.length),
      withSample: withFlag.length,
      withoutRate: winRate(
        withoutFlag.filter((v) => v.result === "awarded").length,
        withoutFlag.length,
      ),
      withoutSample: withoutFlag.length,
    };
  }

  const attachmentImpact = [
    { label: "Budget Included", ...withVsWithout((v) => v.has_budget) },
    { label: "Logic Model Included", ...withVsWithout((v) => v.has_logic_model) },
  ];

  return NextResponse.json({
    insights: insightsResult.data ?? [],
    stats: {
      applicationsTracked: variables.length,
      decidedCount: decided.length,
      winRate: overallWinRate,
      bestSubmissionDay,
      optimalWordCountRange,
      winRateByDay,
      wordCountDistribution: {
        winnersAvg: average(wordCountWinners),
        losersAvg: average(wordCountLosers),
        winnersSample: wordCountWinners.length,
        losersSample: wordCountLosers.length,
        buckets: wordCountBuckets,
      },
      attachmentImpact,
    },
  });
}
