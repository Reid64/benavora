import { getPilClient } from "@/lib/pil/db";
import type { AgentDefinition, AutonomyLevel, PolicyDecision, PolicyDecisionOutcome } from "@/lib/pil/types";

// Policy Enforcement Engine for the Prospect Intelligence Layer, implementing
// PROSPECT_INTELLIGENCE_ARCHITECTURE.md Section 2's A0-A4 autonomy model.
//
// pil_agent_registry has no per-data-class permitted/prohibited columns --
// that granularity lives on pil_delegated_tasks (allowed_data_classes/
// prohibited_data_classes), which is delegation-scoped, not agent-scoped.
// checkAgentAuthorization below evaluates the agent's registry-level
// autonomy ceiling against the requested action's minimum required level
// (Section 2's table), and treats a small set of consequential data classes
// as requiring human review regardless of autonomy level, per Section 2
// point 4 ("every autonomy-adjacent change... required").

const AUTONOMY_ORDER: Record<AutonomyLevel, number> = { A0: 0, A1: 1, A2: 2, A3: 3, A4: 4 };

export type PolicyAction =
  | "observe"
  | "write_evidence"
  | "propose"
  | "prepare_queue"
  | "execute_reversible"
  | "execute_policy_bounded";

// Section 2's table: minimum autonomy level each action class requires.
const ACTION_MIN_AUTONOMY: Record<PolicyAction, AutonomyLevel> = {
  observe: "A0",
  write_evidence: "A1",
  propose: "A1",
  prepare_queue: "A2",
  execute_reversible: "A3",
  execute_policy_bounded: "A4",
};

// Data classes that always require human sign-off (H1 in Section 2's table),
// regardless of the acting agent's autonomy ceiling.
const HUMAN_REVIEW_DATA_CLASSES = new Set([
  "capacity_determination",
  "giving_history_attribution",
  "identity_linkage",
]);

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

async function getAgent(agentCode: string): Promise<AgentDefinition | null> {
  const { data, error } = await getPilClient()
    .from("pil_agent_registry")
    .select("*")
    .eq("agent_id", agentCode)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentDefinition | null) ?? null;
}

export async function checkAgentAuthorization(
  agentCode: string,
  action: PolicyAction,
  dataClass: string,
  orgId: string,
): Promise<PolicyDecision> {
  const agent = await getAgent(agentCode);
  const policyName = "pil_autonomy_ceiling";
  let decision: PolicyDecisionOutcome;
  let reason: string;

  if (!agent || !agent.active) {
    decision = "deny";
    reason = `Agent ${agentCode} is not registered or is inactive`;
  } else {
    const requiredLevel = ACTION_MIN_AUTONOMY[action];
    const agentLevel = agent.default_autonomy_level;
    if (AUTONOMY_ORDER[agentLevel] < AUTONOMY_ORDER[requiredLevel]) {
      decision = "deny";
      reason = `Agent ${agentCode} is ceilinged at ${agentLevel}, action "${action}" requires ${requiredLevel}`;
    } else if (HUMAN_REVIEW_DATA_CLASSES.has(dataClass)) {
      decision = "require_human";
      reason = `Data class "${dataClass}" requires human review regardless of agent autonomy level`;
    } else if (agent.human_boundary && action === "execute_policy_bounded") {
      decision = "require_human";
      reason = `Agent ${agentCode} has a documented human boundary for policy-bounded execution: ${agent.human_boundary}`;
    } else {
      decision = "allow";
      reason = `Agent ${agentCode} (${agentLevel}) authorized for "${action}" on data class "${dataClass}"`;
    }
  }

  const insertPayload = {
    organization_id: orgId,
    actor_agent_id: agentCode,
    action_requested: `${action}:${dataClass}`,
    policy_name: policyName,
    decision,
    reason,
    related_delegated_task_id: null,
  };
  const { data, error } = await getPilClient()
    .from("pil_policy_decisions")
    .insert(insertPayload)
    .select("*")
    .single();
  if (error) throw error;
  return data as PolicyDecision;
}

export async function enforceAutonomyLevel(
  agentCode: string,
  requestedAction: PolicyAction,
): Promise<void> {
  const agent = await getAgent(agentCode);
  if (!agent || !agent.active) {
    throw new PolicyViolationError(`Agent ${agentCode} is not registered or is inactive`);
  }
  const requiredLevel = ACTION_MIN_AUTONOMY[requestedAction];
  if (AUTONOMY_ORDER[agent.default_autonomy_level] < AUTONOMY_ORDER[requiredLevel]) {
    throw new PolicyViolationError(
      `Agent ${agentCode} is ceilinged at ${agent.default_autonomy_level}, action "${requestedAction}" requires ${requiredLevel}`,
    );
  }
}

// Validates a delegation does not exceed the parent agent's own authority --
// Section 2 point 2: pil_delegated_tasks.max_autonomy cannot exceed the
// parent's registry-level autonomy ceiling. (The live per-run
// autonomy_level_used isn't available from just an agent code; this checks
// against the parent's default_autonomy_level, its static ceiling.)
export async function canDelegate(
  parentAgentCode: string,
  childAgentCode: string,
  maxAutonomy: AutonomyLevel,
): Promise<boolean> {
  const [parent, child] = await Promise.all([getAgent(parentAgentCode), getAgent(childAgentCode)]);
  if (!parent || !parent.active) {
    throw new PolicyViolationError(`Parent agent ${parentAgentCode} is not registered or is inactive`);
  }
  if (!child || !child.active) {
    throw new PolicyViolationError(`Child agent ${childAgentCode} is not registered or is inactive`);
  }
  if (parentAgentCode === childAgentCode) {
    return false; // pil_delegated_tasks_no_self_delegation CHECK constraint
  }
  return AUTONOMY_ORDER[maxAutonomy] <= AUTONOMY_ORDER[parent.default_autonomy_level];
}

export async function recordPolicyDecision(decision: PolicyDecision): Promise<void> {
  const { error } = await getPilClient().from("pil_policy_decisions").insert(decision);
  if (error) throw error;
}
