// AG-26 Funding Forecast Agent (AutonomousAgent, migration 078/105:
// funding_forecasts, RLS added migration 105; migration 110 adds the
// UNIQUE(org_id, forecast_date, forecast_period) idempotency constraint and
// the 'ag-26-forecast' agent_type enum value). Enterprise spec: AGENTS_v2.md
// §5, AG-26 "Funding Forecast Agent" (written 2026-08-03). Purpose:
// generates 90-day and 12-month probability-weighted funding forecasts per
// org, grounded in AG-15's real opportunity_probability_scores output and
// this org's own trailing-12-month outcomes.
//
// Confirmed live before writing this file (not assumed): funding_forecasts
// already existed (migration 078/105) with exactly the spec's column set
// (org_id, forecast_date, forecast_period, projected_min/max/most_likely,
// confidence, methodology, factors jsonb, key_risks/key_opportunities/
// recommended_actions text[]), but only a primary key on `id` — no
// uniqueness on (org_id, forecast_date, forecast_period), which the spec
// explicitly calls out as this build task's own responsibility to add
// (idempotency guarantee for the upsert below). Added via migration 110.
//
// Trigger (per spec): schedule only — monthly, 1st of month, 4:00 AM CST,
// via runFundingForecastMonthlyPipeline() in worker/autonomous-orchestrator.ts
// (a real, dedicated scheduler.ts slot, not folded into the 2AM per-org
// sweep — matching AG-38's precedent of a standalone cron entry for an agent
// whose spec explicitly names a fixed clock time). No event trigger: a
// portfolio-level forecast doesn't meaningfully move on a single new
// opportunity/outcome the way AG-10's per-funder profile does — see the
// spec's own "Trigger design" rationale. run() has no scope resolution step
// (unlike AG-10's event/schedule split) — every call processes the full
// pipeline for this.orgId unconditionally, matching the spec's own
// "Trigger Condition: all orgs, unconditionally (a zero-opportunity org
// still gets an honest $0 forecast)".
//
// Deterministic vs. Claude-assisted split (same design principle as AG-10):
// the quantitative core (steps 1-3 — loading opportunities/scores/outcomes
// and the probability-weighted sum) is pure arithmetic, no Claude call
// needed. One bounded Claude call per org per run covers BOTH periods'
// narrative layer (key_risks/key_opportunities/recommended_actions) in a
// single prompt — never per-opportunity, never per-period — to avoid
// doubling cost for two numbers that share the same input pipeline data.
// Implementation choice, stated explicitly since the spec doesn't fully
// pin this down: the single call returns a JSON object keyed by period
// ({"90_day": {...}, "12_month": {...}}), not one narrative reused
// verbatim for both rows — each period's numbers are different enough
// (90-day pipeline vs. full-year pipeline) that a shared narrative would
// misrepresent at least one of them. Only periods with itemsFound > 0 are
// included in the prompt; a zero-opportunity period never needs Claude at
// all (step 2, branch a) and gets empty narrative arrays deterministically.
//
// Confidence-band math (spec's step 3, "a simple ±1 confidence-band
// widening, not a full Monte Carlo simulation"): since this schema has no
// per-opportunity score *distribution*, only a single overall_score, the
// 25th/75th percentile language is implemented as a fixed ±25-percentage-
// point band around each opportunity's effective score (clamped to
// [0,100]) — projected_min sums the low end of that band, projected_max
// the high end, projected_most_likely uses the score as-is. This is stated
// here rather than left implicit, since it's a genuine interpretive choice
// the spec leaves open.
//
// Idempotency: the upsert targets funding_forecasts' new
// UNIQUE(org_id, forecast_date, forecast_period) constraint — a second run
// for the same org/date/period on the same day updates the same row, never
// inserts a duplicate (spec's step 5 / Idempotency section).
//
// Error isolation: each org's steps 1-6 run inside its own try/catch (spec's
// step 7) — one org's bad data never blocks another's forecast in the same
// monthly run. The Claude call retries up to 3 times with exponential
// backoff (1s/2s/4s), the same pattern already proven in
// src/lib/intelligence/embeddings.ts and reused by AG-10 — on exhaustion,
// the forecast row(s) still get written with the real deterministic numbers
// and empty narrative arrays plus a methodology note, never blocked on
// Claude (spec's Error handling section).
//
// Hard limits: never writes to opportunities/outcomes (read-only pipeline
// data); this agent only writes the advisory funding_forecasts read-model.
// No human-approval gate — per the spec's "Autonomy level" section, this
// agent takes no external action and writes nothing a human needs to
// approve before AG-40 (Strategic Advisor) or a human reads it.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

interface ForecastPeriodDef {
  key: "90_day" | "12_month";
  windowDays: number;
}

const FORECAST_PERIODS: ForecastPeriodDef[] = [
  { key: "90_day", windowDays: 90 },
  { key: "12_month", windowDays: 365 },
];

/** Below this many trailing-12-month outcomes, the org's win rate is not a
 * reliable statistic — fall back to a platform-neutral rate instead (same
 * small-sample-neutral-default convention AG-10 uses for its own confidence
 * cap, per the spec's own cross-reference). */
const MIN_OUTCOMES_FOR_REAL_WIN_RATE = 3;
const PLATFORM_NEUTRAL_WIN_RATE = 0.3;

/** Neutral per-opportunity score when AG-15 hasn't scored it yet (spec step
 * 2/3: "a neutral 0.5 probability weight for every unscored opportunity",
 * i.e. 50 on the 0-100 scale used here). */
const NEUTRAL_UNSCORED_SCORE = 50;

/** Spec step 2, branch b: "set confidence no higher than 30 regardless of
 * sample size" when zero opportunities in the window have a real score. */
const ZERO_SCORED_CONFIDENCE_CAP = 30;

/** Half-width, in score points, of the deterministic min/max band around
 * each opportunity's effective score — see file header's "Confidence-band
 * math" note. */
const CONFIDENCE_BAND_HALF_WIDTH = 25;

const NARRATIVE_MAX_TOKENS = 900;

const NARRATIVE_SYSTEM_PROMPT =
  "You are the Funding Forecast Agent inside Benavora, an AI-powered nonprofit " +
  "funding intelligence platform. You are given a deterministically-computed " +
  "90-day and/or 12-month probability-weighted funding projection for one " +
  "organization, plus the real open opportunities, probability scores, and " +
  "recent outcomes it was computed from. Write grounded risks, opportunities, " +
  "and recommended actions that a real development team could act on this " +
  "week - every claim must trace back to a specific opportunity, score, or " +
  "outcome you were given, never a generic platitude. You are producing " +
  "structured data for another system, not prose for a human to read " +
  "directly - respond with ONLY the requested JSON, no markdown fences, no " +
  "commentary before or after it.";

interface OrgRow {
  id: string;
  name: string | null;
  annual_budget: number | null;
}

interface OpportunityRow {
  id: string;
  funder_id: string | null;
  name: string;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  category: string | null;
}

interface ProbabilityScoreRow {
  opportunity_id: string;
  overall_score: number | null;
}

interface OutcomeRow {
  result: string;
  awarded_amount: number | null;
  recorded_at: string | null;
}

interface PeriodProjection {
  periodKey: "90_day" | "12_month";
  openOpportunityCount: number;
  scoredCount: number;
  projectedMin: number;
  projectedMax: number;
  projectedMostLikely: number;
  confidence: number | null;
  methodology: string;
  factors: {
    orgAnnualBudget: number | null;
    openOpportunityCount: number;
    scoredCount: number;
    trailingWinRate: number;
    sampleSize: number;
  };
  /** Opportunities included in this period's window, for the Claude prompt. */
  opportunities: (OpportunityRow & { overallScore: number | null })[];
}

interface NarrativeResult {
  keyRisks: string[];
  keyOpportunities: string[];
  recommendedActions: string[];
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error.";
}

function midpoint(min: number | null, max: number | null): number {
  if (min != null && max != null) return (min + max) / 2;
  if (min != null) return min;
  if (max != null) return max;
  return 0;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

export class FundingForecastAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-26-forecast", supabase);
  }

  /** Trailing-12-month win rate from `outcomes` — real rate if the org has
   * ≥MIN_OUTCOMES_FOR_REAL_WIN_RATE recorded outcomes in the window, else
   * the platform-neutral fallback (spec step 3). */
  private async computeTrailingWinRate(): Promise<{
    rate: number;
    sampleSize: number;
  }> {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setDate(twelveMonthsAgo.getDate() - 365);

    const { data } = await this.supabase
      .from("outcomes")
      .select("result, awarded_amount, recorded_at")
      .eq("organization_id", this.orgId)
      .gte("recorded_at", twelveMonthsAgo.toISOString());
    const outcomes = (data ?? []) as OutcomeRow[];

    if (outcomes.length < MIN_OUTCOMES_FOR_REAL_WIN_RATE) {
      return { rate: PLATFORM_NEUTRAL_WIN_RATE, sampleSize: outcomes.length };
    }
    const awarded = outcomes.filter((o) => o.result === "awarded").length;
    return { rate: awarded / outcomes.length, sampleSize: outcomes.length };
  }

  /** Steps 1-3 for a single forecast period: load open opportunities in the
   * window, load their real AG-15 scores where they exist, and compute the
   * deterministic probability-weighted projection. */
  private async computePeriodProjection(
    period: ForecastPeriodDef,
    org: OrgRow,
    trailingWinRate: number,
    winRateSampleSize: number,
  ): Promise<PeriodProjection> {
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + period.windowDays);

    const { data: oppData } = await this.supabase
      .from("opportunities")
      .select("id, funder_id, name, amount_min, amount_max, deadline, category")
      .eq("organization_id", this.orgId)
      .eq("status", "open")
      .lte("deadline", windowEnd.toISOString());
    const opportunities = (oppData ?? []) as OpportunityRow[];

    // Step 2, branch a: zero open opportunities — an honest, explicit zero.
    if (opportunities.length === 0) {
      return {
        periodKey: period.key,
        openOpportunityCount: 0,
        scoredCount: 0,
        projectedMin: 0,
        projectedMax: 0,
        projectedMostLikely: 0,
        confidence: null,
        methodology: `No open opportunities in the ${period.key.replace("_", "-")} window as of this run.`,
        factors: {
          orgAnnualBudget: org.annual_budget,
          openOpportunityCount: 0,
          scoredCount: 0,
          trailingWinRate,
          sampleSize: winRateSampleSize,
        },
        opportunities: [],
      };
    }

    const oppIds = opportunities.map((o) => o.id);
    const { data: scoreData } = await this.supabase
      .from("opportunity_probability_scores")
      .select("opportunity_id, overall_score")
      .in("opportunity_id", oppIds)
      .eq("organization_id", this.orgId);
    const scoreByOpp = new Map<string, number | null>(
      ((scoreData ?? []) as ProbabilityScoreRow[]).map((s) => [
        s.opportunity_id,
        s.overall_score,
      ]),
    );

    const scoredCount = opportunities.filter(
      (o) => scoreByOpp.get(o.id) != null,
    ).length;

    // Step 3: deterministic probability-weighted sum. Every opportunity
    // contributes midpoint(amount_min, amount_max) x effectiveScore/100 x
    // trailingWinRate; unscored opportunities use the spec's neutral 50.
    let projectedMostLikely = 0;
    let projectedMin = 0;
    let projectedMax = 0;
    const scoredOpportunities: (OpportunityRow & { overallScore: number | null })[] = [];

    for (const opp of opportunities) {
      const realScore = scoreByOpp.get(opp.id) ?? null;
      const effectiveScore = realScore ?? NEUTRAL_UNSCORED_SCORE;
      const value = midpoint(opp.amount_min, opp.amount_max);

      projectedMostLikely += value * (effectiveScore / 100) * trailingWinRate;
      projectedMin +=
        value *
        (clampScore(effectiveScore - CONFIDENCE_BAND_HALF_WIDTH) / 100) *
        trailingWinRate;
      projectedMax +=
        value *
        (clampScore(effectiveScore + CONFIDENCE_BAND_HALF_WIDTH) / 100) *
        trailingWinRate;

      scoredOpportunities.push({ ...opp, overallScore: realScore });
    }

    // Confidence reflects real score coverage: fully-scored windows read
    // 100, fully-unscored windows read 0 (naturally satisfying step 2,
    // branch b's "no higher than 30" rule — a min() is still applied below
    // as an explicit, redundant safety net rather than relying on the
    // formula alone to enforce the spec's stated cap).
    let confidence = Math.round((scoredCount / opportunities.length) * 100);
    if (scoredCount === 0) {
      confidence = Math.min(confidence, ZERO_SCORED_CONFIDENCE_CAP);
    }

    const methodology =
      scoredCount === opportunities.length
        ? `All ${opportunities.length} open opportunity/ies in this window are AG-15-scored. Probability-weighted against a trailing-12-month win rate of ${(trailingWinRate * 100).toFixed(0)}% (${winRateSampleSize >= MIN_OUTCOMES_FOR_REAL_WIN_RATE ? "real" : "platform-neutral fallback, fewer than " + MIN_OUTCOMES_FOR_REAL_WIN_RATE + " recorded outcomes"}).`
        : scoredCount === 0
          ? `0 of ${opportunities.length} open opportunity/ies in this window have an AG-15 score yet — every one used the neutral fallback score of ${NEUTRAL_UNSCORED_SCORE}. Confidence capped at ${ZERO_SCORED_CONFIDENCE_CAP} since this projection is leaning on a fallback, not real scores.`
          : `${scoredCount} of ${opportunities.length} open opportunity/ies in this window are AG-15-scored; the rest used the neutral fallback score of ${NEUTRAL_UNSCORED_SCORE}. Probability-weighted against a trailing-12-month win rate of ${(trailingWinRate * 100).toFixed(0)}% (${winRateSampleSize >= MIN_OUTCOMES_FOR_REAL_WIN_RATE ? "real" : "platform-neutral fallback"}).`;

    return {
      periodKey: period.key,
      openOpportunityCount: opportunities.length,
      scoredCount,
      projectedMin,
      projectedMax,
      projectedMostLikely,
      confidence,
      methodology,
      factors: {
        orgAnnualBudget: org.annual_budget,
        openOpportunityCount: opportunities.length,
        scoredCount,
        trailingWinRate,
        sampleSize: winRateSampleSize,
      },
      opportunities: scoredOpportunities,
    };
  }

  private buildNarrativePrompt(
    org: OrgRow,
    projections: PeriodProjection[],
  ): string {
    const sections = projections
      .filter((p) => p.openOpportunityCount > 0)
      .map((p) => {
        const oppLines = p.opportunities
          .slice(0, 15)
          .map(
            (o) =>
              `  - "${o.name}" (category: ${o.category ?? "uncategorized"}, ` +
              `amount: ${o.amount_min ?? "?"}-${o.amount_max ?? "?"}, ` +
              `deadline: ${o.deadline ?? "none"}, ` +
              `AG-15 score: ${o.overallScore ?? "not yet scored"})`,
          )
          .join("\n");
        return (
          `${p.periodKey} window: projected most-likely value ${p.projectedMostLikely.toFixed(0)} ` +
          `(range ${p.projectedMin.toFixed(0)}-${p.projectedMax.toFixed(0)}), ` +
          `${p.scoredCount}/${p.openOpportunityCount} opportunities score-backed.\n` +
          `Open opportunities in this window:\n${oppLines}`
        );
      })
      .join("\n\n");

    return (
      `Organization: "${org.name ?? "this organization"}" (annual budget: ${org.annual_budget ?? "not on file"}).\n\n` +
      `${sections}\n\n` +
      "For EACH window listed above, write:\n" +
      "(a) key_risks: specific risks grounded in the actual opportunities/scores shown (e.g. concentration in a small number of low-scored opportunities, an unscored opportunity carrying outsized weight).\n" +
      "(b) key_opportunities: specific positive factors grounded in the same data (e.g. a high-scoring opportunity, a historically reliable funder).\n" +
      "(c) recommended_actions: concrete next steps a development team could take this week.\n\n" +
      "Respond with ONLY JSON, shaped exactly as an object keyed by window name for each window that was listed above, e.g.: " +
      '{"90_day": {"keyRisks": string[], "keyOpportunities": string[], "recommendedActions": string[]}, "12_month": {...}}'
    );
  }

  /** Claude call with 3-attempt exponential backoff (1s/2s/4s), the pattern
   * already proven in src/lib/intelligence/embeddings.ts and reused by AG-10. */
  private async callClaudeWithRetry(
    prompt: string,
  ): Promise<{ text: string; tokensUsed: number }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await callClaude({
          model: DEFAULT_MODEL,
          maxTokens: NARRATIVE_MAX_TOKENS,
          system: NARRATIVE_SYSTEM_PROMPT,
          prompt,
        });
        return { text: response.text, tokensUsed: response.usage.totalTokens };
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000),
          );
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Claude call failed after 3 attempts.");
  }

  /** Step 4: one Claude call per org per run, covering every period with
   * ≥1 open opportunity. Returns an empty narrative per period on total
   * Claude failure (Error handling section) rather than blocking the run —
   * the deterministic numbers are the load-bearing part AG-40 consumes. */
  private async generateNarratives(
    org: OrgRow,
    projections: PeriodProjection[],
  ): Promise<{
    narrativeByPeriod: Map<string, NarrativeResult>;
    tokensUsed: number;
    degraded: boolean;
  }> {
    const projectable = projections.filter((p) => p.openOpportunityCount > 0);
    const narrativeByPeriod = new Map<string, NarrativeResult>();
    if (projectable.length === 0) {
      return { narrativeByPeriod, tokensUsed: 0, degraded: false };
    }

    const prompt = this.buildNarrativePrompt(org, projections);

    try {
      const { text, tokensUsed } = await this.callClaudeWithRetry(prompt);
      const jsonText = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "");
      const parsed = JSON.parse(jsonText) as Record<
        string,
        { keyRisks?: unknown; keyOpportunities?: unknown; recommendedActions?: unknown }
      >;

      for (const p of projectable) {
        const raw = parsed[p.periodKey];
        narrativeByPeriod.set(p.periodKey, {
          keyRisks: Array.isArray(raw?.keyRisks)
            ? raw.keyRisks.filter((x): x is string => typeof x === "string")
            : [],
          keyOpportunities: Array.isArray(raw?.keyOpportunities)
            ? raw.keyOpportunities.filter((x): x is string => typeof x === "string")
            : [],
          recommendedActions: Array.isArray(raw?.recommendedActions)
            ? raw.recommendedActions.filter((x): x is string => typeof x === "string")
            : [],
        });
      }
      return { narrativeByPeriod, tokensUsed, degraded: false };
    } catch {
      // Claude exhausted its retries or returned unparseable JSON — degrade
      // gracefully per the spec's Error handling section: every projectable
      // period gets empty narrative arrays, never a blocked run.
      for (const p of projectable) {
        narrativeByPeriod.set(p.periodKey, {
          keyRisks: [],
          keyOpportunities: [],
          recommendedActions: [],
        });
      }
      return { narrativeByPeriod, tokensUsed: 0, degraded: true };
    }
  }

  /** Steps 5-6 for one org: write both forecast rows and log one decision
   * per period actually written. */
  private async writeForecasts(
    runId: string,
    forecastDate: string,
    projections: PeriodProjection[],
    narrativeByPeriod: Map<string, NarrativeResult>,
    degraded: boolean,
  ): Promise<{ decisionIds: string[]; rowsWritten: number }> {
    const decisionIds: string[] = [];
    let rowsWritten = 0;

    for (const p of projections) {
      const narrative = narrativeByPeriod.get(p.periodKey) ?? {
        keyRisks: [],
        keyOpportunities: [],
        recommendedActions: [],
      };
      const methodology =
        degraded && p.openOpportunityCount > 0
          ? `${p.methodology} (narrative synthesis unavailable this run.)`
          : p.methodology;

      const { error: upsertError } = await this.supabase
        .from("funding_forecasts")
        .upsert(
          {
            org_id: this.orgId,
            forecast_date: forecastDate,
            forecast_period: p.periodKey,
            projected_min: p.projectedMin,
            projected_max: p.projectedMax,
            projected_most_likely: p.projectedMostLikely,
            confidence: p.confidence,
            methodology,
            factors: p.factors,
            key_risks: narrative.keyRisks,
            key_opportunities: narrative.keyOpportunities,
            recommended_actions: narrative.recommendedActions,
          },
          { onConflict: "org_id,forecast_date,forecast_period" },
        );

      if (upsertError) {
        throw new Error(
          `Failed to upsert funding_forecasts (${p.periodKey}): ${upsertError.message}`,
        );
      }
      rowsWritten++;

      const scoreCoverageRatio =
        p.openOpportunityCount > 0 ? p.scoredCount / p.openOpportunityCount : null;
      const decisionId = await this.logDecision({
        decisionType: "forecast_generated",
        agentRunId: runId,
        entityType: "organization",
        entityId: this.orgId,
        reasoning: methodology,
        confidenceScore: p.confidence ?? 0,
        actionTaken: `wrote_${p.periodKey}_forecast`,
        actionPayload: {
          periodKey: p.periodKey,
          projectedMostLikely: p.projectedMostLikely,
          projectedMin: p.projectedMin,
          projectedMax: p.projectedMax,
          scoreCoverageRatio,
        },
      });
      decisionIds.push(decisionId);
    }

    return { decisionIds, rowsWritten };
  }

  override async run(triggerSource: TriggerSource): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    try {
      const { data: orgRow } = await this.supabase
        .from("organizations")
        .select("id, name, annual_budget")
        .eq("id", this.orgId)
        .maybeSingle();

      if (!orgRow) {
        throw new Error(`Organization ${this.orgId} not found.`);
      }
      const org = orgRow as OrgRow;

      const { rate: trailingWinRate, sampleSize: winRateSampleSize } =
        await this.computeTrailingWinRate();

      const projections: PeriodProjection[] = [];
      for (const period of FORECAST_PERIODS) {
        const projection = await this.computePeriodProjection(
          period,
          org,
          trailingWinRate,
          winRateSampleSize,
        );
        projections.push(projection);
      }

      const { narrativeByPeriod, tokensUsed, degraded } =
        await this.generateNarratives(org, projections);

      const forecastDate = new Date().toISOString().slice(0, 10);
      const { decisionIds, rowsWritten } = await this.writeForecasts(
        runId,
        forecastDate,
        projections,
        narrativeByPeriod,
        degraded,
      );
      decisions.push(...decisionIds);

      const itemsFound = projections.some((p) => p.openOpportunityCount > 0)
        ? 1
        : 0;

      await this.completeRun(runId, {
        outputSummary:
          `Wrote ${rowsWritten}/${projections.length} forecast row(s) for org ${this.orgId}` +
          (degraded ? " (narrative synthesis unavailable this run)." : "."),
        itemsFound,
        itemsProcessed: rowsWritten > 0 ? 1 : 0,
        itemsQueued: 0,
        tokensUsed,
        outputPayload: {
          orgsProcessed: 1,
          totalRowsWritten: rowsWritten,
          orgsFailed: 0,
          periods: projections.map((p) => ({
            periodKey: p.periodKey,
            projectedMostLikely: p.projectedMostLikely,
            openOpportunityCount: p.openOpportunityCount,
            scoredCount: p.scoredCount,
          })),
        },
      });

      return {
        success: true,
        itemsFound,
        itemsProcessed: rowsWritten > 0 ? 1 : 0,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message = errMsg(err) || "Funding forecast generation failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
