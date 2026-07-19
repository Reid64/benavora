// Relationship Builder Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 4
// (Autonomous Relationship Builder), AGENTS_v2.md AG-19.
//
// Nightly, per-funder pass: recompute a deterministic relationship score
// from relationship_memory recency/volume + award history, derive momentum
// against the previous score, then (above the auto-draft threshold, reused
// here as the relationship-recommendation floor) ask Claude for one specific
// engagement recommendation and log the decision (migration 080
// infrastructure: agent_runs, agent_decisions, org_autonomous_config).
//
// funder_relationship_scores predates this agent (BEHAVIORAL_CONTRACTS.md
// §26, src/lib/agents/funder-relationship.ts — Agent 23's event-delta
// scorer) and has no local migration file; it was created directly against
// prod. Its real columns are organization_id/funder_id/relationship_score/
// trend/updated_at (confirmed via funder-relationship.ts and
// FunderDetail.tsx), NOT the org_id/score/momentum/last_calculated_at names
// SCHEMA_REGISTRY_v2.md describes. This agent writes relationship_score and
// trend on that same table (upsert on organization_id,funder_id — never
// touching Agent 23's recent_events/total_interactions/successful_
// applications/is_stale columns, which are omitted from the payload). The
// "momentum" concept this agent computes (rising/declining/stable) is
// mapped onto the existing trend vocabulary (rising/falling/neutral) so the
// funders list and FunderDetail panel — which type trend as exactly those
// three values — keep rendering correctly.
//
// relationship_memory and relationship_recommendations (migration 076) do
// use org_id, matching both SCHEMA_REGISTRY_v2.md and the reputation agent
// (src/lib/intelligence/reputation-agent.ts), which already writes
// relationship_memory rows this agent reads.

import type { SupabaseClient } from "@supabase/supabase-js";
import { differenceInCalendarDays } from "date-fns";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";

type Momentum = "rising" | "declining" | "stable";
type StoredTrend = "rising" | "falling" | "neutral";

const RECENT_MEMORY_LIMIT = 10;
const MEMORY_FOR_PROMPT = 5;
const NINETY_DAY_BONUS_CAP = 20;
const NINETY_DAY_BONUS_PER_MEMORY = 5;

interface FunderRow {
  id: string;
  name: string;
}

interface MemoryRow {
  memory_type: string;
  content: string;
  signal_date: string | null;
  created_at: string;
}

interface ExistingScoreRow {
  relationship_score: number | null;
}

interface RecommendationResult {
  recommendation: string;
  urgency: "urgent" | "normal" | "low";
  reasoning: string;
}

function memoryDate(m: MemoryRow): Date {
  return new Date(m.signal_date ?? m.created_at);
}

/**
 * Deterministic score per AGENTS_v2.md AG-19: base 50, recency/volume
 * bonuses from relationship_memory, an award bonus, and staleness
 * penalties. The two staleness tiers are treated as tiered (not additive)
 * to mirror the elif structure of the recency bonus directly above them —
 * a funder silent 400 days takes the -20 penalty, not -30.
 */
function computeRelationshipScore(
  memories: MemoryRow[],
  hasAwardedOutcome: boolean,
): number {
  let score = 50;

  const daysSinceContact = memories[0]
    ? differenceInCalendarDays(new Date(), memoryDate(memories[0]))
    : Infinity;

  if (daysSinceContact <= 14) {
    score += 15;
  } else if (daysSinceContact <= 30) {
    score += 10;
  }

  const recentCount = memories.filter(
    (m) => differenceInCalendarDays(new Date(), memoryDate(m)) <= 90,
  ).length;
  score += Math.min(
    recentCount * NINETY_DAY_BONUS_PER_MEMORY,
    NINETY_DAY_BONUS_CAP,
  );

  if (hasAwardedOutcome) score += 10;

  if (daysSinceContact >= 365) {
    score -= 20;
  } else if (daysSinceContact >= 180) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function computeMomentum(newScore: number, previousScore: number): Momentum {
  if (newScore > previousScore + 5) return "rising";
  if (newScore < previousScore - 5) return "declining";
  return "stable";
}

/** Maps this agent's rising/declining/stable onto the trend column's
 * existing rising/falling/neutral vocabulary (see file header). */
function momentumToTrend(momentum: Momentum): StoredTrend {
  if (momentum === "rising") return "rising";
  if (momentum === "declining") return "falling";
  return "neutral";
}

function buildRecommendationPrompt(
  funderName: string,
  score: number,
  momentum: Momentum,
  memories: MemoryRow[],
): { system: string; prompt: string } {
  const system =
    'You are a nonprofit relationship strategist. Return JSON only: ' +
    '{ recommendation: string, urgency: "urgent"|"normal"|"low", reasoning: string }';

  const memoryLines =
    memories.length > 0
      ? memories
          .slice(0, MEMORY_FOR_PROMPT)
          .map((m) => {
            const date = m.signal_date ?? m.created_at.slice(0, 10);
            return `- [${m.memory_type}] ${date}: ${m.content}`;
          })
          .join("\n")
      : "(no recorded interactions)";

  const prompt = [
    `Funder: ${funderName}`,
    `Relationship score: ${score}`,
    `Momentum: ${momentum}`,
    "",
    "Recent interaction history:",
    memoryLines,
    "",
    "Recommend one specific next action. Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

/** Tolerant JSON extraction — mirrors parseClassification in
 * src/lib/intelligence/reputation-agent.ts. Returns null on any
 * unreadable/malformed response rather than risking a garbage
 * recommendation. */
function parseRecommendation(text: string): RecommendationResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const obj = (raw ?? {}) as {
    recommendation?: unknown;
    urgency?: unknown;
    reasoning?: unknown;
  };

  const recommendation =
    typeof obj.recommendation === "string" ? obj.recommendation.trim() : "";
  if (!recommendation) return null;

  const urgencyRaw =
    typeof obj.urgency === "string" ? obj.urgency.toLowerCase() : "";
  const urgency: RecommendationResult["urgency"] =
    urgencyRaw === "urgent" || urgencyRaw === "low" ? urgencyRaw : "normal";

  const reasoning =
    typeof obj.reasoning === "string" ? obj.reasoning.trim() : "";

  return { recommendation, urgency, reasoning };
}

export class RelationshipBuilderAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-19-relationship", supabase);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    let fundersAnalyzed = 0;
    let scoresUpdated = 0;
    let recommendationsGenerated = 0;
    let skippedLowPriority = 0;

    try {
      const { data: funderRows, error: fundersError } = await this.supabase
        .from("funders")
        .select("id, name")
        .eq("organization_id", this.orgId);

      if (fundersError) {
        throw new Error(`Failed to load funders: ${fundersError.message}`);
      }

      const funders = (funderRows ?? []) as FunderRow[];
      const config = await this.getOrgConfig();
      const threshold = config.auto_draft_threshold;

      for (const funder of funders) {
        fundersAnalyzed++;

        try {
          const [memoriesRes, existingScoreRes, applicationsRes] =
            await Promise.all([
              this.supabase
                .from("relationship_memory")
                .select("memory_type, content, signal_date, created_at")
                .eq("org_id", this.orgId)
                .eq("entity_id", funder.id)
                .eq("entity_type", "funder")
                .order("created_at", { ascending: false })
                .limit(RECENT_MEMORY_LIMIT),
              this.supabase
                .from("funder_relationship_scores")
                .select("relationship_score")
                .eq("organization_id", this.orgId)
                .eq("funder_id", funder.id)
                .maybeSingle(),
              this.supabase
                .from("applications")
                .select("id")
                .eq("organization_id", this.orgId)
                .eq("funder_id", funder.id),
            ]);

          if (memoriesRes.error) {
            throw new Error(
              `Failed to load relationship memory: ${memoriesRes.error.message}`,
            );
          }
          if (applicationsRes.error) {
            throw new Error(
              `Failed to load applications: ${applicationsRes.error.message}`,
            );
          }

          const memories = (memoriesRes.data ?? []) as MemoryRow[];
          const applicationIds = (applicationsRes.data ?? []).map(
            (a) => (a as { id: string }).id,
          );

          let hasAwardedOutcome = false;
          if (applicationIds.length > 0) {
            const { data: awardedRows, error: outcomesError } =
              await this.supabase
                .from("outcomes")
                .select("id")
                .eq("organization_id", this.orgId)
                .eq("result", "awarded")
                .in("application_id", applicationIds)
                .limit(1);

            if (outcomesError) {
              throw new Error(
                `Failed to load outcomes: ${outcomesError.message}`,
              );
            }
            hasAwardedOutcome = (awardedRows ?? []).length > 0;
          }

          const existingScore = existingScoreRes.data as
            | ExistingScoreRow
            | null;
          const previousScore = existingScore?.relationship_score ?? null;

          const newScore = computeRelationshipScore(
            memories,
            hasAwardedOutcome,
          );
          const momentum = computeMomentum(newScore, previousScore ?? newScore);

          const { error: upsertError } = await this.supabase
            .from("funder_relationship_scores")
            .upsert(
              {
                organization_id: this.orgId,
                funder_id: funder.id,
                relationship_score: newScore,
                trend: momentumToTrend(momentum),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "organization_id,funder_id" },
            );

          if (upsertError) {
            throw new Error(
              `Failed to upsert relationship score: ${upsertError.message}`,
            );
          }
          scoresUpdated++;

          if (newScore < threshold) {
            skippedLowPriority++;
            decisions.push(
              await this.logDecision({
                decisionType: "relationship_recommendation_generated",
                agentRunId: runId,
                entityType: "funder",
                entityId: funder.id,
                reasoning:
                  `Score ${newScore} (${momentum}). Below relationship-recommendation ` +
                  `threshold ${threshold} — skipped Claude call.`,
                confidenceScore: newScore,
                actionTaken: "score_updated_low_priority_skipped",
              }),
            );
            continue;
          }

          const { data: pendingRec } = await this.supabase
            .from("relationship_recommendations")
            .select("id")
            .eq("org_id", this.orgId)
            .eq("entity_id", funder.id)
            .eq("status", "pending")
            .maybeSingle();

          if (pendingRec) continue;

          const { system, prompt } = buildRecommendationPrompt(
            funder.name,
            newScore,
            momentum,
            memories,
          );

          const response = await callClaude({
            system,
            prompt,
            model: DEFAULT_MODEL,
            maxTokens: 300,
          });
          const parsed = parseRecommendation(response.text);
          if (!parsed) {
            errors.push(
              `funder ${funder.id}: unparseable recommendation response.`,
            );
            continue;
          }

          const { error: insertError } = await this.supabase
            .from("relationship_recommendations")
            .insert({
              org_id: this.orgId,
              entity_id: funder.id,
              entity_type: "funder",
              recommendation_text: parsed.recommendation,
              urgency: parsed.urgency,
              status: "pending",
            });

          if (insertError) {
            throw new Error(
              `Failed to insert recommendation: ${insertError.message}`,
            );
          }
          recommendationsGenerated++;

          decisions.push(
            await this.logDecision({
              decisionType: "relationship_recommendation_generated",
              agentRunId: runId,
              entityType: "funder",
              entityId: funder.id,
              reasoning: `Score ${newScore} (${momentum}). ${parsed.reasoning}`,
              confidenceScore: newScore,
              actionTaken: "inserted_recommendation",
            }),
          );
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to process funder relationship.";
          errors.push(`funder ${funder.id}: ${message}`);
        }
      }

      const summary = {
        fundersAnalyzed,
        scoresUpdated,
        recommendationsGenerated,
        skippedLowPriority,
      };

      await this.completeRun(runId, {
        outputSummary: JSON.stringify(summary),
        itemsFound: funders.length,
        itemsProcessed: scoresUpdated,
        itemsQueued: recommendationsGenerated,
      });

      return {
        success: true,
        itemsFound: funders.length,
        itemsProcessed: scoresUpdated,
        itemsQueued: recommendationsGenerated,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Relationship builder run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: scoresUpdated,
        itemsQueued: recommendationsGenerated,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
