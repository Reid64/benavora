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

// Agent factory. pil_agent_registry (agent-registry-service.ts) carries only
// metadata for all 44 agents from PROSPECT_INTELLIGENCE_AGENTS.md; this is
// the map from agent_id to the executable Agent implementation AgentRunner
// dispatches to. Agents not yet implemented get a graceful
// NotImplementedAgent rather than a hard failure so AgentRunner.run() can
// still record a completed pil_agent_runs row for them.

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
};

export function loadAgentImpl(agentCode: string): Agent {
  const factory = AGENT_FACTORIES[agentCode];
  if (factory) return factory();
  return new NotImplementedAgent(agentCode);
}
