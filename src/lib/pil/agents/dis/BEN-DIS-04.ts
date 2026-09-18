import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { logAction } from "@/lib/pil/audit";
import {
  callTool,
  findOrCreateProspect,
  hostnameOf,
  normalizeName,
  parseGoalCriteria,
  recordDiscoveryEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/dis/shared";
import { upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem } from "@/lib/pil/types";
import { serializePilError } from "@/lib/pil/serialize-error";

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

// CorporateGivingMechanism.v1 keyword classifier, checked in this order so
// the most specific mechanism (e.g. "matching gift") wins over a broader
// fallback (e.g. "foundation") when a title matches more than one.
const GIVING_MECHANISM_KEYWORDS: Array<[string[], string]> = [
  [["matching gift", "matching program"], "employee_matching"],
  [["volunteer grant"], "employee_volunteer_grant"],
  [["workplace giving"], "workplace_giving"],
  [["sponsorship"], "sponsorship"],
  [["in-kind"], "in_kind"],
  [["disaster"], "disaster_response"],
  [["cause marketing", "cause-marketing"], "cause_marketing"],
  [["partnership"], "nonprofit_partnership"],
  [["local", "store", "facility"], "local_facility_giving"],
  [["foundation"], "corporate_foundation_grant"],
];

function classifyGivingMechanism(text: string): string {
  const lower = text.toLowerCase();
  for (const [keywords, mechanism] of GIVING_MECHANISM_KEYWORDS) {
    if (keywords.some((keyword) => lower.includes(keyword))) return mechanism;
  }
  return "direct_corporate_contribution";
}

interface CompanyDiscovery {
  prospectId: string;
  displayName: string;
  confidence: number;
  created: boolean;
}

export class CorporateGivingDiscoveryAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    // p5.2b (2026-09-15): every sibling DIS agent (01/02/03/05/06/07) returns
    // early on an empty goal; this file was missing that guard. Impact was
    // low (parseGoalCriteria degrades harmlessly on ""), but adding it for
    // consistency and to avoid an unnecessary web_search call on a request
    // with nothing to search for.
    if (context.goal.trim().length === 0) {
      return {
        status: "completed",
        evidence: [],
        conclusions: { skipped: true, reason: "BEN-DIS-04 requires a non-empty goal" },
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: null,
      };
    }

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
        costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts (called inside tryModelTokens); recording it again here would double-count the same tokens.
        error: null,
      };
    }

    const results = ((programSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);

    // Corporate-control ambiguity heuristic (roster dependency [BEN-KNW-02,
    // BEN-INT-03]): 2+ program-search results whose titles share the same
    // normalized first-two-word prefix (e.g. "Example Corp Foundation" vs
    // "Example Corp Community Fund") likely name the same corporate parent
    // under different giving-program brands -- every company in such a group
    // is control-ambiguous until identity/ownership is resolved downstream.
    const prefixCounts = new Map<string, number>();
    for (const item of results) {
      const prefixKey = normalizeName(item.title).split(" ").slice(0, 2).join(" ");
      if (!prefixKey) continue;
      prefixCounts.set(prefixKey, (prefixCounts.get(prefixKey) ?? 0) + 1);
    }
    const ambiguousPrefixes = new Set(
      [...prefixCounts.entries()].filter(([, count]) => count >= 2).map(([prefixKey]) => prefixKey),
    );
    const ambiguousProspectIds: string[] = [];

    try {
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

        const givingMechanism = classifyGivingMechanism(item.title);

        evidenceCreated.push(
          await recordDiscoveryEvidence({
            orgId: context.orgId,
            prospectId: companyProspect.id,
            claim: `Active corporate giving program: ${item.title}`,
            value: { title: item.title, url: item.url, causeAlignment: criteria.cause, givingMechanism },
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

        const prefixKey = normalizeName(item.title).split(" ").slice(0, 2).join(" ");
        if (ambiguousPrefixes.has(prefixKey)) {
          ambiguousProspectIds.push(companyProspect.id);
        }

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

      const delegations: DelegationRequest[] = [];
      // Executive-level detail delegated to BEN-DIS-05 per spec
      // ("May delegate executive-level detail to BEN-DIS-05").
      if (companyProspectIds.length > 0) {
        delegations.push({
          childAgentCode: "BEN-DIS-05",
          objective: `Identify executives with philanthropic relevance at companies: ${companyProspectIds.join(", ")}`,
          maxAutonomy: "A2" as const,
          constraints: { companyProspectIds },
        });
      }
      // Corporate-control ambiguity dependency (roster [BEN-KNW-02,
      // BEN-INT-03]) -- blocks opportunity-ready status until resolved, so
      // both resolution paths are delegated in a single batch per run.
      if (ambiguousProspectIds.length > 0) {
        delegations.push({
          childAgentCode: "BEN-KNW-02",
          objective: `Resolve entity identity/control ambiguity for corporate giving candidates: ${ambiguousProspectIds.join(", ")}`,
          maxAutonomy: "A2" as const,
          constraints: { ambiguousProspectIds },
        });
        delegations.push({
          childAgentCode: "BEN-INT-03",
          objective: `Clarify beneficial ownership/control for ambiguous corporate giving candidates: ${ambiguousProspectIds.join(", ")}`,
          maxAutonomy: "A2" as const,
          constraints: { ambiguousProspectIds },
        });
      }

      return {
        status: "completed",
        evidence: evidenceCreated,
        conclusions: {
          criteria,
          discoveredProspectIds: discoveries.map((d) => d.prospectId),
          discoveries,
          companyProspectIds,
        },
        delegations,
        tokensUsed,
        costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts (called inside tryModelTokens); recording it again here would double-count the same tokens.
        error: null,
      };
    } catch (err) {
      // Recovery protocol (BEN-SUP-06, reactive recovery/forensic agent):
      // an uncaught error here is a genuinely unexpected external effect
      // (e.g. a thrown Supabase error from upsertNode/recordDiscoveryEvidence),
      // distinct from the already-handled `if (!success)` tool-failure checks
      // above -- preserve whatever evidence/discoveries were already
      // collected rather than discarding this run's partial progress.
      const message = serializePilError(err);
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "discovery.unknown_external_effect",
        resource_type: "pil_agent_runs",
        resource_id: context.runId,
        before_state: null,
        after_state: { message },
        policy_decision: null,
        ip_address: null,
      });
      return {
        status: "failed",
        evidence: evidenceCreated,
        conclusions: {
          criteria,
          discoveredProspectIds: discoveries.map((d) => d.prospectId),
          discoveries,
          companyProspectIds,
        },
        delegations: [
          {
            childAgentCode: "BEN-SUP-06",
            objective: `Investigate unknown external effect in BEN-DIS-04 run for org ${context.orgId}: ${message}`,
            maxAutonomy: "A2" as const,
            constraints: { runId: context.runId, errorMessage: message },
          },
        ],
        tokensUsed: 0,
        costUsd: 0,
        error: message,
      };
    }
  }
}

export default CorporateGivingDiscoveryAgent;
