import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import {
  callTool,
  extractCityState,
  extractSummaryNear,
  getProspectById,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  recordIntelligenceEvidence,
  tryModelTokens,
  upsertProspectNode,
} from "@/lib/pil/agents/int/shared";
import type { EvidenceItem } from "@/lib/pil/types";

// BEN-INT-01 -- Individual Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3 -- CORE PROSPECT INTELLIGENCE").
// Builds the canonical evidence-backed biographical profile for an
// individual prospect: identity, geography, career summary, biography.
// Permitted tools per spec: T-WEB, T-CRAWL, T-NEWS, T-EVIDENCE (write),
// T-GRAPH (write). Concrete registry keys: web_search, web_crawl,
// news_search.

export class IndividualIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-01 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }
    if (prospect.entity_type !== "individual") {
      return this.completedEmpty(`Prospect ${prospect.id} is entity_type=${prospect.entity_type}, not individual -- skipping`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    await upsertProspectNode(context.orgId, prospect, "person");

    // 1. Public profile page: web_search then crawl the top result for
    // location + a professional-summary excerpt (no readable snippet exists
    // on web_search results -- see tools/web-search.ts -- so a crawl is
    // required to get body text).
    const profileSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" biography OR profile OR "about"`,
      limit: 5,
    });
    if (profileSearch.success) {
      const results = ((profileSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      const top = results[0];
      if (top) {
        const crawl = await callTool(context, runner, "web_crawl", { url: top.url });
        if (crawl.success) {
          const { text, title } = crawl.data as { text: string; title: string };
          const location = extractCityState(text);
          const summary = extractSummaryNear(text, prospect.display_name);

          evidenceCreated.push(
            await recordIntelligenceEvidence({
              orgId: context.orgId,
              prospectId: prospect.id,
              claim: `Verified name from public profile page: ${title || top.url}`,
              value: { name: prospect.display_name, pageUrl: top.url, pageTitle: title },
              claimType: "biographical",
              sourceUrl: top.url,
              sourceTitle: title || null,
              sourceType: "open_web",
              publisher: hostnameOf(top.url),
              evidenceExcerpt: null,
              agentCode: context.agentCode,
              researchRunId: context.runId,
              confidence: 0.5,
              verificationStatus: "single_source_fact",
            }),
          );

          if (location) {
            evidenceCreated.push(
              await recordIntelligenceEvidence({
                orgId: context.orgId,
                prospectId: prospect.id,
                claim: `Location: ${location}`,
                value: { location },
                claimType: "biographical",
                sourceUrl: top.url,
                sourceTitle: title || null,
                sourceType: "open_web",
                publisher: hostnameOf(top.url),
                evidenceExcerpt: location,
                agentCode: context.agentCode,
                researchRunId: context.runId,
                confidence: 0.4,
                verificationStatus: "single_source_fact",
              }),
            );
          }

          if (summary) {
            evidenceCreated.push(
              await recordIntelligenceEvidence({
                orgId: context.orgId,
                prospectId: prospect.id,
                claim: `Professional summary excerpt from ${title || top.url}`,
                value: { summary },
                claimType: "biographical",
                sourceUrl: top.url,
                sourceTitle: title || null,
                sourceType: "open_web",
                publisher: hostnameOf(top.url),
                evidenceExcerpt: summary,
                agentCode: context.agentCode,
                researchRunId: context.runId,
                confidence: 0.45,
                verificationStatus: "single_source_fact",
              }),
            );
          }
        }
      }
    }

    // 2. News mentions -- corroborating (or contradicting) biographical
    // signal, per spec's "checks whether newly retrieved facts corroborate
    // or contradict existing pil_evidence" observation behavior.
    const newsResult = await callTool(context, runner, "news_search", {
      query: `"${prospect.display_name}"`,
      limit: 5,
    });
    if (newsResult.success) {
      const results = ((newsResult.data as { results?: Array<{ title: string; url: string; publishedAt: string | null; source: string }> } | null)?.results ?? []);
      for (const item of results) {
        evidenceCreated.push(
          await recordIntelligenceEvidence({
            orgId: context.orgId,
            prospectId: prospect.id,
            claim: `News mention: ${item.title}`,
            value: { title: item.title, url: item.url, publishedAt: item.publishedAt },
            claimType: "biographical",
            sourceUrl: item.url,
            sourceTitle: item.title,
            sourceType: "news",
            publisher: item.source || hostnameOf(item.url),
            evidenceExcerpt: null,
            agentCode: context.agentCode,
            researchRunId: context.runId,
            confidence: 0.4,
            verificationStatus: "single_source_fact",
          }),
        );
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 400);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: { prospectId: prospect.id, evidenceCount: evidenceCreated.length },
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

export default IndividualIntelligenceAgent;
