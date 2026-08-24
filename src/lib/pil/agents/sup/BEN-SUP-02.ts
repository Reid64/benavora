import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { pilProspects } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { listActiveSources } from "@/lib/pil/sources";
import { logAction } from "@/lib/pil/audit";
import type { EvidenceItem, Prospect, ProspectEntityType, SourceType } from "@/lib/pil/types";

// BEN-SUP-02 -- Research Strategy Architect
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 1 -- SUPERVISORY & ORCHESTRATION").
// Transforms a broad fundraising objective into an evidence-driven research
// strategy: analyzes what's already known about the prospect, identifies
// gaps, selects sources, and produces a structured ResearchPlan for
// BEN-SUP-03 to turn into a dependency-aware execution plan. This agent may
// delegate exactly one task per invocation, and only to BEN-SUP-03.

type ResearchDimension =
  | "professional_position"
  | "wealth_capacity"
  | "board_membership"
  | "giving_history"
  | "contact_info"
  | "foundation_profile"
  | "business_ownership";

const PLANNER_AGENT = "BEN-SUP-03";
const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

const DIMENSION_KEYWORDS: Record<ResearchDimension, string[]> = {
  professional_position: ["employer", "position", "title", "career", "employment"],
  wealth_capacity: ["wealth", "capacity", "net_worth", "asset"],
  board_membership: ["board", "trustee", "director"],
  giving_history: ["gift", "donation", "giving", "pledge"],
  contact_info: ["email", "phone", "contact"],
  foundation_profile: ["foundation", "filing", "990", "grant"],
  business_ownership: ["business", "owner", "equity", "company"],
};

// Which dimensions a research strategy needs to cover, keyed by prospect
// entity type (spec §6 Family 3's per-entity-class dossier requirements).
const REQUIRED_DIMENSIONS_BY_ENTITY_TYPE: Partial<Record<ProspectEntityType, ResearchDimension[]>> = {
  individual: ["professional_position", "wealth_capacity", "board_membership", "giving_history", "contact_info"],
  executive: ["professional_position", "wealth_capacity", "board_membership", "giving_history", "contact_info"],
  business_owner: ["business_ownership", "wealth_capacity", "giving_history", "contact_info"],
  board_member: ["board_membership", "professional_position", "giving_history", "contact_info"],
  trustee: ["board_membership", "foundation_profile", "giving_history"],
  wealth_holder: ["wealth_capacity", "giving_history", "contact_info"],
  community_leader: ["professional_position", "board_membership", "giving_history", "contact_info"],
  institutional_funder: ["foundation_profile", "giving_history", "board_membership"],
  family_foundation: ["foundation_profile", "giving_history", "board_membership"],
  private_foundation: ["foundation_profile", "giving_history", "board_membership"],
  community_foundation: ["foundation_profile", "giving_history", "board_membership"],
  corporate_foundation: ["foundation_profile", "giving_history", "board_membership"],
  corporation: ["business_ownership", "giving_history", "contact_info"],
  other: ["wealth_capacity", "giving_history"],
};

const SOURCE_TYPES_BY_ENTITY_TYPE: Partial<Record<ProspectEntityType, SourceType[]>> = {
  family_foundation: ["irs_form_990", "foundation_information", "open_web"],
  private_foundation: ["irs_form_990", "foundation_information", "open_web"],
  community_foundation: ["irs_form_990", "foundation_information", "open_web"],
  corporate_foundation: ["irs_form_990", "foundation_information", "open_web"],
  institutional_funder: ["irs_form_990", "foundation_information", "open_web"],
  corporation: ["sec_edgar", "corporate_information", "open_web"],
  business_owner: ["sec_edgar", "corporate_information", "open_web", "public_records"],
};
const DEFAULT_SOURCE_TYPES: SourceType[] = ["open_web", "news", "public_records"];

// The concrete specialist that owns each research dimension -- used by
// BEN-SUP-03 downstream, but scored here so the plan can be validated before
// it leaves this agent.
const DIMENSION_AGENT: Record<ResearchDimension, string> = {
  professional_position: "BEN-INT-02",
  wealth_capacity: "BEN-INT-08",
  board_membership: "BEN-INT-05",
  giving_history: "BEN-INT-07",
  contact_info: "BEN-INT-10",
  foundation_profile: "BEN-INT-06",
  business_ownership: "BEN-INT-03",
};

export interface ResearchPlanAgentAssignment {
  dimension: ResearchDimension;
  agentCode: string;
  tokenBudget: number;
}

export interface ResearchPlan {
  prospectId: string | null;
  entityType: ProspectEntityType | null;
  requiredDimensions: ResearchDimension[];
  coveredDimensions: ResearchDimension[];
  gaps: ResearchDimension[];
  sourceKeys: string[];
  agentAssignments: ResearchPlanAgentAssignment[];
  score: number;
}

function coveredDimensionsFromEvidence(evidence: EvidenceItem[]): Set<ResearchDimension> {
  const covered = new Set<ResearchDimension>();
  for (const item of evidence) {
    const haystack = `${item.claim_type} ${item.claim}`.toLowerCase();
    for (const dimension of Object.keys(DIMENSION_KEYWORDS) as ResearchDimension[]) {
      if (DIMENSION_KEYWORDS[dimension].some((keyword) => haystack.includes(keyword))) {
        covered.add(dimension);
      }
    }
  }
  return covered;
}

const DEFAULT_DIMENSIONS: ResearchDimension[] = ["wealth_capacity", "giving_history", "contact_info"];

export class ResearchStrategyArchitect implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    // 1. Analyze the prospect's known information.
    const prospect = context.prospectId ? await this.loadProspect(context.orgId, context.prospectId) : null;
    const evidence = context.prospectId ? await getEvidence(context.prospectId, context.orgId) : [];

    const entityType = prospect?.entity_type ?? null;
    const requiredDimensions = entityType
      ? (REQUIRED_DIMENSIONS_BY_ENTITY_TYPE[entityType] ?? DEFAULT_DIMENSIONS)
      : DEFAULT_DIMENSIONS;
    const covered = coveredDimensionsFromEvidence(evidence);

    // 2. Identify research gaps.
    const gaps = requiredDimensions.filter((dimension) => !covered.has(dimension));

    // 3. Select data sources appropriate for this prospect type.
    const allowedSourceTypes = new Set(entityType ? (SOURCE_TYPES_BY_ENTITY_TYPE[entityType] ?? DEFAULT_SOURCE_TYPES) : DEFAULT_SOURCE_TYPES);
    const activeSources = await listActiveSources();
    const selectedSources = activeSources.filter((source) => allowedSourceTypes.has(source.source_type));

    const tokensUsed = await this.tryUseTool(context, runner, "T-MODEL", 150);

    // 4. Produce the structured research plan.
    const agentAssignments: ResearchPlanAgentAssignment[] = gaps.map((dimension) => ({
      dimension,
      agentCode: DIMENSION_AGENT[dimension],
      tokenBudget: 15000,
    }));

    // 5. Score the plan against the goal's success criteria: how much of
    // the prospect's required dossier will be addressed, weighted by the
    // average confidence of evidence already on file.
    const dimensionCoverageAfterPlan = requiredDimensions.length > 0 ? (covered.size + gaps.length) / requiredDimensions.length : 1;
    const avgEvidenceConfidence = evidence.length > 0 ? evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length : 0;
    const score = Number((0.5 * dimensionCoverageAfterPlan + 0.5 * avgEvidenceConfidence).toFixed(2));

    const plan: ResearchPlan = {
      prospectId: context.prospectId,
      entityType,
      requiredDimensions,
      coveredDimensions: Array.from(covered),
      gaps,
      sourceKeys: selectedSources.map((s) => s.source_key),
      agentAssignments,
      score,
    };

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "strategy.plan_produced",
      resource_type: "pil_research_runs",
      resource_id: context.runId,
      before_state: null,
      after_state: { plan },
      policy_decision: null,
      ip_address: null,
    });

    // 6. Hand the finalized strategy to BEN-SUP-03 for execution planning --
    // the only delegation this agent is permitted to make.
    const delegations: DelegationRequest[] = [
      {
        childAgentCode: PLANNER_AGENT,
        objective: `Execute research plan for prospect ${context.prospectId ?? "(none)"}: dimensions=${gaps.join(",") || "none"}`,
        maxAutonomy: "A2",
        constraints: { plan },
      },
    ];

    return {
      status: "completed",
      evidence: [],
      conclusions: { plan },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private async loadProspect(orgId: string, prospectId: string): Promise<Prospect | null> {
    const { data, error } = await pilProspects(orgId).eq("id", prospectId).maybeSingle();
    if (error) throw error;
    return (data as Prospect | null) ?? null;
  }

  private async tryUseTool(context: AgentContext, runner: AgentRunner, tool: string, units: number): Promise<number> {
    if (!context.tools.includes(tool)) return 0;
    try {
      await runner.useTool(context, tool, { unitCost: MODEL_TOKEN_UNIT_COST_USD, units, costType: "model_tokens" });
      return units;
    } catch {
      return 0;
    }
  }
}

export default ResearchStrategyArchitect;
