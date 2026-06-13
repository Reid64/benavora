import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { runHumanizer } from "@/lib/agents/humanizer-agent";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/utils/constants";
import type {
  DraftKnowledgeEntry,
  DraftProvenNarrative,
  DraftTemplateType,
  HumanizeResult,
  KnowledgeSource,
} from "@/types/ai";
import type { Json } from "@/types/database";

// AI Humanizer endpoint - second-pass anti-detection rewrite (BLUEPRINT §4.8).
// Takes a generated draft and rewrites it through `runHumanizer` so it reads
// like a human grant writer wrote it (no em dashes, no AI vocabulary, varied
// rhythm, grounded specifics). The humanized output is appended to
// draft_versions as a new version (history is append-only) with
// humanization_status = 'humanized'. Logs to agent_runs with token tracking
// (BEHAVIORAL_CONTRACTS §15) and meters the org's daily AI quota (§25).

export const runtime = "nodejs";

const VALID_TEMPLATE_TYPES: DraftTemplateType[] = [
  "grant_narrative",
  "donation_request_letter",
  "budget_narrative",
  "impact_statement",
  "letter_of_inquiry",
  "full_proposal",
];

// How many Knowledge Base facts to supply as grounding for the rewrite. The
// humanizer pulls concrete numbers/names/dates from anywhere in the KB (not just
// the template's categories), so it loads the most-trusted entries broadly.
const MAX_KB_FACTS = 12;
/** Proven narratives supplied as authentic-voice samples (Contracts §9). */
const MAX_VOICE_SAMPLES = 5;

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (BEHAVIORAL_CONTRACTS §16).
  return NextResponse.json({ error: message, code }, { status });
}

// Best-effort per-organization rate limit for AI routes: 20 requests / minute
// (BEHAVIORAL_CONTRACTS §16). In-memory; protects a single instance only.
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
 * Grounding confidence, mirroring /api/ai/draft's heuristic (BEHAVIORAL_CONTRACTS
 * §9): how much of the draft is anchored in verified data versus AI-generated.
 */
function computeGroundedConfidence(
  draftText: string,
  kbCount: number,
  provenCount: number,
): number {
  const needsInput = (draftText.match(/\[NEEDS INPUT/gi) ?? []).length;

  if (kbCount === 0) {
    return Math.max(55, 65 - needsInput * 3);
  }

  let score = 92;
  if (provenCount === 0) score -= 4;
  if (kbCount < 3) score -= 12;
  score -= needsInput * 3;

  return Math.max(0, Math.min(100, score));
}

/**
 * Confidence for a humanized draft: blend grounding (does it still rest on
 * verified data?) with how human the rewrite reads. The grounding term keeps
 * the score honest - a slick-but-ungrounded draft can't score high - while the
 * humanization term reflects this pass's purpose (the task: "update confidence
 * score to reflect humanization status"). Grounding is weighted higher.
 */
function computeHumanizedConfidence(
  grounded: number,
  humanizationScore: number,
): number {
  return Math.max(0, Math.min(100, Math.round(grounded * 0.65 + humanizationScore * 0.35)));
}

export async function POST(request: Request) {
  // Humanizing a draft is a write action - viewers are read-only (Contracts §16).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { opportunityId, templateType, content } = (body ?? {}) as {
    opportunityId?: unknown;
    templateType?: unknown;
    content?: unknown;
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
  if (typeof content !== "string" || content.trim() === "") {
    return jsonError("There is no draft content to humanize.", "invalid_input", 400);
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

  // Derive organization_id server-side from the profile - never from the body.
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
      "Too many humanize requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  // Daily AI-request quota for the org's tier (Behavioral Contracts §25).
  const overLimit = await enforceLimit(supabase, organizationId, "api_calls");
  if (overLimit) return overLimit;

  // Opportunity (RLS-scoped) - needed for the funder category that selects the
  // proven-narrative voice samples.
  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, category")
    .eq("id", opportunityId)
    .single();
  if (oppError || !opportunity) {
    return jsonError("Opportunity not found.", "not_found", 404);
  }

  // Log the agent run before starting (BEHAVIORAL_CONTRACTS §15). The humanizer
  // is the second pass of narrative drafting, so it logs under that agent_type.
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
        input_params: { opportunityId, templateType: template, pass: "humanize" },
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

    // Grounding data: org profile, the most-trusted KB facts, and proven
    // narratives (voice) for this funder category. All RLS-scoped.
    const [orgRes, kbRes, provenRes] = await Promise.all([
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
        .order("is_proven", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(MAX_KB_FACTS),
      supabase
        .from("proven_narratives")
        .select(
          "id, narrative_text, section_type, funder_category, effectiveness_score",
        )
        .eq("funder_category", opportunity.category)
        .order("effectiveness_score", { ascending: false, nullsFirst: false })
        .limit(MAX_VOICE_SAMPLES),
    ]);

    const org = orgRes.data;
    const knowledgeEntries: DraftKnowledgeEntry[] = (kbRes.data ?? []).map(
      (entry) => ({
        id: entry.id as string,
        title: entry.title as string,
        category: entry.category as string,
        content: entry.content as string,
      }),
    );
    const provenNarratives: DraftProvenNarrative[] = (provenRes.data ?? []).map(
      (p) => ({
        id: p.id as string,
        sectionType: (p.section_type as string | null) ?? null,
        funderCategory: (p.funder_category as string | null) ?? null,
        effectivenessScore: (p.effectiveness_score as number | null) ?? null,
        narrativeText: p.narrative_text as string,
      }),
    );

    const result = await runHumanizer({
      draft: content,
      templateType: template,
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
      knowledgeEntries,
      provenNarratives,
      model,
      maxTokens,
    });

    const grounded = computeGroundedConfidence(
      result.content,
      knowledgeEntries.length,
      provenNarratives.length,
    );
    const confidenceScore = computeHumanizedConfidence(
      grounded,
      result.humanizationScore,
    );

    // Transparency panel (BEHAVIORAL_CONTRACTS §9): the facts/voice that informed
    // the rewrite - same shape /api/ai/draft records, so usage history matches.
    const sources: KnowledgeSource[] = [
      ...knowledgeEntries.map((entry) => ({
        id: entry.id,
        kind: "knowledge_base" as const,
        title: entry.title,
      })),
      ...provenNarratives.map((p) => ({
        id: p.id,
        kind: "proven_narrative" as const,
        title: p.sectionType ? `Proven: ${p.sectionType}` : "Proven narrative",
      })),
    ];

    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          output_summary: `Humanized ${template}: removed ${result.emDashesRemoved} em dash(es), replaced ${result.vocabReplaced} AI term(s); reads-human ${result.humanizationScore}/100, confidence ${confidenceScore}.`,
          items_found: sources.length,
          items_processed: 1,
          tokens_used: result.tokensUsed,
          duration_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    // Meter the AI request against the org's daily api_calls quota (§25).
    await trackUsage(supabase, organizationId, "api_calls", 1);

    // Append the humanized output as a new version (history is append-only).
    // organization_id is derived from the session profile, never the body.
    let savedVersion: HumanizeResult["savedVersion"] = null;
    {
      const { data: version, error: versionError } = await supabase
        .from("draft_versions")
        .insert({
          organization_id: organizationId,
          opportunity_id: opportunityId,
          template_type: template,
          content: result.content,
          confidence_score: confidenceScore,
          knowledge_sources: sources as unknown as Json,
          humanization_status: "humanized",
          source: "humanized",
          created_by: profile.id,
        })
        .select("id, version_number, humanization_status, created_at")
        .single();
      if (versionError) {
        // Best-effort: a history-save failure must not fail the rewrite, but it
        // must never pass silently (BEHAVIORAL_CONTRACTS §15).
        console.error("HUMANIZE VERSION SAVE ERROR:", versionError.message);
      } else if (version) {
        savedVersion = {
          id: version.id as string,
          versionNumber: version.version_number as number,
          humanizationStatus: "humanized",
          createdAt: version.created_at as string,
        };
      }
    }

    const payload: HumanizeResult & { belowThreshold: boolean } = {
      content: result.content,
      confidenceScore,
      humanizationStatus: "humanized",
      sources,
      savedVersion,
      humanizationScore: result.humanizationScore,
      belowThreshold: confidenceScore < threshold,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("HUMANIZE ERROR:", err);
    const message =
      err instanceof Error ? err.message : "Humanization failed.";
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
      "The draft could not be humanized. Please try again.",
      "humanization_failed",
      500,
    );
  }
}
