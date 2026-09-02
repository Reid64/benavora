import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { createResearchRun } from "@/lib/pil/workflow";
import { listActiveSources } from "@/lib/pil/sources";
import { logAction } from "@/lib/pil/audit";
import { createReviewItem } from "@/lib/pil/human-review";
import type { AgentRun, HumanReviewPriority, ResearchRun, ResearchRunStep } from "@/lib/pil/types";

// BEN-SUP-06 -- Research Recovery Investigator
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 1 -- SUPERVISORY & ORCHESTRATION").
// Diagnoses failed/incomplete/contradictory research workflows and determines
// the safest recovery path. Invocation contract: context.runId is the failed
// pil_research_runs row under investigation (the same field every other
// agent's research_run_id maps to -- see agent-runner.ts's createRun, which
// always stamps research_run_id: context.runId).

type FailureClass = "transient" | "permanent" | "unknown" | "cross_tenant";
type RecoveryAction = "retry" | "alternative_path" | "escalate";

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

const TRANSIENT_KEYWORDS = [
  "timeout", "timed out", "rate limit", "econnreset", "network", "503", "502",
  "429", "unavailable", "enotfound", "fetch failed", "connection reset",
];
const PERMANENT_KEYWORDS = [
  "not found", "404", "403", "access denied", "unauthorized", "schema mismatch",
  "does not exist", "invalid column", "forbidden",
];

export interface RecoveryPlan {
  failedResearchRunId: string;
  failureClass: FailureClass;
  failedAgentId: string | null;
  action: RecoveryAction;
  detail: Record<string, unknown>;
}

export class ResearchRecoveryInvestigatorAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const failedRunId = context.runId;

    // 1. Receive the failed workflow's history.
    const failedRun = await this.loadResearchRun(failedRunId);
    const steps = await this.loadSteps(failedRunId);
    const failedAgentRuns = await this.loadFailedAgentRuns(context.orgId, failedRunId);

    const lastStep = [...steps].sort((a, b) => b.step_number - a.step_number)[0] ?? null;
    const failingAgentRun = failedAgentRuns[failedAgentRuns.length - 1] ?? null;
    const errorText = failingAgentRun?.error ?? "";

    // 1b. Preservation before mutation (spec invariant 1: "contain first and
    // preserve before mutation"; invariant 2: "durable stores and verified
    // receipts outrank logs and narrative"). Captured as the VERY FIRST
    // action of this run -- before classification, spawning, or delegation
    // can change any state -- so a durable, unmutated snapshot of the
    // pre-recovery state always exists.
    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "recovery.preservation_snapshot",
      resource_type: "pil_research_runs",
      resource_id: failedRunId,
      before_state: null,
      after_state: { failedRun, failingAgentRun },
      policy_decision: null,
      ip_address: null,
    });

    // 2. Cross-tenant check, checked FIRST -- ahead of ordinary keyword
    // classification (spec invariant 7: "cross-tenant evidence/effects
    // trigger quarantine and security escalation"). A failing agent run
    // scoped to a different organization than this investigation is a
    // security incident, never an ordinary transient/permanent failure --
    // it must never fall through to classifyFailure().
    const crossTenant = failingAgentRun !== null && failingAgentRun.organization_id !== context.orgId;
    const failureClass: FailureClass = crossTenant ? "cross_tenant" : this.classifyFailure(errorText);

    const tokensUsed = await this.tryUseTool(context, runner, "T-MODEL", 80);

    const delegations: DelegationRequest[] = [];
    let newResearchRun: ResearchRun | null = null;
    let plan: RecoveryPlan;
    let idempotencyStatus: string | null = null;

    if (failureClass === "cross_tenant") {
      plan = {
        failedResearchRunId: failedRunId,
        failureClass,
        failedAgentId: failingAgentRun?.agent_id ?? null,
        action: "escalate",
        detail: {
          reason: "Failing agent run belongs to a different organization than this recovery investigation -- quarantined as a security incident rather than recovered automatically.",
          failingOrganizationId: failingAgentRun?.organization_id ?? null,
        },
      };
      await this.escalate(context, failedRunId, plan, "urgent");
    } else if (failureClass === "transient") {
      // 3. Idempotency guard against recursive replay (spec: "the same plan
      // cannot replay recursively"; §17 "reproduced faults stop repetition
      // and reopen causal analysis"). If a recovery run was already spawned
      // for this failure, it has already been through automated recovery
      // once -- never spawn a second one; escalate instead.
      const existingRecoveryRun = await this.findExistingRecoveryRun(context.orgId, failedRunId);
      if (existingRecoveryRun) {
        idempotencyStatus = "CONFIRMED_EXECUTED_MULTIPLE";
        plan = {
          failedResearchRunId: failedRunId,
          failureClass,
          failedAgentId: failingAgentRun?.agent_id ?? null,
          action: "escalate",
          detail: {
            reason: `Research run ${failedRunId} has already been through automated recovery once (recovery run ${existingRecoveryRun.id}) and failed again -- refusing to replay the same recovery plan recursively.`,
            priorRecoveryRunId: existingRecoveryRun.id,
          },
        };
        await this.escalate(context, failedRunId, plan);
      } else {
        // 4. Propose a retry plan with modified tool parameters.
        const modifiedParams = { timeoutMs: 60000, backoffMs: 5000, maxRetries: 2 };
        plan = {
          failedResearchRunId: failedRunId,
          failureClass,
          failedAgentId: failingAgentRun?.agent_id ?? null,
          action: "retry",
          detail: { modifiedParams },
        };
        newResearchRun = await this.spawnRecoveryRun(context, failedRun, { recovery_of: failedRunId, recovery_action: "retry", modifiedParams });
        if (failingAgentRun) {
          delegations.push({
            childAgentCode: failingAgentRun.agent_id,
            objective: `Retry the failed step from research run ${failedRunId} with modified parameters`,
            maxAutonomy: "A2",
            constraints: { modifiedParams },
          });
        }
      }
    } else if (failureClass === "permanent") {
      // 5. Propose alternative research paths using different sources.
      const activeSources = await listActiveSources();
      const alternativeSourceKeys = activeSources.map((s) => s.source_key).slice(0, 3);
      if (alternativeSourceKeys.length === 0) {
        plan = {
          failedResearchRunId: failedRunId,
          failureClass,
          failedAgentId: failingAgentRun?.agent_id ?? null,
          action: "escalate",
          detail: { reason: "No alternative active sources available for this failure." },
        };
        await this.escalate(context, failedRunId, plan);
      } else {
        plan = {
          failedResearchRunId: failedRunId,
          failureClass,
          failedAgentId: failingAgentRun?.agent_id ?? null,
          action: "alternative_path",
          detail: { alternativeSourceKeys },
        };
        newResearchRun = await this.spawnRecoveryRun(context, failedRun, { recovery_of: failedRunId, recovery_action: "alternative_path", alternativeSourceKeys });
      }
    } else {
      // 7. Could not classify the failure -- escalate rather than guess at a
      // recovery strategy blind (bounded-retry ceiling, matches the FORGE
      // queue's max_retries_per_prompt convention referenced in this agent's
      // spec entry).
      plan = {
        failedResearchRunId: failedRunId,
        failureClass,
        failedAgentId: failingAgentRun?.agent_id ?? null,
        action: "escalate",
        detail: { reason: "Could not classify failure signature.", errorText },
      };
      await this.escalate(context, failedRunId, plan);
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "recovery.plan_created",
      resource_type: "pil_research_runs",
      resource_id: failedRunId,
      before_state: null,
      after_state: { plan, newResearchRunId: newResearchRun?.id ?? null, idempotencyStatus, failureClass },
      policy_decision: null,
      ip_address: null,
    });

    return {
      status: plan.action === "escalate" ? "escalated" : "completed",
      evidence: [],
      conclusions: { plan, newResearchRunId: newResearchRun?.id ?? null, lastStep, failingAgentRun, idempotencyStatus },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private classifyFailure(errorText: string): FailureClass {
    const lower = errorText.toLowerCase();
    if (TRANSIENT_KEYWORDS.some((k) => lower.includes(k))) return "transient";
    if (PERMANENT_KEYWORDS.some((k) => lower.includes(k))) return "permanent";
    return "unknown";
  }

  // Reused precedence check (spec: "the same plan cannot replay
  // recursively"). No dedicated pil_recovery_cases table exists in the
  // applied schema, so this reuses pil_research_runs the same way
  // BEN-SUP-01's checkUnresolvedRecovery does: any row whose
  // structured_plan.recovery_of matches this failure was spawned by
  // spawnRecoveryRun below for this exact failure already.
  private async findExistingRecoveryRun(orgId: string, failedRunId: string): Promise<ResearchRun | null> {
    const { data, error } = await getPilClient().from("pil_research_runs").select("*").eq("organization_id", orgId);
    if (error) throw error;
    const runs = (data ?? []) as ResearchRun[];
    return runs.find((run) => (run.structured_plan as { recovery_of?: string } | null)?.recovery_of === failedRunId) ?? null;
  }

  private async spawnRecoveryRun(context: AgentContext, failedRun: ResearchRun | null, metadata: Record<string, unknown>): Promise<ResearchRun> {
    return createResearchRun({
      orgId: context.orgId,
      prospectId: failedRun?.prospect_id ?? null,
      runType: (failedRun?.structured_plan as { run_type?: string } | null)?.run_type,
      goal: failedRun?.natural_language_query ?? context.goal,
      triggeredBy: context.agentCode,
    }).then(async (run) => {
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "recovery.run_spawned",
        resource_type: "pil_research_runs",
        resource_id: run.id,
        before_state: null,
        after_state: metadata,
        policy_decision: null,
        ip_address: null,
      });
      return run;
    });
  }

  private async escalate(context: AgentContext, failedRunId: string, plan: RecoveryPlan, priority: HumanReviewPriority = "high"): Promise<void> {
    await createReviewItem({
      organization_id: context.orgId,
      review_type: "high_impact_action",
      subject_type: "pil_research_runs",
      subject_id: failedRunId,
      requested_by_agent_id: context.agentCode,
      priority,
      status: "pending",
      summary: `Research run ${failedRunId} could not be automatically recovered: ${JSON.stringify(plan.detail)}`,
      evidence_refs: [],
      assigned_to_user_id: null,
      resolved_at: null,
    });
  }

  private async loadResearchRun(id: string): Promise<ResearchRun | null> {
    const { data, error } = await getPilClient().from("pil_research_runs").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as ResearchRun | null) ?? null;
  }

  private async loadSteps(researchRunId: string): Promise<ResearchRunStep[]> {
    const { data, error } = await getPilClient().from("pil_research_run_steps").select("*").eq("research_run_id", researchRunId);
    if (error) throw error;
    return (data ?? []) as ResearchRunStep[];
  }

  private async loadFailedAgentRuns(orgId: string, researchRunId: string): Promise<AgentRun[]> {
    const { data, error } = await getPilClient()
      .from("pil_agent_runs")
      .select("*")
      .eq("organization_id", orgId)
      .eq("research_run_id", researchRunId)
      .eq("status", "failed");
    if (error) throw error;
    return (data ?? []) as AgentRun[];
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

export default ResearchRecoveryInvestigatorAgent;
