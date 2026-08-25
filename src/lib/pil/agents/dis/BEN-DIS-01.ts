import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import {
  callTool,
  extractCandidateNames,
  findOrCreateProspect,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  parseGoalCriteria,
  recordDiscoveryEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/dis/shared";
import type { EvidenceItem } from "@/lib/pil/types";

// BEN-DIS-01 -- Individual Prospect Discovery Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 2 -- DISCOVERY"). Discovers
// individual philanthropic prospects for a tenant's fundraising objective.
// Output is a ranked candidate list with preliminary evidence, never a full
// dossier -- that is Family 3's job (BEN-INT-01 etc).
//
// Permitted tools per the spec: T-WEB, T-CRAWL, T-NEWS, T-GRAPH (write: new
// nodes only), T-EVIDENCE (write), T-MODEL. The task spec for this batch
// names the concrete tool registry keys directly: web_search, web_crawl,
// news_search, entity_lookup.

interface Discovery {
  prospectId: string;
  displayName: string;
  confidence: number;
  created: boolean;
}

export class IndividualProspectDiscoveryAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const criteria = parseGoalCriteria(context.goal);
    const locationPhrase = [criteria.geography, criteria.cause].filter(Boolean).join(" ");

    const discoveries: Discovery[] = [];
    const evidenceCreated: EvidenceItem[] = [];

    // 1/2. Search news for philanthropic announcements.
    const newsResult = await callTool(context, runner, "news_search", {
      query: `philanthropic gift announcement ${locationPhrase}`.trim(),
      limit: 10,
    });
    if (newsResult.success) {
      const results = ((newsResult.data as { results?: Array<{ title: string; url: string; publishedAt: string | null; source: string }> } | null)?.results ?? []);
      for (const item of results) {
        const { prospect, created } = await findOrCreateProspect({
          orgId: context.orgId,
          displayName: item.title,
          entityType: "individual",
          agentCode: context.agentCode,
        });
        const evidence = await recordDiscoveryEvidence({
          orgId: context.orgId,
          prospectId: prospect.id,
          claim: `Philanthropic announcement mention: ${item.title}`,
          value: { title: item.title, url: item.url, publishedAt: item.publishedAt },
          claimType: "philanthropic_announcement",
          sourceUrl: item.url,
          sourceTitle: item.title,
          sourceType: "news",
          publisher: item.source || hostnameOf(item.url),
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: 0.45,
          verificationStatus: "single_source_fact",
        });
        evidenceCreated.push(evidence);
        discoveries.push({ prospectId: prospect.id, displayName: prospect.display_name, confidence: 0.45, created });
      }
    }

    // 3. Search the web for donor lists, nonprofit board member lists,
    // foundation trustees; crawl the top result for a heuristic name pull
    // (web_search alone carries no readable snippet text -- see
    // tools/web-search.ts -- so web_crawl is what actually surfaces names).
    const webResult = await callTool(context, runner, "web_search", {
      query: `donor list OR nonprofit board members OR foundation trustees ${locationPhrase}`.trim(),
      limit: 10,
    });
    if (webResult.success) {
      const results = ((webResult.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      const topUrl = results[0]?.url;
      if (topUrl) {
        const crawlResult = await callTool(context, runner, "web_crawl", { url: topUrl });
        if (crawlResult.success) {
          const { text, title } = crawlResult.data as { text: string; title: string };
          const candidateNames = extractCandidateNames(text, 5);
          for (const candidateName of candidateNames) {
            const { prospect, created } = await findOrCreateProspect({
              orgId: context.orgId,
              displayName: candidateName,
              entityType: "individual",
              agentCode: context.agentCode,
            });
            const evidence = await recordDiscoveryEvidence({
              orgId: context.orgId,
              prospectId: prospect.id,
              claim: `Named on a donor/board/trustee list page: ${title || topUrl}`,
              value: { candidateName, pageUrl: topUrl, pageTitle: title },
              claimType: "board_or_donor_list_mention",
              sourceUrl: topUrl,
              sourceTitle: title || null,
              sourceType: "open_web",
              publisher: hostnameOf(topUrl),
              evidenceExcerpt: null,
              agentCode: context.agentCode,
              researchRunId: context.runId,
              confidence: 0.35,
              verificationStatus: "unverified",
            });
            evidenceCreated.push(evidence);
            discoveries.push({ prospectId: prospect.id, displayName: prospect.display_name, confidence: 0.35, created });
          }
        }
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 400);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        criteria,
        discoveredProspectIds: discoveries.map((d) => d.prospectId),
        discoveries,
      },
      delegations: [],
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }
}

export default IndividualProspectDiscoveryAgent;
