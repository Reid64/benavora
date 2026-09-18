import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  getProspectById,
  MAX_DELEGATIONS_PER_RUN,
  recordIntelligenceEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/int/shared";
import { logAction } from "@/lib/pil/audit";
import { getEvidence } from "@/lib/pil/evidence";
import { getEdges, getNodesByProspect } from "@/lib/pil/graph";
import { createReviewItem } from "@/lib/pil/human-review";
import type { EvidenceItem } from "@/lib/pil/types";
import { serializePilError } from "@/lib/pil/serialize-error";

// BEN-INT-08 -- Wealth & Capacity Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3", line ~539). Evaluates
// evidence relevant to philanthropic capacity without treating estimated
// net worth as confirmed giving ability -- wealth / liquidity /
// philanthropic capacity / propensity are recorded as four distinct fields,
// never collapsed into one number (spec §6, and spec's explicit failure
// criteria: "A capacity range presented without an uncertainty list").
//
// The task spec that commissioned this batch labeled this code "Corporate
// Philanthropy Intelligence" -- the live registry has no such agent at
// BEN-INT-08; that code is "Wealth & Capacity Intelligence Agent". Per this
// codebase's established registry-wins pattern, this file implements the
// real BEN-INT-08.
//
// Autonomy: default A2, Human boundary H1 for capacity ranges that would
// place a prospect in TIER_1_PRIORITY on capacity alone. This agent has no
// access to tenant-specific tier thresholds, so it applies spec's stated
// escalation condition directly: a wealth signal resting on
// D-WEALTH-INFERRED alone, with no giving-behavior corroborant, always
// routes to pil_human_review_queue (review_type='capacity_determination')
// rather than guessing at a tier boundary.
//
// Permitted tools per spec: T-WEB, T-EDGAR, T-PUBREC, T-LICENSED,
// T-EVIDENCE (write), T-MODEL. No T-GRAPH -- matching spec exactly, this
// agent never writes graph edges. No T-EDGAR/T-PUBREC/T-LICENSED tool is
// registered in tools/index.ts, so only web_search is actually callable;
// business-ownership and giving-history corroborants are read from evidence
// already recorded by BEN-INT-03/BEN-INT-07 rather than re-fetched here.

interface CapacityRange {
  low: number;
  high: number;
}

// The six domain dimensions BEN-INT-08's output contract (BEN_INT_08Decision.v1,
// PIL_AGENT_COMPLETE_ROSTER.md "Core Intelligence") is scored across. Coverage
// is computed from persisted signal (getEvidence()/graph edges), not merely
// "an evidence row happens to exist" -- see dimensionCoverage below.
const WEALTH_CAPACITY_DIMENSIONS = [
  "Asset And Ownership Indicators",
  "Liquidity Indicators",
  "Liability/Encumbrance Limitations",
  "Valuation Basis/Date",
  "Capacity Range",
  "Confidence And Uncertainty",
] as const;

export interface WealthCapacityIntelligenceReport {
  prospectId: string;
  dimensionCoverage: Record<(typeof WEALTH_CAPACITY_DIMENSIONS)[number], boolean>;
  evidenceCreatedThisRun: number;
  delegationsIssued: string[];
  wealth: CapacityRange;
  liquidity: string;
  philanthropicCapacity: CapacityRange;
  propensity: string;
  uncertainties: string[];
  escalatedForReview: boolean;
}

export class WealthCapacityIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-08 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];

    const wealthSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" net worth OR wealth OR "sold for" OR estate`,
      limit: 5,
    });
    const wealthResults = wealthSearch.success
      ? ((wealthSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? [])
      : [];
    const hasWealthSignal = wealthResults.length > 0;

    // Corroborants: business ownership (graph, written by BEN-INT-03) and
    // documented giving behavior (evidence, written by BEN-INT-07).
    const personNodes = await getNodesByProspect(prospect.id, context.orgId);
    const personNode = personNodes.find((n) => n.node_type === "person");
    const ownsEdges = personNode ? (await getEdges(personNode.id)).filter((e) => e.edge_type === "owns") : [];
    const hasOwnershipCorroborant = ownsEdges.length > 0;

    const allEvidence = await getEvidence(prospect.id, context.orgId);
    const hasGivingCorroborant = allEvidence.some((e) => e.claim_type === "giving_history");

    const uncertainties: string[] = [];
    if (!hasWealthSignal) uncertainties.push("no public wealth indicator found");
    if (!hasOwnershipCorroborant) uncertainties.push("no documented business ownership stake to corroborate");
    if (!hasGivingCorroborant) uncertainties.push("no documented giving-behavior corroborant");

    const wealth: CapacityRange = hasOwnershipCorroborant ? { low: 500_000, high: 5_000_000 } : { low: 50_000, high: 500_000 };
    const philanthropicCapacity: CapacityRange = hasGivingCorroborant
      ? { low: Math.round(wealth.low * 0.02), high: Math.round(wealth.high * 0.05) }
      : { low: 0, high: Math.round(wealth.high * 0.02) };
    const propensity = hasGivingCorroborant ? "demonstrated" : "unknown";
    // BEN-INT-09 (Wealth Origin & Liquidity Event) is implemented -- check its
    // recorded output rather than assuming "unknown" unconditionally.
    const hasLiquidityEventEvidence = allEvidence.some((e) => e.claim_type === "liquidity_event");
    const liquidity = hasLiquidityEventEvidence ? "event_documented" : "unknown";

    const corroboratedByGiving = hasGivingCorroborant;
    const confidence = !hasWealthSignal ? 0.15 : corroboratedByGiving ? 0.55 : 0.3;

    const evidence = await recordIntelligenceEvidence({
      orgId: context.orgId,
      prospectId: prospect.id,
      claim: `Estimated philanthropic capacity range: $${philanthropicCapacity.low.toLocaleString()}-$${philanthropicCapacity.high.toLocaleString()} (confidence ${confidence})`,
      value: {
        wealth,
        liquidity,
        philanthropicCapacity,
        propensity,
        uncertainties,
        wealthIndicatorSources: wealthResults.map((r) => ({ title: r.title, url: r.url })),
      },
      claimType: "wealth_capacity",
      sourceUrl: wealthResults[0]?.url ?? null,
      sourceTitle: wealthResults[0]?.title ?? null,
      sourceType: hasWealthSignal ? "open_web" : "internal",
      publisher: null,
      evidenceExcerpt: null,
      agentCode: context.agentCode,
      researchRunId: context.runId,
      // Capacity is definitionally an inference, never a verified fact --
      // spec's explicit failure criteria.
      confidence,
      verificationStatus: "reasoned_inference",
    });
    evidenceCreated.push(evidence);

    let escalated = false;
    if (hasWealthSignal && !hasGivingCorroborant) {
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "capacity_determination",
        subject_type: "pil_prospects",
        subject_id: prospect.id,
        requested_by_agent_id: context.agentCode,
        priority: "normal",
        status: "pending",
        summary: `Capacity determination for ${prospect.display_name} rests on a wealth-inferred signal alone with no giving-behavior corroborant -- human review required before treating as authoritative.`,
        evidence_refs: [evidence.id],
        assigned_to_user_id: null,
        resolved_at: null,
      });
      escalated = true;
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    // Everything above this point (evidence + human-review writes) is this
    // run's own defensible determination and has already durably landed.
    // Gap-analysis/delegation-construction/report-construction below is
    // secondary reasoning over that already-persisted work -- a bug here must
    // never discard evidence this run already recorded (roster: "captured
    // evidence stays immutable").
    try {
      const dimensionSignals: Record<(typeof WEALTH_CAPACITY_DIMENSIONS)[number], boolean> = {
        "Asset And Ownership Indicators": hasOwnershipCorroborant || hasWealthSignal,
        "Liquidity Indicators": hasLiquidityEventEvidence,
        // No agent in this codebase writes a claim_type for liabilities or
        // encumbrances yet -- an explicit false, not an omitted field.
        "Liability/Encumbrance Limitations": false,
        // True only when this run's estimate is backed by a real sourced
        // mention (a "basis" and its retrieval date), not a bare internal
        // inference recorded when no wealth signal was found.
        "Valuation Basis/Date": hasWealthSignal,
        // A capacity range is computed and persisted unconditionally below.
        "Capacity Range": evidenceCreated.length > 0,
        // Confidence and the uncertainties list are computed and persisted
        // alongside that same evidence row.
        "Confidence And Uncertainty": evidenceCreated.length > 0,
      };
      // Iterate the canonical dimension list rather than trusting the object
      // literal's keys alone, so dimensionCoverage always covers exactly the
      // six roster-defined dimensions.
      const dimensionCoverage = Object.fromEntries(
        WEALTH_CAPACITY_DIMENSIONS.map((dimension) => [dimension, dimensionSignals[dimension]]),
      ) as WealthCapacityIntelligenceReport["dimensionCoverage"];

      // Completes the BEN-INT-03/08/09 mutual triangle plus the QLF-03/KNW-03
      // consumers -- pushed in priority order, capped at
      // MAX_DELEGATIONS_PER_RUN since AgentRunner executes delegations
      // synchronously/inline. Never BEN-KNW-02 for this agent (documented
      // roster anomaly shared only with BEN-INT-10).
      const delegations: DelegationRequest[] = [];
      if (!hasOwnershipCorroborant && delegations.length < MAX_DELEGATIONS_PER_RUN) {
        delegations.push({
          childAgentCode: "BEN-INT-03",
          objective: `Deepen business-ownership research for prospect ${context.prospectId}: no corroborating 'owns' graph edge exists to substantiate this wealth-capacity estimate's asset basis.`,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      }
      if (!hasLiquidityEventEvidence && delegations.length < MAX_DELEGATIONS_PER_RUN) {
        delegations.push({
          childAgentCode: "BEN-INT-09",
          objective: `Build the wealth-origin/liquidity-event chain for prospect ${context.prospectId}: no liquidity_event evidence is on file to explain how this estimated wealth was realized.`,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      }
      if (hasWealthSignal && delegations.length < MAX_DELEGATIONS_PER_RUN) {
        delegations.push({
          childAgentCode: "BEN-QLF-03",
          objective: `Consume the capacity_determination evidence just recorded for prospect ${context.prospectId} as input to capacity & propensity qualification.`,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      }
      if (evidenceCreated.length > 0 && delegations.length < MAX_DELEGATIONS_PER_RUN) {
        delegations.push({
          childAgentCode: "BEN-KNW-03",
          objective: `Verify the wealth_capacity evidence just recorded for prospect ${context.prospectId} (reasoned_inference, confidence ${confidence}).`,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      }

      const report: WealthCapacityIntelligenceReport = {
        prospectId: prospect.id,
        dimensionCoverage,
        evidenceCreatedThisRun: evidenceCreated.length,
        delegationsIssued: delegations.map((d) => d.childAgentCode),
        wealth,
        liquidity,
        philanthropicCapacity,
        propensity,
        uncertainties,
        escalatedForReview: escalated,
      };

      return {
        status: "completed",
        evidence: evidenceCreated,
        conclusions: { report },
        delegations,
        tokensUsed,
        costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts (called inside tryModelTokens); recording it again here would double-count the same tokens.
        error: null,
      };
    } catch (err) {
      const message = serializePilError(err);
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "ben-int-08.gap_analysis_failed",
        resource_type: "pil_agent_runs",
        resource_id: context.runId,
        before_state: null,
        after_state: { error: message },
        policy_decision: null,
        ip_address: null,
      });
      return {
        status: "completed",
        evidence: evidenceCreated,
        conclusions: { skipped: true, reason: "gap_analysis_failed", error: message },
        delegations: [],
        tokensUsed,
        costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts (called inside tryModelTokens); recording it again here would double-count the same tokens.
        error: null,
      };
    }
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

export default WealthCapacityIntelligenceAgent;
