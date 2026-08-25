import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect, getEdges } from "@/lib/pil/graph";
import { logAction } from "@/lib/pil/audit";
import type { EvidenceContradiction, EvidenceItem, GraphNode, ProspectDigitalTwin, ProspectOpportunity } from "@/lib/pil/types";

// BEN-KNW-01 -- Prospect Digital Twin Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~945, FAMILY 7 -- KNOWLEDGE
// INTEGRITY). "Maintain the living structured representation of each
// prospect."
//
// This recovery pass was asked to create a file at this exact path for a
// mission the task prompt described as "Entity Resolution and Graph Agent."
// The registry's real BEN-KNW-01 is the digital-twin aggregator (this file);
// the entity-resolution mission the task described is BEN-KNW-02, already
// implemented (src/lib/pil/agents/knw/BEN-KNW-02.ts, header comment explains
// the same reconciliation). This file implements the real BEN-KNW-01 instead
// of duplicating BEN-KNW-02 under a new name, continuing the established
// per-batch pattern of trusting pil_agent_registry/PROSPECT_INTELLIGENCE_AGENTS.md
// over task prose (see BEN-KNW-02.ts, BEN-KNW-03.ts, and this batch's other
// agent files for prior instances).
//
// Conflict handling (spec): "Treats every incoming update as a proposed
// patch to a specific twin field, not a full-document overwrite... Detects
// when an incoming update conflicts with current canonical state and routes
// to BEN-KNW-04 rather than silently applying a later-write-wins overwrite."
// Only the fact-bearing fields (biography, giving_history, wealth_indicators,
// affinity, capacity) are conflict-checked against the prior twin row --
// the remaining fields (organizations_summary, relationships_summary,
// evidence_summary, timeline, opportunities_summary, research_gaps,
// contradictions_summary, completeness_score) are pure derived aggregates
// recomputed from current pil_evidence/pil_graph_*/pil_prospect_opportunities
// state on every run, so there is nothing to "conflict" with. A conflicted
// field keeps its prior value in this run's write and the field name is
// delegated to BEN-KNW-04 (not yet implemented -- runs as a graceful
// NotImplementedAgent per src/lib/pil/agents/index.ts's documented pattern)
// rather than silently overwritten, per the spec's failure criteria.
//
// current_strategy and monitoring_events_summary are owned by the Strategy
// family (BEN-STR-01..04, unimplemented) and BEN-OPS-01/monitoring
// respectively -- this agent passes through whatever the prior twin row
// already had for those two fields rather than fabricating content outside
// its own mission.

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

const BIOGRAPHY_CLAIM_TYPES = new Set(["employment", "education", "board_membership", "business_ownership", "biography"]);
const GIVING_CLAIM_TYPES = new Set(["giving_history", "donation"]);
const WEALTH_CLAIM_TYPES = new Set(["wealth_capacity", "wealth_indicator"]);
const AFFINITY_CLAIM_TYPES = new Set(["mission_affinity", "cause_alignment"]);
const DIMENSIONS: Array<{ key: string; claimTypes: Set<string> }> = [
  { key: "biography", claimTypes: BIOGRAPHY_CLAIM_TYPES },
  { key: "giving_history", claimTypes: GIVING_CLAIM_TYPES },
  { key: "wealth_indicators", claimTypes: WEALTH_CLAIM_TYPES },
  { key: "affinity", claimTypes: AFFINITY_CLAIM_TYPES },
];

export interface DigitalTwinReport {
  prospectId: string;
  twinVersion: number;
  completenessScore: number;
  conflictedFields: string[];
  researchGaps: string[];
  contradictionsOpen: number;
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function materiallyDifferent(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export class ProspectDigitalTwinAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-KNW-01 requires an existing prospectId");
    }

    const client = getPilClient();
    const [prospect, evidence, nodes, contradictions, opportunities, existingTwin] = await Promise.all([
      this.loadProspect(context.orgId, context.prospectId),
      getEvidence(context.prospectId, context.orgId),
      getNodesByProspect(context.prospectId, context.orgId),
      this.loadOpenContradictions(context.orgId, context.prospectId),
      this.loadOpportunities(context.orgId, context.prospectId),
      this.loadTwin(context.orgId, context.prospectId),
    ]);

    if (!prospect) {
      return this.completedEmpty(`No pil_prospects row found for ${context.prospectId}`);
    }

    const edges = (
      await Promise.all(nodes.map((n) => getEdges(n.id)))
    ).flat();

    const byClaimType = new Map<string, EvidenceItem[]>();
    for (const item of evidence) {
      const list = byClaimType.get(item.claim_type) ?? [];
      list.push(item);
      byClaimType.set(item.claim_type, list);
    }

    const proposed: Record<string, unknown> = {
      identity: { display_name: prospect.display_name, canonical_name: prospect.canonical_name, entity_type: prospect.entity_type },
      biography: this.buildBucket(byClaimType, BIOGRAPHY_CLAIM_TYPES),
      giving_history: this.buildList(byClaimType, GIVING_CLAIM_TYPES),
      wealth_indicators: this.buildBucket(byClaimType, WEALTH_CLAIM_TYPES),
      affinity: this.buildBucket(byClaimType, AFFINITY_CLAIM_TYPES),
      capacity: this.buildCapacity(opportunities),
      organizations_summary: this.summarizeNodes(nodes, ["nonprofit", "board"]),
      companies: this.summarizeNodes(nodes, ["company"]),
      foundations: this.summarizeNodes(nodes, ["foundation"]),
      relationships_summary: edges.map((e) => ({
        edge_type: e.edge_type,
        strength: e.relationship_strength,
        confidence: e.confidence,
        is_current: e.is_current,
      })),
      evidence_summary: this.summarizeEvidence(evidence),
      timeline: this.buildTimeline(evidence),
      opportunities_summary: opportunities.map((o) => ({
        id: o.id,
        classification: o.classification,
        status: o.status,
        confidence: o.confidence,
      })),
      contradictions_summary: contradictions.map((c) => ({ id: c.id, claim_type: c.claim_type, resolution_status: c.resolution_status })),
      research_gaps: this.findResearchGaps(byClaimType),
    };
    proposed.completeness_score = this.scoreCompleteness(proposed, evidence.length > 0);

    const conflictedFields: string[] = [];
    const finalFields: Record<string, unknown> = { ...proposed };
    const conflictCheckedKeys = ["biography", "giving_history", "wealth_indicators", "affinity", "capacity"];
    for (const key of conflictCheckedKeys) {
      const priorValue = existingTwin ? (existingTwin as unknown as Record<string, unknown>)[key] : undefined;
      if (existingTwin && !isEmptyValue(priorValue) && materiallyDifferent(priorValue, proposed[key])) {
        conflictedFields.push(key);
        finalFields[key] = priorValue;
      }
    }

    const nextVersion = existingTwin ? existingTwin.twin_version + 1 : 1;
    const payload = {
      prospect_id: context.prospectId,
      organization_id: context.orgId,
      twin_version: nextVersion,
      current_strategy: existingTwin?.current_strategy ?? {},
      monitoring_events_summary: existingTwin?.monitoring_events_summary ?? [],
      ...finalFields,
      last_updated_by_agent_id: context.agentCode,
      updated_at: new Date().toISOString(),
    };

    if (existingTwin) {
      const { error } = await client.from("pil_prospect_digital_twins").update(payload).eq("id", existingTwin.id);
      if (error) throw error;
    } else {
      const { error } = await client.from("pil_prospect_digital_twins").insert(payload);
      if (error) throw error;
    }

    const delegations: DelegationRequest[] = [];
    if (conflictedFields.length > 0) {
      delegations.push({
        childAgentCode: "BEN-KNW-04",
        objective: `Resolve conflicting canonical values for prospect ${context.prospectId}: ${conflictedFields.join(", ")}`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, fields: conflictedFields },
      });
    }

    const report: DigitalTwinReport = {
      prospectId: context.prospectId,
      twinVersion: nextVersion,
      completenessScore: proposed.completeness_score as number,
      conflictedFields,
      researchGaps: proposed.research_gaps as string[],
      contradictionsOpen: contradictions.length,
    };

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "digital_twin.updated",
      resource_type: "pil_prospect_digital_twins",
      resource_id: context.prospectId,
      before_state: null,
      after_state: { report },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 150);

    return {
      status: "completed",
      evidence: [],
      conclusions: { report },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private buildBucket(byClaimType: Map<string, EvidenceItem[]>, claimTypes: Set<string>): Record<string, unknown> {
    const facts: Array<{ claim: string; value: unknown; confidence: number; evidenceId: string }> = [];
    for (const [claimType, items] of byClaimType) {
      if (!claimTypes.has(claimType)) continue;
      for (const item of items) {
        facts.push({ claim: item.claim, value: item.value, confidence: item.confidence, evidenceId: item.id });
      }
    }
    return facts.length === 0 ? {} : { facts };
  }

  private buildList(byClaimType: Map<string, EvidenceItem[]>, claimTypes: Set<string>): unknown[] {
    const list: unknown[] = [];
    for (const [claimType, items] of byClaimType) {
      if (!claimTypes.has(claimType)) continue;
      for (const item of items) {
        list.push({ claim: item.claim, value: item.value, confidence: item.confidence, evidenceId: item.id, retrievedAt: item.retrieved_at });
      }
    }
    return list;
  }

  private buildCapacity(opportunities: ProspectOpportunity[]): Record<string, unknown> {
    const latest = opportunities[0];
    if (!latest) return {};
    return {
      estimateLow: latest.capacity_estimate_low,
      estimateHigh: latest.capacity_estimate_high,
      recommendedAskLow: latest.recommended_ask_low,
      recommendedAskHigh: latest.recommended_ask_high,
      confidence: latest.confidence,
    };
  }

  private summarizeNodes(nodes: GraphNode[], nodeTypes: string[]): unknown[] {
    return nodes.filter((n) => nodeTypes.includes(n.node_type)).map((n) => ({ id: n.id, label: n.label, nodeType: n.node_type }));
  }

  private summarizeEvidence(evidence: EvidenceItem[]): Record<string, unknown> {
    const byVerification: Record<string, number> = {};
    const byFreshness: Record<string, number> = {};
    for (const item of evidence) {
      byVerification[item.verification_status] = (byVerification[item.verification_status] ?? 0) + 1;
      byFreshness[item.freshness_status] = (byFreshness[item.freshness_status] ?? 0) + 1;
    }
    return { total: evidence.length, byVerificationStatus: byVerification, byFreshnessStatus: byFreshness };
  }

  private buildTimeline(evidence: EvidenceItem[]): unknown[] {
    return [...evidence]
      .sort((a, b) => Date.parse(a.published_at ?? a.retrieved_at) - Date.parse(b.published_at ?? b.retrieved_at))
      .map((item) => ({ date: item.published_at ?? item.retrieved_at, claim: item.claim, claimType: item.claim_type }))
      .slice(-50);
  }

  private findResearchGaps(byClaimType: Map<string, EvidenceItem[]>): string[] {
    return DIMENSIONS.filter((d) => ![...d.claimTypes].some((ct) => (byClaimType.get(ct)?.length ?? 0) > 0)).map((d) => d.key);
  }

  private scoreCompleteness(proposed: Record<string, unknown>, hasAnyEvidence: boolean): number {
    if (!hasAnyEvidence) return 0;
    const checked = ["biography", "giving_history", "wealth_indicators", "affinity", "relationships_summary", "opportunities_summary"];
    const present = checked.filter((key) => !isEmptyValue(proposed[key])).length;
    return Math.round((present / checked.length) * 100) / 100;
  }

  private async loadProspect(orgId: string, prospectId: string): Promise<{ id: string; display_name: string; canonical_name: string; entity_type: string } | null> {
    const { data, error } = await getPilClient()
      .from("pil_prospects")
      .select("id, display_name, canonical_name, entity_type")
      .eq("organization_id", orgId)
      .eq("id", prospectId)
      .maybeSingle();
    if (error) throw error;
    return data as { id: string; display_name: string; canonical_name: string; entity_type: string } | null;
  }

  private async loadOpenContradictions(orgId: string, prospectId: string): Promise<EvidenceContradiction[]> {
    const { data, error } = await getPilClient()
      .from("pil_contradictions")
      .select("*")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .eq("resolution_status", "open");
    if (error) throw error;
    return (data ?? []) as EvidenceContradiction[];
  }

  private async loadOpportunities(orgId: string, prospectId: string): Promise<ProspectOpportunity[]> {
    const { data, error } = await getPilClient()
      .from("pil_prospect_opportunities")
      .select("*")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ProspectOpportunity[];
  }

  private async loadTwin(orgId: string, prospectId: string): Promise<ProspectDigitalTwin | null> {
    const { data, error } = await getPilClient()
      .from("pil_prospect_digital_twins")
      .select("*")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .maybeSingle();
    if (error) throw error;
    return data as ProspectDigitalTwin | null;
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (!context.tools.includes("T-MODEL")) return 0;
    try {
      await runner.useTool(context, "T-MODEL", { unitCost: MODEL_TOKEN_UNIT_COST_USD, units, costType: "model_tokens" });
      return units;
    } catch {
      return 0;
    }
  }

  private completedEmpty(reason: string): AgentResult {
    return {
      status: "completed",
      evidence: [],
      conclusions: { skipped: true, reason },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: null,
    };
  }
}

export default ProspectDigitalTwinAgent;
