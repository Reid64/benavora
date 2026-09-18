// Semantic Matching Agent - uses Claude to score semantic alignment between
// the organization profile and each funder, returning a ranked list with reasoning.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  causeOf,
  withCause,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_CLAUDE_CALL_MS,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

export interface SemanticMatchInput {
  topN?: number;
}

export interface FunderMatch {
  funderId: string;
  funderName: string;
  score: number;
  reasoning: string;
}

export interface SemanticMatchResult {
  matches: FunderMatch[];
}

export interface SemanticMatchingOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

interface OrgProfile {
  name: string;
  missionStatement: string | null;
  serviceArea: string | null;
  targetPopulation: string | null;
  programs: string | null;
}

interface FunderRow {
  id: string;
  name: string;
  description: string | null;
  geographic_focus: string | null;
  priorities: string[] | null;
  review_criteria: string | null;
  application_tips: string | null;
}

export class SemanticMatchingAgent extends BaseAgent<
  SemanticMatchInput,
  SemanticMatchResult
> {
  readonly agentType: AgentType = "semantic_matching";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: SemanticMatchingOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_CLAUDE_CALL_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: SemanticMatchInput,
  ): Promise<AgentExecution<SemanticMatchResult>> {
    const topN = input.topN ?? 10;

    const [orgRes, fundersRes] = await Promise.all([
      this.client
        .from("organizations")
        .select(
          "name, mission_statement, service_area, target_population, vision_statement",
        )
        .eq("id", this.organizationId)
        .single(),
      this.client
        .from("funders")
        .select("id, name, description, geographic_focus")
        .eq("organization_id", this.organizationId)
        .order("name", { ascending: true })
        .limit(200),
    ]);

    if (orgRes.error) {
      console.error(
        `[SemanticMatchingAgent] organization fetch failed for organizationId=${this.organizationId}: ${causeOf(orgRes.error)}`,
      );
      throw new AgentError(
        withCause("Failed to load the organization profile.", orgRes.error),
        "db_error",
      );
    }
    if (!orgRes.data) {
      throw new AgentError("Organization not found.", "not_found", 404);
    }

    const org: OrgProfile = {
      name: orgRes.data.name as string,
      missionStatement: (orgRes.data.mission_statement as string | null) ?? null,
      serviceArea: (orgRes.data.service_area as string | null) ?? null,
      targetPopulation: (orgRes.data.target_population as string | null) ?? null,
      programs: (orgRes.data.vision_statement as string | null) ?? null,
    };

    const funderRows = (fundersRes.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      description: string | null;
      geographic_focus: string | null;
    }>;

    if (funderRows.length === 0) {
      return {
        data: { matches: [] },
        outputSummary: "No funders found to match against.",
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    // Load funder intelligence separately for priorities/review_criteria
    const funderIds = funderRows.map((f) => f.id);
    const { data: intelData } = await this.client
      .from("funder_intelligence")
      .select(
        "funder_id, priorities, review_criteria, application_tips",
      )
      .eq("organization_id", this.organizationId)
      .in("funder_id", funderIds);

    const intelMap = new Map<string, { priorities: string[] | null; review_criteria: string | null; application_tips: string | null }>();
    for (const row of (intelData ?? [])) {
      intelMap.set(row.funder_id as string, {
        priorities: row.priorities as string[] | null,
        review_criteria: row.review_criteria as string | null,
        application_tips: row.application_tips as string | null,
      });
    }

    const funders: FunderRow[] = funderRows.map((f) => {
      const intel = intelMap.get(f.id);
      return {
        id: f.id,
        name: f.name,
        description: f.description,
        geographic_focus: f.geographic_focus,
        priorities: intel?.priorities ?? null,
        review_criteria: intel?.review_criteria ?? null,
        application_tips: intel?.application_tips ?? null,
      };
    });

    const { system, prompt } = buildMatchingPrompt(org, funders, topN);

    const response = await callClaude({
      system,
      prompt,
      model: this.model,
      maxTokens: this.maxTokens,
    });

    const matches = parseMatchResponse(response.text, funders);

    return {
      data: { matches },
      outputSummary: `Ranked ${matches.length} funders by semantic alignment with ${org.name}.`,
      itemsFound: funders.length,
      itemsProcessed: matches.length,
      tokensUsed: response.usage.totalTokens,
    };
  }
}

// --- prompt ------------------------------------------------------------------

function buildMatchingPrompt(
  org: OrgProfile,
  funders: FunderRow[],
  topN: number,
): { system: string; prompt: string } {
  const system = [
    "You are a nonprofit grants analyst scoring semantic alignment between an organization and funders.",
    "",
    "RULES:",
    "1. Score each funder 0-100 based on how well the organization's mission, programs, and service area align with the funder's priorities and focus.",
    "2. Return ONLY the top " + topN + " funders by score.",
    '3. Respond with ONLY a JSON array, no prose, no code fences, in exactly this shape:',
    '[{"funder_id":"<uuid>","score":<integer 0-100>,"reasoning":"<one sentence>"}]',
    "4. Do NOT include funders with a score below 40.",
    "5. Base scoring strictly on provided data only — never invent facts.",
  ].join("\n");

  const orgLines: string[] = [];
  if (org.missionStatement) orgLines.push(`Mission: ${org.missionStatement}`);
  if (org.serviceArea) orgLines.push(`Service area: ${org.serviceArea}`);
  if (org.targetPopulation) orgLines.push(`Target population: ${org.targetPopulation}`);
  if (org.programs) orgLines.push(`Programs/vision: ${org.programs}`);
  const orgBlock = orgLines.length > 0
    ? orgLines.join("\n")
    : "No detailed profile available. Score conservatively.";

  const funderLines = funders.map((f) => {
    const parts = [`ID: ${f.id}`, `Name: ${f.name}`];
    if (f.description) parts.push(`Description: ${f.description}`);
    if (f.geographic_focus) parts.push(`Geographic focus: ${f.geographic_focus}`);
    if (f.priorities?.length) parts.push(`Priorities: ${f.priorities.join(", ")}`);
    if (f.review_criteria) parts.push(`Review criteria: ${f.review_criteria}`);
    return parts.join(" | ");
  });

  const prompt = [
    `## Organization: ${org.name}`,
    orgBlock,
    "",
    "## Funders to score",
    funderLines.join("\n"),
    "",
    `Return a JSON array of the top ${topN} matches. Return ONLY the JSON array.`,
  ].join("\n");

  return { system, prompt };
}

// --- response parsing --------------------------------------------------------

interface RawMatch {
  funder_id?: unknown;
  score?: unknown;
  reasoning?: unknown;
}

function parseMatchResponse(text: string, funders: FunderRow[]): FunderMatch[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new AgentError(
      "The matching model returned an unreadable response.",
      "bad_model_output",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError(
      "The matching model returned malformed JSON.",
      "bad_model_output",
    );
  }

  if (!Array.isArray(raw)) return [];

  const funderMap = new Map(funders.map((f) => [f.id, f.name]));
  const matches: FunderMatch[] = [];

  for (const item of raw) {
    const obj = (item ?? {}) as RawMatch;
    const funderId = typeof obj.funder_id === "string" ? obj.funder_id.trim() : "";
    const scoreNum = Number(obj.score);
    const score = Number.isFinite(scoreNum)
      ? Math.max(0, Math.min(100, Math.round(scoreNum)))
      : 0;
    const reasoning =
      typeof obj.reasoning === "string" && obj.reasoning.trim() !== ""
        ? obj.reasoning.trim()
        : "No reasoning provided.";

    const funderName = funderMap.get(funderId);
    if (!funderId || !funderName) continue;

    matches.push({ funderId, funderName, score, reasoning });
  }

  return matches.sort((a, b) => b.score - a.score);
}
