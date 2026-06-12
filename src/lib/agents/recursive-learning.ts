// Recursive Learning Agent — AGENTS.md Agent 10.
//
// Triggered when an outcome is recorded. It closes the learning loop: from an
// AWARDED (or PARTIAL) application it extracts the reusable narrative sections
// that won, records them as proven_narratives, flags the source Knowledge Base
// entries once they clear the proven threshold, and recomputes effectiveness
// scores. From a DENIED outcome it recomputes effectiveness so narratives that
// were used but lost are weighted down.
//
// Contracts honored (BEHAVIORAL_CONTRACTS §8, §10): is_proven / proven_count are
// written ONLY here; a KB entry earns is_proven after PROVEN_NARRATIVE_THRESHOLD
// awarded uses; effectiveness is wins / (wins + failures), recalculated on every
// outcome; the narrative_snapshot is treated as frozen and never modified.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  buildProvenExtractionPrompt,
  parseExtractionResponse,
  type ExtractedSection,
  type KnowledgeCandidate,
} from "@/lib/ai/learning/proven-extractor";
import { computeEffectiveness } from "@/lib/ai/learning/narrative-scorer";
import { PROVEN_NARRATIVE_THRESHOLD } from "@/lib/utils/constants";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { Enums } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/** Narrative KB categories the extractor draws candidates from. */
const NARRATIVE_KB_CATEGORIES: Enums<"knowledge_base_category">[] = [
  "mission",
  "vision",
  "need_statement",
  "program_description",
  "impact",
  "capacity",
  "sustainability",
  "partnerships",
  "budget_justification",
  "organizational_history",
];

export interface RecursiveLearningInput {
  /** outcomes.id that was just recorded. */
  outcomeId: string;
}

export interface RecursiveLearningResult {
  outcomeId: string;
  result: Enums<"outcome_result">;
  sectionsExtracted: number;
  provenCreated: number;
  provenUpdated: number;
  /** knowledge_base ids newly flagged is_proven this run. */
  knowledgeBaseFlagged: string[];
  /** Number of proven_narratives whose effectiveness was recalculated. */
  narrativesRescored: number;
}

export interface RecursiveLearningOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

export class RecursiveLearningAgent extends BaseAgent<
  RecursiveLearningInput,
  RecursiveLearningResult
> {
  readonly agentType: AgentType = "recursive_learning";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: RecursiveLearningOptions) {
    super(options);
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: RecursiveLearningInput,
  ): Promise<AgentExecution<RecursiveLearningResult>> {
    const { data: outcome, error } = await this.client
      .from("outcomes")
      .select(
        "id, application_id, result, funder_category, narrative_snapshot",
      )
      .eq("id", input.outcomeId)
      .eq("organization_id", this.organizationId)
      .single();

    if (error || !outcome) {
      throw new AgentError("Outcome not found.", "not_found", 404);
    }

    const result = outcome.result as Enums<"outcome_result">;
    const funderCategory =
      (outcome.funder_category as FunderCategory | null) ?? null;

    let sectionsExtracted = 0;
    let provenCreated = 0;
    let provenUpdated = 0;
    const knowledgeBaseFlagged: string[] = [];
    let tokensUsed = 0;

    if (result === "awarded" || result === "partial") {
      // A snapshot is required to extract from; fall back to the live draft if
      // the outcome row didn't capture one (the form normally snapshots it).
      const snapshot = await this.resolveSnapshot(
        outcome.narrative_snapshot as string | null,
        outcome.application_id as string,
      );

      if (snapshot.trim() !== "" && funderCategory) {
        const extraction = await this.extractAndStore(
          input.outcomeId,
          snapshot,
          funderCategory,
          // Only awarded uses count toward the is_proven gate (Contracts §10);
          // partials extract narratives but at lower weight.
          result === "awarded",
        );
        sectionsExtracted = extraction.sectionsExtracted;
        provenCreated = extraction.created;
        provenUpdated = extraction.updated;
        knowledgeBaseFlagged.push(...extraction.flagged);
        tokensUsed = extraction.tokensUsed;
      }
    }

    // Effectiveness is recalculated on every outcome (Contracts §10), for both
    // wins (denominator/numerator grew) and losses (failures grew).
    const narrativesRescored = funderCategory
      ? await this.rescoreCategory(funderCategory)
      : 0;

    const summary =
      result === "denied"
        ? `Denied outcome processed — rescored ${narrativesRescored} narrative(s).`
        : `${result} outcome: extracted ${sectionsExtracted} section(s), ${provenCreated} new / ${provenUpdated} updated proven narrative(s), flagged ${knowledgeBaseFlagged.length} KB entr${knowledgeBaseFlagged.length === 1 ? "y" : "ies"}.`;

    return {
      data: {
        outcomeId: input.outcomeId,
        result,
        sectionsExtracted,
        provenCreated,
        provenUpdated,
        knowledgeBaseFlagged,
        narrativesRescored,
      },
      outputSummary: summary,
      itemsFound: sectionsExtracted,
      itemsProcessed: provenCreated + provenUpdated,
      tokensUsed,
    };
  }

  /** Prefer the frozen outcome snapshot; fall back to the application draft. */
  private async resolveSnapshot(
    snapshot: string | null,
    applicationId: string,
  ): Promise<string> {
    if (snapshot && snapshot.trim() !== "") return snapshot;
    const { data } = await this.client
      .from("applications")
      .select("draft_content")
      .eq("id", applicationId)
      .eq("organization_id", this.organizationId)
      .single();
    return (data?.draft_content as string | null) ?? "";
  }

  /**
   * Extract proven sections from the winning narrative and persist them:
   * upsert proven_narratives, then (for awarded outcomes) increment the matched
   * KB entries' proven_count and flag is_proven once they clear the threshold.
   */
  private async extractAndStore(
    outcomeId: string,
    snapshot: string,
    funderCategory: FunderCategory,
    countsTowardProven: boolean,
  ): Promise<{
    sectionsExtracted: number;
    created: number;
    updated: number;
    flagged: string[];
    tokensUsed: number;
  }> {
    // Candidate KB entries the extractor can attribute sections to.
    const { data: kbRows } = await this.client
      .from("knowledge_base")
      .select("id, category, title, content")
      .eq("organization_id", this.organizationId)
      .in("category", NARRATIVE_KB_CATEGORIES);

    const candidates: KnowledgeCandidate[] = (kbRows ?? []).map((r) => ({
      id: r.id as string,
      category: r.category as string,
      title: r.title as string,
      content: r.content as string,
    }));
    const validKbIds = new Set(candidates.map((c) => c.id));

    const { system, prompt } = buildProvenExtractionPrompt({
      narrativeSnapshot: snapshot,
      funderCategory,
      knowledgeCandidates: candidates,
    });

    const response = await callClaude({
      system,
      prompt,
      model: this.model,
      maxTokens: this.maxTokens,
    });

    const sections = parseExtractionResponse(response.text, validKbIds);

    let created = 0;
    let updated = 0;
    for (const section of sections) {
      const wasUpdate = await this.upsertProvenNarrative(
        outcomeId,
        funderCategory,
        section,
      );
      if (wasUpdate) updated += 1;
      else created += 1;
    }

    const flagged: string[] = [];
    if (countsTowardProven) {
      const usedKbIds = Array.from(
        new Set(
          sections
            .map((s) => s.knowledgeBaseId)
            .filter((id): id is string => id !== null),
        ),
      );
      for (const kbId of usedKbIds) {
        const didFlag = await this.bumpKnowledgeBaseProven(kbId);
        if (didFlag) flagged.push(kbId);
      }
    }

    return {
      sectionsExtracted: sections.length,
      created,
      updated,
      flagged,
      tokensUsed: response.usage.totalTokens,
    };
  }

  /**
   * Create or update the proven_narrative for a section. Matches an existing row
   * by (funder_category, section_type) and knowledge_base_id when present.
   * Returns true if an existing row was updated, false if a new row was created.
   */
  private async upsertProvenNarrative(
    outcomeId: string,
    funderCategory: FunderCategory,
    section: ExtractedSection,
  ): Promise<boolean> {
    let query = this.client
      .from("proven_narratives")
      .select("id, success_count")
      .eq("organization_id", this.organizationId)
      .eq("funder_category", funderCategory)
      .eq("section_type", section.sectionType);
    query = section.knowledgeBaseId
      ? query.eq("knowledge_base_id", section.knowledgeBaseId)
      : query.is("knowledge_base_id", null);

    const { data: existing } = await query.limit(1).maybeSingle();
    const nowIso = new Date().toISOString();

    if (existing) {
      const successCount = ((existing.success_count as number | null) ?? 0) + 1;
      await this.client
        .from("proven_narratives")
        .update({
          success_count: successCount,
          last_used_at: nowIso,
        })
        .eq("id", existing.id as string)
        .eq("organization_id", this.organizationId);
      return true;
    }

    await this.client.from("proven_narratives").insert({
      organization_id: this.organizationId,
      outcome_id: outcomeId,
      knowledge_base_id: section.knowledgeBaseId,
      narrative_text: section.text,
      section_type: section.sectionType,
      funder_category: funderCategory,
      success_count: 1,
      effectiveness_score: 1, // provisional; rescored below against denials
      last_used_at: nowIso,
    });
    return false;
  }

  /**
   * Increment a KB entry's proven_count and set is_proven once it reaches
   * PROVEN_NARRATIVE_THRESHOLD awarded uses. Returns true if this call flipped
   * is_proven to true.
   */
  private async bumpKnowledgeBaseProven(kbId: string): Promise<boolean> {
    const { data: kb } = await this.client
      .from("knowledge_base")
      .select("proven_count, is_proven")
      .eq("id", kbId)
      .eq("organization_id", this.organizationId)
      .single();
    if (!kb) return false;

    const provenCount = ((kb.proven_count as number | null) ?? 0) + 1;
    const alreadyProven = Boolean(kb.is_proven);
    const isProven = provenCount >= PROVEN_NARRATIVE_THRESHOLD;

    await this.client
      .from("knowledge_base")
      .update({ proven_count: provenCount, is_proven: isProven })
      .eq("id", kbId)
      .eq("organization_id", this.organizationId);

    return isProven && !alreadyProven;
  }

  /**
   * Recompute effectiveness for every proven_narrative in a funder_category as
   * success_count / (success_count + categoryDenials), where categoryDenials is
   * the number of denied outcomes in that category. Returns how many rows were
   * rescored.
   */
  private async rescoreCategory(
    funderCategory: FunderCategory,
  ): Promise<number> {
    const [{ count: deniedCount }, { data: narratives }] = await Promise.all([
      this.client
        .from("outcomes")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", this.organizationId)
        .eq("funder_category", funderCategory)
        .eq("result", "denied"),
      this.client
        .from("proven_narratives")
        .select("id, success_count")
        .eq("organization_id", this.organizationId)
        .eq("funder_category", funderCategory),
    ]);

    const failures = deniedCount ?? 0;
    const rows = narratives ?? [];
    for (const row of rows) {
      const successCount = (row.success_count as number | null) ?? 0;
      const score = Number(
        computeEffectiveness(successCount, failures).toFixed(2),
      );
      await this.client
        .from("proven_narratives")
        .update({ effectiveness_score: score })
        .eq("id", row.id as string)
        .eq("organization_id", this.organizationId);
    }
    return rows.length;
  }
}
