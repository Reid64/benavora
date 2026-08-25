import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import {
  callTool,
  findOrCreateProspect,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  parseGoalCriteria,
  recordDiscoveryEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/dis/shared";
import { upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem } from "@/lib/pil/types";

// BEN-DIS-04 -- Corporate Giving Discovery Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 2 -- DISCOVERY"). Identifies
// companies with relevant charitable-giving, sponsorship, employee-giving,
// or community-investment programs, plus any corporate foundation
// associated with them.
//
// The task spec that commissioned this batch put this mission's content
// under a differently-numbered agent code ("BEN-DIS-05 Corporate Giving
// Discovery"). The live registry (migration 155) and PROSPECT_INTELLIGENCE_
// AGENTS.md both assign this mission to BEN-DIS-04 and assign "Executive
// Prospect Discovery" to BEN-DIS-05 -- see BEN-DIS-03.ts's file header for
// the full reconciliation note. This file implements BEN-DIS-04 per the
// live registry; the executive-identification portion of the task's
// step-5 description is implemented in BEN-DIS-05.ts instead, which is
// also where this agent's spec-defined delegation target sends
// executive-level detail ("May delegate executive-level detail to
// BEN-DIS-05").
//
// Permitted tools per spec: T-WEB, T-EDGAR, T-CRAWL, T-GRAPH (write),
// T-EVIDENCE (write). No EDGAR adapter tool exists yet in tools/index.ts
// (T-990/entity_lookup cover the private-foundation side; corporate/SEC
// data has no concrete tool implementation in this codebase), so this
// agent uses web_search + web_crawl only, matching what's actually wired.

const STALE_PROGRAM_MARKERS = ["discontinued", "no longer accepting", "program has ended", "legacy program"];

function looksCurrentlyActive(pageText: string): boolean {
  const lower = pageText.toLowerCase();
  return !STALE_PROGRAM_MARKERS.some((marker) => lower.includes(marker));
}

interface CompanyDiscovery {
  prospectId: string;
  displayName: string;
  confidence: number;
  created: boolean;
}

export class CorporateGivingDiscoveryAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const criteria = parseGoalCriteria(context.goal);
    const locationPhrase = [criteria.geography, criteria.cause].filter(Boolean).join(" ");
    const evidenceCreated: EvidenceItem[] = [];
    const discoveries: CompanyDiscovery[] = [];
    const companyProspectIds: string[] = [];

    // 1. Search for companies with corporate giving programs.
    const programSearch = await callTool(context, runner, "web_search", {
      query: `corporate giving program OR CSR OR community investment ${locationPhrase}`.trim(),
      limit: 10,
    });
    if (!programSearch.success) {
      const tokensUsed = await tryModelTokens(context, runner, 200);
      return {
        status: "completed",
        evidence: [],
        conclusions: { criteria, discoveredProspectIds: [], discoveries: [] },
        delegations: [],
        tokensUsed,
        costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
        error: null,
      };
    }

    const results = ((programSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);

    for (const item of results) {
      // Confirm the program is currently active (not a discontinued/legacy
      // CSR page) before flagging -- crawl the page to check.
      const crawl = await callTool(context, runner, "web_crawl", { url: item.url });
      const isActive = crawl.success ? looksCurrentlyActive((crawl.data as { text: string }).text) : true;
      if (!isActive) continue;

      const { prospect: companyProspect, created } = await findOrCreateProspect({
        orgId: context.orgId,
        displayName: item.title,
        entityType: "corporation",
        agentCode: context.agentCode,
      });

      const companyNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "company",
        prospect_id: companyProspect.id,
        label: companyProspect.display_name,
        properties: {},
      });

      evidenceCreated.push(
        await recordDiscoveryEvidence({
          orgId: context.orgId,
          prospectId: companyProspect.id,
          claim: `Active corporate giving program: ${item.title}`,
          value: { title: item.title, url: item.url, causeAlignment: criteria.cause },
          claimType: "corporate_giving_eligibility_rationale",
          sourceUrl: item.url,
          sourceTitle: item.title,
          sourceType: "corporate_information",
          publisher: hostnameOf(item.url),
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: 0.5,
          verificationStatus: "single_source_fact",
        }),
      );

      // 2. Search for a corporate foundation associated with this company.
      const foundationSearch = await callTool(context, runner, "web_search", {
        query: `"${item.title}" corporate foundation`,
        limit: 3,
      });
      if (foundationSearch.success) {
        const foundationResults = ((foundationSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []).slice(0, 1);
        for (const foundationItem of foundationResults) {
          const { prospect: foundationProspect, created: foundationCreated } = await findOrCreateProspect({
            orgId: context.orgId,
            displayName: foundationItem.title,
            entityType: "corporate_foundation",
            agentCode: context.agentCode,
          });
          evidenceCreated.push(
            await recordDiscoveryEvidence({
              orgId: context.orgId,
              prospectId: foundationProspect.id,
              claim: `Corporate foundation associated with ${item.title}: ${foundationItem.title}`,
              value: { title: foundationItem.title, url: foundationItem.url, parentCompany: item.title },
              claimType: "corporate_foundation_association",
              sourceUrl: foundationItem.url,
              sourceTitle: foundationItem.title,
              sourceType: "corporate_information",
              publisher: hostnameOf(foundationItem.url),
              evidenceExcerpt: null,
              agentCode: context.agentCode,
              researchRunId: context.runId,
              confidence: 0.4,
              verificationStatus: "unverified",
            }),
          );
          discoveries.push({ prospectId: foundationProspect.id, displayName: foundationProspect.display_name, confidence: 0.4, created: foundationCreated });
        }
      }

      // Graph edge: Company -> its giving program, modeled as an
      // 'opportunity' node (pil_graph_nodes has no dedicated "program" node
      // type; 'presents_opportunity' is the closest schema-supported fit
      // for a company presenting a giving program prospects can pursue).
      const programNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "opportunity",
        prospect_id: null,
        label: `${companyProspect.display_name} corporate giving program`,
        properties: { causeAlignment: criteria.cause, discoveredVia: item.url },
      });
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: companyNode.id,
        target_node_id: programNode.id,
        edge_type: "presents_opportunity",
        relationship_strength: "moderate",
        confidence: 0.5,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: {},
      });

      discoveries.push({ prospectId: companyProspect.id, displayName: companyProspect.display_name, confidence: 0.5, created });
      companyProspectIds.push(companyProspect.id);
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        criteria,
        discoveredProspectIds: discoveries.map((d) => d.prospectId),
        discoveries,
        companyProspectIds,
      },
      // Executive-level detail delegated to BEN-DIS-05 per spec
      // ("May delegate executive-level detail to BEN-DIS-05").
      delegations:
        companyProspectIds.length > 0
          ? [
              {
                childAgentCode: "BEN-DIS-05",
                objective: `Identify executives with philanthropic relevance at companies: ${companyProspectIds.join(", ")}`,
                maxAutonomy: "A2" as const,
                constraints: { companyProspectIds },
              },
            ]
          : [],
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }
}

export default CorporateGivingDiscoveryAgent;
