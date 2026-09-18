import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  extractCityState,
  extractSummaryNear,
  getProspectById,
  hostnameOf,
  MAX_DELEGATIONS_PER_RUN,
  recordIntelligenceEvidence,
  tryModelTokens,
  upsertProspectNode,
} from "@/lib/pil/agents/int/shared";
import { logAction } from "@/lib/pil/audit";
import { getEvidence } from "@/lib/pil/evidence";
import { getEdges } from "@/lib/pil/graph";
import type { EvidenceItem } from "@/lib/pil/types";
import { serializePilError } from "@/lib/pil/serialize-error";

// Six domain dimensions this agent's report scores coverage across, per
// PIL_AGENT_COMPLETE_ROSTER.md's "Core Intelligence" BEN_INT_01Decision.v1
// contract. Coverage is computed from persisted pil_evidence/pil_graph_edges
// state (getEvidence/getEdges), not just evidence created this run, matching
// BEN-INT-08's own established getEvidence(prospect.id, context.orgId)
// pattern for reading the full existing dossier.
const INTELLIGENCE_DIMENSIONS = [
  "Identity Hypotheses And Discriminators",
  "Biographical And Role Chronology",
  "Geographic Relevance",
  "Documented Affiliations",
  "Public Philanthropic Observations",
  "Research Gaps And Contradictions",
] as const;

export interface IndividualIntelligenceReport {
  prospectId: string;
  dimensionCoverage: Record<string, boolean>;
  evidenceCreatedThisRun: number;
  delegationsIssued: string[];
}

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
    const personNode = await upsertProspectNode(context.orgId, prospect, "person");

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

    // Everything below is secondary reasoning layered on top of the
    // evidence-gathering above, which has already durably committed via
    // individually atomic recordIntelligenceEvidence()/upsertProspectNode()
    // calls. A bug here must never discard that already-collected evidence
    // or fail this run -- recovery starts from persisted truth, and captured
    // evidence stays immutable regardless of what happens next.
    let report: IndividualIntelligenceReport = {
      prospectId: prospect.id,
      dimensionCoverage: Object.fromEntries(INTELLIGENCE_DIMENSIONS.map((d) => [d, false])),
      evidenceCreatedThisRun: evidenceCreated.length,
      delegationsIssued: [],
    };
    let delegations: DelegationRequest[] = [];

    try {
      const allEvidence = await getEvidence(prospect.id, context.orgId);
      const personEdges = personNode ? await getEdges(personNode.id) : [];

      const hasEmployment = allEvidence.some((e) => e.claim_type === "employment");
      const hasEducation = allEvidence.some((e) => e.claim_type === "education");
      const hasBoard = allEvidence.some((e) => e.claim_type === "nonprofit_board");
      const hasGiving = allEvidence.some((e) => e.claim_type === "giving_history");
      const hasWealth = allEvidence.some((e) => e.claim_type === "wealth_capacity");
      // Phase 5.4 (2026-09-15): BEN-INT-10 (Contact Intelligence) was fully
      // built but had no gap-check delegating into it -- every other
      // dimension BEN-SUP-02's DIMENSION_AGENT map assigns to an INT agent
      // (employment/education/board/giving/wealth) already had one here.
      const hasContactInfo = allEvidence.some((e) => e.claim_type === "contact");
      const hasRelationshipEdges = personEdges.length > 0;

      const dimensionCoverage: Record<string, boolean> = {
        "Identity Hypotheses And Discriminators": allEvidence.some(
          (e) => e.claim_type === "biographical" && /verified name/i.test(e.claim),
        ),
        "Biographical And Role Chronology":
          hasEmployment ||
          hasEducation ||
          allEvidence.some((e) => e.claim_type === "biographical" && /professional summary/i.test(e.claim)),
        "Geographic Relevance": allEvidence.some((e) => e.claim_type === "biographical" && /^Location:/.test(e.claim)),
        "Documented Affiliations": hasBoard || hasRelationshipEdges,
        "Public Philanthropic Observations":
          hasGiving || allEvidence.some((e) => e.claim_type === "biographical" && /^News mention:/.test(e.claim)),
        "Research Gaps And Contradictions": allEvidence.some(
          (e) => e.verification_status === "contradicted" || e.contradiction_status !== "none",
        ),
      };

      // Identity-ambiguity trigger: this run found nothing new AND no prior
      // evidence exists at all for this prospect -- genuinely no identity
      // signal to build a dossier on.
      const identityAmbiguous = evidenceCreated.length === 0 && allEvidence.length === 0;
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

      // Priority order per the roster's BEN-INT-01 delegation list -- stop
      // once MAX_DELEGATIONS_PER_RUN candidates are collected, even if a
      // lower-priority condition below also holds.
      if (identityAmbiguous) {
        pushCandidate(
          "BEN-KNW-02",
          `Prospect ${context.prospectId} has zero new or existing evidence after this BEN-INT-01 run -- resolve identity ambiguity before further intelligence gathering.`,
        );
      }
      if (!hasEmployment) {
        pushCandidate(
          "BEN-INT-02",
          `Prospect ${context.prospectId} has no employment/career evidence on file -- research employment history.`,
        );
      }
      if (!hasEducation) {
        pushCandidate(
          "BEN-INT-04",
          `Prospect ${context.prospectId} has no education/alumni evidence on file -- research education history.`,
        );
      }
      if (!hasBoard) {
        pushCandidate(
          "BEN-INT-05",
          `Prospect ${context.prospectId} has no nonprofit board affiliation evidence on file -- research board involvement.`,
        );
      }
      if (!hasGiving) {
        pushCandidate(
          "BEN-INT-07",
          `Prospect ${context.prospectId} has no giving-history evidence on file -- research philanthropic giving history.`,
        );
      }
      if (!hasWealth) {
        pushCandidate(
          "BEN-INT-08",
          `Prospect ${context.prospectId} has no wealth/capacity evidence on file -- research wealth and giving capacity.`,
        );
      }
      if (!hasContactInfo) {
        pushCandidate(
          "BEN-INT-10",
          `Prospect ${context.prospectId} has no contact-channel evidence on file -- identify permissible contact pathways.`,
        );
      }
      if (!hasRelationshipEdges) {
        pushCandidate(
          "BEN-REL-01",
          `Prospect ${context.prospectId} has no relationship graph edges on file -- discover relationships.`,
        );
      }
      if (needsEvidenceVerification) {
        pushCandidate(
          "BEN-KNW-03",
          `BEN-INT-01 recorded ${evidenceCreated.length} new evidence item(s) for prospect ${context.prospectId} this run -- verify provenance before treating as authoritative.`,
        );
      }

      delegations = candidates.slice(0, MAX_DELEGATIONS_PER_RUN);

      report = {
        prospectId: prospect.id,
        dimensionCoverage,
        evidenceCreatedThisRun: evidenceCreated.length,
        delegationsIssued: delegations.map((d) => d.childAgentCode),
      };
    } catch (err) {
      const message = serializePilError(err);
      try {
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "ben-int-01.gap_analysis_failed",
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
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts (called inside tryModelTokens); recording it again here would double-count the same tokens.
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
