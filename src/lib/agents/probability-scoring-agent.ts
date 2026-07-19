// Grant Probability Scoring Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 5
// (Grant Probability Engine), AGENTS_v2.md AG-15.
//
// Autonomous wrapper around the existing deterministic scoring logic in
// src/lib/intelligence/grant-probability-engine.ts (computeGrantProbability
// already upserts opportunity_probability_scores itself — this agent adds
// scope resolution, org-config gating, decision logging, and chaining into
// draft generation, per AutonomousAgent (migration 080 infrastructure:
// autonomous_triggers, agent_queue, agent_decisions, org_autonomous_config)).
//
// agentId is "ag-15-probability" to match the id OpportunityDiscoveryAgent
// (src/lib/agents/opportunity-discovery-agent.ts) already uses when it
// chains new discoveries into this agent via queueChainedAgent — the
// chain-scope lookup below (triggerSource === "chain") depends on that
// literal string matching the agent_queue row the queue processor is
// currently running.

import type { SupabaseClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import {
  computeGrantProbability,
  type GrantProbabilityFactor,
} from "@/lib/intelligence/grant-probability-engine";

const STALE_AFTER_DAYS = 7;

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";

interface OpportunityScopeRow {
  id: string;
  name: string | null;
  funder_id: string | null;
}

interface ScoreRow {
  opportunity_id: string;
  computed_at: string | null;
}

interface DigitalTwinRow {
  mission: string | null;
  twin_completeness_score: number | null;
}

function factorPercent(
  factors: GrantProbabilityFactor[],
  name: string,
): number {
  const found = factors.find((f) => f.name === name);
  return found ? Math.round(found.value * 100) : 0;
}

export class ProbabilityScoringAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-15-probability", supabase);
  }

  /**
   * "chain" scope: the discovery agent enqueues this agent's own agent_queue
   * row with input_payload.opportunityIds — read the row the queue processor
   * marked "processing" (this run) rather than re-querying the queue by id,
   * since AutonomousAgent has no queue-item id passed into run().
   */
  private async loadChainScope(): Promise<OpportunityScopeRow[]> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as {
      opportunityIds?: unknown;
    };
    const opportunityIds = Array.isArray(payload.opportunityIds)
      ? payload.opportunityIds.filter((id): id is string => typeof id === "string")
      : [];

    if (opportunityIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from("opportunities")
      .select("id, name, funder_id")
      .eq("organization_id", this.orgId)
      .in("id", opportunityIds);

    if (error) {
      throw new Error(`Failed to load chained opportunities: ${error.message}`);
    }
    return (data ?? []) as OpportunityScopeRow[];
  }

  /**
   * Default scope: every open opportunity for this org with no score row yet,
   * or whose score is more than STALE_AFTER_DAYS old — mirrors
   * scripts/batch-score-opportunities.ts's staleness rule, scoped to one org.
   */
  private async loadDefaultScope(): Promise<OpportunityScopeRow[]> {
    const [opportunitiesRes, scoresRes] = await Promise.all([
      this.supabase
        .from("opportunities")
        .select("id, name, funder_id")
        .eq("organization_id", this.orgId)
        .eq("status", "open"),
      this.supabase
        .from("opportunity_probability_scores")
        .select("opportunity_id, computed_at")
        .eq("organization_id", this.orgId),
    ]);

    if (opportunitiesRes.error) {
      throw new Error(
        `Failed to load open opportunities: ${opportunitiesRes.error.message}`,
      );
    }
    if (scoresRes.error) {
      throw new Error(
        `Failed to load existing probability scores: ${scoresRes.error.message}`,
      );
    }

    const scoreMap = new Map<string, string | null>();
    for (const row of (scoresRes.data ?? []) as ScoreRow[]) {
      scoreMap.set(row.opportunity_id, row.computed_at);
    }

    const staleThreshold = subDays(new Date(), STALE_AFTER_DAYS);
    const opportunities = (opportunitiesRes.data ?? []) as OpportunityScopeRow[];

    return opportunities.filter((opp) => {
      if (!scoreMap.has(opp.id)) return true;
      const computedAt = scoreMap.get(opp.id);
      if (!computedAt) return true;
      return new Date(computedAt) < staleThreshold;
    });
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    const nextActions: string[] = [];
    let scored = 0;
    let aboveThreshold = 0;
    let draftQueued = 0;

    try {
      const scope =
        triggerSource === "chain"
          ? await this.loadChainScope()
          : await this.loadDefaultScope();

      const { data: twinData } = await this.supabase
        .from("organizational_digital_twins")
        .select("mission, twin_completeness_score")
        .eq("organization_id", this.orgId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const twin = (twinData ?? null) as DigitalTwinRow | null;
      void twin; // loaded per spec; computeGrantProbability re-reads it itself for scoring.

      const config = await this.getOrgConfig();

      for (const opp of scope) {
        try {
          const result = await computeGrantProbability(
            opp.id,
            this.orgId,
            this.supabase,
          );
          scored++;

          const missionScore = factorPercent(result.factors, "twin_completeness");
          const urgency = factorPercent(result.factors, "deadline_proximity");
          const name = opp.name ?? "Untitled opportunity";

          const decisionId = await this.logDecision({
            decisionType: "probability_scored",
            agentRunId: runId,
            entityType: "opportunity",
            entityId: opp.id,
            reasoning:
              `Scored ${name} at ${result.score}%. ` +
              `Mission alignment: ${missionScore}%. ` +
              `Deadline urgency: ${urgency}%.`,
            confidenceScore: result.score,
            actionTaken: "upserted_probability_score",
          });
          decisions.push(decisionId);

          if (result.score >= config.auto_draft_threshold) {
            aboveThreshold++;

            if (config.auto_draft_enabled) {
              await this.queueChainedAgent("ag-05-draft", 8, {
                opportunityId: opp.id,
                score: result.score,
                title: name,
                funderId: opp.funder_id,
              });
              draftQueued++;
              nextActions.push("ag-05-draft");
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to score opportunity.";
          errors.push(`opportunity ${opp.id}: ${message}`);
        }
      }

      await this.completeRun(runId, {
        outputSummary: JSON.stringify({ scored, aboveThreshold, draftQueued }),
        itemsFound: scope.length,
        itemsProcessed: scored,
        itemsQueued: draftQueued,
      });

      return {
        success: true,
        itemsFound: scope.length,
        itemsProcessed: scored,
        itemsQueued: draftQueued,
        decisions,
        nextActions,
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Probability scoring failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: scored,
        itemsQueued: draftQueued,
        decisions,
        nextActions,
        errors: [...errors, message],
      };
    }
  }
}
