// Autonomous Digest Agent — FULL AGENTIC UPGRADE (July 2026).
//
// This is no longer a data dump of overnight counts. It is a curated,
// prioritized briefing: it pulls candidate items from every autonomous
// signal source in the platform, scores each with a digest_priority value,
// takes the top 8, and asks Claude to write a specific, action-oriented
// narrative over exactly those items. It also tracks whether the user acts
// on what it surfaces (via digest_item_log) and nudges each item type's
// priority weight over time based on that history (digest_priority_weights)
// — see migration 098_digest_agent_upgrade.sql for both new tables and the
// 'ag-digest' agent_type enum value this agent has always needed but never
// had (AGENTS_v2.md section 1.2 / section 7: "AutonomousDigestAgent per
// active org (blocked, 1.2)" — every prior run has failed at startRun()
// before any of the logic below ever executed).
//
// Known deviations from the literal task spec, documented per this
// project's established practice of not silently reshaping the schema to
// fit a task description that collides with what's actually live (see
// migration 091/093/097's own header comments for prior instances):
//   - "agent_runs WHERE agent_type='discovery'": agent_runs.agent_type has
//     no 'discovery' value — the actual discovery agent id is
//     'ag-17-discovery', and (per AGENTS_v2.md 1.2/1.3) that agent's own
//     startRun() insert is itself still blocked. This agent already reads
//     discovery activity from agent_decisions (decision_type=
//     'opportunity_discovered'), the same source the pre-upgrade version of
//     this file used — that is the one path that has actually been
//     confirmed to populate in this build.
//   - "deadline_predictions WHERE urgency='critical'": the real column is
//     urgency_tier with values red/amber/yellow/green (migration 097). 'red'
//     is treated as the critical tier.
//   - "relationship_recommendations WHERE priority_score >= 0.7":
//     relationship_recommendations has no priority_score column (checked
//     every migration that touches it — 076 created it, 096 only added the
//     agent_type enum value, no column was ever added). The multi-hop
//     "priority ranking" RelationshipBuilderAgent computes (recent AG-06
//     upgrade) lives in-memory for its own introduction-path ranking and is
//     never persisted back onto this table. This agent instead treats
//     urgency='urgent' AND status='pending' as the actionable-now subset,
//     the closest real analog to "high priority and not yet acted on."
//   - "strategic_recommendations WHERE urgency IN ('immediate','urgent')":
//     the priority-scoring table in the task spec only defines a score for
//     "immediate strategic recommendation: 100", not urgent. Urgent
//     strategic recommendations are scored at 90 (one tier below immediate,
//     above the 85 draft-review tier) — a reasoned interpolation, not a
//     literal spec value; see BASE_PRIORITY below.
//   - "improvement_proposals" has no org_id (migration 087 — platform-wide,
//     "No RLS -- platform owner only" per its own table comment). Surfacing
//     platform-internal AI self-improvement backlog inside every tenant's
//     morning briefing would leak platform-operator data to every customer.
//     This agent includes that source only when the running org has a
//     role='owner' profile, matching the exact targeting convention
//     SelfImprovementAgent.notifyPlatformOwners() already established
//     (src/lib/agents/self-improvement-agent.ts) for the same table.
//   - Every new-table query (deadline_predictions, corporate_intent_signals,
//     strategic_recommendations, community_need_signals,
//     improvement_proposals) is defensive: a query error degrades that
//     source to zero candidates rather than failing the whole run, matching
//     the pattern StrategicAdvisorAgent already uses for exactly this reason
//     (a migration landing in the repo is not the same as it being applied
//     to the live database this agent is running against).

import type { SupabaseClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";

/** Item types this agent can surface. Doubles as the digest_item_log /
 * digest_priority_weights key — keep these stable once weights accumulate
 * real history against them. */
type DigestItemType =
  | "strategic_immediate"
  | "strategic_urgent"
  | "critical_deadline"
  | "draft_pending_review"
  | "high_intent_signal"
  | "community_need_spike"
  | "high_probability_opportunity"
  | "relationship_opportunity"
  | "improvement_proposal";

/** Base priority per the task's scoring algorithm (Section 2), with the two
 * documented deviations above (strategic_urgent interpolated; no separate
 * tier exists for the 75-79 / 80-84 "detected but below action threshold"
 * bands — those are counted in narrative context only, never surfaced as a
 * candidate). */
const BASE_PRIORITY: Record<DigestItemType, number> = {
  strategic_immediate: 100,
  critical_deadline: 95,
  draft_pending_review: 85,
  strategic_urgent: 90,
  high_intent_signal: 80,
  community_need_spike: 75,
  high_probability_opportunity: 70,
  relationship_opportunity: 65,
  improvement_proposal: 40,
};

const TOP_N = 8;
const NARRATIVE_MAX_TOKENS = 800;
/** Give the org at least one full day to act before evaluating whether a
 * shown item was actioned; don't chase a backlog older than this. */
const RESOLVE_MIN_AGE_DAYS = 1;
const RESOLVE_MAX_AGE_DAYS = 60;
/** "After 30 days" per the task spec: a item type's weight is only nudged
 * once it has at least this many days of resolved history behind it. */
const WEIGHT_LOOKBACK_DAYS = 30;
/** Below this many resolved samples, an action rate is too noisy to trust —
 * leave the multiplier at its current value. */
const MIN_SAMPLES_FOR_WEIGHT = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Maps an observed action rate (0-1) to a bounded multiplier. An item type
 * nobody ever acts on drifts toward 0.6x its base priority; one that's
 * always acted on drifts toward 1.4x. Centered on 1.0 at a 50% action rate
 * so a brand-new type with no signal yet stays neutral. */
function computeWeightMultiplier(actionRate: number): number {
  return clamp(0.6 + actionRate * 0.8, 0.6, 1.4);
}

interface DigestCandidate {
  itemType: DigestItemType;
  entityType: string;
  entityId: string;
  title: string;
  detail: string;
  basePriority: number;
  dueDate?: string | null;
}

interface RankedItem extends DigestCandidate {
  digestPriority: number;
}

interface StrategicRecRow {
  id: string;
  title: string;
  recommendation: string;
  urgency: string;
  time_sensitivity: string | null;
}

interface DeadlinePredictionRow {
  id: string;
  opportunity_id: string | null;
  predicted_deadline: string;
  confidence: number;
  urgency_tier: string | null;
  opportunities: { name: string } | null;
}

interface ApplicationPendingRow {
  id: string;
  opportunity_id: string | null;
  funder_id: string | null;
  draft_confidence_score: number | null;
  opportunities: { name: string } | null;
  funders: { name: string } | null;
}

interface CorporateIntentRow {
  id: string;
  company_name: string;
  signal_type: string;
  signal_summary: string;
  intent_score: number | null;
  recommended_deadline: string | null;
}

interface CommunityNeedRow {
  id: string;
  signal_category: string;
  signal_description: string;
  geographic_area: string | null;
  predicted_demand_increase: number | null;
}

interface ProbabilityScoreRow {
  id: string;
  opportunity_id: string;
  overall_score: number;
  computed_at: string | null;
  opportunities: { name: string; deadline: string | null } | null;
}

interface RelationshipRecRow {
  id: string;
  entity_id: string;
  entity_type: string;
  recommendation_text: string;
  urgency: string;
}

interface ImprovementProposalRow {
  id: string;
  title: string;
  description: string;
  risk_level: string | null;
}

interface DigestItemLogRow {
  id: string;
  item_type: string;
  entity_type: string | null;
  entity_id: string | null;
  digest_date: string;
}

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
      const todayKey = since.slice(0, 10);

      // Adaptive learning runs every night regardless of whether tonight
      // has anything new to report — the weights should stay fresh even on
      // a quiet night.
      await this.resolveOutstandingLog(errors);
      await this.recalculateWeights(errors);
      const weights = await this.loadWeights();

      const [
        discoveredRes,
        scoredRes,
        strategicRes,
        deadlineRes,
        draftsRes,
        intentRes,
        communityRes,
        probabilityRes,
        relationshipRes,
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
        this.collectStrategicRecommendations(),
        this.collectCriticalDeadlines(since, errors),
        this.collectDraftsPendingReview(since, errors),
        this.collectHighIntentSignals(since, errors),
        this.collectCommunityNeedSpikes(since, errors),
        this.collectHighProbabilityOpportunities(since, errors),
        this.collectRelationshipOpportunities(since, errors),
      ]);
      const improvementCandidates = await this.collectImprovementProposals(
        since,
        errors,
      );

      const discovered = discoveredRes.count ?? 0;
      const scored = scoredRes.count ?? 0;

      const allCandidates: DigestCandidate[] = [
        ...strategicRes,
        ...deadlineRes,
        ...draftsRes,
        ...intentRes,
        ...communityRes,
        ...probabilityRes,
        ...relationshipRes,
        ...improvementCandidates,
      ];

      const totalActivity = discovered + scored + allCandidates.length;

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

      const ranked: RankedItem[] = allCandidates
        .map((candidate) => ({
          ...candidate,
          digestPriority: Math.round(
            candidate.basePriority * (weights.get(candidate.itemType) ?? 1.0),
          ),
        }))
        .sort((a, b) => b.digestPriority - a.digestPriority)
        .slice(0, TOP_N);

      let narrative: string;
      let tokensUsed: number | undefined;

      if (ranked.length === 0) {
        // Activity happened (discovery/scoring) but nothing rose to a
        // curated, actionable item -- a short factual line beats an empty
        // Claude call.
        narrative = `Overnight your AI platform discovered ${discovered} new opportunities and scored ${scored} opportunities. Nothing requires action yet -- check Opportunities for details.`;
      } else {
        const structured = ranked.map((item, index) => ({
          rank: index + 1,
          type: item.itemType,
          title: item.title,
          detail: item.detail,
          priority: item.digestPriority,
          due_date: item.dueDate ?? null,
        }));

        const userPrompt =
          `Overnight your AI platform discovered ${discovered} new opportunities and scored ${scored} opportunities. ` +
          `Here are the ${ranked.length} most important items, ranked by priority (highest first):\n\n` +
          JSON.stringify(structured, null, 2);

        const response = await callClaude({
          system:
            "You are writing a morning briefing for a nonprofit executive director. Be concise, specific, and action-oriented. Lead with the most time-sensitive item. Use numbered list format. Each item: one sentence what, one sentence why it matters, one sentence what to do. Total digest: 300-400 words.",
          prompt: userPrompt,
          model: DEFAULT_MODEL,
          maxTokens: NARRATIVE_MAX_TOKENS,
        });
        narrative = response.text;
        tokensUsed = response.usage.totalTokens;
      }

      const topPriority = ranked[0]?.digestPriority ?? 0;
      await this.createNotification(
        "morning_digest",
        "Good morning -- here is what happened overnight",
        narrative,
        {
          summary: {
            opportunities_discovered: discovered,
            opportunities_scored: scored,
            curated_items: ranked.length,
          },
        },
        topPriority >= 90 ? "warning" : "info",
      );

      const generatedAt = new Date().toISOString();
      await this.completeRun(runId, {
        outputSummary: narrative,
        itemsFound: totalActivity,
        itemsProcessed: totalActivity,
        tokensUsed,
        outputPayload: {
          narrative,
          items: ranked,
          generated_at: generatedAt,
        },
      });

      if (ranked.length > 0) {
        await this.logDigestItems(ranked, runId, todayKey, errors);
      }

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

  // ---- Candidate collection -------------------------------------------

  private async collectStrategicRecommendations(): Promise<
    DigestCandidate[]
  > {
    const { data, error } = await this.supabase
      .from("strategic_recommendations")
      .select("id, title, recommendation, urgency, time_sensitivity")
      .eq("org_id", this.orgId)
      .eq("status", "pending")
      .in("urgency", ["immediate", "urgent"])
      .order("generated_at", { ascending: false })
      .limit(20);
    if (error || !data) return [];

    return (data as StrategicRecRow[]).map((row) => ({
      itemType:
        row.urgency === "immediate"
          ? ("strategic_immediate" as const)
          : ("strategic_urgent" as const),
      entityType: "strategic_recommendation",
      entityId: row.id,
      title: row.title,
      detail: row.recommendation,
      basePriority:
        BASE_PRIORITY[
          row.urgency === "immediate" ? "strategic_immediate" : "strategic_urgent"
        ],
      dueDate: row.time_sensitivity,
    }));
  }

  private async collectCriticalDeadlines(
    since: string,
    errors: string[],
  ): Promise<DigestCandidate[]> {
    const { data, error } = await this.supabase
      .from("deadline_predictions")
      .select(
        "id, opportunity_id, predicted_deadline, confidence, urgency_tier, opportunities(name)",
      )
      .eq("org_id", this.orgId)
      .eq("urgency_tier", "red")
      .gte("created_at", since);
    if (error) {
      errors.push(`deadline_predictions query failed: ${error.message}`);
      return [];
    }
    const rows = (data ?? []) as unknown as DeadlinePredictionRow[];
    if (rows.length === 0) return [];

    const oppIds = rows
      .map((row) => row.opportunity_id)
      .filter((id): id is string => Boolean(id));
    const oppsWithApplication = new Set<string>();
    if (oppIds.length > 0) {
      const { data: existingApps } = await this.supabase
        .from("applications")
        .select("opportunity_id")
        .eq("organization_id", this.orgId)
        .in("opportunity_id", oppIds);
      for (const row of (existingApps ?? []) as Array<{
        opportunity_id: string | null;
      }>) {
        if (row.opportunity_id) oppsWithApplication.add(row.opportunity_id);
      }
    }

    return rows
      .filter(
        (row) => !row.opportunity_id || !oppsWithApplication.has(row.opportunity_id),
      )
      .map((row) => ({
        itemType: "critical_deadline" as const,
        entityType: "opportunity",
        entityId: row.opportunity_id ?? row.id,
        title: row.opportunities?.name ?? "Unnamed opportunity",
        detail: `Deadline predicted ${row.predicted_deadline} (${Math.round(row.confidence * 100)}% confidence), no application started yet.`,
        basePriority: BASE_PRIORITY.critical_deadline,
        dueDate: row.predicted_deadline,
      }));
  }

  private async collectDraftsPendingReview(
    since: string,
    errors: string[],
  ): Promise<DigestCandidate[]> {
    const { data, error } = await this.supabase
      .from("applications")
      .select(
        "id, opportunity_id, funder_id, draft_confidence_score, opportunities(name), funders(name)",
      )
      .eq("organization_id", this.orgId)
      .eq("auto_generated", true)
      .eq("pending_review", true)
      .gte("created_at", since);
    if (error) {
      errors.push(`applications (pending review) query failed: ${error.message}`);
      return [];
    }
    return ((data ?? []) as unknown as ApplicationPendingRow[]).map((row) => ({
      itemType: "draft_pending_review" as const,
      entityType: "application",
      entityId: row.id,
      title:
        row.opportunities?.name ??
        row.funders?.name ??
        "New draft application",
      detail: `AI-generated draft is ready for your review${row.draft_confidence_score != null ? ` (${row.draft_confidence_score}% confidence)` : ""}.`,
      basePriority: BASE_PRIORITY.draft_pending_review,
    }));
  }

  private async collectHighIntentSignals(
    since: string,
    errors: string[],
  ): Promise<DigestCandidate[]> {
    const { data, error } = await this.supabase
      .from("corporate_intent_signals")
      .select(
        "id, company_name, signal_type, signal_summary, intent_score, recommended_deadline",
      )
      .eq("org_id", this.orgId)
      .gte("intent_score", 80)
      .gte("created_at", since);
    if (error) {
      errors.push(`corporate_intent_signals query failed: ${error.message}`);
      return [];
    }
    // Collection threshold is 80 per the task's data-collection step, but
    // only >=85 rises to a curated top-8 candidate (the task's priority
    // formula) -- the 80-84 band is real activity, just not action-worthy
    // enough to bump another item out of the top 8.
    return ((data ?? []) as CorporateIntentRow[])
      .filter((row) => (row.intent_score ?? 0) >= 85)
      .map((row) => ({
        itemType: "high_intent_signal" as const,
        entityType: "corporate_intent_signal",
        entityId: row.id,
        title: row.company_name,
        detail: `${row.signal_type.replace(/_/g, " ")}: ${row.signal_summary}`,
        basePriority: BASE_PRIORITY.high_intent_signal,
        dueDate: row.recommended_deadline,
      }));
  }

  private async collectCommunityNeedSpikes(
    since: string,
    errors: string[],
  ): Promise<DigestCandidate[]> {
    const { data, error } = await this.supabase
      .from("community_need_signals")
      .select(
        "id, signal_category, signal_description, geographic_area, predicted_demand_increase",
      )
      .eq("org_id", this.orgId)
      .eq("severity", "critical")
      .gte("created_at", since);
    if (error) {
      errors.push(`community_need_signals query failed: ${error.message}`);
      return [];
    }
    return ((data ?? []) as CommunityNeedRow[]).map((row) => ({
      itemType: "community_need_spike" as const,
      entityType: "community_need_signal",
      entityId: row.id,
      title: `${row.signal_category} spike${row.geographic_area ? ` in ${row.geographic_area}` : ""}`,
      detail: row.signal_description,
      basePriority: BASE_PRIORITY.community_need_spike,
    }));
  }

  private async collectHighProbabilityOpportunities(
    since: string,
    errors: string[],
  ): Promise<DigestCandidate[]> {
    const { data, error } = await this.supabase
      .from("opportunity_probability_scores")
      .select("id, opportunity_id, overall_score, computed_at, opportunities(name, deadline)")
      .eq("org_id", this.orgId)
      .gte("computed_at", since)
      .gte("overall_score", 75);
    if (error) {
      errors.push(`opportunity_probability_scores query failed: ${error.message}`);
      return [];
    }
    // Same 75-vs-80 split as high-intent signals above: 75-79 counts toward
    // "opportunities scored" activity, only >=80 becomes a candidate item.
    return ((data ?? []) as unknown as ProbabilityScoreRow[])
      .filter((row) => row.overall_score >= 80)
      .map((row) => ({
        itemType: "high_probability_opportunity" as const,
        entityType: "opportunity",
        entityId: row.opportunity_id,
        title: row.opportunities?.name ?? "Unnamed opportunity",
        detail: `Scored ${row.overall_score}/100 -- above your draft threshold.`,
        basePriority: BASE_PRIORITY.high_probability_opportunity,
        dueDate: row.opportunities?.deadline ?? null,
      }));
  }

  private async collectRelationshipOpportunities(
    since: string,
    errors: string[],
  ): Promise<DigestCandidate[]> {
    const { data, error } = await this.supabase
      .from("relationship_recommendations")
      .select("id, entity_id, entity_type, recommendation_text, urgency")
      .eq("org_id", this.orgId)
      .eq("status", "pending")
      .eq("urgency", "urgent")
      .gte("created_at", since);
    if (error) {
      errors.push(`relationship_recommendations query failed: ${error.message}`);
      return [];
    }
    const rows = (data ?? []) as RelationshipRecRow[];
    if (rows.length === 0) return [];

    const funderIds = Array.from(
      new Set(
        rows.filter((row) => row.entity_type === "funder").map((row) => row.entity_id),
      ),
    );
    const funderNames = new Map<string, string>();
    if (funderIds.length > 0) {
      const { data: funderRows } = await this.supabase
        .from("funders")
        .select("id, name")
        .in("id", funderIds);
      for (const funder of (funderRows ?? []) as Array<{
        id: string;
        name: string;
      }>) {
        funderNames.set(funder.id, funder.name);
      }
    }

    return rows.map((row) => ({
      itemType: "relationship_opportunity" as const,
      entityType: "relationship_recommendation",
      entityId: row.id,
      title: funderNames.get(row.entity_id) ?? "Funder relationship",
      detail: row.recommendation_text,
      basePriority: BASE_PRIORITY.relationship_opportunity,
    }));
  }

  private async collectImprovementProposals(
    since: string,
    errors: string[],
  ): Promise<DigestCandidate[]> {
    const isOwnerOrg = await this.isPlatformOwnerOrg();
    if (!isOwnerOrg) return [];

    const { data, error } = await this.supabase
      .from("improvement_proposals")
      .select("id, title, description, risk_level")
      .eq("status", "proposed")
      .gte("proposed_at", since);
    if (error) {
      errors.push(`improvement_proposals query failed: ${error.message}`);
      return [];
    }
    return ((data ?? []) as ImprovementProposalRow[]).map((row) => ({
      itemType: "improvement_proposal" as const,
      entityType: "improvement_proposal",
      entityId: row.id,
      title: row.title,
      detail: `${row.description}${row.risk_level ? ` (${row.risk_level} risk)` : ""}`,
      basePriority: BASE_PRIORITY.improvement_proposal,
    }));
  }

  /** improvement_proposals has no org_id (migration 087, platform-wide) --
   * only surface it to the org whose own top-level user is role='owner',
   * matching SelfImprovementAgent.notifyPlatformOwners()'s targeting. */
  private async isPlatformOwnerOrg(): Promise<boolean> {
    const { data } = await this.supabase
      .from("profiles")
      .select("id")
      .eq("organization_id", this.orgId)
      .eq("role", "owner")
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  // ---- Adaptive learning -------------------------------------------------

  private async logDigestItems(
    items: RankedItem[],
    runId: string,
    digestDate: string,
    errors: string[],
  ): Promise<void> {
    const { error } = await this.supabase.from("digest_item_log").insert(
      items.map((item) => ({
        org_id: this.orgId,
        agent_run_id: runId,
        item_type: item.itemType,
        entity_type: item.entityType,
        entity_id: item.entityId,
        base_priority: item.basePriority,
        weighted_priority: item.digestPriority,
        digest_date: digestDate,
      })),
    );
    if (error) errors.push(`digest_item_log insert failed: ${error.message}`);
  }

  /** For every previously-logged item old enough to have plausibly been
   * acted on, checks the source table's current state and records whether
   * it was. Best-effort: a failure here must never block tonight's digest. */
  private async resolveOutstandingLog(errors: string[]): Promise<void> {
    try {
      const maxDate = subDays(new Date(), RESOLVE_MIN_AGE_DAYS)
        .toISOString()
        .slice(0, 10);
      const minDate = subDays(new Date(), RESOLVE_MAX_AGE_DAYS)
        .toISOString()
        .slice(0, 10);

      const { data, error } = await this.supabase
        .from("digest_item_log")
        .select("id, item_type, entity_type, entity_id, digest_date")
        .eq("org_id", this.orgId)
        .eq("resolved", false)
        .lte("digest_date", maxDate)
        .gte("digest_date", minDate)
        .limit(200);
      if (error || !data || data.length === 0) return;

      const rows = data as DigestItemLogRow[];
      const byType = new Map<string, DigestItemLogRow[]>();
      for (const row of rows) {
        const bucket = byType.get(row.item_type) ?? [];
        bucket.push(row);
        byType.set(row.item_type, bucket);
      }

      for (const [itemType, bucket] of byType) {
        const actionedIds = await this.resolveBucket(itemType, bucket);
        for (const row of bucket) {
          const actioned = actionedIds.has(row.id) ? actionedIds.get(row.id)! : null;
          await this.supabase
            .from("digest_item_log")
            .update({
              resolved: true,
              actioned,
              resolved_at: new Date().toISOString(),
            })
            .eq("id", row.id);
        }
      }
    } catch (err) {
      errors.push(
        `resolveOutstandingLog failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Returns a map of digest_item_log.id -> actioned (true/false). Rows
   * whose action state genuinely can't be determined from this schema
   * (high_intent_signal, community_need_spike -- neither source table has a
   * status column) are simply absent from the map, which resolveOutstandingLog
   * treats as "resolved with unknown outcome" rather than fabricating one. */
  private async resolveBucket(
    itemType: string,
    bucket: DigestItemLogRow[],
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    const entityIds = bucket
      .map((row) => row.entity_id)
      .filter((id): id is string => Boolean(id));
    if (entityIds.length === 0) return result;

    if (itemType === "draft_pending_review") {
      const { data } = await this.supabase
        .from("applications")
        .select("id, pending_review")
        .in("id", entityIds);
      const stillPending = new Set(
        ((data ?? []) as Array<{ id: string; pending_review: boolean }>)
          .filter((row) => row.pending_review)
          .map((row) => row.id),
      );
      for (const row of bucket) {
        if (row.entity_id) result.set(row.id, !stillPending.has(row.entity_id));
      }
      return result;
    }

    if (itemType === "critical_deadline" || itemType === "high_probability_opportunity") {
      const { data } = await this.supabase
        .from("applications")
        .select("opportunity_id")
        .eq("organization_id", this.orgId)
        .in("opportunity_id", entityIds);
      const withApplication = new Set(
        ((data ?? []) as Array<{ opportunity_id: string | null }>)
          .map((row) => row.opportunity_id)
          .filter((id): id is string => Boolean(id)),
      );
      for (const row of bucket) {
        if (row.entity_id) result.set(row.id, withApplication.has(row.entity_id));
      }
      return result;
    }

    if (itemType === "strategic_immediate" || itemType === "strategic_urgent") {
      const { data } = await this.supabase
        .from("strategic_recommendations")
        .select("id, status")
        .in("id", entityIds);
      const stillPending = new Set(
        ((data ?? []) as Array<{ id: string; status: string }>)
          .filter((row) => row.status === "pending")
          .map((row) => row.id),
      );
      for (const row of bucket) {
        if (row.entity_id) result.set(row.id, !stillPending.has(row.entity_id));
      }
      return result;
    }

    if (itemType === "relationship_opportunity") {
      const { data } = await this.supabase
        .from("relationship_recommendations")
        .select("id, status")
        .in("id", entityIds);
      const stillPending = new Set(
        ((data ?? []) as Array<{ id: string; status: string }>)
          .filter((row) => row.status === "pending")
          .map((row) => row.id),
      );
      for (const row of bucket) {
        if (row.entity_id) result.set(row.id, !stillPending.has(row.entity_id));
      }
      return result;
    }

    if (itemType === "improvement_proposal") {
      const { data } = await this.supabase
        .from("improvement_proposals")
        .select("id, status")
        .in("id", entityIds);
      const stillProposed = new Set(
        ((data ?? []) as Array<{ id: string; status: string }>)
          .filter((row) => row.status === "proposed")
          .map((row) => row.id),
      );
      for (const row of bucket) {
        if (row.entity_id) result.set(row.id, !stillProposed.has(row.entity_id));
      }
      return result;
    }

    // high_intent_signal / community_need_spike: no status column exists on
    // corporate_intent_signals or community_need_signals to check against --
    // left unresolved-outcome by design (see method doc comment above).
    return result;
  }

  /** Folds this org's resolved history into the shared, platform-wide
   * digest_priority_weights table via an incremental (not overwrite) update,
   * since every org's nightly run contributes to the same shared weights.
   * Only nudges a type once it has both enough samples and enough elapsed
   * time (30 days) behind it, per the task spec. */
  private async recalculateWeights(errors: string[]): Promise<void> {
    try {
      const cutoff = subDays(new Date(), WEIGHT_LOOKBACK_DAYS)
        .toISOString()
        .slice(0, 10);

      const { data, error } = await this.supabase
        .from("digest_item_log")
        .select("item_type, actioned, digest_date")
        .eq("org_id", this.orgId)
        .eq("resolved", true)
        .not("actioned", "is", null)
        .lte("digest_date", cutoff);
      if (error || !data || data.length === 0) return;

      const rows = data as Array<{
        item_type: string;
        actioned: boolean;
        digest_date: string;
      }>;
      const byType = new Map<string, { total: number; actioned: number }>();
      for (const row of rows) {
        const bucket = byType.get(row.item_type) ?? { total: 0, actioned: 0 };
        bucket.total += 1;
        if (row.actioned) bucket.actioned += 1;
        byType.set(row.item_type, bucket);
      }

      for (const [itemType, sample] of byType) {
        if (sample.total < MIN_SAMPLES_FOR_WEIGHT) continue;

        const { data: existing } = await this.supabase
          .from("digest_priority_weights")
          .select("sample_count, action_rate")
          .eq("item_type", itemType)
          .maybeSingle();

        const priorCount = (existing as { sample_count: number } | null)
          ?.sample_count ?? 0;
        const priorRate =
          (existing as { action_rate: number | null } | null)?.action_rate ?? 0.5;
        const newCount = priorCount + sample.total;
        const newRate =
          (priorRate * priorCount + sample.actioned) / Math.max(newCount, 1);

        await this.supabase.from("digest_priority_weights").upsert(
          {
            item_type: itemType,
            weight_multiplier: computeWeightMultiplier(newRate),
            action_rate: newRate,
            sample_count: newCount,
            last_recalculated_at: new Date().toISOString(),
          },
          { onConflict: "item_type" },
        );
      }
    } catch (err) {
      errors.push(
        `recalculateWeights failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async loadWeights(): Promise<Map<DigestItemType, number>> {
    const weights = new Map<DigestItemType, number>();
    const { data } = await this.supabase
      .from("digest_priority_weights")
      .select("item_type, weight_multiplier");
    for (const row of (data ?? []) as Array<{
      item_type: string;
      weight_multiplier: number;
    }>) {
      weights.set(row.item_type as DigestItemType, row.weight_multiplier);
    }
    return weights;
  }
}
