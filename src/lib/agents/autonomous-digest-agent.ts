// Autonomous Digest Agent — an AI-written morning briefing over the
// agent_decisions audit trail (migration 080 infrastructure), distinct from
// src/lib/agents/morning-digest.ts's plain sendMorningDigest() function
// (which rolls up discovery_matches/reputation_alerts/relationship_recommendations/
// deadlines into a single alerts row, no Claude call, no agent_runs logging).
// This agent instead summarizes what the autonomous pipeline itself did
// overnight — discoveries, scores, drafts, signals — via AutonomousAgent
// (src/lib/agents/autonomous-base.ts), so its run is logged to agent_runs
// like every other autonomous agent.
//
// "threshold" for the high-score count is the org's own auto_draft_threshold
// (org_autonomous_config) — the same value ProbabilityScoringAgent gates
// auto-drafting on, so "opportunities above your draft threshold" means
// exactly that.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";

export class AutonomousDigestAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-digest", supabase);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];

    try {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const since = midnight.toISOString();

      const config = await this.getOrgConfig();
      const threshold = config.auto_draft_threshold;

      const [
        discoveredRes,
        scoredRes,
        highScoreRes,
        draftsGeneratedRes,
        draftsPendingReviewRes,
        reputationAlertsRes,
        relationshipRecsRes,
      ] = await Promise.all([
        this.supabase
          .from("agent_decisions")
          .select("id", { count: "exact", head: true })
          .eq("org_id", this.orgId)
          .eq("decision_type", "opportunity_discovered")
          .gte("created_at", since),
        this.supabase
          .from("agent_decisions")
          .select("id", { count: "exact", head: true })
          .eq("org_id", this.orgId)
          .eq("decision_type", "probability_scored")
          .gte("created_at", since),
        this.supabase
          .from("agent_decisions")
          .select("id", { count: "exact", head: true })
          .eq("org_id", this.orgId)
          .eq("decision_type", "probability_scored")
          .gte("confidence_score", threshold)
          .gte("created_at", since),
        this.supabase
          .from("agent_decisions")
          .select("id", { count: "exact", head: true })
          .eq("org_id", this.orgId)
          .eq("decision_type", "draft_generated")
          .gte("created_at", since),
        this.supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", this.orgId)
          .eq("auto_generated", true)
          .eq("pending_review", true)
          .gte("created_at", since),
        this.supabase
          .from("reputation_alerts")
          .select("id", { count: "exact", head: true })
          .eq("org_id", this.orgId)
          .gte("created_at", since),
        this.supabase
          .from("relationship_recommendations")
          .select("id", { count: "exact", head: true })
          .eq("org_id", this.orgId)
          .gte("created_at", since),
      ]);

      const discovered = discoveredRes.count ?? 0;
      const scored = scoredRes.count ?? 0;
      const highScore = highScoreRes.count ?? 0;
      const draftsGenerated = draftsGeneratedRes.count ?? 0;
      const draftsPendingReview = draftsPendingReviewRes.count ?? 0;
      const reputationAlerts = reputationAlertsRes.count ?? 0;
      const relationshipRecs = relationshipRecsRes.count ?? 0;

      const totalActivity =
        discovered +
        scored +
        highScore +
        draftsGenerated +
        draftsPendingReview +
        reputationAlerts +
        relationshipRecs;

      if (totalActivity === 0) {
        await this.completeRun(runId, {
          outputSummary: "No overnight activity -- digest skipped",
          itemsFound: 0,
          itemsProcessed: 0,
        });
        return {
          success: true,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions: [],
          nextActions: [],
          errors,
        };
      }

      const userPrompt =
        `Write a 3-sentence morning briefing. Overnight your AI platform discovered ${discovered} new opportunities, ` +
        `scored ${scored} opportunities (${highScore} above your draft threshold), generated ${draftsGenerated} draft ` +
        `applications now pending your review, detected ${reputationAlerts} reputation signals, and created ${relationshipRecs} ` +
        `relationship recommendations. Lead with the most actionable item. Be specific with numbers. Professional but warm tone.`;

      const response = await callClaude({
        system:
          "You are writing a concise morning briefing for a nonprofit executive director.",
        prompt: userPrompt,
        model: DEFAULT_MODEL,
        maxTokens: 400,
      });

      await this.createNotification(
        "morning_digest",
        "Good morning -- here is what happened overnight",
        response.text,
        {
          summary: {
            opportunities_discovered: discovered,
            opportunities_scored: scored,
            drafts_generated: draftsGenerated,
            reputation_alerts: reputationAlerts,
          },
        },
      );

      await this.completeRun(runId, {
        outputSummary: response.text,
        itemsFound: totalActivity,
        itemsProcessed: totalActivity,
        tokensUsed: response.usage.totalTokens,
      });

      return {
        success: true,
        itemsFound: totalActivity,
        itemsProcessed: totalActivity,
        itemsQueued: 0,
        decisions: [],
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Morning digest failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions: [],
        nextActions: [],
        errors: [message],
      };
    }
  }
}
