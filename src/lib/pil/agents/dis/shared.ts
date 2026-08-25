import type { AgentContext, AgentRunner } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { recordEvidence } from "@/lib/pil/evidence";
import { getTool } from "@/lib/pil/tools";
import type { ToolResult } from "@/lib/pil/tools";
import type { EvidenceItem, EvidenceVerificationStatus, Prospect, ProspectEntityType } from "@/lib/pil/types";

// Shared plumbing for the Discovery family (BEN-DIS-01..05,
// PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 2 -- DISCOVERY"). The task spec for
// this batch explicitly frames all five agents as following "the same
// pattern: receive a discovery goal ... search multiple sources ... create
// pil_prospects rows ... create pil_evidence rows ... return discovered
// prospect IDs with confidence scores" -- this module is that shared
// pattern's implementation, factored out once five concrete callers need it.

export const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

export interface DiscoveryGoalCriteria {
  geography: string | null;
  stateCode: string | null;
  cause: string | null;
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  texas: "TX", california: "CA", "new york": "NY", florida: "FL", illinois: "IL",
  pennsylvania: "PA", ohio: "OH", georgia: "GA", "north carolina": "NC", michigan: "MI",
  "new jersey": "NJ", virginia: "VA", washington: "WA", arizona: "AZ", massachusetts: "MA",
  tennessee: "TN", indiana: "IN", missouri: "MO", maryland: "MD", colorado: "CO",
};

const GEOGRAPHY_PATTERN = /\b(?:in|near|within\s+\d+\s+miles\s+of)\s+([A-Z][A-Za-z.\s]{1,40}?)(?=,|\.|$|\s+\band\b|\s+\bfor\b|\s+\bwith\b)/;

const CAUSE_KEYWORDS = [
  "affordable housing", "homelessness", "recovery", "reentry", "workforce development",
  "education", "veterans", "community development", "poverty reduction", "poverty",
  "health", "arts", "environment", "youth", "hunger", "food security",
];

/** Resolves a free-text geography token to a 2-letter state code when possible; never guesses. */
function resolveStateCode(token: string): string | null {
  const trimmed = token.trim();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  return STATE_NAME_TO_CODE[trimmed.toLowerCase()] ?? null;
}

export function parseGoalCriteria(goal: string): DiscoveryGoalCriteria {
  const geoMatch = goal.match(GEOGRAPHY_PATTERN);
  const geography = geoMatch?.[1] ? geoMatch[1].trim() : null;
  const lower = goal.toLowerCase();
  const cause = CAUSE_KEYWORDS.find((keyword) => lower.includes(keyword)) ?? null;
  return {
    geography,
    stateCode: geography ? resolveStateCode(geography) : null,
    cause,
  };
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function findExistingProspect(orgId: string, displayName: string): Promise<Prospect | null> {
  const canonical = normalizeName(displayName);
  if (!canonical) return null;
  const { data, error } = await getPilClient()
    .from("pil_prospects")
    .select("*")
    .eq("organization_id", orgId)
    .eq("canonical_name", canonical)
    .maybeSingle();
  if (error) throw error;
  return (data as Prospect | null) ?? null;
}

export interface FindOrCreateProspectParams {
  orgId: string;
  displayName: string;
  entityType: ProspectEntityType;
  agentCode: string;
}

export async function findOrCreateProspect(
  params: FindOrCreateProspectParams,
): Promise<{ prospect: Prospect; created: boolean }> {
  const existing = await findExistingProspect(params.orgId, params.displayName);
  if (existing) return { prospect: existing, created: false };

  const { data, error } = await getPilClient()
    .from("pil_prospects")
    .insert({
      organization_id: params.orgId,
      entity_type: params.entityType,
      display_name: params.displayName,
      canonical_name: normalizeName(params.displayName),
      status: "active",
      merged_into_prospect_id: null,
      source_of_record: "discovery",
      created_by_agent_id: params.agentCode,
    })
    .select("*")
    .single();
  if (error) throw error;
  return { prospect: data as Prospect, created: true };
}

export interface RecordDiscoveryEvidenceParams {
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

export async function recordDiscoveryEvidence(params: RecordDiscoveryEvidenceParams): Promise<EvidenceItem> {
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

// Invokes a concrete Tool (web_search/web_crawl/news_search/entity_lookup/
// irs_990_lookup -- tools/index.ts's REGISTRY keys, not the spec's T-codes)
// and, only on success, records its real dollar cost against the agent's
// permitted-tool ledger via AgentRunner.useTool. Tool.execute already
// self-guards against a non-permitted tool (tools/index.ts's per-tool
// context.tools.includes check), so a denied call returns a normal
// ToolResult failure here rather than throwing.
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
    await runner.useTool(context, "T-MODEL", { unitCost: MODEL_TOKEN_UNIT_COST_USD, units, costType: "model_tokens" });
    return units;
  } catch {
    return 0;
  }
}

/** Rough capitalized-name extractor for crawled page text (no snippet field is available -- see web-search.ts). Capped and deduped; false positives are expected and are exactly what BEN-KNW-02 entity resolution exists to clean up. */
export function extractCandidateNames(text: string, limit: number): string[] {
  const pattern = /\b(?:[A-Z][a-z]+ ){1,2}[A-Z][a-z]+\b/g;
  const stopWords = new Set(["The", "This", "That", "Board", "Foundation", "Community", "United", "National", "American"]);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const candidate = match[0].trim();
    const firstWord = candidate.split(" ")[0];
    if (firstWord && stopWords.has(firstWord)) continue;
    const key = normalizeName(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(candidate);
    if (names.length >= limit) break;
  }
  return names;
}

export interface RecordProspectClassificationParams {
  orgId: string;
  prospectId: string;
  dimension: "cause" | "geography" | "affiliation" | "wealth_indicator" | "other";
  value: string;
  confidence: number;
  evidenceId: string | null;
}

// pil_prospect_classifications has no TS interface/service of its own yet
// (no prior DIS agent writes to it) -- BEN-DIS-06/07 are the first callers,
// per their spec's explicit dimension='geography'/'cause' output
// requirements, so this is a thin insert helper rather than a full service.
export async function recordProspectClassification(params: RecordProspectClassificationParams): Promise<void> {
  const { error } = await getPilClient()
    .from("pil_prospect_classifications")
    .insert({
      organization_id: params.orgId,
      prospect_id: params.prospectId,
      dimension: params.dimension,
      value: params.value,
      confidence: params.confidence,
      evidence_id: params.evidenceId,
    });
  if (error) throw error;
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
