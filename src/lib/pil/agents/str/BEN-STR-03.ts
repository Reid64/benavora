import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { logAction } from "@/lib/pil/audit";
import { CLAIM_TYPES_BY_DIMENSION, scoreDimension } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import { describeWarmIntroduction, findWarmEdge } from "@/lib/pil/agents/str/shared";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";
import type {
  CultivationMilestone,
  CultivationPlan,
  CultivationReassessmentGate,
  CultivationStage,
  EvidenceItem,
  ProspectOpportunity,
} from "@/lib/pil/types";

// BEN-STR-03 -- Cultivation Strategy Agent
// (pil_agent_registry, migration 155 line 114, FAMILY 6 -- STRATEGY &
// NEXT-BEST-ACTION). Mission: "Create a multi-step relationship-development
// plan when immediate solicitation is not appropriate." default_autonomy_level
// A2, human_boundary NULL. cadence "On demand, when BEN-QLF-05/BEN-STR-01
// indicate cultivate_first."
//
// depends_on [BEN-STR-01, BEN-STR-02, BEN-REL-06, BEN-QLF-05], feeds
// [BEN-STR-04] per PIL_AGENT_DEPENDENCIES.yaml -- BEN-STR-04 names BEN-STR-03
// in its own delegation list, confirming the chain BEN-STR-01/02 -> BEN-STR-03
// -> BEN-STR-04. BEN-QLF-05 (Timing & Readiness Agent) is not implemented or
// registered in this codebase yet (see agents/index.ts's AGENT_FACTORIES), so
// this agent works standalone off just context.prospectId -- an explicit
// trigger (whether direct or via BEN-STR-01's delegation, which carries
// BEN-STR-01's own objective string as context.goal) is treated as sufficient
// signal that cultivation was already determined necessary by whatever
// called it. No special-casing of context.goal is needed: both trigger paths
// converge on the same prospectId-driven logic below.
//
// Cultivation Stages: a fixed, documented 4-stage ladder
// (CULTIVATION_STAGES below) -- the roster gives no literal stage names, so
// this is a standard major-gift cultivation-cycle progression (identify a
// connection point, make first contact, build the relationship, then
// reassess before any ask).
//
// Milestones: one object per stage at documented cumulative offsets
// (MILESTONE_TIMING_DAYS below, roughly a 6-month/180-day cadence) -- a
// reasonable default, not a value the spec mandates.
//
// Relationship-Building Actions: reuses BEN-QLF-04's own pil_graph_edges
// relationship-strength query, via str/shared.ts's findWarmEdge()/
// describeWarmIntroduction() -- extracted there rather than copied inline a
// third time (BEN-STR-01/02 each already call BEN-QLF-04's
// scoreRelationshipStrength() for a bare score; see shared.ts's own header
// for why BEN-STR-03 needed the actual edge instead and this was the
// signal to extract a shared module, per BEN-STR-02's header noting a third
// call site would be that signal). The resulting action (a warm
// introduction descriptor, or "shared_content_outreach" if no warm edge
// exists) is assigned identically to every stage's milestone -- it describes
// the touch *type* available for this prospect's whole cultivation
// sequence, not a stage-specific variant.
//
// Content/Evidence Needs: every claim_type from BEN-QLF-04's
// CLAIM_TYPES_BY_DIMENSION missionAffinity/givingCapacity/
// philanthropicPropensity arrays whose scored dimension (via BEN-QLF-04's
// own exported scoreDimension()) is below CONTENT_EVIDENCE_SUFFICIENCY_
// THRESHOLD. BEN-QLF-04.ts's own RESEARCH_SUFFICIENCY_THRESHOLD (value 40)
// is a private, unexported const, so this redefines the same value locally
// rather than importing it -- BEN-QLF-04.ts is the canonical source; if that
// value ever changes there, this constant must be updated to match so the
// two never drift silently.
//
// Timing: plan horizon = max(milestone offsets) = 180 days;
// nextReassessmentAt = now + 180 days.
//
// Reassessment Gates: true only for the terminal "readiness_reassessment"
// stage -- the point of a reassessment gate is confirming readiness before
// the fleet re-engages BEN-STR-02/BEN-STR-04, so only that stage requires
// one by default.
//
// Persistence: pil_prospect_opportunities has no column for a structured
// multi-step plan, and pil_agent_run_events.event_type is a fixed 7-value
// CHECK constraint with no slot for one either (see migration
// 166_pil_str_03_cultivation_plans.sql's own header) -- this agent owns a
// new pil_cultivation_plans table instead. At most one 'active' row per
// (organization_id, prospect_id): findActivePlan()/upsertPlan() below do a
// find-then-write, the same pattern graph.ts's upsertNode/upsertEdge use for
// a table with no natural ON CONFLICT target.
//
// Delegation: BEN-STR-03's own registry ceiling is A2 (verified against
// migration 155, not assumed) -- canDelegate() (policy.ts) checks a
// requested maxAutonomy against the DELEGATING agent's own ceiling, not the
// child's, so the BEN-STR-04 delegation below requests maxAutonomy "A2"
// (matching BEN-STR-03's own ceiling), never BEN-STR-04's own A3 ceiling --
// requesting "A3" here would make canDelegate() return false and fail this
// run, the same convention BEN-STR-01's header documents for its own
// BEN-STR-03 delegation.

// See this file's own header -- cross-references BEN-QLF-04.ts's private
// RESEARCH_SUFFICIENCY_THRESHOLD (value 40), which cannot be imported.
const CONTENT_EVIDENCE_SUFFICIENCY_THRESHOLD = 40;

const NO_WARM_EDGE_ACTION = "shared_content_outreach";

export const CULTIVATION_STAGES: CultivationStage[] = [
  "identify_shared_ground",
  "warm_introduction_or_first_touch",
  "deepen_engagement",
  "readiness_reassessment",
];

const STAGE_DESCRIPTIONS: Record<CultivationStage, string> = {
  identify_shared_ground:
    "Identify shared ground -- mutual connections, cause alignment, or programmatic fit -- to use as an entry point.",
  warm_introduction_or_first_touch: "Make a warm introduction or low-pressure first touch using the identified pathway.",
  deepen_engagement: "Deepen engagement through repeated, low-pressure touches that build trust and mutual familiarity.",
  readiness_reassessment: "Reassess readiness for solicitation before any ask is made.",
};

// Cumulative day offsets per stage (index-aligned with CULTIVATION_STAGES) --
// roughly a 6-month cadence, a reasonable default rather than a
// spec-mandated number.
const MILESTONE_TIMING_DAYS = [0, 30, 90, 180];
const PLAN_HORIZON_DAYS = MILESTONE_TIMING_DAYS[MILESTONE_TIMING_DAYS.length - 1]!;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const CONTENT_EVIDENCE_DIMENSIONS = ["missionAffinity", "givingCapacity", "philanthropicPropensity"] as const;

export interface CultivationStrategyReport {
  prospectId: string;
  opportunityId: string;
  planId: string;
  stages: CultivationStage[];
  milestones: CultivationMilestone[];
  contentEvidenceNeeds: string[];
  reassessmentGates: CultivationReassessmentGate[];
  planHorizonDays: number;
  nextReassessmentAt: string;
}

export class CultivationStrategyAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completed({}, "BEN-STR-03 requires an existing prospectId");
    }

    const opportunity = await this.findOpportunity(context.orgId, context.prospectId);
    if (!opportunity) {
      return this.completed(
        {},
        `No pil_prospect_opportunities row exists yet for prospect ${context.prospectId}; BEN-QLF-04 must qualify this prospect before BEN-STR-03 can build a cultivation plan.`,
      );
    }

    const evidence = await getEvidence(context.prospectId, context.orgId);
    const evidenceByClaimType = new Map<string, EvidenceItem[]>();
    for (const item of evidence) {
      const list = evidenceByClaimType.get(item.claim_type) ?? [];
      list.push(item);
      evidenceByClaimType.set(item.claim_type, list);
    }

    const contentEvidenceNeeds: string[] = [];
    for (const dimension of CONTENT_EVIDENCE_DIMENSIONS) {
      const claimTypes = CLAIM_TYPES_BY_DIMENSION[dimension];
      const items = claimTypes.flatMap((claimType) => evidenceByClaimType.get(claimType) ?? []);
      if (scoreDimension(items) < CONTENT_EVIDENCE_SUFFICIENCY_THRESHOLD) {
        contentEvidenceNeeds.push(...claimTypes);
      }
    }

    const warmEdge = await findWarmEdge(context.orgId, context.prospectId);
    const action = warmEdge ? describeWarmIntroduction(warmEdge) : NO_WARM_EDGE_ACTION;

    const milestones: CultivationMilestone[] = CULTIVATION_STAGES.map((stage, index) => ({
      stage,
      description: STAGE_DESCRIPTIONS[stage],
      suggestedTimingDays: MILESTONE_TIMING_DAYS[index]!,
      completed: false,
      action,
    }));

    const reassessmentGates: CultivationReassessmentGate[] = CULTIVATION_STAGES.map((stage) => ({
      stage,
      reassessmentRequired: stage === "readiness_reassessment",
    }));

    const nextReassessmentAt = new Date(Date.now() + PLAN_HORIZON_DAYS * MS_PER_DAY).toISOString();

    const existingPlan = await this.findActivePlan(context.orgId, context.prospectId);
    const plan = await this.upsertPlan(context.orgId, context.prospectId, opportunity.id, existingPlan, {
      stages: CULTIVATION_STAGES,
      milestones,
      content_evidence_needs: contentEvidenceNeeds,
      reassessment_gates: reassessmentGates,
      next_reassessment_at: nextReassessmentAt,
      created_by_agent_id: context.agentCode,
    });

    const delegations: DelegationRequest[] = [
      {
        childAgentCode: "BEN-STR-04",
        objective: `A cultivation plan (${plan.id}) now exists for prospect ${context.prospectId} -- re-evaluate next-best-action for opportunity ${opportunity.id}.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, opportunityId: opportunity.id, planId: plan.id },
      },
    ];

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "cultivation_plan.created",
      resource_type: "pil_cultivation_plans",
      resource_id: plan.id,
      before_state: null,
      after_state: { stageCount: CULTIVATION_STAGES.length, nextReassessmentAt },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 300);

    const report: CultivationStrategyReport = {
      prospectId: context.prospectId,
      opportunityId: opportunity.id,
      planId: plan.id,
      stages: CULTIVATION_STAGES,
      milestones,
      contentEvidenceNeeds,
      reassessmentGates,
      planHorizonDays: PLAN_HORIZON_DAYS,
      nextReassessmentAt,
    };

    return {
      status: "completed",
      evidence: [],
      conclusions: { report },
      delegations,
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
      error: null,
    };
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

  private async findActivePlan(orgId: string, prospectId: string): Promise<CultivationPlan | null> {
    const { data, error } = await getPilClient()
      .from("pil_cultivation_plans")
      .select("*")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    return (data as CultivationPlan | null) ?? null;
  }

  // Find-then-write, mirroring graph.ts's upsertNode/upsertEdge -- no
  // natural ON CONFLICT target exists for "at most one active plan per
  // (organization_id, prospect_id)".
  private async upsertPlan(
    orgId: string,
    prospectId: string,
    opportunityId: string,
    existing: CultivationPlan | null,
    fields: Pick<
      CultivationPlan,
      "stages" | "milestones" | "content_evidence_needs" | "reassessment_gates" | "next_reassessment_at" | "created_by_agent_id"
    >,
  ): Promise<CultivationPlan> {
    const client = getPilClient();

    if (existing) {
      const { data, error } = await client
        .from("pil_cultivation_plans")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as CultivationPlan;
    }

    const { data, error } = await client
      .from("pil_cultivation_plans")
      .insert({
        organization_id: orgId,
        prospect_id: prospectId,
        opportunity_id: opportunityId,
        status: "active",
        ...fields,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as CultivationPlan;
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (!context.tools.includes("T-MODEL")) return 0;
    try {
      const rate = await pilBlendedTokenRateUsd();
      await runner.useTool(context, "T-MODEL", { unitCost: rate, units, costType: "model_tokens", model: PIL_AGENT_MODEL });
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

export default CultivationStrategyAgent;
