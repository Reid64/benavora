import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET /api/agents/registry - list every agent in `agent_registry` for the
// Agent Marketplace settings page, each annotated with this org's
// `agent_configurations` enabled state (migration 094, AGENTS_v2.md Pillar 17).
//
// organization_id is derived server-side via requireRole (never trusted from a
// client-supplied header) - this route lists real settings data, not a
// soft-fail widget count, so it follows the same convention as
// /api/grants and other substantive list routes rather than the lightweight
// x-organization-id header read used by /api/nav-counts.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

interface AgentRegistryRow {
  agent_id: string;
  name: string;
  description: string;
  version: string;
  plan_requirement: string;
  trigger_type: string;
  schedule_cron: string | null;
  avg_runtime_seconds: number | null;
  avg_tokens_per_run: number | null;
  active: boolean;
  created_at: string;
}

interface AgentConfigurationRow {
  agent_id: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_run_at: string | null;
  run_count: number;
  total_tokens_consumed: number;
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: registryRows, error: registryError } = await supabase
    .from("agent_registry")
    .select(
      "agent_id, name, description, version, plan_requirement, trigger_type, schedule_cron, avg_runtime_seconds, avg_tokens_per_run, active, created_at",
    )
    .order("agent_id", { ascending: true });
  if (registryError) {
    return jsonError(
      "Could not load the agent registry.",
      "registry_load_failed",
      500,
    );
  }

  const { data: configRows, error: configError } = await supabase
    .from("agent_configurations")
    .select("agent_id, enabled, config, last_run_at, run_count, total_tokens_consumed")
    .eq("organization_id", organizationId);
  if (configError) {
    return jsonError(
      "Could not load agent configurations.",
      "config_load_failed",
      500,
    );
  }

  const configByAgentId = new Map<string, AgentConfigurationRow>(
    ((configRows ?? []) as AgentConfigurationRow[]).map((row) => [row.agent_id, row]),
  );

  const agents = ((registryRows ?? []) as AgentRegistryRow[]).map((agent) => {
    const config = configByAgentId.get(agent.agent_id);
    return {
      ...agent,
      enabled: config?.enabled ?? false,
      config: config?.config ?? {},
      last_run_at: config?.last_run_at ?? null,
      run_count: config?.run_count ?? 0,
      total_tokens_consumed: config?.total_tokens_consumed ?? 0,
    };
  });

  return NextResponse.json({ agents });
}
