// Draft Generation Agent — AGENTS_v2.md's Phase 1 list calls this
// "AG-06: Draft Generator Agent (Already implemented)", but the literal
// agent_id already wired into agent_queue chaining is "ag-05-draft" (see
// src/lib/agents/probability-scoring-agent.ts's queueChainedAgent call when
// auto_draft_enabled and score >= auto_draft_threshold). This file keeps
// that id so the existing chain actually fires.
//
// Extends AutonomousAgent (migration 080 infrastructure: autonomous_triggers,
// agent_queue, agent_decisions, org_autonomous_config — see
// src/lib/agents/autonomous-base.ts).
//
// Deviations from the task-given spec, following this project's established
// practice of checking real schema/docs state before applying a literal spec
// verbatim (see opportunity-discovery-agent.ts's header for a prior instance
// of this same pattern):
//   - governance/BEHAVIORAL_CONTRACTS.md only numbers sections 17-33 (v2.0
//     Tier 6 additions); it has no section 9 or 15 in this repo. No
//     source-specific contract applies to this agent.
//   - governance/AGENTS.md only defines Agents 15-29 (v2.0 Tier 6
//     additions); Agent 05 is not described there.
//   - There is no `knowledge_base_profiles` table. The org profile lives on
//     `organizations` (mission_statement, vision_statement, service_area,
//     target_population, founder_name, annual_budget) — the same columns
//     src/lib/drafts/generator.ts already reads for the interactive draft
//     route.
//   - There is no `organizational_digital_twins` table applied yet (only
//     planned in SCHEMA_REGISTRY_v2.md as a future migration that was never
//     run — confirmed absent from every file in src/supabase/migrations and
//     from src/types/database.ts). Digital twin summary is skipped.
//   - `applications` has no `funder_id` column (confirmed absent from every
//     migration and src/types/database.ts) — only `opportunity_id` is set
//     on the created application; the funder is reachable via
//     opportunities.funder_id.
//   - AutonomousAgent#run() takes only triggerSource, not free-form input
//     params, so both "chain" and "manual" triggers read their target
//     opportunity from the same place any queue-driven agent already reads
//     its payload from: the agent_queue row this run is processing
//     (status='processing', this org + agent_id) — mirrors
//     ProbabilityScoringAgent.loadChainScope. If no payload is found (e.g. a
//     bare manual trigger with no opportunityId queued), the run logs
//     nothing to act on and exits with zero items rather than guessing.
//
// This agent uses its own lightweight Claude call rather than the full
// src/lib/drafts/generator.ts pipeline (RAG retrieval, rubric inference,
// logic models, budget patterns) — per the task spec, it is a narrower,
// autonomous-only path: org profile + KB + proven narratives in, a single
// draft out, always gated behind pending_review.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import type { Enums } from "@/types/database";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";
type FunderCategory = Enums<"funder_category">;

interface TriggerPayload {
  opportunityId: string;
  score: number | null;
  title: string | null;
  funderId: string | null;
}

interface KnowledgeBaseEntry {
  title: string;
  category: string;
  content: string;
}

interface ProvenNarrativeRow {
  narrative_text: string;
  section_type: string | null;
  effectiveness_score: number | null;
}

interface OpportunityRow {
  id: string;
  name: string;
  category: string;
  description: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  eligibility_requirements: string | null;
  funder_id: string | null;
}

// platform_learning_patterns (migration 083) has no generated types yet --
// same manual-cast convention as learning-network-aggregator-agent.ts.
// funder_category/ntee_code are plain `text` columns at the DB level (not
// FK/enum-typed), narrowed to FunderCategory here for readability only.
interface PlatformLearningPatternRow {
  id: string;
  pattern_type: string;
  funder_category: FunderCategory | null;
  ntee_code: string | null;
  pattern_content: string;
  success_rate: number | null;
  sample_count: number;
}

// Knowledge Base categories that feed a grant narrative draft — mirrors
// TEMPLATE_KB_CATEGORIES.grant_narrative in src/lib/drafts/generator.ts.
const GRANT_NARRATIVE_KB_CATEGORIES = [
  "mission",
  "vision",
  "need_statement",
  "program_description",
  "impact",
  "capacity",
  "sustainability",
  "partnerships",
  "organizational_history",
  "budget_justification",
];

// Platform Learning Network (AG-36 / migration 083) tuning constants.
const PLATFORM_PATTERN_LIMIT = 10;
// success_rate on platform_learning_patterns is a corroboration-confidence
// proxy in [0,1] (see learning-network-aggregator-agent.ts's
// computeConfidenceProxy) -- 0.7+ means at least ~14 independent awarded
// outcomes have corroborated the pattern, which is the bar for "high
// confidence" used here.
const HIGH_CONFIDENCE_SUCCESS_RATE = 0.7;
const CONFIDENCE_BOOST_PER_HIGH_CONFIDENCE_PATTERN = 5;
const MAX_PLATFORM_PATTERN_CONFIDENCE_BOOST = 20;

function countNeedsInput(draftText: string): number {
  return (draftText.match(/\[NEEDS INPUT/gi) ?? []).length;
}

function computeConfidence(
  needsInputCount: number,
  provenNarrativesUsed: number,
  highConfidencePatternsApplied: number,
): number {
  let confidence: number;
  if (needsInputCount === 0) confidence = 90;
  else if (needsInputCount <= 2) confidence = 75;
  else confidence = 60;

  if (provenNarrativesUsed === 0) confidence -= 10;

  const platformPatternBoost = Math.min(
    highConfidencePatternsApplied * CONFIDENCE_BOOST_PER_HIGH_CONFIDENCE_PATTERN,
    MAX_PLATFORM_PATTERN_CONFIDENCE_BOOST,
  );
  confidence += platformPatternBoost;

  return Math.max(0, Math.min(100, confidence));
}

export class DraftGenerationAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-05-draft", supabase);
  }

  /**
   * Reads the target opportunity (and the probability-scoring context that
   * chained into this run, when present) from the agent_queue row this run
   * is processing. Returns null when no queued payload has an
   * opportunityId — there is nothing to draft.
   */
  private async loadTriggerPayload(): Promise<TriggerPayload | null> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as Record<string, unknown>;
    const opportunityId = payload.opportunityId;
    if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
      return null;
    }

    return {
      opportunityId,
      score: typeof payload.score === "number" ? payload.score : null,
      title: typeof payload.title === "string" ? payload.title : null,
      funderId:
        typeof payload.funderId === "string" ? payload.funderId : null,
    };
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    try {
      const config = await this.getOrgConfig();

      // HARD LIMIT: Never create more than max_auto_drafts_per_night per org per day.
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const { count: draftsToday } = await this.supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", this.orgId)
        .eq("auto_generated", true)
        .gte("created_at", todayStart.toISOString());

      if ((draftsToday ?? 0) >= config.max_auto_drafts_per_night) {
        const decisionId = await this.logDecision({
          decisionType: "draft_generation_skipped",
          agentRunId: runId,
          reasoning:
            `Daily auto-draft limit reached (${draftsToday}/` +
            `${config.max_auto_drafts_per_night}). Skipping this run.`,
          confidenceScore: 100,
          actionTaken: "skipped_daily_limit_reached",
        });
        decisions.push(decisionId);

        await this.completeRun(runId, {
          outputSummary: JSON.stringify({
            skipped: true,
            reason: "daily_limit_reached",
          }),
          itemsFound: 0,
          itemsProcessed: 0,
        });

        return {
          success: true,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      const payload = await this.loadTriggerPayload();
      if (!payload) {
        await this.completeRun(runId, {
          outputSummary: JSON.stringify({
            skipped: true,
            reason: "no_opportunity_in_payload",
          }),
          itemsFound: 0,
          itemsProcessed: 0,
        });

        return {
          success: true,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors: [
            "No opportunityId available for this trigger; nothing to draft.",
          ],
        };
      }

      const { data: opportunityData, error: oppError } = await this.supabase
        .from("opportunities")
        .select(
          "id, name, category, description, amount_min, amount_max, deadline, eligibility_requirements, funder_id",
        )
        .eq("id", payload.opportunityId)
        .eq("organization_id", this.orgId)
        .single();

      if (oppError || !opportunityData) {
        throw new Error(
          `Opportunity ${payload.opportunityId} not found: ${oppError?.message ?? "no row returned"}`,
        );
      }
      const opportunity = opportunityData as OpportunityRow;

      const funderId = opportunity.funder_id ?? payload.funderId;
      const { data: funderData } = funderId
        ? await this.supabase
            .from("funders")
            .select("name")
            .eq("id", funderId)
            .maybeSingle()
        : { data: null };

      const { data: orgProfile } = await this.supabase
        .from("organizations")
        .select(
          "name, mission_statement, vision_statement, service_area, target_population, founder_name, annual_budget",
        )
        .eq("id", this.orgId)
        .single();

      const [{ data: kbRows }, { data: provenRows }] = await Promise.all([
        this.supabase
          .from("knowledge_base")
          .select("title, category, content")
          .eq("organization_id", this.orgId)
          .in("category", GRANT_NARRATIVE_KB_CATEGORIES)
          .order("is_proven", { ascending: false })
          .order("updated_at", { ascending: false }),
        this.supabase
          .from("proven_narratives")
          .select("narrative_text, section_type, effectiveness_score")
          .eq("organization_id", this.orgId)
          .eq("funder_category", opportunity.category)
          .order("effectiveness_score", { ascending: false, nullsFirst: false })
          .limit(5),
      ]);

      const knowledgeEntries = (kbRows ?? []) as KnowledgeBaseEntry[];
      const provenNarratives = (provenRows ?? []) as ProvenNarrativeRow[];

      // Platform Learning Network (AG-36 / migration 083): anonymized
      // cross-org patterns from awarded outcomes elsewhere on the platform,
      // matched to this opportunity's funder category. `organizations` has
      // no ntee_code column (confirmed absent from every migration and
      // src/types/database.ts -- the same gap
      // learning-network-aggregator-agent.ts already hit on the write side
      // and left null rather than guessing). With no org-side NTEE value to
      // match against, this only surfaces platform-wide patterns
      // (ntee_code IS NULL) instead of fabricating an NTEE match.
      const { data: patternRows } = await this.supabase
        .from("platform_learning_patterns")
        .select(
          "id, pattern_type, funder_category, ntee_code, pattern_content, success_rate, sample_count",
        )
        .eq("funder_category", opportunity.category)
        .is("ntee_code", null)
        .order("success_rate", { ascending: false, nullsFirst: false })
        .limit(PLATFORM_PATTERN_LIMIT);

      const platformPatterns = (patternRows ??
        []) as PlatformLearningPatternRow[];
      const highConfidencePatternsApplied = platformPatterns.filter(
        (p) => (p.success_rate ?? 0) >= HIGH_CONFIDENCE_SUCCESS_RATE,
      ).length;

      const orgName = (orgProfile?.name as string | undefined) ?? "the organization";

      // Step 6: Claude call — system persona + user context, per spec.
      const systemPrompt =
        `You are an expert grant writer for ${orgName}. Use ONLY the provided organizational data. ` +
        `Never fabricate statistics, certifications, or financial figures not in the data. ` +
        `Flag missing required data with [NEEDS INPUT: description].`;

      const kbSection =
        knowledgeEntries.length > 0
          ? knowledgeEntries
              .map((e) => `[${e.category}] ${e.title}\n${e.content}`)
              .join("\n\n")
          : "No knowledge base entries available for this organization.";

      const provenSection =
        provenNarratives.length > 0
          ? provenNarratives
              .map(
                (p, i) =>
                  `[High-weight example ${i + 1} — effectiveness score ${p.effectiveness_score ?? "N/A"}, section: ${p.section_type ?? "general"}]\n${p.narrative_text}`,
              )
              .join("\n\n")
          : "No proven narratives available for this funder category yet.";

      const patternsSection =
        platformPatterns.length > 0
          ? platformPatterns
              .map((p) => {
                const rate =
                  p.success_rate != null
                    ? `${Math.round(p.success_rate * 100)}%`
                    : "N/A";
                return (
                  `[${p.pattern_type}] ${p.pattern_content} ` +
                  `(success rate: ${rate}, based on ${p.sample_count} ` +
                  `corroborating outcome${p.sample_count === 1 ? "" : "s"})`
                );
              })
              .join("\n")
          : null;

      const userPrompt = [
        `OPPORTUNITY: ${opportunity.name}`,
        `Funder: ${(funderData?.name as string | null | undefined) ?? "Unknown"}`,
        `Category: ${opportunity.category}`,
        `Amount range: ${opportunity.amount_min ?? "unspecified"} - ${opportunity.amount_max ?? "unspecified"}`,
        `Deadline: ${opportunity.deadline ?? "none published"}`,
        `Eligibility requirements: ${opportunity.eligibility_requirements ?? "none listed"}`,
        opportunity.description ? `Description: ${opportunity.description}` : "",
        "",
        "ORGANIZATION PROFILE:",
        `Name: ${orgName}`,
        `Mission: ${(orgProfile?.mission_statement as string | null | undefined) ?? "[NEEDS INPUT: mission statement]"}`,
        `Vision: ${(orgProfile?.vision_statement as string | null | undefined) ?? ""}`,
        `Service area: ${(orgProfile?.service_area as string | null | undefined) ?? "[NEEDS INPUT: service area]"}`,
        `Target population: ${(orgProfile?.target_population as string | null | undefined) ?? "[NEEDS INPUT: target population]"}`,
        `Founder: ${(orgProfile?.founder_name as string | null | undefined) ?? ""}`,
        `Annual budget: ${(orgProfile?.annual_budget as number | null | undefined) ?? "[NEEDS INPUT: annual budget]"}`,
        "",
        "KNOWLEDGE BASE CONTENT:",
        kbSection,
        "",
        "PROVEN NARRATIVES (high-weight examples from previously successful applications):",
        provenSection,
        "",
        ...(patternsSection
          ? [
              "PLATFORM LEARNING PATTERNS (from anonymized successful grants):",
              patternsSection,
              "",
            ]
          : []),
        "Write a complete grant narrative draft for this opportunity.",
      ].join("\n");

      const response = await callClaude({
        system: systemPrompt,
        prompt: userPrompt,
        model: DEFAULT_MODEL,
        maxTokens: 4000,
      });

      // Step 7: confidence scoring. Platform learning patterns add up to
      // +20 on top of the base KB/proven-narrative score (see
      // computeConfidence's platformPatternBoost).
      const needsInputCount = countNeedsInput(response.text);
      const confidence = computeConfidence(
        needsInputCount,
        provenNarratives.length,
        highConfidencePatternsApplied,
      );
      const patternsApplied = platformPatterns.length;

      // HARD LIMIT: Never submit externally. Never call AutoApply. Never set submitted_at.
      // HARD LIMIT: Always set pending_review=true and auto_generated=true on created applications.
      const { data: newApp, error: insertError } = await this.supabase
        .from("applications")
        .insert({
          organization_id: this.orgId,
          opportunity_id: opportunity.id,
          stage: "drafting",
          draft_content: response.text,
          draft_confidence_score: confidence,
          auto_generated: true,
          pending_review: true,
          draft_source: "autonomous",
          platform_patterns_applied: patternsApplied,
        })
        .select("id")
        .single();

      if (insertError || !newApp) {
        throw new Error(
          `Failed to create draft application: ${insertError?.message ?? "no row returned"}`,
        );
      }
      const newAppId = (newApp as { id: string }).id;

      const title = payload.title ?? opportunity.name;
      const score = payload.score;

      const decisionId = await this.logDecision({
        decisionType: "draft_generated",
        agentRunId: runId,
        entityType: "application",
        entityId: newAppId,
        reasoning:
          `Auto-generated draft for ${title} (probability: ${score ?? "N/A"}%). ` +
          `Confidence: ${confidence}%. Platform learning patterns applied: ` +
          `${patternsApplied} (${highConfidencePatternsApplied} high-confidence).`,
        confidenceScore: confidence,
        actionTaken: "created_draft_pending_review",
        requiredHumanReview: true,
      });
      decisions.push(decisionId);

      await this.createNotification(
        "autonomous_draft_ready",
        "AI Draft Ready for Review",
        `${title} -- AI draft ready. Confidence: ${confidence}%. Click to review.`,
        {
          applicationId: newAppId,
          opportunityId: opportunity.id,
          confidence,
          probabilityScore: score,
        },
      );

      await this.completeRun(runId, {
        outputSummary: JSON.stringify({
          draftCreated: true,
          applicationId: newAppId,
          confidence,
          requiresReview: true,
          patternsApplied,
        }),
        itemsFound: 1,
        itemsProcessed: 1,
        tokensUsed: response.usage.totalTokens,
        confidenceScore: confidence,
      });

      return {
        success: true,
        itemsFound: 1,
        itemsProcessed: 1,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Draft generation failed.";
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
