import type { AgentContext, AgentRunner } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { recordEvidence } from "@/lib/pil/evidence";
import { upsertNode } from "@/lib/pil/graph";
import { getTool } from "@/lib/pil/tools";
import type { ToolResult } from "@/lib/pil/tools";
import type { EvidenceItem, EvidenceVerificationStatus, GraphNode, GraphNodeType, Prospect } from "@/lib/pil/types";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";

// Shared plumbing for the Core Prospect Intelligence family (BEN-INT-01..08,
// PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3 -- CORE PROSPECT INTELLIGENCE").
// Unlike Discovery (agents/dis/shared.ts), every agent here receives an
// *existing* pil_prospect_id via AgentContext.prospectId and deepens that
// prospect's dossier with cited pil_evidence rows -- it never creates a new
// prospect row itself (spec: "Builds the canonical evidence-backed dossier
// once a prospect exists ... never a bare, uncited assertion").

// Bounds per-run delegation fan-out: AgentRunner executes delegations
// synchronously/inline (agent-runner.ts's delegate()), so an unbounded
// candidate list would block this run on N cascading child runs.
export const MAX_DELEGATIONS_PER_RUN = 3;

export async function getProspectById(orgId: string, prospectId: string): Promise<Prospect | null> {
  const { data, error } = await getPilClient()
    .from("pil_prospects")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", prospectId)
    .maybeSingle();
  if (error) throw error;
  return (data as Prospect | null) ?? null;
}

export interface RecordIntelligenceEvidenceParams {
  orgId: string;
  prospectId: string;
  claim: string;
  value: unknown;
  claimType: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceType: string;
  publisher: string | null;
  evidenceExcerpt: string | null;
  agentCode: string;
  researchRunId: string | null;
  confidence: number;
  verificationStatus: EvidenceVerificationStatus;
}

export async function recordIntelligenceEvidence(params: RecordIntelligenceEvidenceParams): Promise<EvidenceItem> {
  const now = new Date().toISOString();
  return recordEvidence({
    organization_id: params.orgId,
    entity_id: params.prospectId,
    entity_table: "pil_prospects",
    claim: params.claim,
    value: params.value,
    claim_type: params.claimType,
    source_url: params.sourceUrl,
    source_title: params.sourceTitle,
    source_type: params.sourceType,
    publisher: params.publisher,
    retrieved_at: now,
    published_at: null,
    last_verified_at: now,
    evidence_excerpt: params.evidenceExcerpt,
    agent_id: params.agentCode,
    research_run_id: params.researchRunId,
    confidence: params.confidence,
    verification_status: params.verificationStatus,
    freshness_status: "fresh",
    inference_status: "direct",
    contradiction_status: "none",
    lineage: [],
    created_at: now,
  });
}

// Invokes a concrete Tool (web_search/web_crawl/news_search/irs_990_lookup --
// tools/index.ts's REGISTRY keys) and, only on success, records its real
// dollar cost against the agent's permitted-tool ledger via
// AgentRunner.useTool. Same pattern as dis/shared.ts's callTool.
export async function callTool(
  context: AgentContext,
  runner: AgentRunner,
  toolName: string,
  params: Record<string, unknown>,
  costType: "api_call" | "licensed_data" = "api_call",
): Promise<ToolResult> {
  const result = await getTool(toolName).execute(params, context);
  if (result.success) {
    try {
      await runner.useTool(context, toolName, { unitCost: result.cost_usd, units: 1, costType });
    } catch {
      // Cost-ledger recording is best-effort -- a ledger write failure must
      // not discard search results the tool already returned.
    }
  }
  return result;
}

export async function tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
  if (!context.tools.includes("T-MODEL")) return 0;
  try {
    const rate = await pilBlendedTokenRateUsd();
    await runner.useTool(context, "T-MODEL", { unitCost: rate, units, costType: "model_tokens", model: PIL_AGENT_MODEL });
    return units;
  } catch {
    return 0;
  }
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Upserts a graph node representing the prospect itself (identity anchor other agents' edges attach to). Calling again with new `properties` merges via upsertNode's find-then-update, so a later-resolved fact (e.g. an EIN) can be layered onto an already-created node. */
export async function upsertProspectNode(
  orgId: string,
  prospect: Prospect,
  nodeType: GraphNodeType,
  properties: Record<string, unknown> = {},
): Promise<GraphNode> {
  return upsertNode({
    organization_id: orgId,
    node_type: nodeType,
    prospect_id: prospect.id,
    label: prospect.display_name,
    properties,
  });
}

/** Upserts a graph node for a counterparty entity (company/nonprofit/foundation) discovered via research, not itself a pil_prospects row. */
export async function upsertCounterpartyNode(
  orgId: string,
  nodeType: GraphNodeType,
  label: string,
  properties: Record<string, unknown> = {},
): Promise<GraphNode> {
  return upsertNode({
    organization_id: orgId,
    node_type: nodeType,
    prospect_id: null,
    label,
    properties,
  });
}

/** Sorensen-Dice-free, capitalized "City, ST" extractor for crawled/search-result text -- no snippet field is available (see tools/web-search.ts), so this is a best-effort heuristic, not a verified geocode. */
export function extractCityState(text: string): string | null {
  const match = text.match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)*),\s([A-Z]{2})\b/);
  return match ? `${match[1]}, ${match[2]}` : null;
}

/** Returns the sentence-ish window of text around the first mention of `name`, falling back to a leading excerpt when no mention is found. */
export function extractSummaryNear(text: string, name: string, windowChars = 240): string | null {
  if (!text) return null;
  const idx = text.toLowerCase().indexOf(name.toLowerCase());
  if (idx === -1) return text.slice(0, windowChars).trim() || null;
  const start = Math.max(0, idx - windowChars / 2);
  const end = Math.min(text.length, idx + windowChars / 2);
  return text.slice(start, end).trim() || null;
}

/** Flags a dollar figure as a press-release round estimate (e.g. "$1 million") rather than a filing-confirmed precise amount -- spec's explicit giving/capacity conflation guard. */
export function looksLikeRoundEstimate(text: string): boolean {
  return /\$\s?[\d,.]+\s*(million|thousand|billion|k|m|b)\b/i.test(text);
}

/**
 * p5.2b (2026-09-15): best-effort extraction of an entity/company/
 * institution name from a raw web-search-result TITLE, since
 * web_search_result carries no structured name field (only title/url/
 * page_age -- see tools/web-search.ts's own comment, "snippet is always ''
 * here"). Several BEN-INT-0X callers previously used the entire raw title
 * (e.g. "John Smith Named CEO of Acme Corp - Business Wire") verbatim as a
 * graph node's company/institution/org name, polluting the relationship
 * graph with headline text instead of clean names. Tries common
 * news-headline patterns before falling back to the raw title; callers
 * should treat `extracted: false` as lower-confidence than a real match.
 */
export function extractEntityName(title: string): { name: string; extracted: boolean } {
  const trimmed = title.trim();
  const NAME = "[A-Z][\\w&.,'-]*(?:\\s+(?:of\\s+|the\\s+)?[A-Z][\\w&.,'-]*){0,5}";
  const patterns = [
    new RegExp(`\\b(?:CEO|President|Director|Chair(?:man|woman)?|CFO|COO|VP|Vice President)\\s+of\\s+(${NAME})`, "i"),
    new RegExp(`\\bjoins\\s+(${NAME})(?:\\s+as\\b)?`, "i"),
    new RegExp(`\\b(?:at|with)\\s+(${NAME})\\s*(?:[-|]|$)`),
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && candidate.length >= 3) return { name: candidate, extracted: true };
  }
  return { name: trimmed, extracted: false };
}
