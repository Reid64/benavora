import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  getProspectById,
  hostnameOf,
  looksLikeRoundEstimate,
  MAX_DELEGATIONS_PER_RUN,
  recordIntelligenceEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/int/shared";
import { logAction } from "@/lib/pil/audit";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect, traverseGraph } from "@/lib/pil/graph";
import type { EvidenceItem, GraphNode } from "@/lib/pil/types";
import { serializePilError } from "@/lib/pil/serialize-error";

// BEN-INT-09 -- Wealth Origin & Liquidity Event Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~560). Explains, with citations, the
// documented mechanisms through which substantial wealth or liquidity
// appears to have arisen -- a causal chain (ownership stake -> company sale
// / acquisition / IPO), each link labeled VERIFIED/INFERRED/UNKNOWN, never
// silently filled in.
//
// The task spec that commissioned this batch called this code "Giving
// History Intelligence" -- the live registry has no such content at
// BEN-INT-09; that code is "Wealth Origin & Liquidity Event Agent", and
// giving history is already implemented at BEN-INT-07. The task also asked
// for BEN-INT-10 through BEN-INT-15 as five further agents (Wealth
// Indicator, Liquidity Event, Geographic, Contact, Cause Interest, News and
// Trigger). PROSPECT_INTELLIGENCE_AGENTS.md's "Core Prospect Intelligence"
// family is fixed at 10 agents (BEN-INT-01..BEN-INT-10; Fleet Summary table,
// line ~1062) and migration 155_pil_agent_registry.sql's INSERT list jumps
// directly from BEN-INT-10 to BEN-REL-01 -- there is no BEN-INT-11 through
// BEN-INT-15 anywhere in the spec, architecture doc, or registry. Per this
// codebase's established registry-wins pattern, this file implements the
// real BEN-INT-09; BEN-INT-10 is implemented separately as the real Contact
// Intelligence Agent, and BEN-INT-11..15 are not built since they do not
// exist in the 44-agent fleet.
//
// Permitted tools per spec: T-WEB, T-EDGAR, T-NEWS, T-EVIDENCE (write). No
// T-GRAPH -- this agent only ever writes evidence, matching spec exactly.
// No T-EDGAR tool is registered in tools/index.ts (same gap noted in
// BEN-INT-03's header), so the EDGAR-scoped step below is a web_search query
// scoped toward SEC filing language rather than a parsed filing.

type ChainLabel = "VERIFIED" | "INFERRED" | "UNKNOWN";

interface ChainLink {
  step: string;
  label: ChainLabel;
  description: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
}

// The six domain dimensions this agent's report scores coverage across, per
// PIL_AGENT_COMPLETE_ROSTER.md "Core Intelligence" BEN_INT_09Decision.v1
// contract. Coverage is computed from persisted pil_evidence state
// (getEvidence()), not just evidence created this run, matching BEN-INT-08's
// own established getEvidence(prospect.id, context.orgId) pattern.
const WEALTH_ORIGIN_DIMENSIONS = [
  "Company Sale/M&A/IPO Events",
  "Equity Transactions",
  "Founder Ownership Evidence",
  "Distribution/Proceeds Limitations",
  "Event Timing",
  "Post-Event Uncertainty",
] as const;

export interface WealthOriginLiquidityEventReport {
  prospectId: string;
  dimensionCoverage: Record<(typeof WEALTH_ORIGIN_DIMENSIONS)[number], boolean>;
  evidenceCreatedThisRun: number;
  delegationsIssued: string[];
  chainsBuilt: number;
  ownedCompaniesFound: number;
}

function classifyEventStep(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("ipo") || lower.includes("initial public offering")) return "ipo";
  if (lower.includes("acqui")) return "acquisition";
  if (lower.includes("sold") || lower.includes("sale")) return "company_sale";
  return "liquidity_event";
}

export class WealthOriginLiquidityEventAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-09 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];

    // Chain root: this prospect's documented ownership stakes, per spec's
    // input "Business ownership history (BEN-INT-03)" -- read from the graph
    // BEN-INT-03 already wrote rather than re-searched here.
    const personNodes = await getNodesByProspect(prospect.id, context.orgId);
    const personNode = personNodes.find((n) => n.node_type === "person");

    let ownedCompanies: GraphNode[] = [];
    if (personNode) {
      const { nodes, edges } = await traverseGraph(personNode.id, 1, context.orgId);
      const ownsEdges = edges.filter((e) => e.source_node_id === personNode.id && e.edge_type === "owns");
      ownedCompanies = ownsEdges
        .map((e) => nodes.find((n) => n.id === e.target_node_id))
        .filter((n): n is GraphNode => Boolean(n));
    }

    const chainTargets = ownedCompanies.length > 0 ? ownedCompanies : [null];

    // Capacity-refresh trigger for BEN-INT-08: true as soon as any chain
    // target's search actually turns up a real event (not the UNKNOWN
    // fallback) -- a newly-documented liquidity event should prompt
    // BEN-INT-08 to re-score capacity with fresh wealth evidence.
    let liquidityEventFound = false;

    for (const company of chainTargets) {
      const chain: ChainLink[] = [];

      if (company) {
        chain.push({
          step: "ownership_stake",
          label: "INFERRED",
          description: `${prospect.display_name} held a documented ownership/founder stake in ${company.label} (per BEN-INT-03)`,
          sourceUrl: null,
          sourceTitle: null,
        });
      } else {
        chain.push({
          step: "ownership_stake",
          label: "UNKNOWN",
          description: "No documented ownership stake on file for this prospect (BEN-INT-03 has not linked an owned company)",
          sourceUrl: null,
          sourceTitle: null,
        });
      }

      const subjectPhrase = company ? `"${company.label}"` : `"${prospect.display_name}"`;
      const newsResult = await callTool(context, runner, "news_search", {
        query: `${subjectPhrase} acquired OR acquisition OR "sold to" OR IPO OR "initial public offering" OR "company sale"`,
        limit: 3,
      });
      const newsResults = newsResult.success
        ? ((newsResult.data as { results?: Array<{ title: string; url: string; source: string }> } | null)?.results ?? [])
        : [];

      // T-EDGAR substitution (no T-EDGAR tool registered -- see file header).
      const edgarResult = await callTool(context, runner, "web_search", {
        query: `${subjectPhrase} SEC EDGAR "Schedule 13D" OR "Form 4" OR "S-1" acquisition OR merger`,
        limit: 3,
      });
      const edgarResults = edgarResult.success
        ? ((edgarResult.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? [])
        : [];

      const found = newsResults[0] ?? edgarResults[0] ?? null;
      if (found) {
        liquidityEventFound = true;
        const isRoundEstimate = looksLikeRoundEstimate(found.title);
        chain.push({
          step: classifyEventStep(found.title),
          // Neither a parsed filing nor a confirmed sale price is available
          // (no T-EDGAR/T-990 parse here) -- a news/search mention never
          // earns VERIFIED, per spec's distinction between a documented and
          // a rumored/estimated figure.
          label: "INFERRED",
          description: isRoundEstimate
            ? `Liquidity event reported (round/estimated figure, unconfirmed by filing): ${found.title}`
            : `Liquidity event reported: ${found.title}`,
          sourceUrl: found.url,
          sourceTitle: found.title,
        });
      } else {
        chain.push({
          step: "liquidity_event",
          label: "UNKNOWN",
          description: company
            ? `No documented liquidity event found for the ${company.label} ownership stake -- chain stops here rather than assuming one`
            : "No documented liquidity event found -- chain stops here rather than assuming one",
          sourceUrl: null,
          sourceTitle: null,
        });
      }

      const lastCitedLink = [...chain].reverse().find((l) => l.sourceUrl);
      const confidence = found ? 0.4 : 0.15;

      evidenceCreated.push(
        await recordIntelligenceEvidence({
          orgId: context.orgId,
          prospectId: prospect.id,
          claim: `Wealth origin chain${company ? ` via ${company.label}` : ""}: ${chain.map((l) => `${l.step}[${l.label}]`).join(" -> ")}`,
          value: { chain },
          claimType: "liquidity_event",
          sourceUrl: lastCitedLink?.sourceUrl ?? null,
          sourceTitle: lastCitedLink?.sourceTitle ?? null,
          sourceType: found ? (newsResults[0] ? "news" : "open_web") : "internal",
          publisher: lastCitedLink?.sourceUrl ? hostnameOf(lastCitedLink.sourceUrl) : null,
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence,
          verificationStatus: found ? "reasoned_inference" : "unverified",
        }),
      );
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    // Everything above this point (evidence writes) is this run's own
    // defensible determination and has already durably landed via
    // individually atomic recordIntelligenceEvidence() calls. Gap-analysis/
    // delegation-construction/report-construction below is secondary
    // reasoning over that already-persisted work -- a bug here must never
    // discard evidence this run already recorded (roster: "captured evidence
    // stays immutable").
    let report: WealthOriginLiquidityEventReport = {
      prospectId: prospect.id,
      dimensionCoverage: Object.fromEntries(WEALTH_ORIGIN_DIMENSIONS.map((d) => [d, false])) as WealthOriginLiquidityEventReport["dimensionCoverage"],
      evidenceCreatedThisRun: evidenceCreated.length,
      delegationsIssued: [],
      chainsBuilt: evidenceCreated.length,
      ownedCompaniesFound: ownedCompanies.length,
    };
    let delegations: DelegationRequest[] = [];

    try {
      const allEvidence = await getEvidence(prospect.id, context.orgId);
      const liquidityEvidence = allEvidence.filter((e) => e.claim_type === "liquidity_event");
      const chains = liquidityEvidence.map((e) => (e.value as { chain?: ChainLink[] } | null)?.chain ?? []);

      const hasSpecificEventClassification = chains.some((chain) =>
        chain.some((link) => link.step === "ipo" || link.step === "acquisition" || link.step === "company_sale"),
      );
      // The EDGAR-substitute web_search (Schedule 13D/Form 4/S-1 language,
      // see file header) only ever wins as `found` -- and is only ever
      // recorded with source_type "open_web" -- when the news_search leg came
      // up empty, so an "open_web" liquidity_event row is this agent's own
      // proxy for a documented equity-transaction filing mention.
      const hasEdgarSubstituteHit = liquidityEvidence.some((e) => e.source_type === "open_web");
      const hasFoundOwnershipStake =
        ownedCompanies.length > 0 || chains.some((chain) => chain.some((link) => link.step === "ownership_stake" && link.label === "INFERRED"));
      const hasFoundEventStep = chains.some((chain) => chain.some((link) => link.label !== "UNKNOWN" && link.step !== "ownership_stake"));
      const hasDatedSource = liquidityEvidence.some((e) => e.source_url !== null);
      const hasUnknownLabeledLink = chains.some((chain) => chain.some((link) => link.label === "UNKNOWN"));

      const dimensionSignals: Record<(typeof WEALTH_ORIGIN_DIMENSIONS)[number], boolean> = {
        "Company Sale/M&A/IPO Events": hasSpecificEventClassification,
        "Equity Transactions": hasEdgarSubstituteHit,
        "Founder Ownership Evidence": hasFoundOwnershipStake,
        // No agent in this codebase tracks distribution restrictions, lockups,
        // or proceeds limitations on a documented liquidity event -- an
        // explicit false, not an omitted field (same pattern as BEN-INT-08's
        // "Liability/Encumbrance Limitations").
        "Distribution/Proceeds Limitations": false,
        "Event Timing": hasFoundEventStep && hasDatedSource,
        "Post-Event Uncertainty": hasUnknownLabeledLink,
      };
      const dimensionCoverage = Object.fromEntries(
        WEALTH_ORIGIN_DIMENSIONS.map((dimension) => [dimension, dimensionSignals[dimension]]),
      ) as WealthOriginLiquidityEventReport["dimensionCoverage"];

      // Completes the BEN-INT-03/08/09 mutual triangle plus the KNW-02/KNW-03
      // consumers -- pushed in priority order, capped at
      // MAX_DELEGATIONS_PER_RUN since AgentRunner executes delegations
      // synchronously/inline.
      const candidates: DelegationRequest[] = [];
      const pushCandidate = (childAgentCode: string, objective: string) => {
        candidates.push({
          childAgentCode,
          objective,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      };

      if (!personNode) {
        pushCandidate(
          "BEN-KNW-02",
          `Prospect ${context.prospectId} has no resolved person graph node -- resolve identity ambiguity before further wealth-origin research.`,
        );
      }
      if (ownedCompanies.length === 0) {
        pushCandidate(
          "BEN-INT-03",
          `Prospect ${context.prospectId} has no documented ownership stake on file -- BEN-INT-09 has no ownership stake to build a wealth-origin chain from.`,
        );
      }
      if (liquidityEventFound) {
        pushCandidate(
          "BEN-INT-08",
          `Prospect ${context.prospectId} has a newly-documented liquidity event this run -- re-score wealth/giving capacity against the fresh wealth evidence.`,
        );
      }
      if (evidenceCreated.length > 0) {
        pushCandidate(
          "BEN-KNW-03",
          `BEN-INT-09 recorded ${evidenceCreated.length} new liquidity_event evidence item(s) for prospect ${context.prospectId} this run -- verify provenance before treating as authoritative.`,
        );
      }

      delegations = candidates.slice(0, MAX_DELEGATIONS_PER_RUN);

      report = {
        prospectId: prospect.id,
        dimensionCoverage,
        evidenceCreatedThisRun: evidenceCreated.length,
        delegationsIssued: delegations.map((d) => d.childAgentCode),
        chainsBuilt: evidenceCreated.length,
        ownedCompaniesFound: ownedCompanies.length,
      };
    } catch (err) {
      const message = serializePilError(err);
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "ben-int-09.gap_analysis_failed",
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

export default WealthOriginLiquidityEventAgent;
