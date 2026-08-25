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

// BEN-INT-04 -- Education & Alumni Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3"). Researches educational
// affiliations, treated as a relationship-discovery input first and a
// biography-completeness input second (spec's planning behavior).
//
// The task spec that commissioned this batch labeled this code "Executive
// Intelligence" -- the live registry has no such agent at BEN-INT-04; that
// code is "Education & Alumni Intelligence Agent"
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~455). Per this codebase's
// established pattern of trusting registry/spec state over a colliding
// task-given description (see agents/dis/BEN-DIS-03.ts's file header for
// the same situation), this file implements the real BEN-INT-04.
//
// Permitted tools per spec: T-WEB, T-CRAWL, T-EVIDENCE (write), T-GRAPH
// (write). GraphNodeType has no dedicated "university"/"institution" value
// (types.ts) -- higher-ed institutions are themselves 501(c)(3) nonprofits,
// so node_type='nonprofit' is the closest existing fit, matching how
// BEN-DIS-03 reuses existing node types for entities without a bespoke one.

interface EducationMention {
  institutionName: string;
  sourceUrl: string;
  sourceTitle: string | null;
  excerpt: string | null;
}

const DEGREE_PATTERN = /\b(B\.?A\.?|B\.?S\.?|M\.?A\.?|M\.?B\.?A\.?|M\.?S\.?|J\.?D\.?|Ph\.?D\.?)\b/i;
const GRAD_YEAR_PATTERN = /\b(19|20)\d{2}\b/;

export class EducationAlumniIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-04 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const personNode = await upsertProspectNode(context.orgId, prospect, "person");
    const mentions: EducationMention[] = [];

    const eduSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" university OR college OR alumnus OR graduated OR degree`,
      limit: 5,
    });
    if (eduSearch.success) {
      const results = ((eduSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 3)) {
        mentions.push({ institutionName: item.title, sourceUrl: item.url, sourceTitle: item.title, excerpt: null });
      }
    }

    for (const mention of mentions) {
      // LinkedIn-style profile crawl for a degree/graduation-year excerpt.
      const crawl = await callTool(context, runner, "web_crawl", { url: mention.sourceUrl });
      let excerpt: string | null = null;
      let degree: string | null = null;
      let gradYear: string | null = null;
      if (crawl.success) {
        const { text } = crawl.data as { text: string };
        excerpt = text.slice(0, 300);
        degree = text.match(DEGREE_PATTERN)?.[0] ?? null;
        gradYear = text.match(GRAD_YEAR_PATTERN)?.[0] ?? null;
      }

      const evidence = await recordIntelligenceEvidence({
        orgId: context.orgId,
        prospectId: prospect.id,
        claim: `Education affiliation mention: ${mention.institutionName}${degree ? ` (${degree})` : ""}${gradYear ? `, ${gradYear}` : ""}`,
        value: { institution: mention.institutionName, degree, graduationYear: gradYear, url: mention.sourceUrl },
        claimType: "education",
        sourceUrl: mention.sourceUrl,
        sourceTitle: mention.sourceTitle,
        sourceType: "open_web",
        publisher: hostnameOf(mention.sourceUrl),
        evidenceExcerpt: excerpt,
        agentCode: context.agentCode,
        researchRunId: context.runId,
        confidence: 0.4,
        verificationStatus: "single_source_fact",
      });
      evidenceCreated.push(evidence);

      const institutionNode = await upsertCounterpartyNode(context.orgId, "nonprofit", mention.institutionName, {
        institutionKind: "education",
      });
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: personNode.id,
        target_node_id: institutionNode.id,
        edge_type: "related_to",
        relationship_strength: "moderate",
        confidence: 0.4,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: { relationship: "alumnus_of", degree, graduationYear: gradYear },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 300);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: { prospectId: prospect.id, educationMentionsFound: mentions.length },
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

export default EducationAlumniIntelligenceAgent;
