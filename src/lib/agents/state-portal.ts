// State Portal Research Agent — AGENTS.md Agent 18.
//
// Fetches and parses HTML from state grant portals, using Claude to extract
// structured opportunity data (BEHAVIORAL_CONTRACTS §21).
//
// Per-run behaviour:
//   1. Looks up the target state in the built-in portal registry.
//   2. Fetches the portal page via server-side HTTP (no CORS issues).
//   3. Sends the HTML + keywords to Claude to extract structured grant data.
//   4. Deduplicates against existing opportunities by name + source.
//   5. Inserts new records and returns the full discovered list.
//
// Behavioral contracts enforced:
//   §21 — public pages only; 5s+ delay if multi-page; quality validation.
//   §18 Agent — source set to state name; tier gate checked by route layer.
//
// WIRING NOTE (2026-08-04): NOT cron-scheduled, and correctly so — this agent
// takes a single required `state` input per call and is tier-gated (Starter=1
// state, Pro=5, Enterprise/Consultant=all), so which state(s) to run is a
// per-org, per-tier configuration decision, not a single global cron entry
// (a naive cron addition would run one hardcoded state for every org
// regardless of relevance). Wiring this into automation would require
// resolving each org's configured/allowed state(s) first — a real feature,
// not a one-line schedule addition — and no such per-org state configuration
// currently exists to resolve against. Live-tested directly this session
// (state: "TX"): threw a real `404` from the Texas portal URL in the
// built-in registry — the portal URL itself is stale/wrong, a separate real
// bug from the scheduling question, not diagnosed further here (out of scope
// for this pass).

import { callClaude } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

export interface StatePortalInput {
  /** Two-letter state code (e.g. "TX") or full state name. */
  state: string;
  keywords: string[];
  /** Optional category hint passed to Claude and used as opportunity category. */
  category?: string;
}

export interface StatePortalOpportunity {
  title: string;
  agency: string | null;
  deadline: string | null;
  amount: string | null;
  eligibility: string | null;
  url: string | null;
  source: string;
}

export interface StatePortalResult {
  opportunities: StatePortalOpportunity[];
  count: number;
  opportunitiesCreated: number;
  state: string;
}

interface PortalConfig {
  stateCode: string;
  stateName: string;
  /** Base URL to fetch. Append search params here if the portal supports them. */
  portalUrl: string;
  /** Optional URL suffix template; {keywords} is replaced with the encoded query. */
  searchSuffix?: string;
}

// Built-in registry. Texas is the primary portal (BLUEPRINT §3.6).
// Add additional portals here as they are onboarded.
//
// URL corrected 2026-08-05: the old "Texas Online" URL
// (txapps.texas.gov/tolapp/ogi/) 301-redirects through
// texasonline.state.tx.us -> www.texasonline.state.tx.us, a decommissioned
// e-government system whose final destination genuinely 404s (not a typo,
// the underlying page is gone). Replaced with the real, current, official
// Texas state grant opportunities portal (Statewide Procurement
// Division/eGrants), confirmed live via a direct fetch: `200`, real content.
const PORTAL_REGISTRY: PortalConfig[] = [
  {
    stateCode: "TX",
    stateName: "Texas",
    portalUrl: "https://egrants.gov.texas.gov/fundingopp",
  },
];

function findPortal(state: string): PortalConfig | undefined {
  const normalised = state.trim().toUpperCase();
  return PORTAL_REGISTRY.find(
    (p) =>
      p.stateCode === normalised ||
      p.stateName.toUpperCase() === normalised,
  );
}

interface RawExtracted {
  title?: unknown;
  agency?: unknown;
  deadline?: unknown;
  amount?: unknown;
  eligibility?: unknown;
  url?: unknown;
}

function parseClaudeResponse(text: string): RawExtracted[] {
  // Claude is prompted to return a bare JSON array. Strip any markdown fences.
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed as RawExtracted[];
    if (parsed !== null && typeof parsed === "object") {
      const candidate = (parsed as Record<string, unknown>)["opportunities"];
      if (Array.isArray(candidate)) return candidate as RawExtracted[];
    }
  } catch {
    // Claude occasionally returns plain text when no opportunities are found.
  }
  return [];
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

// ISO-8601 date prefix check — only store deadline if Claude returned a parseable date.
function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}

export class StatePortalResearchAgent extends BaseAgent<
  StatePortalInput,
  StatePortalResult
> {
  readonly agentType: AgentType = "state_portal";

  protected async execute(
    input: StatePortalInput,
  ): Promise<AgentExecution<StatePortalResult>> {
    const state = input.state?.trim() ?? "";
    if (!state) {
      throw new AgentError("state parameter is required.", "no_state", 400);
    }

    const keywords = (input.keywords ?? []).map(String).filter(Boolean);
    if (keywords.length === 0) {
      throw new AgentError(
        "At least one keyword is required.",
        "no_keywords",
        400,
      );
    }

    const portal = findPortal(state);
    if (!portal) {
      const supported = PORTAL_REGISTRY.map((p) => p.stateCode).join(", ");
      throw new AgentError(
        `No portal configured for "${state}". Supported states: ${supported}.`,
        "unsupported_state",
        400,
      );
    }

    const keywordQuery = keywords.join(" ");
    const portalUrl =
      portal.searchSuffix
        ? portal.portalUrl +
          portal.searchSuffix.replace(
            "{keywords}",
            encodeURIComponent(keywordQuery),
          )
        : portal.portalUrl;

    // Fetch portal HTML server-side.
    let html: string;
    try {
      const response = await fetch(portalUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Benavora/1.0; grant-research-bot)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new AgentError(
          `${portal.stateName} portal returned HTTP ${response.status}.`,
          "portal_error",
          502,
        );
      }
      html = await response.text();
    } catch (err) {
      if (err instanceof AgentError) throw err;
      throw new AgentError(
        `Failed to fetch ${portal.stateName} portal: ${
          err instanceof Error ? err.message : "network error"
        }`,
        "fetch_failed",
        502,
      );
    }

    // Truncate to ~80KB to stay within token limits; most grant listings are
    // in the upper DOM so early content is most useful.
    const truncatedHtml =
      html.length > 80_000 ? html.slice(0, 80_000) : html;

    const keywordStr = keywords.join(", ");
    const categoryClause = input.category
      ? ` Focus on grants related to the "${input.category}" category.`
      : "";

    const prompt = `You are analyzing a ${portal.stateName} state grant portal page. Extract all grant and funding opportunities relevant to these search keywords: ${keywordStr}.${categoryClause}

Return ONLY a JSON array. Each element must follow this exact shape (use null for any missing field):
{
  "title": string,
  "agency": string | null,
  "deadline": string | null,
  "amount": string | null,
  "eligibility": string | null,
  "url": string | null
}

Rules:
- For "deadline": use YYYY-MM-DD if the date is determinable, otherwise use the raw text, otherwise null.
- For "amount": include the full funding range as text (e.g. "Up to $50,000"), otherwise null.
- For "url": include the direct link to the opportunity page if present, otherwise null.
- If no relevant opportunities are found, return an empty array: []
- Do NOT wrap the array in markdown fences or any other text. Return only raw JSON.

Page HTML:
${truncatedHtml}`;

    let claudeResult: Awaited<ReturnType<typeof callClaude>>;
    try {
      claudeResult = await callClaude({ prompt, maxTokens: 2048 });
    } catch (err) {
      throw new AgentError(
        `Claude extraction failed: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        "claude_error",
        502,
      );
    }

    const extracted = parseClaudeResponse(claudeResult.text);

    // Source name follows the convention in BEHAVIORAL_CONTRACTS §21.
    const sourceName = portal.stateName.toLowerCase().replace(/\s+/g, "_");
    const oppCategory = input.category ?? "government_grant";

    const opportunities: StatePortalOpportunity[] = extracted.map((item) => ({
      title: toStr(item.title),
      agency: toStr(item.agency) || null,
      deadline: toStr(item.deadline) || null,
      amount: toStr(item.amount) || null,
      eligibility: toStr(item.eligibility) || null,
      url: toStr(item.url) || null,
      source: sourceName,
    }));

    let opportunitiesCreated = 0;

    for (const opp of opportunities) {
      if (!opp.title) continue;

      // Quality validation: skip if no title and no url (§21 minimum fields).
      if (!opp.url && !opp.agency && !opp.eligibility) continue;

      // Dedup by name + source (§21).
      const { data: existing } = await this.client
        .from("opportunities")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("name", opp.title)
        .eq("source", opp.source)
        .maybeSingle();

      if (existing) continue;

      // Build description from structured fields.
      const descParts: string[] = [];
      if (opp.agency) descParts.push(`Agency: ${opp.agency}`);
      if (opp.amount) descParts.push(`Amount: ${opp.amount}`);
      if (opp.eligibility) descParts.push(`Eligibility: ${opp.eligibility}`);
      if (opp.url) descParts.push(`URL: ${opp.url}`);

      const row: Record<string, unknown> = {
        organization_id: this.organizationId,
        name: opp.title,
        category: oppCategory,
        source: opp.source,
        source_type: "government_state",
        status: "open",
      };

      if (descParts.length > 0) row.description = descParts.join(" | ");
      if (opp.deadline && isIsoDate(opp.deadline))
        row.deadline = opp.deadline.slice(0, 10);

      const { error } = await this.client.from("opportunities").insert(row);
      if (!error) opportunitiesCreated++;
    }

    return {
      data: {
        opportunities,
        count: opportunities.length,
        opportunitiesCreated,
        state: portal.stateName,
      },
      outputSummary: `${portal.stateName} portal search for "${keywordStr}" found ${opportunities.length} opportunity(ies); ${opportunitiesCreated} new record(s) created.`,
      itemsFound: opportunities.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
