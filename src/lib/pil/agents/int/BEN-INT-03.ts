import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import {
  callTool,
  getProspectById,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  recordIntelligenceEvidence,
  tryModelTokens,
  upsertCounterpartyNode,
  upsertProspectNode,
} from "@/lib/pil/agents/int/shared";
import { upsertEdge } from "@/lib/pil/graph";
import type { EvidenceItem } from "@/lib/pil/types";

// BEN-INT-03 -- Business Ownership Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3"). Investigates documented
// ownership/founder/partnership stakes, distinct from a mere directorship
// (spec's observation behavior: "different edge semantics, not
// interchangeable").
//
// Permitted tools per spec: T-WEB, T-EDGAR, T-PUBREC, T-EVIDENCE (write),
// T-GRAPH (write). No T-EDGAR/T-PUBREC tool is registered in
// tools/index.ts, so both the state-registry-style and SEC-EDGAR-style
// searches this agent performs are web_search queries scoped toward those
// sources (same substitution pattern as BEN-INT-02's T-EDGAR gap) --
// filing-backed corroboration is therefore never available here, so every
// ownership claim is recorded as `reasoned_inference`, matching spec's
// explicit replanning trigger ("can't be corroborated by a registry/filing
// source -- downgrades to reasoned_inference rather than verified_fact").

interface OwnershipMention {
  companyName: string;
  sourceUrl: string;
  sourceTitle: string | null;
  fromEdgar: boolean;
}

export class BusinessOwnershipIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-03 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const personNode = await upsertProspectNode(context.orgId, prospect, "person");
    const mentions: OwnershipMention[] = [];

    // 1. General ownership/founder search.
    const ownerSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" company owner OR founder OR "co-founder"`,
      limit: 5,
    });
    if (ownerSearch.success) {
      const results = ((ownerSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 3)) {
        mentions.push({ companyName: item.title, sourceUrl: item.url, sourceTitle: item.title, fromEdgar: false });
      }
    }

    // 2. SEC EDGAR-scoped search for public-company ownership stakes
    // (highest-authority source per spec's planning behavior, but reached
    // via web_search since no T-EDGAR tool exists -- see file header).
    const edgarSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" SEC EDGAR beneficial owner OR "Schedule 13D" OR "Form 4"`,
      limit: 5,
    });
    if (edgarSearch.success) {
      const results = ((edgarSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 3)) {
        mentions.push({ companyName: item.title, sourceUrl: item.url, sourceTitle: item.title, fromEdgar: true });
      }
    }

    for (const mention of mentions) {
      // EDGAR-sourced mentions carry a filing-scoped source_type and higher
      // confidence than a bare web mention, but neither is a parsed filing
      // (no T-EDGAR tool), so verification_status stays reasoned_inference
      // for both -- per spec, never verified_fact without an actual filing.
      const evidence = await recordIntelligenceEvidence({
        orgId: context.orgId,
        prospectId: prospect.id,
        claim: `Ownership/founder mention: ${mention.companyName}`,
        value: { company: mention.companyName, url: mention.sourceUrl, source: mention.fromEdgar ? "sec_edgar_search" : "open_web" },
        claimType: "business_ownership",
        sourceUrl: mention.sourceUrl,
        sourceTitle: mention.sourceTitle,
        sourceType: mention.fromEdgar ? "sec_edgar" : "open_web",
        publisher: hostnameOf(mention.sourceUrl),
        evidenceExcerpt: null,
        agentCode: context.agentCode,
        researchRunId: context.runId,
        confidence: mention.fromEdgar ? 0.5 : 0.35,
        verificationStatus: "reasoned_inference",
      });
      evidenceCreated.push(evidence);

      const companyNode = await upsertCounterpartyNode(context.orgId, "company", mention.companyName, {});
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: personNode.id,
        target_node_id: companyNode.id,
        edge_type: "owns",
        relationship_strength: mention.fromEdgar ? "strong" : "moderate",
        confidence: mention.fromEdgar ? 0.5 : 0.35,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: { verificationBasis: mention.fromEdgar ? "edgar_search_mention" : "web_mention" },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 400);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: { prospectId: prospect.id, ownershipMentionsFound: mentions.length },
      delegations: [],
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
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

export default BusinessOwnershipIntelligenceAgent;
