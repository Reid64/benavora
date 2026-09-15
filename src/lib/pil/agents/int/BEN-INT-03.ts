import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  extractEntityName,
  getProspectById,
  hostnameOf,
  MAX_DELEGATIONS_PER_RUN,
  MODEL_TOKEN_UNIT_COST_USD,
  recordIntelligenceEvidence,
  tryModelTokens,
  upsertCounterpartyNode,
  upsertProspectNode,
} from "@/lib/pil/agents/int/shared";
import { logAction } from "@/lib/pil/audit";
import { getEvidence } from "@/lib/pil/evidence";
import { getEdges, upsertEdge } from "@/lib/pil/graph";
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

// Six domain dimensions this agent's report scores coverage across, per
// PIL_AGENT_COMPLETE_ROSTER.md's "Core Intelligence" BEN_INT_03Decision.v1
// contract. Coverage is computed from persisted pil_evidence/pil_graph_edges
// state (getEvidence/getEdges), not just evidence created this run, matching
// BEN-INT-08's own established getEvidence(prospect.id, context.orgId)
// pattern for reading the full existing dossier.
const OWNERSHIP_DIMENSIONS = [
  "Legal Entity Ownership",
  "Direct Versus Indirect Interests",
  "Control Versus Economics",
  "Ownership Intervals",
  "Transactions And Exits",
  "Private-Company Uncertainty",
] as const;

export interface BusinessOwnershipIntelligenceReport {
  prospectId: string;
  dimensionCoverage: Record<string, boolean>;
  evidenceCreatedThisRun: number;
  delegationsIssued: string[];
  ownershipMentionsFound: number;
}

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
        mentions.push({ companyName: extractEntityName(item.title).name, sourceUrl: item.url, sourceTitle: item.title, fromEdgar: false });
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
        mentions.push({ companyName: extractEntityName(item.title).name, sourceUrl: item.url, sourceTitle: item.title, fromEdgar: true });
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

    // Everything below is secondary reasoning layered on top of the
    // evidence-gathering above, which has already durably committed via
    // individually atomic recordIntelligenceEvidence()/upsertEdge() calls. A
    // bug here must never discard that already-collected evidence or fail
    // this run -- recovery starts from persisted truth, and captured
    // evidence stays immutable regardless of what happens next.
    let report: BusinessOwnershipIntelligenceReport = {
      prospectId: prospect.id,
      dimensionCoverage: Object.fromEntries(OWNERSHIP_DIMENSIONS.map((d) => [d, false])),
      evidenceCreatedThisRun: evidenceCreated.length,
      delegationsIssued: [],
      ownershipMentionsFound: mentions.length,
    };
    let delegations: DelegationRequest[] = [];

    try {
      const allEvidence = await getEvidence(prospect.id, context.orgId);
      const personEdges = personNode ? await getEdges(personNode.id) : [];
      const ownershipEvidence = allEvidence.filter((e) => e.claim_type === "business_ownership");
      const ownEdges = personEdges.filter((e) => e.edge_type === "owns");
      const hasEdgarEvidence = ownershipEvidence.some((e) => e.source_type === "sec_edgar");
      const hasOpenWebEvidence = ownershipEvidence.some((e) => e.source_type === "open_web");

      const dimensionCoverage: Record<string, boolean> = {
        "Legal Entity Ownership": ownershipEvidence.length > 0 || ownEdges.length > 0,
        "Direct Versus Indirect Interests": hasEdgarEvidence && hasOpenWebEvidence,
        "Control Versus Economics": ownEdges.some((e) => e.relationship_strength === "strong"),
        "Ownership Intervals": ownEdges.some((e) => e.temporal_validity_start !== null || e.temporal_validity_end !== null),
        "Transactions And Exits": hasEdgarEvidence,
        "Private-Company Uncertainty": ownershipEvidence.some((e) => e.verification_status === "reasoned_inference"),
      };

      // Triangle-completion trigger: an EDGAR/SEC-filing-language mention
      // (Schedule 13D/Form 4 language) is a strong enough ownership-stake
      // signal to warrant both re-scoring capacity (BEN-INT-08) and checking
      // for an associated liquidity/transaction event (BEN-INT-09),
      // completing the documented BEN-INT-03/08/09 delegation triangle.
      const hasEdgarMention = mentions.some((m) => m.fromEdgar);
      // Identity-ambiguity trigger: no ownership signal found at all this run.
      const identityAmbiguous = mentions.length === 0;
      // Evidence-verification trigger: new evidence was recorded this run
      // and needs provenance verification.
      const needsEvidenceVerification = evidenceCreated.length > 0;

      const candidates: DelegationRequest[] = [];
      const pushCandidate = (childAgentCode: string, objective: string) => {
        candidates.push({
          childAgentCode,
          objective,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      };

      // Priority order per the roster's BEN-INT-03 delegation list -- stop
      // once MAX_DELEGATIONS_PER_RUN candidates are collected, even if a
      // lower-priority condition below also holds.
      if (identityAmbiguous) {
        pushCandidate(
          "BEN-KNW-02",
          `Prospect ${context.prospectId} has no ownership/founder mention found by this BEN-INT-03 run -- resolve identity ambiguity before further ownership research.`,
        );
      }
      if (hasEdgarMention) {
        pushCandidate(
          "BEN-INT-09",
          `Prospect ${context.prospectId} has an EDGAR/SEC-filing-language ownership mention (Schedule 13D/Form 4) -- check for an associated liquidity/transaction event.`,
        );
      }
      if (hasEdgarMention) {
        pushCandidate(
          "BEN-INT-08",
          `Prospect ${context.prospectId} has an EDGAR/SEC-filing-language ownership mention (Schedule 13D/Form 4) -- re-score wealth/giving capacity against the documented stake.`,
        );
      }
      if (needsEvidenceVerification) {
        pushCandidate(
          "BEN-KNW-03",
          `BEN-INT-03 recorded ${evidenceCreated.length} new ownership evidence item(s) for prospect ${context.prospectId} this run -- verify provenance before treating as authoritative.`,
        );
      }

      delegations = candidates.slice(0, MAX_DELEGATIONS_PER_RUN);

      report = {
        prospectId: prospect.id,
        dimensionCoverage,
        evidenceCreatedThisRun: evidenceCreated.length,
        delegationsIssued: delegations.map((d) => d.childAgentCode),
        ownershipMentionsFound: mentions.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "ben-int-03.gap_analysis_failed",
          resource_type: "pil_agent_runs",
          resource_id: context.runId,
          before_state: null,
          after_state: { error: message },
          policy_decision: null,
          ip_address: null,
        });
      } catch {
        // Audit logging is best-effort -- never let it mask the
        // already-collected evidence this run already durably recorded.
      }
      delegations = [];
    }

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: { report },
      delegations,
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
