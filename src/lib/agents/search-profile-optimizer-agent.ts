// AG-12 Search Profile Optimizer Agent (AutonomousAgent, migration 080
// infrastructure). Runs monthly - registered in
// worker/autonomous-orchestrator.ts's runOrgPipeline, gated on the 1st of
// the month (America/Chicago) since the worker only has a single fixed 2AM
// nightly cron slot; see worker/scheduler.ts.
//
// HARD LIMIT: this agent only ever writes suggestions to a notification and
// an agent_decisions row. It NEVER updates search_profiles.
//
// Deviation from the task-given spec, checked against the real schema
// (src/types/database.ts): there is no column anywhere linking a discovered
// `opportunity` back to the `search_profile` that found it (no
// opportunities.search_profile_id, no join table). "Opportunities
// discovered in last 90 days ... linked to this profile" is therefore
// approximated: if the profile has `categories` configured, opportunities
// whose category is in that list count as this profile's; otherwise, if it
// has `keywords`, opportunities whose name matches one of those keywords
// count. Both are scoped to source='agent' and discovered_at within the
// last 90 days, same as the task's literal filter. A profile with neither
// categories nor keywords set (shouldn't happen - keywords is NOT NULL on
// search_profiles) discovers 0 by definition.
//
// "scored >= 70" uses opportunities.eligibility_score - the only per-
// opportunity score that exists on discovered records (probability scoring
// lives in a separate, application-keyed success_probability_scores table
// with no path back to a raw discovered opportunity).

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude } from "@/lib/ai/claude";
import type { Enums } from "@/types/database";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";
type FunderCategory = Enums<"funder_category">;

const DISCOVERY_WINDOW_DAYS = 90;
const HIGH_SCORE_THRESHOLD = 70;
const UNDERPERFORMING_HIT_RATE = 0.2;

interface SearchProfileRow {
  id: string;
  name: string;
  keywords: string[];
  categories: FunderCategory[] | null;
}

interface OpportunityScoreRow {
  eligibility_score: number | null;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export class SearchProfileOptimizerAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-12-search-optimizer", supabase);
  }

  /** Approximates "opportunities discovered by this profile" - see file header. */
  private async loadDiscoveredScores(
    profile: SearchProfileRow,
    sinceIso: string,
  ): Promise<OpportunityScoreRow[]> {
    let query = this.supabase
      .from("opportunities")
      .select("eligibility_score")
      .eq("organization_id", this.orgId)
      .eq("source", "agent")
      .gte("discovered_at", sinceIso);

    if (profile.categories && profile.categories.length > 0) {
      query = query.in("category", profile.categories);
    } else if (profile.keywords && profile.keywords.length > 0) {
      const orFilter = profile.keywords
        .map((kw) => `name.ilike.%${kw.replace(/[%,]/g, "")}%`)
        .join(",");
      query = query.or(orFilter);
    } else {
      return [];
    }

    const { data } = await query;
    return (data ?? []) as OpportunityScoreRow[];
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;
    let profilesFlagged = 0;

    try {
      const [{ data: profileRows, error: profilesError }, { data: orgRow }] =
        await Promise.all([
          this.supabase
            .from("search_profiles")
            .select("id, name, keywords, categories")
            .eq("organization_id", this.orgId),
          this.supabase
            .from("organizations")
            .select("mission_statement")
            .eq("id", this.orgId)
            .maybeSingle(),
        ]);

      if (profilesError) {
        throw new Error(
          `Failed to load search profiles: ${profilesError.message}`,
        );
      }

      const profiles = (profileRows ?? []) as SearchProfileRow[];
      const orgMission =
        (orgRow?.mission_statement as string | null) ??
        "No mission statement on file.";
      const sinceIso = addDays(new Date(), -DISCOVERY_WINDOW_DAYS).toISOString();

      for (const profile of profiles) {
        try {
          const scores = await this.loadDiscoveredScores(profile, sinceIso);
          const totalDiscovered = scores.length;
          const highScoreCount = scores.filter(
            (s) => (s.eligibility_score ?? 0) >= HIGH_SCORE_THRESHOLD,
          ).length;
          const hitRate =
            totalDiscovered > 0 ? highScoreCount / totalDiscovered : 0;
          const underperforming =
            hitRate < UNDERPERFORMING_HIT_RATE || totalDiscovered === 0;

          if (!underperforming) continue;

          profilesFlagged++;

          const response = await callClaude({
            maxTokens: 300,
            prompt:
              `This nonprofit search profile has underperformed. Keywords: ${profile.keywords.join(", ")}. ` +
              `Org mission: ${orgMission}. Suggest 5 improved keyword additions to find better-matched grant opportunities.`,
          });
          tokensUsed += response.usage.totalTokens;

          await this.createNotification(
            "search_profile_optimization",
            `Search profile "${profile.name}" is underperforming`,
            `Hit rate ${(hitRate * 100).toFixed(0)}% over ${totalDiscovered} discovered opportunit${
              totalDiscovered === 1 ? "y" : "ies"
            } in the last ${DISCOVERY_WINDOW_DAYS} days. Suggested keyword additions: ${response.text.trim()}`,
            {
              searchProfileId: profile.id,
              totalDiscovered,
              highScoreCount,
              hitRate,
            },
          );

          decisions.push(
            await this.logDecision({
              decisionType: "search_profile_optimization_suggested",
              agentRunId: runId,
              entityType: "search_profile",
              entityId: profile.id,
              reasoning: `Profile "${profile.name}" hit rate ${(hitRate * 100).toFixed(0)}% (${highScoreCount}/${totalDiscovered}) over the last ${DISCOVERY_WINDOW_DAYS} days is below the ${(UNDERPERFORMING_HIT_RATE * 100).toFixed(0)}% threshold.`,
              confidenceScore: 75,
              actionTaken: "suggested_keyword_additions",
              actionPayload: {
                totalDiscovered,
                highScoreCount,
                hitRate,
                suggestions: response.text.trim(),
              },
              requiredHumanReview: true,
            }),
          );
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to evaluate search profile.";
          errors.push(`search profile ${profile.id}: ${message}`);
        }
      }

      await this.completeRun(runId, {
        outputSummary: `${profilesFlagged}/${profiles.length} search profile(s) flagged as underperforming.`,
        itemsFound: profiles.length,
        itemsProcessed: profiles.length,
        itemsQueued: profilesFlagged,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: profiles.length,
        itemsProcessed: profiles.length,
        itemsQueued: profilesFlagged,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Search profile optimizer run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: profilesFlagged,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
