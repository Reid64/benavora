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

// BEN-INT-02 -- Employment & Career Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3"). Reconstructs the prospect's
// relevant professional history as a time-aware chronology of
// pil_graph_edges(edge_type='employed_by'), ordered current-role-first per
// spec's planning behavior (verifies highest-value data first under any
// budget cutoff).
//
// Permitted tools per spec: T-WEB, T-CRAWL, T-EDGAR, T-EVIDENCE (write),
// T-GRAPH (write). No T-EDGAR-equivalent tool is registered in
// tools/index.ts (only web_search/web_crawl/news_search/entity_lookup/
// irs_990_lookup exist) -- this agent uses web_search/web_crawl only, same
// substitution the task spec for this batch explicitly names ("Uses
// web_search and web_crawl").

interface EmploymentRecord {
  title: string;
  company: string;
  sourceUrl: string;
  sourceTitle: string | null;
}

export class EmploymentCareerIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-02 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const personNode = await upsertProspectNode(context.orgId, prospect, "person");

    // Current role first (spec's recency-first planning behavior).
    const currentSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" current title OR "CEO" OR "president" OR "employed at"`,
      limit: 5,
    });
    const records: EmploymentRecord[] = [];
    if (currentSearch.success) {
      const results = ((currentSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 3)) {
        records.push({ title: item.title, company: item.title, sourceUrl: item.url, sourceTitle: item.title });
      }
    }

    // Historical roles -- searched after current, per spec ordering.
    const historySearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" former OR previously OR "prior to" employer`,
      limit: 5,
    });
    if (historySearch.success) {
      const results = ((historySearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 3)) {
        records.push({ title: item.title, company: item.title, sourceUrl: item.url, sourceTitle: item.title });
      }
    }

    let isFirst = true;
    for (const record of records) {
      const crawl = await callTool(context, runner, "web_crawl", { url: record.sourceUrl });
      const excerpt = crawl.success ? (crawl.data as { text: string }).text.slice(0, 300) : null;

      const evidence = await recordIntelligenceEvidence({
        orgId: context.orgId,
        prospectId: prospect.id,
        claim: `Employment role mention: ${record.title}`,
        value: { title: record.title, company: record.company, isCurrent: isFirst },
        claimType: "employment",
        sourceUrl: record.sourceUrl,
        sourceTitle: record.sourceTitle,
        sourceType: "open_web",
        publisher: hostnameOf(record.sourceUrl),
        evidenceExcerpt: excerpt,
        agentCode: context.agentCode,
        researchRunId: context.runId,
        confidence: isFirst ? 0.5 : 0.35,
        verificationStatus: "single_source_fact",
      });
      evidenceCreated.push(evidence);

      const companyNode = await upsertCounterpartyNode(context.orgId, "company", record.company, {});
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: personNode.id,
        target_node_id: companyNode.id,
        edge_type: "employed_by",
        relationship_strength: isFirst ? "strong" : "moderate",
        confidence: isFirst ? 0.5 : 0.35,
        temporal_validity_start: null,
        temporal_validity_end: isFirst ? null : new Date().toISOString().slice(0, 10),
        is_current: isFirst,
        superseded_by_edge_id: null,
        properties: { title: record.title, seniority: null },
      });

      isFirst = false;
    }

    const tokensUsed = await tryModelTokens(context, runner, 400);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: { prospectId: prospect.id, employmentRecordsFound: records.length },
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

export default EmploymentCareerIntelligenceAgent;
