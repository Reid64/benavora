// Competitor Intelligence Agent (AGENTS.md Agent 24, BEHAVIORAL_CONTRACTS §27).
//
// Loads funder_giving_history for a target funder (last 3 fiscal years), sends
// the recipient list to Claude to identify organizations most similar to the
// client in mission and geography, then upserts per-competitor rows into
// competitor_tracking. Enterprise and Consultant tiers only.
//
// NEVER stores contact information for competitors (§27).
// Data source: public IRS 990-PF filings via funder_giving_history only (§27).
// Maximum 50 competitors tracked per funder (§27).

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const MAX_COMPETITORS = 50;
const MAX_HISTORY_ROWS = 200;

export interface CompetitorIntelInput {
  funderId: string;
}

export interface CompetitorIntelResult {
  funderId: string;
  funderName: string;
  competitorsFound: number;
  competitorsInserted: number;
  competitionLevel: "low" | "high" | "very_high";
}

export interface CompetitorIntelAgentOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

interface HistoryRow {
  recipient_name: string | null;
  amount: number | null;
  grant_purpose: string | null;
  fiscal_year: number | null;
}

interface ClaudeCompetitor {
  name: string;
  what_they_do: string;
  how_they_differ: string;
  competitive_advantage: string;
  similarity_score: number;
}

export class CompetitorIntelAgent extends BaseAgent<
  CompetitorIntelInput,
  CompetitorIntelResult
> {
  readonly agentType: AgentType = "competitor_intelligence";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: CompetitorIntelAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: CompetitorIntelInput,
  ): Promise<AgentExecution<CompetitorIntelResult>> {
    // 1. Verify funder exists within org scope
    const { data: funder, error: funderError } = await this.client
      .from("funders")
      .select("id, name")
      .eq("id", input.funderId)
      .eq("organization_id", this.organizationId)
      .single();

    if (funderError || !funder) {
      throw new AgentError("Funder not found.", "not_found", 404);
    }

    // 2. Load org profile for mission context (best-effort — nulls are handled)
    const { data: org } = await this.client
      .from("organizations")
      .select("name, mission_statement, service_area")
      .eq("id", this.organizationId)
      .single();

    // 3. Load funder_giving_history — last 3 fiscal years (§27: source is 990-PF only)
    const threeYearsAgo = new Date().getFullYear() - 3;
    const { data: historyRows } = await this.client
      .from("funder_giving_history")
      .select("recipient_name, amount, grant_purpose, fiscal_year")
      .eq("organization_id", this.organizationId)
      .eq("funder_id", input.funderId)
      .gte("fiscal_year", threeYearsAgo)
      .order("fiscal_year", { ascending: false })
      .limit(MAX_HISTORY_ROWS);

    if (!historyRows || historyRows.length === 0) {
      throw new AgentError(
        "No giving history found for this funder. Run the 990 Mining agent first.",
        "no_giving_history",
        422,
      );
    }

    const funderName = funder.name as string;
    const orgName = (org?.name as string | null) ?? "our organization";
    const orgMission = (org?.mission_statement as string | null) ?? "";
    const orgArea = (org?.service_area as string | null) ?? "";

    // 4. Send recipient list to Claude — identify similar orgs by mission + geography
    const response = await callClaude({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(
        funderName,
        orgName,
        orgMission,
        orgArea,
        historyRows as HistoryRow[],
      ),
      model: this.model,
      maxTokens: this.maxTokens,
    });

    const claudeCompetitors = parseCompetitorResponse(response.text);
    const capped = claudeCompetitors.slice(0, MAX_COMPETITORS);

    // 5. Build a lookup map from giving history for financial enrichment
    const historyByName = new Map<string, HistoryRow>();
    for (const row of historyRows as HistoryRow[]) {
      if (!row.recipient_name) continue;
      const key = row.recipient_name.toLowerCase().trim();
      if (!historyByName.has(key)) historyByName.set(key, row);
    }

    // 6. Refresh: delete prior competitor_intel rows for this funder (§27: max 50, refreshed on run)
    await this.client
      .from("competitor_tracking")
      .delete()
      .eq("organization_id", this.organizationId)
      .eq("funder_id", input.funderId)
      .eq("source", "competitor_intel");

    // 7. Determine competition level for header row (§27: high = 3+ similar orgs)
    const competitionLevel: "low" | "high" | "very_high" =
      capped.length >= 10 ? "very_high" : capped.length >= 3 ? "high" : "low";

    // 8. Insert per-competitor rows — analysis stored in grant_purpose (§27)
    if (capped.length > 0) {
      const rows = capped.map((c) => {
        const hist = historyByName.get(c.name.toLowerCase().trim());
        const analysisText = [
          c.what_they_do,
          `Difference: ${c.how_they_differ}`,
          `Competitive edge: ${c.competitive_advantage}`,
        ].join(" | ");

        return {
          organization_id: this.organizationId,
          funder_id: input.funderId,
          competitor_name: c.name,
          grant_amount: hist?.amount ?? null,
          grant_purpose: analysisText,
          fiscal_year: hist?.fiscal_year ?? null,
          estimated_applicants: capped.length,
          competition_level: competitionLevel,
          source: "competitor_intel",
        };
      });

      const { error: insertError } = await this.client
        .from("competitor_tracking")
        .insert(rows);

      if (insertError) {
        throw new AgentError(
          "Failed to save competitor data.",
          "write_failed",
        );
      }
    }

    return {
      data: {
        funderId: input.funderId,
        funderName,
        competitorsFound: claudeCompetitors.length,
        competitorsInserted: capped.length,
        competitionLevel,
      },
      outputSummary: `Identified ${capped.length} competitor${capped.length !== 1 ? "s" : ""} for "${funderName}". Competition level: ${competitionLevel}.${claudeCompetitors.length > MAX_COMPETITORS ? ` ${claudeCompetitors.length - MAX_COMPETITORS} excess trimmed to cap.` : ""}`,
      itemsFound: claudeCompetitors.length,
      itemsProcessed: capped.length,
      tokensUsed: response.usage.totalTokens,
    };
  }
}

// --- prompt ------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a nonprofit funding analyst. Given a list of grant recipients from a foundation, identify which organizations are most similar to the client organization in mission and geographic focus — these are potential competitors for the same funding.

Return ONLY valid JSON with this exact schema — no prose, no markdown fences:

{
  "competitors": [
    {
      "name": "Organization Name",
      "what_they_do": "Brief description of their mission and programs (1-2 sentences)",
      "how_they_differ": "Key ways they differ from the client organization (1-2 sentences)",
      "competitive_advantage": "Where they may have an edge over the client (1 sentence)",
      "similarity_score": 85
    }
  ]
}

Rules:
- Include ONLY organizations that overlap meaningfully in mission AND geography with the client.
- similarity_score: integer 0-100. Include only organizations scoring 50 or above.
- Sort by similarity_score descending (most similar first).
- Maximum 50 results.
- NEVER include contact information (phone, email, physical address) in any field.
- If fewer than 3 recipients are similar, return an empty competitors array.`;

function buildPrompt(
  funderName: string,
  orgName: string,
  orgMission: string,
  orgArea: string,
  history: HistoryRow[],
): string {
  const recipientLines = history
    .map((r) => {
      const parts: string[] = [];
      if (r.recipient_name) parts.push(`Name: ${r.recipient_name}`);
      if (r.amount) parts.push(`Amount: $${r.amount.toLocaleString()}`);
      if (r.grant_purpose) parts.push(`Purpose: ${r.grant_purpose}`);
      if (r.fiscal_year) parts.push(`Year: ${r.fiscal_year}`);
      return parts.join(", ");
    })
    .filter((line) => line.trim() !== "")
    .join("\n");

  return `Funder: ${funderName}

Client Organization: ${orgName}
Mission: ${orgMission || "Not specified"}
Geographic Focus: ${orgArea || "Not specified"}

Grant Recipients (last 3 fiscal years):
${recipientLines || "No recipients found."}

Identify which of these recipients are potential competitors to ${orgName}. Return as JSON.`;
}

// --- response parsing --------------------------------------------------------

function parseCompetitorResponse(text: string): ClaudeCompetitor[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError(
      "The competitor analysis model returned malformed JSON.",
      "bad_model_output",
    );
  }

  const obj = (raw ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(obj.competitors) ? obj.competitors : [];

  return (arr as unknown[])
    .map((item) => {
      const c = (item ?? {}) as Record<string, unknown>;
      const name = typeof c.name === "string" ? c.name.trim() : "";
      const score =
        typeof c.similarity_score === "number" ? c.similarity_score : 0;
      return {
        name,
        what_they_do:
          typeof c.what_they_do === "string" ? c.what_they_do.trim() : "",
        how_they_differ:
          typeof c.how_they_differ === "string" ? c.how_they_differ.trim() : "",
        competitive_advantage:
          typeof c.competitive_advantage === "string"
            ? c.competitive_advantage.trim()
            : "",
        similarity_score: score,
      };
    })
    .filter((c) => c.name !== "" && c.similarity_score >= 50);
}
