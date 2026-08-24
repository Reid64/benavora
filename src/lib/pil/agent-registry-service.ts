import { getPilClient } from "@/lib/pil/db";
import type { AgentDefinition, AgentFamily } from "@/lib/pil/types";

// Runtime reader/updater for pil_agent_registry. The 44 agents are seeded by
// migration 155 (deploy-pipeline-owned, per
// PROSPECT_INTELLIGENCE_ARCHITECTURE.md Section 2 point 1) -- this service
// only reads that table and toggles `active`; it never inserts or changes
// `default_autonomy_level`.

export class AgentNotFoundError extends Error {
  constructor(agentCode: string) {
    super(`Agent ${agentCode} not found in pil_agent_registry`);
    this.name = "AgentNotFoundError";
  }
}

export async function loadAgent(agentCode: string): Promise<AgentDefinition> {
  const { data, error } = await getPilClient()
    .from("pil_agent_registry")
    .select("*")
    .eq("agent_id", agentCode)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AgentNotFoundError(agentCode);
  return data as AgentDefinition;
}

export async function listAgents(family?: AgentFamily): Promise<AgentDefinition[]> {
  let query = getPilClient().from("pil_agent_registry").select("*");
  if (family) {
    query = query.eq("family", family);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AgentDefinition[];
}

export async function getAgentsByFamily(family: AgentFamily): Promise<AgentDefinition[]> {
  return listAgents(family);
}

export async function isAgentActive(agentCode: string): Promise<boolean> {
  const { data, error } = await getPilClient()
    .from("pil_agent_registry")
    .select("active")
    .eq("agent_id", agentCode)
    .maybeSingle();
  if (error) throw error;
  return data?.active === true;
}

export async function updateAgentStatus(agentCode: string, active: boolean): Promise<void> {
  const { error } = await getPilClient()
    .from("pil_agent_registry")
    .update({ active })
    .eq("agent_id", agentCode);
  if (error) throw error;
}
