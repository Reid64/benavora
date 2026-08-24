import { getPilClient } from "@/lib/pil/db";
import { logAction } from "@/lib/pil/audit";
import type { ResearchRun, ResearchRunStatus } from "@/lib/pil/types";

// Durable workflow engine for the Research Run lifecycle
// (PROSPECT_INTELLIGENCE_ARCHITECTURE.md Section 1.2):
//   planning -> running -> (completed | failed | cancelled)
//
// pil_research_runs has no `run_type`/`depth_target` columns and no
// `queued`/`executing`/`evaluating` status values -- the applied schema's
// ResearchRunStatus (src/lib/pil/types.ts) is exactly
// planning|running|completed|failed|cancelled. run_type/depth_target are
// caller-supplied planning parameters with no dedicated column, so they are
// folded into `structured_plan` alongside the rest of the plan, matching how
// `structured_plan` is already documented as a free-form JSON planning
// artifact.

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

const VALID_TRANSITIONS: Record<ResearchRunStatus, ResearchRunStatus[]> = {
  planning: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export interface CreateResearchRunParams {
  orgId: string;
  prospectId?: string | null;
  runType?: string;
  goal: string;
  depthTarget?: number;
  triggeredBy: string;
}

async function getRun(runId: string): Promise<ResearchRun> {
  const { data, error } = await getPilClient()
    .from("pil_research_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (error) throw error;
  return data as ResearchRun;
}

export async function createResearchRun(params: CreateResearchRunParams): Promise<ResearchRun> {
  const insertPayload = {
    organization_id: params.orgId,
    goal_id: null,
    prospect_id: params.prospectId ?? null,
    initiating_agent_id: params.triggeredBy,
    natural_language_query: params.goal,
    structured_plan: {
      run_type: params.runType ?? null,
      depth_target: params.depthTarget ?? null,
    },
    status: "planning" as ResearchRunStatus,
    token_budget: null,
    tokens_consumed: 0,
    financial_budget: null,
    financial_spent: 0,
    started_at: null,
    completed_at: null,
  };

  const { data, error } = await getPilClient()
    .from("pil_research_runs")
    .insert(insertPayload)
    .select("*")
    .single();
  if (error) throw error;
  const run = data as ResearchRun;

  await logAction({
    organization_id: params.orgId,
    actor_type: "agent",
    actor_id: params.triggeredBy,
    action: "research_run.created",
    resource_type: "pil_research_runs",
    resource_id: run.id,
    before_state: null,
    after_state: { status: run.status },
    policy_decision: null,
    ip_address: null,
  });

  return run;
}

export async function advanceRunState(
  runId: string,
  newStatus: ResearchRunStatus,
  metadata?: Record<string, unknown>,
): Promise<ResearchRun> {
  const current = await getRun(runId);
  const allowed = VALID_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new WorkflowError(
      `Invalid research run transition: ${current.status} -> ${newStatus} (run ${runId})`,
    );
  }

  const updatePayload: Record<string, unknown> = { status: newStatus };
  if (newStatus === "running" && !current.started_at) {
    updatePayload.started_at = new Date().toISOString();
  }
  if (["completed", "failed", "cancelled"].includes(newStatus)) {
    updatePayload.completed_at = new Date().toISOString();
  }
  if (metadata) {
    updatePayload.structured_plan = { ...current.structured_plan, ...metadata };
  }

  const { data, error } = await getPilClient()
    .from("pil_research_runs")
    .update(updatePayload)
    .eq("id", runId)
    .select("*")
    .single();
  if (error) throw error;
  const updated = data as ResearchRun;

  await logAction({
    organization_id: current.organization_id,
    actor_type: "system",
    actor_id: "workflow-engine",
    action: "research_run.transitioned",
    resource_type: "pil_research_runs",
    resource_id: runId,
    before_state: { status: current.status },
    after_state: { status: newStatus },
    policy_decision: null,
    ip_address: null,
  });

  return updated;
}

export async function failRun(runId: string, error: string): Promise<void> {
  await advanceRunState(runId, "failed", { error });
}

export async function cancelRun(runId: string, reason: string): Promise<void> {
  await advanceRunState(runId, "cancelled", { cancel_reason: reason });
}

export async function getActiveRuns(orgId: string): Promise<ResearchRun[]> {
  const { data, error } = await getPilClient()
    .from("pil_research_runs")
    .select("*")
    .eq("organization_id", orgId)
    .in("status", ["planning", "running"]);
  if (error) throw error;
  return (data ?? []) as ResearchRun[];
}
