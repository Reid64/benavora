import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { logAction } from "@/lib/pil/audit";
import { createReviewItem } from "@/lib/pil/human-review";
import type { AgentDefinition, AgentRun, AutonomyLevel, DelegatedTask, FeatureFlag, HumanReviewItem } from "@/lib/pil/types";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";

// BEN-SUP-07 -- Autonomy Governor
// Kill-switch and policy-enforcement supervisor for the Prospect Intelligence
// Layer fleet. Not part of PROSPECT_INTELLIGENCE_AGENTS.md's documented
// Family 1 (that document defines exactly 6 supervisory agents,
// BEN-SUP-01..06) -- this agent and BEN-SUP-08 are additions this task
// explicitly directed building; both are registered in pil_agent_registry by
// migration 163 so AgentRunner can actually execute them.
//
// Runs continuously: each execute() call is one governance sweep over the
// calling org's active runs/delegations (context.orgId), meant to be invoked
// on a recurring cadence by an external scheduler -- the same pattern this
// codebase already uses for other continuous supervisors (e.g.
// worker/queue-processor.ts's setInterval loop), not a retry loop inside
// this agent itself.

const AUTONOMY_ORDER: Record<AutonomyLevel, number> = { A0: 0, A1: 1, A2: 2, A3: 3, A4: 4 };
const ACTIVE_RUN_STATUSES = ["queued", "planning", "running", "observing", "replanning"];
const ACTIVE_DELEGATION_STATUSES = ["pending", "accepted", "running"];
const SELF_APPROVAL_REVIEW_TYPES = ["autonomy_increase", "policy_exception"];
export type ViolationType =
  | "autonomy_ceiling_exceeded"
  | "delegation_exceeds_parent"
  | "kill_switch_active"
  | "self_approved_authority_increase";

export interface AutonomyViolation {
  type: ViolationType;
  agentRunId: string | null;
  delegatedTaskId: string | null;
  reviewItemId: string | null;
  agentCode: string;
  detail: string;
}

export class AutonomyGovernorAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    // 1. Monitor all active agent runs (and delegations, and kill switches)
    // for the org this sweep covers.
    const [activeRuns, agentDefs, activeDelegations, killSwitches, selfApprovedItems] = await Promise.all([
      this.loadActiveRuns(context.orgId),
      this.loadAgentRegistry(),
      this.loadActiveDelegations(context.orgId),
      this.loadEnabledKillSwitches(),
      this.loadSelfApprovedReviewItems(context.orgId),
    ]);
    const agentByCode = new Map(agentDefs.map((a) => [a.agent_id, a]));

    const tokensUsed = await this.tryUseTool(context, runner, "T-MODEL", 40);

    const violations: AutonomyViolation[] = [];

    // 2. Intercept any agent_run that requests an autonomy level higher than
    // its own registry definition allows.
    for (const run of activeRuns) {
      const def = agentByCode.get(run.agent_id);
      if (!def || !run.autonomy_level_used) continue;
      if (AUTONOMY_ORDER[run.autonomy_level_used] > AUTONOMY_ORDER[def.default_autonomy_level]) {
        violations.push({
          type: "autonomy_ceiling_exceeded",
          agentRunId: run.id,
          delegatedTaskId: null,
          reviewItemId: null,
          agentCode: run.agent_id,
          detail: `Run ${run.id} used autonomy ${run.autonomy_level_used} but agent ${run.agent_id} is ceilinged at ${def.default_autonomy_level}`,
        });
      }
    }

    // 3. Intercept any delegation where the child's granted max_autonomy
    // would exceed the parent's own registry ceiling.
    for (const task of activeDelegations) {
      const parentDef = agentByCode.get(task.parent_agent_id);
      if (!parentDef) continue;
      if (AUTONOMY_ORDER[task.max_autonomy] > AUTONOMY_ORDER[parentDef.default_autonomy_level]) {
        violations.push({
          type: "delegation_exceeds_parent",
          agentRunId: null,
          delegatedTaskId: task.task_id,
          reviewItemId: null,
          agentCode: task.child_agent_id,
          detail: `Delegation ${task.task_id} grants ${task.child_agent_id} autonomy ${task.max_autonomy}, exceeding parent ${task.parent_agent_id}'s ceiling ${parentDef.default_autonomy_level}`,
        });
      }
    }

    // 4. Check active runs against kill switch flags.
    if (killSwitches.length > 0) {
      const platformKill = killSwitches.some((f) => f.scope_type === "platform");
      const orgKill = killSwitches.some((f) => f.scope_type === "org" && f.scope_id === context.orgId);
      const killedAgentCodes = new Set(killSwitches.filter((f) => f.scope_type === "agent").map((f) => f.scope_id));
      const globalKill = platformKill || orgKill;
      for (const run of activeRuns) {
        if (globalKill || killedAgentCodes.has(run.agent_id)) {
          violations.push({
            type: "kill_switch_active",
            agentRunId: run.id,
            delegatedTaskId: null,
            reviewItemId: null,
            agentCode: run.agent_id,
            detail: `Kill switch active for ${globalKill ? "platform/org scope" : `agent ${run.agent_id}`}`,
          });
        }
      }
    }

    // 5. Agents cannot approve their own authority increases or policy
    // exceptions -- a pil_human_review_queue row of either type that reached
    // 'approved' with no assigned human reviewer never went through a real
    // human decision (submitReviewDecision always requires a human actor).
    for (const item of selfApprovedItems) {
      violations.push({
        type: "self_approved_authority_increase",
        agentRunId: null,
        delegatedTaskId: null,
        reviewItemId: item.id,
        agentCode: item.requested_by_agent_id ?? "unknown",
        detail: `Review item ${item.id} (${item.review_type}) reached 'approved' without an assigned human reviewer`,
      });
    }

    // 6. Terminate violating runs immediately and log every violation.
    const terminatedRunIds: string[] = [];
    for (const violation of violations) {
      if (violation.agentRunId) {
        await this.terminateRun(violation.agentRunId, violation.detail);
        terminatedRunIds.push(violation.agentRunId);
      }

      const resourceType = violation.agentRunId ? "pil_agent_runs" : violation.delegatedTaskId ? "pil_delegated_tasks" : "pil_human_review_queue";
      const resourceId = violation.agentRunId ?? violation.delegatedTaskId ?? violation.reviewItemId ?? context.runId;

      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "AUTONOMY_VIOLATION",
        resource_type: resourceType,
        resource_id: resourceId,
        before_state: null,
        after_state: { violationType: violation.type, agentCode: violation.agentCode, detail: violation.detail },
        policy_decision: "deny",
        ip_address: null,
      });

      // 7. Human review for every violation.
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "policy_exception",
        subject_type: resourceType,
        subject_id: resourceId,
        requested_by_agent_id: context.agentCode,
        priority: "urgent",
        status: "pending",
        summary: `Autonomy violation (${violation.type}) for agent ${violation.agentCode}: ${violation.detail}`,
        evidence_refs: [],
        assigned_to_user_id: null,
        resolved_at: null,
      });
    }

    return {
      status: "completed",
      evidence: [],
      conclusions: {
        violations,
        terminatedRunIds,
        sweepScope: { activeRuns: activeRuns.length, activeDelegations: activeDelegations.length, killSwitches: killSwitches.length },
      },
      delegations: [],
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
      error: null,
    };
  }

  private async terminateRun(runId: string, reason: string): Promise<void> {
    const { error } = await getPilClient()
      .from("pil_agent_runs")
      .update({ status: "failed", error: `AUTONOMY_VIOLATION: ${reason}`, completed_at: new Date().toISOString() })
      .eq("id", runId);
    if (error) throw error;
  }

  private async loadActiveRuns(orgId: string): Promise<AgentRun[]> {
    const { data, error } = await getPilClient()
      .from("pil_agent_runs")
      .select("*")
      .eq("organization_id", orgId)
      .in("status", ACTIVE_RUN_STATUSES);
    if (error) throw error;
    return (data ?? []) as AgentRun[];
  }

  private async loadAgentRegistry(): Promise<AgentDefinition[]> {
    const { data, error } = await getPilClient().from("pil_agent_registry").select("*");
    if (error) throw error;
    return (data ?? []) as AgentDefinition[];
  }

  private async loadActiveDelegations(orgId: string): Promise<DelegatedTask[]> {
    const { data, error } = await getPilClient()
      .from("pil_delegated_tasks")
      .select("*")
      .eq("organization_id", orgId)
      .in("status", ACTIVE_DELEGATION_STATUSES);
    if (error) throw error;
    return (data ?? []) as DelegatedTask[];
  }

  private async loadEnabledKillSwitches(): Promise<FeatureFlag[]> {
    const { data, error } = await getPilClient().from("pil_feature_flags").select("*").eq("enabled", true);
    if (error) throw error;
    return (data ?? []) as FeatureFlag[];
  }

  private async loadSelfApprovedReviewItems(orgId: string): Promise<HumanReviewItem[]> {
    const { data, error } = await getPilClient()
      .from("pil_human_review_queue")
      .select("*")
      .eq("organization_id", orgId)
      .in("review_type", SELF_APPROVAL_REVIEW_TYPES)
      .eq("status", "approved")
      .is("assigned_to_user_id", null);
    if (error) throw error;
    return (data ?? []) as HumanReviewItem[];
  }

  private async tryUseTool(context: AgentContext, runner: AgentRunner, tool: string, units: number): Promise<number> {
    if (!context.tools.includes(tool)) return 0;
    try {
      const rate = await pilBlendedTokenRateUsd();
      await runner.useTool(context, tool, { unitCost: rate, units, costType: "model_tokens", model: PIL_AGENT_MODEL });
      return units;
    } catch {
      return 0;
    }
  }
}

export default AutonomyGovernorAgent;
