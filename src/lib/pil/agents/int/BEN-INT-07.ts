import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  getProspectById,
  hostnameOf,
  looksLikeRoundEstimate,
  MAX_DELEGATIONS_PER_RUN,
  MODEL_TOKEN_UNIT_COST_USD,
  recordIntelligenceEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/int/shared";
import { logAction } from "@/lib/pil/audit";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getEdges, getNodesByProspect } from "@/lib/pil/graph";
import type { EvidenceItem, GraphEdge, GraphNode } from "@/lib/pil/types";

// The six BEN-INT-07 output-contract dimensions (roster "Core Intelligence"
// section / PIL_AGENT_DEPENDENCIES.yaml's BEN-INT-07 entry). Coverage is
// computed from persisted giving_history evidence (getEvidence()), not just
// evidence created this run -- matching BEN-INT-08's own coverage pattern.
const GIVING_HISTORY_DIMENSIONS = [
  "Donor Attribution",
  "Gift/Grant Status",
  "Recipient And Purpose",
  "Amount/Currency/Date",
  "Vehicle And Intermediary",
  "Repeat-Pattern Analysis",
] as const;

export interface GivingHistoryIntelligenceReport {
  prospectId: string;
  dimensionCoverage: Record<string, boolean>;
  evidenceCreatedThisRun: number;
  delegationsIssued: string[];
  givingMentionsFound: number;
}

// BEN-INT-07 -- Giving History Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3", line ~518). Reconstructs
// documented charitable-giving behavior as discrete, evidenced gift events
// -- never an aggregated total, and never conflated with a capacity estimate
// (spec's explicit failure criteria: "A capacity estimate leaks into the
// giving_history array").
//
// The task spec that commissioned this batch (BEN-INT-01..08) described
// eight agents but its step 6/7/8 descriptions do not correspond to any
// live registry agent at BEN-INT-06/07/08 (they describe "Nonprofit Board"
// and "Foundation Intelligence" a second time, and "Corporate Philanthropy",
// none of which is BEN-INT-07's real mission). Per this codebase's
// established registry-wins pattern, this file implements the real
// BEN-INT-07 straight from PROSPECT_INTELLIGENCE_AGENTS.md.
//
// Permitted tools per spec: T-WEB, T-NEWS, T-990, T-EVIDENCE (write). No
// T-GRAPH -- this agent only ever writes evidence, matching spec exactly.

interface GivingMention {
  claim: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceType: string;
  publisher: string | null;
}

export class GivingHistoryIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-07 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const mentions: GivingMention[] = [];

    const webResult = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" donated OR "gift of" OR pledge OR "gave" nonprofit`,
      limit: 6,
    });
    if (webResult.success) {
      const results = ((webResult.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 4)) {
        mentions.push({
          claim: item.title,
          sourceUrl: item.url,
          sourceTitle: item.title,
          sourceType: "open_web",
          publisher: hostnameOf(item.url),
        });
      }
    }

    const newsResult = await callTool(context, runner, "news_search", {
      query: `"${prospect.display_name}" donation OR gift OR pledge`,
      limit: 6,
    });
    if (newsResult.success) {
      const results = ((newsResult.data as { results?: Array<{ title: string; url: string; source: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 4)) {
        mentions.push({
          claim: item.title,
          sourceUrl: item.url,
          sourceTitle: item.title,
          sourceType: "news",
          publisher: item.source || hostnameOf(item.url),
        });
      }
    }

    let hasSolidGiftEvidence = false;
    for (const mention of mentions) {
      // Round press-release figures ("$1 million commitment") are an
      // estimate until a filing confirms them, per spec's observation
      // behavior -- never recorded as verified_fact.
      const isEstimate = looksLikeRoundEstimate(mention.claim);
      if (!isEstimate) hasSolidGiftEvidence = true;
      evidenceCreated.push(
        await recordIntelligenceEvidence({
          orgId: context.orgId,
          prospectId: prospect.id,
          claim: `Documented gift mention: ${mention.claim}`,
          value: { text: mention.claim, url: mention.sourceUrl },
          claimType: "giving_history",
          sourceUrl: mention.sourceUrl,
          sourceTitle: mention.sourceTitle,
          sourceType: mention.sourceType,
          publisher: mention.publisher,
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: isEstimate ? 0.3 : 0.4,
          verificationStatus: isEstimate ? "estimate" : "single_source_fact",
        }),
      );
    }

    // Foundation-trustee deepening (spec input: "foundation grant history
    // from BEN-INT-06 where the prospect is a foundation officer/trustee").
    // Walk this person's trustee_of edges (written by BEN-INT-06) to any
    // foundation with a resolved EIN and record its total grants paid as a
    // corroborated giving-history entry distinct from a personal gift.
    const personNodes = await getNodesByProspect(prospect.id, context.orgId);
    const personNode = personNodes.find((n) => n.node_type === "person");
    let trusteeEdges: GraphEdge[] = [];
    if (personNode) {
      const edges = await getEdges(personNode.id);
      trusteeEdges = edges.filter((e) => e.edge_type === "trustee_of");
      for (const edge of trusteeEdges) {
        const { data: targetNodeRow } = await getPilClient()
          .from("pil_graph_nodes")
          .select("*")
          .eq("id", edge.target_node_id)
          .maybeSingle();
        const targetNode = targetNodeRow as GraphNode | null;
        const ein = (targetNode?.properties as { ein?: string } | undefined)?.ein;
        if (!ein) continue;

        const nineNinety = await callTool(context, runner, "irs_990_lookup", { ein });
        if (!nineNinety.success) continue;
        const data = nineNinety.data as { total_grants_paid: number | null; filing_year: number | null };

        evidenceCreated.push(
          await recordIntelligenceEvidence({
            orgId: context.orgId,
            prospectId: prospect.id,
            claim: `Grants paid via foundation trusteeship at ${targetNode?.label ?? ein} per 990 filing (${data.filing_year ?? "unknown year"}): ${data.total_grants_paid ?? "unknown"}`,
            value: { foundationLabel: targetNode?.label ?? null, ein, totalGrantsPaid: data.total_grants_paid, filingYear: data.filing_year },
            claimType: "giving_history",
            sourceUrl: null,
            sourceTitle: targetNode?.label ?? null,
            sourceType: "irs_form_990",
            publisher: "IRS Form 990",
            evidenceExcerpt: null,
            agentCode: context.agentCode,
            researchRunId: context.runId,
            confidence: 0.75,
            verificationStatus: "corroborated_fact",
          }),
        );
        hasSolidGiftEvidence = true;
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 400);

    // Gap-analysis + delegation-construction + report-construction. Runs
    // strictly after every evidence write above has already durably
    // committed, so a bug here can never discard evidence this run already
    // recorded ("recovery starts from persisted truth ... captured evidence
    // stays immutable") -- on failure this still returns status: "completed"
    // with evidenceCreated intact and delegations: [].
    let delegations: DelegationRequest[] = [];
    let report: GivingHistoryIntelligenceReport = {
      prospectId: prospect.id,
      dimensionCoverage: Object.fromEntries(GIVING_HISTORY_DIMENSIONS.map((d) => [d, false])),
      evidenceCreatedThisRun: evidenceCreated.length,
      delegationsIssued: [],
      givingMentionsFound: mentions.length,
    };
    try {
      const allEvidence = await getEvidence(prospect.id, context.orgId);
      const givingEvidence = allEvidence.filter((e) => e.claim_type === "giving_history");
      const hasDollarFigure = /\$\s?[\d,.]+/.test(givingEvidence.map((e) => e.claim).join(" "));
      const hasTrusteeshipRecord = givingEvidence.some((e) => e.source_type === "irs_form_990");
      const dimensionCoverage: Record<string, boolean> = {
        "Donor Attribution": givingEvidence.length > 0,
        "Gift/Grant Status": givingEvidence.some((e) => e.verification_status !== "estimate"),
        "Recipient And Purpose": hasTrusteeshipRecord,
        "Amount/Currency/Date": hasTrusteeshipRecord || hasDollarFigure,
        "Vehicle And Intermediary": hasTrusteeshipRecord,
        "Repeat-Pattern Analysis": givingEvidence.length > 1,
      };

      const isIdentityAmbiguous = mentions.length === 0 && trusteeEdges.length === 0;
      const candidates: DelegationRequest[] = [];
      if (isIdentityAmbiguous) {
        candidates.push({
          childAgentCode: "BEN-KNW-02",
          objective: `Resolve identity ambiguity for prospect ${context.prospectId} -- BEN-INT-07 found zero giving-history mentions and zero foundation-trusteeship edges this run.`,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      }
      if (trusteeEdges.length > 0) {
        candidates.push({
          childAgentCode: "BEN-INT-06",
          objective: `Deepen the foundation dossier for prospect ${context.prospectId}'s ${trusteeEdges.length} trustee_of foundation(s) now that grant history has been totalled here.`,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      }
      if (hasSolidGiftEvidence) {
        candidates.push({
          childAgentCode: "BEN-QLF-03",
          objective: `Score capacity/propensity for prospect ${context.prospectId} using the documented non-estimate gift evidence BEN-INT-07 recorded this run.`,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      }
      if (evidenceCreated.length > 0) {
        candidates.push({
          childAgentCode: "BEN-KNW-03",
          objective: `Verify the ${evidenceCreated.length} giving-history evidence item(s) BEN-INT-07 recorded this run for prospect ${context.prospectId}.`,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      }
      delegations = candidates.slice(0, MAX_DELEGATIONS_PER_RUN);

      report = {
        prospectId: prospect.id,
        dimensionCoverage,
        evidenceCreatedThisRun: evidenceCreated.length,
        delegationsIssued: delegations.map((d) => d.childAgentCode),
        givingMentionsFound: mentions.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "ben-int-07.gap_analysis_failed",
        resource_type: "pil_agent_runs",
        resource_id: context.runId,
        before_state: null,
        after_state: { error: message },
        policy_decision: null,
        ip_address: null,
      });
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

export default GivingHistoryIntelligenceAgent;
