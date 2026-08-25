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

// BEN-INT-05 -- Nonprofit Board Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3"). Identifies and verifies
// nonprofit board/trustee/officer memberships -- "one of the highest-signal
// indicators of philanthropic engagement" per the task spec that
// commissioned this batch.
//
// The task spec labeled this code "Education Intelligence" and put
// "Nonprofit Board Intelligence" at BEN-INT-06 -- the live registry has the
// reverse (BEN-INT-05 = Nonprofit Board, BEN-INT-06 = Foundation
// Intelligence; PROSPECT_INTELLIGENCE_AGENTS.md line ~476). Per this
// codebase's established pattern of trusting registry/spec state over a
// colliding task-given description, this file implements the real
// BEN-INT-05.
//
// Permitted tools per spec: T-WEB, T-990, T-EVIDENCE (write), T-GRAPH
// (write). Spec's source-authority ordering: nonprofit website -> Form 990
// -> official biography -> other filing, falling back to general web search
// only once exhausted. entity_lookup (foundation_directory-backed) is the
// closest available EIN resolver for a web-discovered org name, so it
// stands in for "check the 990" before accepting a lower-authority mention.

interface BoardMention {
  orgName: string;
  sourceUrl: string;
  sourceTitle: string | null;
}

export class NonprofitBoardIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-05 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const personNode = await upsertProspectNode(context.orgId, prospect, "person");
    const mentions: BoardMention[] = [];

    const boardSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" board of directors OR trustee OR "board member" nonprofit`,
      limit: 6,
    });
    if (boardSearch.success) {
      const results = ((boardSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 4)) {
        mentions.push({ orgName: item.title, sourceUrl: item.url, sourceTitle: item.title });
      }
    }

    for (const mention of mentions) {
      // Try to resolve the org against foundation_directory (entity_lookup)
      // to get an EIN, then cross-check the 990's officer list -- the
      // highest-authority source available per spec ordering.
      let sourceType = "open_web";
      let confidence = 0.35;
      let verificationStatus: "unverified" | "single_source_fact" | "corroborated_fact" = "unverified";
      let filingYear: number | null = null;

      const lookup = await callTool(context, runner, "entity_lookup", { name: mention.orgName, type: "foundation" });
      if (lookup.success) {
        const matches = ((lookup.data as { matches?: Array<{ source: string; ein: string | null; confidence: number }> } | null)?.matches ?? []);
        const best = matches.find((m) => m.source === "foundation_directory" && m.ein);
        if (best?.ein) {
          const nineNinety = await callTool(context, runner, "irs_990_lookup", { ein: best.ein });
          if (nineNinety.success) {
            const data = nineNinety.data as { officers: Array<{ name: string | null }>; filing_year: number | null };
            filingYear = data.filing_year;
            const nameOnFiling = data.officers.some(
              (o) => (o.name ?? "").toLowerCase().includes(prospect.display_name.toLowerCase()),
            );
            sourceType = "irs_form_990";
            confidence = nameOnFiling ? 0.85 : 0.5;
            verificationStatus = nameOnFiling ? "corroborated_fact" : "single_source_fact";
          }
        }
      }

      const evidence = await recordIntelligenceEvidence({
        orgId: context.orgId,
        prospectId: prospect.id,
        claim: `Nonprofit board/trustee mention: ${mention.orgName}${filingYear ? ` (990 filing year ${filingYear})` : ""}`,
        value: { organization: mention.orgName, url: mention.sourceUrl, filingYear },
        claimType: "nonprofit_board",
        sourceUrl: sourceType === "open_web" ? mention.sourceUrl : null,
        sourceTitle: mention.sourceTitle,
        sourceType,
        publisher: sourceType === "open_web" ? hostnameOf(mention.sourceUrl) : "IRS Form 990",
        evidenceExcerpt: null,
        agentCode: context.agentCode,
        researchRunId: context.runId,
        confidence,
        verificationStatus,
      });
      evidenceCreated.push(evidence);

      const orgNode = await upsertCounterpartyNode(context.orgId, "nonprofit", mention.orgName, {});
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: personNode.id,
        target_node_id: orgNode.id,
        edge_type: "serves_on_board_of",
        relationship_strength: sourceType === "irs_form_990" ? "strong" : "weak",
        confidence,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: { sourceType },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 400);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: { prospectId: prospect.id, boardMentionsFound: mentions.length },
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

export default NonprofitBoardIntelligenceAgent;
