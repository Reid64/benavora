import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { createReviewItem } from "@/lib/pil/human-review";
import { logAction } from "@/lib/pil/audit";
import { CLAIM_TYPES_BY_DIMENSION, INSTITUTIONAL_ENTITY_TYPES, scoreRelationshipStrength } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import type { EvidenceItem, Prospect, ProspectOpportunity, ProspectOpportunityClassification } from "@/lib/pil/types";

// BEN-STR-01 -- Prospect Engagement Strategy Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~854, FAMILY 6 -- STRATEGY &
// NEXT-BEST-ACTION). "Determine the most appropriate evidence-based
// engagement strategy for a qualified prospect" -- the first Strategy-family
// agent to run once BEN-QLF-04 has classified a prospect as
// TIER_1_PRIORITY/TIER_2_CULTIVATE (registry cadence). src/lib/pil/agents/str/
// did not exist before this file; this is the first agent written there.
//
// PIL_AGENT_DEPENDENCIES.yaml lists depends_on: [BEN-QLF-04, BEN-REL-05,
// BEN-KNW-03] and feeds: [BEN-STR-02, BEN-STR-03, BEN-STR-04] for this agent
// -- but that file's own methodology section documents depends_on/feeds as an
// AUTHORITY graph ("may call") mined from each spec's own delegation section,
// not a strict data-flow direction. This codebase's actual
// `delegations: DelegationRequest[]` field on AgentResult (agent-runner.ts)
// is a distinct, concrete forward-execution-chaining mechanism that can point
// the opposite way from the roster's authority arrows -- e.g. BEN-QLF-04
// forward-delegates to BEN-SUP-05 despite BEN-SUP-05 sitting upstream in the
// authority graph. The delegation logic below follows that concrete
// forward-chain convention (delegate to BEN-STR-03 when cultivation is
// indicated), not a literal reading of depends_on/feeds.
//
// Relationship Path: the roster calls for a Warm Introduction Pathfinding
// (BEN-REL-05) read, but no agent in this codebase closes a delegation loop
// synchronously yet (see BEN-QLF-04's own header for the identical
// limitation re: BEN-SUP-05), and BEN-REL-05 has no persisted, synchronously
// readable output table of its own. This agent stands in with
// relationship_strength off pil_graph_edges instead, the same approach
// BEN-QLF-04 already takes for its own relationshipStrength dimension.
// Concretely, this reuses BEN-QLF-04's own scoreRelationshipStrength(orgId,
// prospectId) directly (imported below) rather than re-deriving the
// identical pil_graph_edges query inline: by the time this file was
// written, scoreRelationshipStrength had already been promoted from a
// private OpportunityQualificationAgent method to a standalone exported
// function specifically so sibling agents could reuse it without
// re-implementing the query (see BEN-QLF-04.ts's own header -- BEN-QLF-05
// does the same thing). Re-deriving the query inline here would only
// duplicate that same logic a third time, so RELATIONSHIP_STRENGTH_SCORE is
// applied inside the imported function rather than reimported here.
//
// Message Themes / Channel Constraints reuse BEN-QLF-04's exact
// CLAIM_TYPES_BY_DIMENSION claim-type vocabulary and INSTITUTIONAL_ENTITY_TYPES
// set (both already exported from that file) rather than inventing new
// claim_type strings or a new entity-type list.
//
// Channel taxonomy is a defensible default this file establishes -- the
// roster gives no literal channel list, only a "Recommended strategy" text
// output. Institutional funders (foundations/corporations/institutional
// funders, per INSTITUTIONAL_ENTITY_TYPES) get formal_application/
// program_officer_contact; individual prospects get warm_introduction/
// email/phone.
//
// Autonomy: BEN-STR-01's own pil_agent_registry row (migration 155, line
// ~112) is default_autonomy_level A2 -- verified against the applied
// migration, not assumed from the task prompt. The BEN-STR-03 delegation
// below requests maxAutonomy "A2", the ceiling policy.canDelegate() will
// authorize (checked against the DELEGATING agent's own registry ceiling,
// not the child's, per policy.ts).
//
// BEN-STR-01 deliberately never delegates to BEN-STR-02 (Best First Ask):
// BEN-STR-02 carries an H1 human boundary on its own registry row (final
// solicitation decision always remains human) -- auto-chaining into it here
// would make a governed decision look like an automatic continuation of this
// agent's own run.

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;
const LOW_CONFIDENCE_THRESHOLD = 0.4;

export type EngagementObjective = "solicit" | "cultivate" | "monitor" | "research_more";

const OBJECTIVE_BY_CLASSIFICATION: Record<ProspectOpportunityClassification, EngagementObjective> = {
  tier_1_priority: "solicit",
  tier_2_cultivate: "cultivate",
  tier_3_monitor: "monitor",
  research_more: "research_more",
  low_probability: "research_more",
  ineligible: "research_more",
  disqualified: "research_more",
};

// Exact claim_type vocabulary each message theme is grounded in, reusing
// BEN-QLF-04's CLAIM_TYPES_BY_DIMENSION strings verbatim rather than
// inventing new ones.
const MESSAGE_THEME_CLAIM_TYPES: Record<string, string[]> = {
  mission_alignment: CLAIM_TYPES_BY_DIMENSION.missionAffinity,
  giving_history_continuity: CLAIM_TYPES_BY_DIMENSION.philanthropicPropensity, // ["giving_history", "documented_major_gift"]
  // Deliberately just these two claim types, not the full opportunityStrength
  // array (which also includes "documented_major_gift" -- already covered by
  // giving_history_continuity above, so not repeated here).
  programmatic_fit: ["foundation_grants_paid", "corporate_giving_eligibility_rationale"],
};

export interface EngagementStrategyReport {
  prospectId: string;
  opportunityId: string;
  objective: EngagementObjective;
  prospectContext: {
    entityType: string;
    displayName: string;
    evidenceByClaimType: Record<string, number>;
  };
  relationshipPathScore: number;
  messageThemes: string[];
  channels: string[];
  riskFlagged: boolean;
  riskReasons: string[];
  humanReviewCreated: boolean;
  engagementStrategy: string;
}

export class ProspectEngagementStrategyAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completed({}, "BEN-STR-01 requires an existing prospectId");
    }

    const opportunity = await this.findOpportunity(context.orgId, context.prospectId);
    if (!opportunity) {
      return this.completed(
        {},
        `No pil_prospect_opportunities row exists yet for prospect ${context.prospectId}; BEN-QLF-04 must qualify this prospect before BEN-STR-01 can recommend an engagement strategy.`,
      );
    }

    const prospect = await this.loadProspect(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completed({}, `Prospect ${context.prospectId} not found`);
    }

    const objective = OBJECTIVE_BY_CLASSIFICATION[opportunity.classification];

    const evidence = await getEvidence(context.prospectId, context.orgId);
    const evidenceByClaimType = new Map<string, EvidenceItem[]>();
    for (const item of evidence) {
      const list = evidenceByClaimType.get(item.claim_type) ?? [];
      list.push(item);
      evidenceByClaimType.set(item.claim_type, list);
    }
    const evidenceSummary: Record<string, number> = {};
    for (const [claimType, items] of evidenceByClaimType) {
      evidenceSummary[claimType] = items.length;
    }

    const relationshipPathScore = await scoreRelationshipStrength(context.orgId, context.prospectId);

    const messageThemes = Object.entries(MESSAGE_THEME_CLAIM_TYPES)
      .filter(([, claimTypes]) => claimTypes.some((claimType) => evidenceByClaimType.has(claimType)))
      .map(([theme]) => theme);

    const channels = INSTITUTIONAL_ENTITY_TYPES.has(prospect.entity_type)
      ? ["formal_application", "program_officer_contact"]
      : ["warm_introduction", "email", "phone"];

    const avgConfidence = evidence.length > 0 ? evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length : 0;
    const coldSolicitation = objective === "solicit" && relationshipPathScore === 0;
    const lowConfidence = avgConfidence < LOW_CONFIDENCE_THRESHOLD;
    const riskReasons: string[] = [];
    if (coldSolicitation) {
      riskReasons.push(
        `Objective "solicit" recommended with no relationship pathway on record (relationshipPathScore 0) -- cold solicitation risk.`,
      );
    }
    if (lowConfidence) {
      riskReasons.push(
        `Average evidence confidence ${avgConfidence.toFixed(2)} is below the ${LOW_CONFIDENCE_THRESHOLD} low-confidence threshold.`,
      );
    }
    const riskFlagged = riskReasons.length > 0;

    let humanReviewCreated = false;
    if (riskFlagged) {
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "high_impact_action",
        subject_type: "pil_prospect_opportunities",
        subject_id: opportunity.id,
        requested_by_agent_id: context.agentCode,
        priority: coldSolicitation ? "high" : "normal",
        status: "pending",
        summary: `BEN-STR-01 flagged the engagement strategy recommendation for prospect ${context.prospectId}: ${riskReasons.join(" ")}`,
        evidence_refs: evidence.map((item) => item.id),
        assigned_to_user_id: null,
        resolved_at: null,
      });
      humanReviewCreated = true;
    }

    const engagementStrategy = `${objective}:${channels.join("+")}`;
    const updatedOpportunity = await this.updateEngagementStrategy(opportunity.id, engagementStrategy);

    const delegations: DelegationRequest[] = [];
    if (objective === "cultivate" || coldSolicitation) {
      delegations.push({
        childAgentCode: "BEN-STR-03",
        objective:
          objective === "cultivate"
            ? `Prospect ${context.prospectId} classified "${opportunity.classification}" -- build a multi-step cultivation plan before any solicitation.`
            : `Prospect ${context.prospectId}'s "solicit" objective has no relationship pathway on record (relationshipPathScore 0) -- cultivation is needed before an ask.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, opportunityId: opportunity.id },
      });
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "engagement_strategy.recommended",
      resource_type: "pil_prospect_opportunities",
      resource_id: opportunity.id,
      before_state: { engagement_strategy: opportunity.engagement_strategy },
      after_state: { objective, channels, relationshipPathScore, riskFlagged, engagementStrategy },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 300);

    const report: EngagementStrategyReport = {
      prospectId: context.prospectId,
      opportunityId: updatedOpportunity.id,
      objective,
      prospectContext: {
        entityType: prospect.entity_type,
        displayName: prospect.display_name,
        evidenceByClaimType: evidenceSummary,
      },
      relationshipPathScore,
      messageThemes,
      channels,
      riskFlagged,
      riskReasons,
      humanReviewCreated,
      engagementStrategy,
    };

    return {
      status: "completed",
      evidence: [],
      conclusions: { report },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private async loadProspect(orgId: string, prospectId: string): Promise<Prospect | null> {
    const { data, error } = await getPilClient()
      .from("pil_prospects")
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", prospectId)
      .maybeSingle();
    if (error) throw error;
    return (data as Prospect | null) ?? null;
  }

  private async findOpportunity(orgId: string, prospectId: string): Promise<ProspectOpportunity | null> {
    const { data, error } = await getPilClient()
      .from("pil_prospect_opportunities")
      .select("*")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .maybeSingle();
    if (error) throw error;
    return (data as ProspectOpportunity | null) ?? null;
  }

  // Update-only, per this agent's persistence contract -- BEN-QLF-04 owns
  // creating the pil_prospect_opportunities row; this agent only ever
  // updates an existing one (findOpportunity above already early-returns if
  // none exists).
  private async updateEngagementStrategy(opportunityId: string, engagementStrategy: string): Promise<ProspectOpportunity> {
    const { data, error } = await getPilClient()
      .from("pil_prospect_opportunities")
      .update({ engagement_strategy: engagementStrategy, updated_at: new Date().toISOString() })
      .eq("id", opportunityId)
      .select("*")
      .single();
    if (error) throw error;
    return data as ProspectOpportunity;
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (!context.tools.includes("T-MODEL")) return 0;
    try {
      await runner.useTool(context, "T-MODEL", { unitCost: MODEL_TOKEN_UNIT_COST_USD, units, costType: "model_tokens" });
      return units;
    } catch {
      return 0;
    }
  }

  private completed(conclusions: Record<string, unknown>, reason: string): AgentResult {
    return {
      status: "completed",
      evidence: [],
      conclusions: { skipped: true, reason, ...conclusions },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: null,
    };
  }
}

export default ProspectEngagementStrategyAgent;
