import { getPilClient } from "@/lib/pil/db";
import { loadAgent } from "@/lib/pil/agent-registry-service";
import { loadAgentImpl } from "@/lib/pil/agents";
import { logAction } from "@/lib/pil/audit";
import { checkBudget, recordCost } from "@/lib/pil/cost";
import { canDelegate, checkAgentAuthorization, PolicyViolationError } from "@/lib/pil/policy";
import { createReviewItem } from "@/lib/pil/human-review";
import { agentEventsLogged, agentRunDuration } from "@/lib/observability/metrics";
import { serializePilError } from "@/lib/pil/serialize-error";
import type { AgentRun, AgentRunStatus, AutonomyLevel } from "@/lib/pil/types";

// The closed reasoning/execution loop harness
// (PROSPECT_INTELLIGENCE_ARCHITECTURE.md Section 1.2/1.3). One AgentRunner.run()
// call corresponds to exactly one pil_agent_runs row.

export interface AgentContext {
  agentCode: string;
  orgId: string;
  prospectId: string | null;
  runId: string;
  goal: string;
  plan: Record<string, unknown>;
  tools: string[];
  budget: number;
  depth: number;
}

export interface DelegationRequest {
  childAgentCode: string;
  objective: string;
  maxAutonomy: AutonomyLevel;
  constraints?: Record<string, unknown>;
}

export interface AgentResult {
  status: AgentRunStatus;
  evidence: unknown[];
  conclusions: Record<string, unknown>;
  delegations: DelegationRequest[];
  tokensUsed: number;
  costUsd: number;
  error: string | null;
}

export interface Agent {
  execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult>;
}

export class ToolNotPermittedError extends Error {
  constructor(toolName: string, agentCode: string) {
    super(`Tool "${toolName}" is not in the permitted tool set for agent ${agentCode}`);
    this.name = "ToolNotPermittedError";
  }
}

export class AgentRunner {
  // Concrete agent implementations (PIL-03+) register themselves here by
  // agent_id; pil_agent_registry (agent-registry-service.ts) only carries
  // metadata (mission, autonomy ceiling, cadence) -- it holds no executable
  // code for the runner to invoke.
  private static implementations = new Map<string, Agent>();

  static registerImplementation(agentCode: string, agent: Agent): void {
    AgentRunner.implementations.set(agentCode, agent);
  }

  async run(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();
    const observeRun = (status: AgentRunStatus, family: string) => {
      agentRunDuration.labels(context.agentCode, family, status).observe((Date.now() - startTime) / 1000);
      agentEventsLogged.labels(context.agentCode, "run_completed", status === "failed" ? "error" : "info").inc();
    };

    const agentDef = await loadAgent(context.agentCode);
    if (!agentDef.active) {
      throw new PolicyViolationError(`Agent ${context.agentCode} is not active`);
    }

    // p5.2b (2026-09-15): was hardcoded to "execute_reversible" (min A3),
    // which per PROSPECT_INTELLIGENCE_ARCHITECTURE.md §2's own table is the
    // tier for "execute pre-authorized, low-risk, REVERSIBLE operations"
    // (its own examples: BEN-SUP-04 pausing a goal, BEN-KNW-01 applying an
    // accepted twin update) — not the generic act of an agent doing its own
    // per-family work. §2's A2 ("Prepare & Queue") tier is "write evidence,
    // create dossiers/briefs, draft rows, delegate" — exactly what the
    // large majority of the 51 registered agents' `default_autonomy_level`
    // was set to, and exactly what most of them actually do (write
    // pil_evidence, propose scores, delegate). The blanket "execute_reversible"
    // check meant every A2-ceilinged agent (40 of 51, confirmed live) threw
    // "ceilinged at A2, requires A3" before ever reaching its own logic.
    // "write_evidence" (A1) is used here instead of "prepare_queue" (A2) so
    // this floor doesn't ALSO newly block BEN-OPS-01 (deliberately A1 —
    // its whole mission is "propose," per its own Human boundary, and it's
    // correctly barred from ever reaching A2/"prepare_queue" work). This is
    // a floor check only: any agent needing a genuinely higher-consequence
    // action should still gate that specific action via a dedicated,
    // narrower check (enforceAutonomyLevel), not by raising this blanket
    // per-run gate again.
    const policyDecision = await checkAgentAuthorization(
      context.agentCode,
      "write_evidence",
      "agent_research_execution",
      context.orgId,
    );

    if (policyDecision.decision === "deny") {
      throw new PolicyViolationError(policyDecision.reason);
    }

    if (policyDecision.decision === "require_human") {
      const blockedRun = await this.createRun(context, agentDef.default_autonomy_level, "blocked");
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "policy_exception",
        subject_type: "pil_agent_runs",
        subject_id: blockedRun.id,
        requested_by_agent_id: context.agentCode,
        priority: "normal",
        status: "pending",
        summary: `Agent ${context.agentCode} requires human review: ${policyDecision.reason}`,
        evidence_refs: [],
        assigned_to_user_id: null,
        resolved_at: null,
      });
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "agent_run.blocked",
        resource_type: "pil_agent_runs",
        resource_id: blockedRun.id,
        before_state: null,
        after_state: { status: "blocked" },
        policy_decision: policyDecision.decision,
        ip_address: null,
      });
      observeRun("blocked", agentDef.family);
      return {
        status: "blocked",
        evidence: [],
        conclusions: {},
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: null,
      };
    }

    await checkBudget(context.orgId);

    const agentRun = await this.createRun(context, agentDef.default_autonomy_level, "running");

    // Explicitly-registered implementations (used by tests to stub an
    // agent) win over the real factory; everything else resolves through
    // agents/index.ts, which falls back to a graceful NotImplementedAgent
    // for any agent_id without a concrete implementation yet.
    const implementation = AgentRunner.implementations.get(context.agentCode) ?? loadAgentImpl(context.agentCode);

    let result: AgentResult;
    try {
      result = await implementation.execute(context, this);
    } catch (err) {
      const message = serializePilError(err);
      await this.finalizeRun(agentRun, context, "failed", {}, 0, 0, message);
      observeRun("failed", agentDef.family);
      return {
        status: "failed",
        evidence: [],
        conclusions: {},
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: message,
      };
    }

    let finalStatus: AgentRunStatus = result.status;

    if (result.delegations.length > 0 && context.depth > 0) {
      for (const delegation of result.delegations) {
        const authorized = await canDelegate(
          context.agentCode,
          delegation.childAgentCode,
          delegation.maxAutonomy,
        );
        if (!authorized) {
          const message = `Delegation from ${context.agentCode} to ${delegation.childAgentCode} at ${delegation.maxAutonomy} exceeds parent authority`;
          await this.finalizeRun(agentRun, context, "failed", result.conclusions, result.tokensUsed, result.costUsd, message);
          observeRun("failed", agentDef.family);
          return { ...result, status: "failed", error: message };
        }
        await this.delegate(context, agentRun.id, delegation);
      }
    } else if (result.delegations.length > 0 && context.depth <= 0) {
      finalStatus = "escalated";
    }

    await this.finalizeRun(
      agentRun,
      context,
      finalStatus,
      result.conclusions,
      result.tokensUsed,
      result.costUsd,
      result.error,
    );

    observeRun(finalStatus, agentDef.family);
    return { ...result, status: finalStatus };
  }

  // Validates a tool the agent implementation wants to call against the
  // context's permitted_tools set, then records its cost. Agent
  // implementations should route every tool invocation through this rather
  // than calling recordCost directly, so no tool call can bypass the
  // permitted-tools check.
  async useTool(
    context: AgentContext,
    toolName: string,
    cost: { unitCost: number; units: number; costType?: "model_tokens" | "api_call" | "licensed_data" | "browser_automation" | "storage"; agentRunId?: string | null },
  ): Promise<void> {
    if (!context.tools.includes(toolName)) {
      throw new ToolNotPermittedError(toolName, context.agentCode);
    }
    const costType = cost.costType ?? "api_call";
    // ai_usage_log has no research_run_id/delegated_task_id columns (unlike
    // the superseded pil_cost_ledger) -- that finer-grained attribution is
    // out of scope for AR-5.1's consolidation; pil_agent_run_id is preserved
    // as the run-attribution column. model is unknown at this call site (a
    // tool invocation, not necessarily a model call) so it falls back to
    // "unknown" to satisfy ai_usage_log.model's NOT NULL constraint.
    await recordCost({
      organization_id: context.orgId,
      model: "unknown",
      endpoint: costType,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: costType === "model_tokens" ? cost.units : 0,
      cost_usd: cost.units * cost.unitCost,
      duration_ms: null,
      agent_type: toolName,
      agent_run_id: null,
      pil_agent_run_id: cost.agentRunId ?? null,
      provider: "anthropic",
      billing_path: "api",
    });
  }

  private async createRun(
    context: AgentContext,
    autonomyLevel: AutonomyLevel,
    status: AgentRunStatus,
  ): Promise<AgentRun> {
    const { data, error } = await getPilClient()
      .from("pil_agent_runs")
      .insert({
        organization_id: context.orgId,
        agent_id: context.agentCode,
        research_run_id: context.runId,
        delegated_task_id: null,
        goal_id: null,
        status,
        autonomy_level_used: autonomyLevel,
        input: { goal: context.goal, plan: context.plan },
        output: null,
        tokens_consumed: 0,
        cost_usd: 0,
        started_at: new Date().toISOString(),
        completed_at: null,
        error: null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as AgentRun;
  }

  private async finalizeRun(
    agentRun: AgentRun,
    context: AgentContext,
    status: AgentRunStatus,
    conclusions: Record<string, unknown>,
    tokensUsed: number,
    costUsd: number,
    error: string | null,
  ): Promise<void> {
    await getPilClient()
      .from("pil_agent_runs")
      .update({
        status,
        output: conclusions,
        tokens_consumed: tokensUsed,
        cost_usd: costUsd,
        completed_at: new Date().toISOString(),
        error,
      })
      .eq("id", agentRun.id);

    if (tokensUsed > 0 || costUsd > 0) {
      // model is unknown here (the agent implementation doesn't report which
      // underlying model it called) -- falls back to "unknown", same as
      // useTool() above, to satisfy ai_usage_log.model's NOT NULL constraint.
      await recordCost({
        organization_id: context.orgId,
        model: "unknown",
        endpoint: "model_tokens",
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: tokensUsed,
        cost_usd: costUsd,
        duration_ms: null,
        agent_type: context.agentCode,
        agent_run_id: null,
        pil_agent_run_id: agentRun.id,
        provider: "anthropic",
        billing_path: "api",
      });
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: `agent_run.${status}`,
      resource_type: "pil_agent_runs",
      resource_id: agentRun.id,
      before_state: { status: agentRun.status },
      after_state: { status },
      policy_decision: null,
      ip_address: null,
    });
  }

  private async delegate(
    parentContext: AgentContext,
    parentAgentRunId: string,
    delegation: DelegationRequest,
  ): Promise<void> {
    const client = getPilClient();
    const { data, error } = await client
      .from("pil_delegated_tasks")
      .insert({
        organization_id: parentContext.orgId,
        parent_agent_run_id: parentAgentRunId,
        parent_agent_id: parentContext.agentCode,
        child_agent_id: delegation.childAgentCode,
        objective: delegation.objective,
        constraints: delegation.constraints ?? {},
        context_refs: [],
        allowed_tools: parentContext.tools,
        allowed_data_classes: [],
        prohibited_data_classes: [],
        evidence_budget: null,
        tool_budget: null,
        token_budget: parentContext.budget,
        financial_budget: null,
        deadline: null,
        freshness_requirement: null,
        minimum_confidence: null,
        success_criteria: {},
        stop_conditions: {},
        escalation_conditions: {},
        max_autonomy: delegation.maxAutonomy,
        status: "accepted",
        child_agent_run_id: null,
        delegation_depth: parentContext.depth - 1,
        cancelled_at: null,
      })
      .select("*")
      .single();
    if (error) throw error;
    const delegatedTask = data as { task_id: string };

    const childContext: AgentContext = {
      agentCode: delegation.childAgentCode,
      orgId: parentContext.orgId,
      prospectId: parentContext.prospectId,
      runId: parentContext.runId,
      goal: delegation.objective,
      plan: {},
      tools: parentContext.tools,
      budget: parentContext.budget,
      depth: parentContext.depth - 1,
    };

    const childRunner = new AgentRunner();
    try {
      const childResult = await childRunner.run(childContext);
      await client
        .from("pil_delegated_tasks")
        .update({ status: childResult.status === "failed" ? "failed" : "completed" })
        .eq("task_id", delegatedTask.task_id);
    } catch {
      await client
        .from("pil_delegated_tasks")
        .update({ status: "failed" })
        .eq("task_id", delegatedTask.task_id);
    }
  }
}
