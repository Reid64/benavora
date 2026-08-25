import type { Agent, AgentContext, AgentResult } from "@/lib/pil/agent-runner";
import { logAction } from "@/lib/pil/audit";
import { ChiefProspectIntelligenceOrchestrator } from "@/lib/pil/agents/sup/BEN-SUP-01";
import { ResearchStrategyArchitect } from "@/lib/pil/agents/sup/BEN-SUP-02";
import { CrossAgentResearchPlanner } from "@/lib/pil/agents/sup/BEN-SUP-03";
import { ResearchPortfolioAllocator } from "@/lib/pil/agents/sup/BEN-SUP-04";
import { ProspectResearchCriticAgent } from "@/lib/pil/agents/sup/BEN-SUP-05";
import { ResearchRecoveryInvestigatorAgent } from "@/lib/pil/agents/sup/BEN-SUP-06";
import { AutonomyGovernorAgent } from "@/lib/pil/agents/sup/BEN-SUP-07";
import { ExecutiveIntelligenceNarrativeAgent } from "@/lib/pil/agents/sup/BEN-SUP-08";
import { IndividualProspectDiscoveryAgent } from "@/lib/pil/agents/dis/BEN-DIS-01";
import { MajorDonorDiscoveryAgent } from "@/lib/pil/agents/dis/BEN-DIS-02";
import { FoundationDiscoveryAgent } from "@/lib/pil/agents/dis/BEN-DIS-03";
import { CorporateGivingDiscoveryAgent } from "@/lib/pil/agents/dis/BEN-DIS-04";
import { ExecutiveProspectDiscoveryAgent } from "@/lib/pil/agents/dis/BEN-DIS-05";
import { GeographicFundingDiscoveryAgent } from "@/lib/pil/agents/dis/BEN-DIS-06";
import { CauseAlignedProspectDiscoveryAgent } from "@/lib/pil/agents/dis/BEN-DIS-07";
import { HiddenProspectAndCrmRediscoveryAgent } from "@/lib/pil/agents/dis/BEN-DIS-08";
import { IndividualIntelligenceAgent } from "@/lib/pil/agents/int/BEN-INT-01";
import { EmploymentCareerIntelligenceAgent } from "@/lib/pil/agents/int/BEN-INT-02";
import { BusinessOwnershipIntelligenceAgent } from "@/lib/pil/agents/int/BEN-INT-03";
import { EducationAlumniIntelligenceAgent } from "@/lib/pil/agents/int/BEN-INT-04";
import { NonprofitBoardIntelligenceAgent } from "@/lib/pil/agents/int/BEN-INT-05";
import { FoundationIntelligenceAgent } from "@/lib/pil/agents/int/BEN-INT-06";
import { GivingHistoryIntelligenceAgent } from "@/lib/pil/agents/int/BEN-INT-07";
import { WealthCapacityIntelligenceAgent } from "@/lib/pil/agents/int/BEN-INT-08";
import { WealthOriginLiquidityEventAgent } from "@/lib/pil/agents/int/BEN-INT-09";
import { ContactIntelligenceAgent } from "@/lib/pil/agents/int/BEN-INT-10";
import { RelationshipDiscoveryAgent } from "@/lib/pil/agents/rel/BEN-REL-01";
import { BoardRelationshipMappingAgent } from "@/lib/pil/agents/rel/BEN-REL-02";
import { CorporateRelationshipMappingAgent } from "@/lib/pil/agents/rel/BEN-REL-03";
import { OrganizationalOverlapAgent } from "@/lib/pil/agents/rel/BEN-REL-04";
import { WarmIntroductionPathfindingAgent } from "@/lib/pil/agents/rel/BEN-REL-05";
import { RelationshipStrengthAgent } from "@/lib/pil/agents/rel/BEN-REL-06";
import { FoundationRelationshipMappingAgent } from "@/lib/pil/agents/rel/BEN-REL-07";
import { ProfessionalConnectionMappingAgent } from "@/lib/pil/agents/rel/BEN-REL-08";
import { OpportunityQualificationAgent } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import { ProspectDigitalTwinAgent } from "@/lib/pil/agents/knw/BEN-KNW-01";
import { EntityResolutionAgent } from "@/lib/pil/agents/knw/BEN-KNW-02";
import { EvidenceProvenanceAgent } from "@/lib/pil/agents/knw/BEN-KNW-03";

// Agent factory. pil_agent_registry (agent-registry-service.ts) carries
// metadata for the 44 agents from PROSPECT_INTELLIGENCE_AGENTS.md plus 4
// task-directed additions the spec doc doesn't define (BEN-SUP-07/08,
// migration 163; BEN-REL-07/08, migration 164) -- this is the map from
// agent_id to the executable Agent implementation AgentRunner dispatches to.
// Agents not yet implemented get a graceful NotImplementedAgent rather than
// a hard failure so AgentRunner.run() can still record a completed
// pil_agent_runs row for them.
//
// REL family reconciliation: PROSPECT_INTELLIGENCE_AGENTS.md's Family 4 is a
// fixed 6-agent list (BEN-REL-01..06); a task spec directed building 8
// Relationship-family agents, so REL-01..06 were built to the live 6-agent
// registry/spec (each REL-0N.ts header documents which task-numbered mission
// landed at that file) and the two dropped missions -- Foundation
// Relationship Mapping, Professional Connection Mapping -- were built
// separately as BEN-REL-07/08 (see those files' own headers).

class NotImplementedAgent implements Agent {
  constructor(private readonly agentCode: string) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const message = `Agent ${this.agentCode} has no implementation yet`;
    // eslint-disable-next-line no-console
    console.warn(`[pil/agents] ${message} (org=${context.orgId}, run=${context.runId})`);
    try {
      await logAction({
        organization_id: context.orgId,
        actor_type: "system",
        actor_id: "agent-factory",
        action: "agent.not_implemented",
        resource_type: "pil_agent_runs",
        resource_id: context.runId,
        before_state: null,
        after_state: { agentCode: this.agentCode, goal: context.goal },
        policy_decision: null,
        ip_address: null,
      });
    } catch {
      // Best-effort audit trail -- never let a missing implementation's
      // logging failure mask the real "not implemented" result below.
    }

    return {
      status: "failed",
      evidence: [],
      conclusions: { notImplemented: true, agentCode: this.agentCode },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: message,
    };
  }
}

const AGENT_FACTORIES: Record<string, () => Agent> = {
  "BEN-SUP-01": () => new ChiefProspectIntelligenceOrchestrator(),
  "BEN-SUP-02": () => new ResearchStrategyArchitect(),
  "BEN-SUP-03": () => new CrossAgentResearchPlanner(),
  "BEN-SUP-04": () => new ResearchPortfolioAllocator(),
  "BEN-SUP-05": () => new ProspectResearchCriticAgent(),
  "BEN-SUP-06": () => new ResearchRecoveryInvestigatorAgent(),
  "BEN-SUP-07": () => new AutonomyGovernorAgent(),
  "BEN-SUP-08": () => new ExecutiveIntelligenceNarrativeAgent(),
  "BEN-DIS-01": () => new IndividualProspectDiscoveryAgent(),
  "BEN-DIS-02": () => new MajorDonorDiscoveryAgent(),
  "BEN-DIS-03": () => new FoundationDiscoveryAgent(),
  "BEN-DIS-04": () => new CorporateGivingDiscoveryAgent(),
  "BEN-DIS-05": () => new ExecutiveProspectDiscoveryAgent(),
  "BEN-DIS-06": () => new GeographicFundingDiscoveryAgent(),
  "BEN-DIS-07": () => new CauseAlignedProspectDiscoveryAgent(),
  "BEN-DIS-08": () => new HiddenProspectAndCrmRediscoveryAgent(),
  "BEN-INT-01": () => new IndividualIntelligenceAgent(),
  "BEN-INT-02": () => new EmploymentCareerIntelligenceAgent(),
  "BEN-INT-03": () => new BusinessOwnershipIntelligenceAgent(),
  "BEN-INT-04": () => new EducationAlumniIntelligenceAgent(),
  "BEN-INT-05": () => new NonprofitBoardIntelligenceAgent(),
  "BEN-INT-06": () => new FoundationIntelligenceAgent(),
  "BEN-INT-07": () => new GivingHistoryIntelligenceAgent(),
  "BEN-INT-08": () => new WealthCapacityIntelligenceAgent(),
  "BEN-INT-09": () => new WealthOriginLiquidityEventAgent(),
  "BEN-INT-10": () => new ContactIntelligenceAgent(),
  "BEN-REL-01": () => new RelationshipDiscoveryAgent(),
  "BEN-REL-02": () => new BoardRelationshipMappingAgent(),
  "BEN-REL-03": () => new CorporateRelationshipMappingAgent(),
  "BEN-REL-04": () => new OrganizationalOverlapAgent(),
  "BEN-REL-05": () => new WarmIntroductionPathfindingAgent(),
  "BEN-REL-06": () => new RelationshipStrengthAgent(),
  "BEN-REL-07": () => new FoundationRelationshipMappingAgent(),
  "BEN-REL-08": () => new ProfessionalConnectionMappingAgent(),
  "BEN-QLF-04": () => new OpportunityQualificationAgent(),
  "BEN-KNW-01": () => new ProspectDigitalTwinAgent(),
  "BEN-KNW-02": () => new EntityResolutionAgent(),
  "BEN-KNW-03": () => new EvidenceProvenanceAgent(),
};

export function loadAgentImpl(agentCode: string): Agent {
  const factory = AGENT_FACTORIES[agentCode];
  if (factory) return factory();
  return new NotImplementedAgent(agentCode);
}
