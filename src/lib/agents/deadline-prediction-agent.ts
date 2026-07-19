// Deadline Prediction Agent — AGENTS_v2.md AG-25 (per this task's naming;
// AGENTS_v2.md's own AG-25 slot is Disaster Response — this agent is scoped
// exactly as given in this build's task prompt) — deterministic, per-funder
// deadline-cycle detection built on AutonomousAgent (migration 080
// infrastructure: agent_runs, agent_decisions, org_autonomous_config).
//
// Deviations from the task-given spec, checked against real schema
// (src/types/database.ts) rather than applied literally:
//   - opportunity_status has no 'awarded' value in the real enum (only
//     open/applied/closed/expired — 'awarded' lives on outcomes.result and
//     applications' pipeline_stage instead). Historical opportunities are
//     filtered to status IN ('closed','expired').
//   - `opportunities` has no `notes` column (see Row/Insert types) — the
//     task's notes text is written into the real `description` column
//     instead, matching the substitution convention already established in
//     src/lib/agents/opportunity-discovery-agent.ts's file header.
//   - `opportunities.category` is NOT NULL with no natural source in this
//     task's inputs; the qualifying funder's own `category` is reused for
//     the predicted opportunity, same as a funder's own category is what
//     that funder's real historical opportunities would have used.

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, differenceInCalendarDays, format } from "date-fns";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import type { Enums } from "@/types/database";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";
type FunderCategory = Enums<"funder_category">;
type Pattern = "annual" | "quarterly" | "rolling";

const HISTORICAL_STATUSES = ["closed", "expired"] as const;
const ANNUAL_GAP_MIN = 330;
const ANNUAL_GAP_MAX = 400;
const QUARTERLY_GAP_MIN = 80;
const QUARTERLY_GAP_MAX = 100;
const PREDICTION_WINDOW_DAYS = 90;
const HIGH_CONFIDENCE = 85;
const LOW_CONFIDENCE = 65;

interface FunderRow {
  id: string;
  name: string;
  category: FunderCategory;
}

interface HistoricalOpportunityRow {
  funder_id: string;
  deadline: string;
}

function computeGaps(dates: Date[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const curr = dates[i];
    if (!prev || !curr) continue;
    gaps.push(differenceInCalendarDays(curr, prev));
  }
  return gaps;
}

function detectPattern(gaps: number[]): Pattern {
  if (gaps.every((g) => g >= ANNUAL_GAP_MIN && g <= ANNUAL_GAP_MAX)) {
    return "annual";
  }
  if (gaps.every((g) => g >= QUARTERLY_GAP_MIN && g <= QUARTERLY_GAP_MAX)) {
    return "quarterly";
  }
  return "rolling";
}

export class DeadlinePredictionAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-25-deadline-prediction", supabase);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    let fundersAnalyzed = 0;
    let patternsDetected = 0;
    let opportunitiesCreated = 0;

    try {
      const [{ data: funderRows, error: fundersError }, { data: histRows, error: histError }] =
        await Promise.all([
          this.supabase
            .from("funders")
            .select("id, name, category")
            .eq("organization_id", this.orgId),
          this.supabase
            .from("opportunities")
            .select("funder_id, deadline")
            .eq("organization_id", this.orgId)
            .in("status", HISTORICAL_STATUSES)
            .not("funder_id", "is", null)
            .not("deadline", "is", null)
            .order("deadline", { ascending: true }),
        ]);

      if (fundersError) {
        throw new Error(`Failed to load funders: ${fundersError.message}`);
      }
      if (histError) {
        throw new Error(
          `Failed to load historical opportunities: ${histError.message}`,
        );
      }

      const funders = (funderRows ?? []) as FunderRow[];

      const byFunder = new Map<string, string[]>();
      for (const row of (histRows ?? []) as HistoricalOpportunityRow[]) {
        const list = byFunder.get(row.funder_id) ?? [];
        list.push(row.deadline);
        byFunder.set(row.funder_id, list);
      }

      const qualifyingFunders = funders.filter(
        (f) => (byFunder.get(f.id)?.length ?? 0) >= 2,
      );

      for (const funder of qualifyingFunders) {
        fundersAnalyzed++;

        try {
          const deadlineStrings = byFunder.get(funder.id) ?? [];
          const dates = deadlineStrings
            .map((d) => new Date(d))
            .filter((d) => !isNaN(d.getTime()))
            .sort((a, b) => a.getTime() - b.getTime());

          if (dates.length < 2) continue;

          const dataPointCount = dates.length;
          const gaps = computeGaps(dates);
          const pattern = detectPattern(gaps);

          if (pattern === "rolling") continue;

          patternsDetected++;

          const avgGapDays = Math.round(
            gaps.reduce((a, b) => a + b, 0) / gaps.length,
          );
          const lastDeadline = dates[dates.length - 1];
          if (!lastDeadline) continue;
          const predictedDate = addDays(lastDeadline, avgGapDays);
          const predictedDateStr = format(predictedDate, "yyyy-MM-dd");
          const confidence =
            dataPointCount >= 3 ? HIGH_CONFIDENCE : LOW_CONFIDENCE;

          const daysFromNow = differenceInCalendarDays(
            predictedDate,
            new Date(),
          );
          if (daysFromNow < 0 || daysFromNow > PREDICTION_WINDOW_DAYS) {
            continue;
          }

          const { data: openOpp } = await this.supabase
            .from("opportunities")
            .select("id")
            .eq("organization_id", this.orgId)
            .eq("funder_id", funder.id)
            .eq("status", "open")
            .maybeSingle();

          if (openOpp) continue;

          const year = predictedDate.getFullYear();
          const description =
            `Auto-predicted by Deadline Prediction Agent. ${dataPointCount} ` +
            `historical cycles. Confidence: ${confidence}%. Pattern: ${pattern}.`;

          const { data: inserted, error: insertError } = await this.supabase
            .from("opportunities")
            .insert({
              organization_id: this.orgId,
              funder_id: funder.id,
              name: `${funder.name} -- Predicted ${year} Cycle`,
              category: funder.category,
              status: "open",
              source: "agent",
              deadline: predictedDateStr,
              description,
            })
            .select("id")
            .single();

          if (insertError || !inserted) {
            errors.push(
              `funder ${funder.id}: failed to insert predicted opportunity: ${
                insertError?.message ?? "no row returned"
              }`,
            );
            continue;
          }

          const newOppId = (inserted as { id: string }).id;
          opportunitiesCreated++;

          decisions.push(
            await this.logDecision({
              decisionType: "deadline_predicted",
              agentRunId: runId,
              entityType: "opportunity",
              entityId: newOppId,
              reasoning:
                `${pattern} pattern detected for ${funder.name} across ` +
                `${dataPointCount} cycles. Predicted next deadline: ` +
                `${predictedDateStr}. Avg cycle: ${avgGapDays} days.`,
              confidenceScore: confidence,
              actionTaken: "created_projected_opportunity",
              requiredHumanReview: true,
            }),
          );
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to process funder deadline prediction.";
          errors.push(`funder ${funder.id}: ${message}`);
        }
      }

      const summary = {
        fundersAnalyzed,
        patternsDetected,
        opportunitiesCreated,
      };

      await this.completeRun(runId, {
        outputSummary: JSON.stringify(summary),
        itemsFound: qualifyingFunders.length,
        itemsProcessed: fundersAnalyzed,
        itemsQueued: opportunitiesCreated,
      });

      return {
        success: true,
        itemsFound: qualifyingFunders.length,
        itemsProcessed: fundersAnalyzed,
        itemsQueued: opportunitiesCreated,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Deadline prediction run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: fundersAnalyzed,
        itemsQueued: opportunitiesCreated,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
