import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { logAudit } from "@/lib/audit/logger";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";
import { withUsageCheck } from "@/lib/billing/usage-middleware";
import { incrementUsage } from "@/lib/billing/usage-limiter";
import {
  callClaude,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
} from "@/lib/ai/claude";
import { buildGrantNarrativePrompt } from "@/lib/ai/prompts/grant-narrative";
import { buildDonationRequestPrompt } from "@/lib/ai/prompts/donation-request";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/utils/constants";
import type {
  DraftPromptContext,
  DraftResult,
  DraftTemplateType,
  KnowledgeSource,
  SavedDraftVersion,
  SuccessPatternAnalysis,
  SuccessPatternEntry,
} from "@/types/ai";
import type { Enums, Json } from "@/types/database";

export const runtime = "nodejs";

type KbCategory = Enums<"knowledge_base_category">;

const VALID_TEMPLATE_TYPES: DraftTemplateType[] = [
  "grant_narrative",
  "donation_request_letter",
  "budget_narrative",
  "impact_statement",
  "letter_of_inquiry",
  "full_proposal",
];

// Which Knowledge Base categories feed each template type (Agent 05 step 2:
// "load relevant Knowledge Base entries by category matching template type").
const TEMPLATE_KB_CATEGORIES: Record<DraftTemplateType, KbCategory[]> = {
  grant_narrative: [
    "mission",
    "need_statement",
    "program_description",
    "impact",
    "capacity",
    "sustainability",
    "partnerships",
    "organizational_history",
  ],
  donation_request_letter: [
    "mission",
    "need_statement",
    "impact",
    "program_description",
  ],
  budget_narrative: [
    "budget_justification",
    "program_description",
    "capacity",
    "sustainability",
  ],
  impact_statement: ["impact", "mission", "program_description"],
  letter_of_inquiry: [
    "mission",
    "need_statement",
    "program_description",
    "impact",
  ],
  full_proposal: [
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
  ],
};

/**
 * Pull the winning_patterns from the first proven_narrative row that has a
 * non-null success_patterns JSONB. All rows in a given funder_category batch
 * share the same analysis, so the first hit is sufficient.
 */
function extractTopPatterns(
  rawPatterns: unknown[],
): SuccessPatternEntry[] {
  for (const raw of rawPatterns) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    const analysis = obj as Partial<SuccessPatternAnalysis>;
    if (Array.isArray(analysis.winning_patterns) && analysis.winning_patterns.length > 0) {
      return analysis.winning_patterns
        .filter(
          (p): p is SuccessPatternEntry =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as SuccessPatternEntry).description === "string",
        )
        .slice(0, 5);
    }
  }
  return [];
}

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (BEHAVIORAL_CONTRACTS §16).
  return NextResponse.json({ error: message, code }, { status });
}

// Best-effort per-organization rate limit for AI routes: 20 requests / minute
// (BEHAVIORAL_CONTRACTS §16). This in-memory bucket only protects a single
// server instance; a shared store (e.g. Supabase or Redis) is the production
// fix for multi-instance deployments.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function isRateLimited(orgId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(orgId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(orgId, recent);
    return true;
  }
  recent.push(now);
  hits.set(orgId, recent);
  return false;
}

/**
 * Heuristic confidence score (BEHAVIORAL_CONTRACTS §9 / Agent 05). Reflects how
 * much of the draft is grounded in verified data versus AI-generated:
 *   - No Knowledge Base entries available  -> insufficient data (<50, blocks submit)
 *   - Unresolved [NEEDS INPUT] flags        -> each lowers the score
 *   - Sparse KB / no proven narratives      -> modest reductions
 * A fully grounded draft with no gaps lands in the 90+ band.
 */
function computeConfidence(
  draftText: string,
  kbCount: number,
  provenCount: number,
): number {
  const needsInput = (draftText.match(/\[NEEDS INPUT/gi) ?? []).length;

  if (kbCount === 0) {
    // No verified narrative content to draw on — require KB updates first.
    return Math.max(55, 65 - needsInput * 3);
  }

  let score = 92;
  if (provenCount === 0) score -= 4;
  if (kbCount < 3) score -= 12;
  score -= needsInput * 3;

  return Math.max(0, Math.min(100, score));
}

export async function POST(request: Request) {
  // Generating a draft is a write action — viewers are read-only (Contracts §16).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { opportunityId, templateType } = (body ?? {}) as {
    opportunityId?: unknown;
    templateType?: unknown;
  };

  if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
    return jsonError("opportunityId is required.", "invalid_input", 400);
  }
  if (
    typeof templateType !== "string" ||
    !VALID_TEMPLATE_TYPES.includes(templateType as DraftTemplateType)
  ) {
    return jsonError("A valid templateType is required.", "invalid_input", 400);
  }
  const template = templateType as DraftTemplateType;

  const supabase = createClient();

  // Authenticate via the session (BEHAVIORAL_CONTRACTS §16).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  // Derive organization_id server-side from the profile — never from the body.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profile.organization_id as string;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many draft requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  // Daily AI-request quota for the org's tier (Behavioral Contracts §25).
  const overLimit = await enforceLimit(supabase, organizationId, "api_calls");
  if (overLimit) return overLimit;

  // Monthly AI-drafts quota (usage-limiter tier limits).
  const draftLimitBlocked = await withUsageCheck(supabase, organizationId, "ai_drafts");
  if (draftLimitBlocked) return draftLimitBlocked;

  // Opportunity (RLS-scoped to the organization).
  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("*")
    .eq("id", opportunityId)
    .single();
  if (oppError || !opportunity) {
    return jsonError("Opportunity not found.", "not_found", 404);
  }

  // Log the agent run before starting (BEHAVIORAL_CONTRACTS §15). Best-effort:
  // a logging failure must not block drafting.
  const startedAt = Date.now();
  let runId: string | null = null;
  {
    const { data: run } = await supabase
      .from("agent_runs")
      .insert({
        organization_id: organizationId,
        agent_type: "narrative_drafting",
        status: "running",
        triggered_by: profile.id,
        input_params: { opportunityId, templateType: template },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    runId = run?.id ?? null;
  }

  try {
    // Resolve config (platform_config overrides, then env/defaults).
    const { data: configRows } = await supabase
      .from("platform_config")
      .select("key, value")
      .in("key", ["ai.model", "ai.max_tokens", "ai.confidence_threshold"]);
    const config = new Map<string, string>(
      (configRows ?? []).map((r) => [r.key as string, r.value as string]),
    );
    const model = config.get("ai.model") ?? DEFAULT_MODEL;
    const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;
    const threshold =
      Number(config.get("ai.confidence_threshold")) || AI_CONFIDENCE_THRESHOLD;

    // Organization profile, KB entries for this template, and proven narratives.
    const [orgRes, kbRes, provenRes, funderRes] = await Promise.all([
      supabase
        .from("organizations")
        .select(
          "name, dba, ein, tax_status, mission_statement, vision_statement, service_area, target_population, founder_name, annual_budget",
        )
        .eq("id", organizationId)
        .single(),
      supabase
        .from("knowledge_base")
        .select("id, title, category, content")
        .in("category", TEMPLATE_KB_CATEGORIES[template])
        .order("is_proven", { ascending: false })
        .order("updated_at", { ascending: false }),
      // Proven narratives for the opportunity's funder category, best first,
      // capped at 5 (BEHAVIORAL_CONTRACTS §9). Also fetch success_patterns so
      // the draft prompt includes discovered winning language patterns.
      supabase
        .from("proven_narratives")
        .select(
          "id, narrative_text, section_type, funder_category, effectiveness_score, success_patterns",
        )
        .eq("funder_category", opportunity.category)
        .order("effectiveness_score", { ascending: false, nullsFirst: false })
        .limit(5),
      opportunity.funder_id
        ? supabase
            .from("funders")
            .select("name")
            .eq("id", opportunity.funder_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);

    const org = orgRes.data;
    const knowledgeEntries = (kbRes.data ?? []).map((entry) => ({
      id: entry.id as string,
      title: entry.title as string,
      category: entry.category as string,
      content: entry.content as string,
    }));
    const provenNarratives = (provenRes.data ?? []).map((p) => ({
      id: p.id as string,
      sectionType: (p.section_type as string | null) ?? null,
      funderCategory: (p.funder_category as string | null) ?? null,
      effectivenessScore: (p.effectiveness_score as number | null) ?? null,
      narrativeText: p.narrative_text as string,
    }));

    // Extract the top winning patterns from the first proven narrative that
    // has a success_patterns analysis stored (migration 017). All rows in this
    // batch share the same funder_category analysis so the first hit is enough.
    const successPatterns = extractTopPatterns(
      (provenRes.data ?? []).map((p) => p.success_patterns),
    );

    const context: DraftPromptContext = {
      organization: org
        ? {
            name: org.name as string,
            dba: (org.dba as string | null) ?? null,
            ein: (org.ein as string | null) ?? null,
            taxStatus: (org.tax_status as string | null) ?? null,
            missionStatement: (org.mission_statement as string | null) ?? null,
            visionStatement: (org.vision_statement as string | null) ?? null,
            serviceArea: (org.service_area as string | null) ?? null,
            targetPopulation: (org.target_population as string | null) ?? null,
            founderName: (org.founder_name as string | null) ?? null,
            annualBudget: (org.annual_budget as number | null) ?? null,
          }
        : null,
      opportunity: {
        name: opportunity.name as string,
        category: opportunity.category as string,
        description: (opportunity.description as string | null) ?? null,
        funderName:
          (funderRes.data?.name as string | null | undefined) ?? null,
        eligibilityRequirements:
          (opportunity.eligibility_requirements as string | null) ?? null,
        amountMin: (opportunity.amount_min as number | null) ?? null,
        amountMax: (opportunity.amount_max as number | null) ?? null,
        requiredDocuments:
          (opportunity.required_documents as string[] | null) ?? null,
      },
      knowledgeEntries,
      provenNarratives,
      successPatterns: successPatterns.length > 0 ? successPatterns : undefined,
    };

    // Build the prompt: donation letters get their own builder; everything else
    // uses the grant-narrative builder, parameterized by template type.
    const built =
      template === "donation_request_letter"
        ? buildDonationRequestPrompt(context)
        : buildGrantNarrativePrompt(context, template);

    const response = await callClaude({
      system: built.system,
      prompt: built.prompt,
      model,
      maxTokens,
    });

    const confidenceScore = computeConfidence(
      response.text,
      knowledgeEntries.length,
      provenNarratives.length,
    );

    // Transparency panel (BEHAVIORAL_CONTRACTS §9): every KB entry and proven
    // narrative supplied to the model informed the draft.
    const sources: KnowledgeSource[] = [
      ...knowledgeEntries.map((entry) => ({
        id: entry.id,
        kind: "knowledge_base" as const,
        title: entry.title,
      })),
      ...provenNarratives.map((p) => ({
        id: p.id,
        kind: "proven_narrative" as const,
        title: p.sectionType
          ? `Proven: ${p.sectionType}`
          : "Proven narrative",
      })),
    ];

    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          output_summary: `Drafted ${template} (confidence ${confidenceScore}, ${sources.length} sources).`,
          items_found: sources.length,
          items_processed: 1,
          tokens_used: response.usage.totalTokens,
          duration_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    // Meter the AI request against the org's daily api_calls quota (§25).
    await trackUsage(supabase, organizationId, "api_calls", 1);
    // Meter the monthly ai_drafts quota (usage-limiter).
    await incrementUsage(supabase, organizationId, "ai_drafts");

    // Audit the AI draft generation (Behavioral Contracts §24).
    await logAudit(supabase, {
      organizationId,
      userId: profile.id,
      action: "agent_run",
      entityType: "opportunity",
      entityId: opportunityId,
      details: { templateType: template, confidenceScore, sourcesCount: sources.length },
    });

    // Auto-save the generated draft as a version immediately (BLUEPRINT §4.8).
    // organization_id is derived from the session profile, never the body; the
    // version_number is assigned per opportunity by a DB trigger. This is the
    // durable history behind the single "current" draft on applications.*.
    let savedVersion: SavedDraftVersion | null = null;
    {
      const { data: version, error: versionError } = await supabase
        .from("draft_versions")
        .insert({
          organization_id: organizationId,
          opportunity_id: opportunityId,
          template_type: template,
          content: response.text,
          confidence_score: confidenceScore,
          knowledge_sources: sources as unknown as Json,
          humanization_status: "not_humanized",
          source: "generated",
          created_by: profile.id,
        })
        .select("id, version_number, humanization_status, created_at")
        .single();
      if (versionError) {
        // Best-effort: a history-save failure must not fail generation, but it
        // should never pass silently (BEHAVIORAL_CONTRACTS §15).
        console.error("DRAFT VERSION SAVE ERROR:", versionError.message);
      } else if (version) {
        savedVersion = {
          id: version.id as string,
          versionNumber: version.version_number as number,
          humanizationStatus:
            version.humanization_status as SavedDraftVersion["humanizationStatus"],
          createdAt: version.created_at as string,
        };
      }
    }

    const result: DraftResult & { belowThreshold: boolean } = {
      content: response.text,
      confidenceScore,
      sources,
      savedVersion,
      belowThreshold: confidenceScore < threshold,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("DRAFT ERROR:", err);
    const message =
      err instanceof Error ? err.message : "Draft generation failed.";
    if (runId) {
      // Agents never fail silently (BEHAVIORAL_CONTRACTS §15).
      await supabase
        .from("agent_runs")
        .update({
          status: "failed",
          error_message: message,
          duration_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return jsonError(
      "The draft could not be generated. Please try again.",
      "generation_failed",
      500,
    );
  }
}

