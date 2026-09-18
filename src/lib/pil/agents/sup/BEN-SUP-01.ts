import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { pilResearchRuns, pilProspects, getPilClient } from "@/lib/pil/db";
import { createResearchRun, advanceRunState } from "@/lib/pil/workflow";
import { logAction } from "@/lib/pil/audit";
import { createReviewItem } from "@/lib/pil/human-review";
import type { AgentRun, AgentRunStatus, PolicyDecision, Prospect, ResearchRun } from "@/lib/pil/types";
import { serializePilError } from "@/lib/pil/serialize-error";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";

// BEN-SUP-01 -- Chief Prospect Intelligence Orchestrator
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 1 -- SUPERVISORY & ORCHESTRATION").
// Owns the persistent prospect-intelligence objective for a tenant and
// coordinates the research fleet. Never scrapes sources itself -- it
// observes portfolio state, plans which agent families still owe research,
// dispatches pil_research_runs for the gaps, and delegates execution to
// BEN-SUP-02 (strategy), BEN-SUP-03 (planning), BEN-SUP-04 (allocation), and
// the Discovery family entry point.
//
// Conflict precedence (PIL_AGENT_COMPLETE_ROSTER.md BEN-SUP-01 section 23):
// constitution/policy > tenant/security/integrity quarantine > BEN-SUP-05
// blocking critic verdict > BEN-SUP-06 unresolved recovery > approved
// strategy (BEN-SUP-02) > validated plan (BEN-SUP-03) > allocation plan
// (BEN-SUP-04) > human decisions. This agent enforces the two precedence
// tiers it can evaluate directly from pil_policy_decisions/pil_research_runs
// (a pending BEN-SUP-05 deny verdict, or an unresolved BEN-SUP-06 recovery
// run) before it will ever report objectiveSatisfied=true or continue
// dispatching further strategy work.

type ResearchFamily = "discovery" | "prospect_intelligence" | "relationship_intelligence" | "qualification";

const ALL_FAMILIES: ResearchFamily[] = [
  "discovery",
  "prospect_intelligence",
  "relationship_intelligence",
  "qualification",
];

const FAMILY_KEYWORDS: Record<ResearchFamily, string[]> = {
  discovery: ["find", "discover", "identify", "surface", "new prospect", "candidate"],
  prospect_intelligence: ["wealth", "capacity", "foundation", "corporate", "business", "dossier", "profile"],
  relationship_intelligence: ["relationship", "connection", "network", "board", "introduc", "warm path"],
  qualification: ["qualify", "qualification", "score", "rank", "prioritiz", "readiness"],
};

const STRATEGY_ARCHITECT_AGENT = "BEN-SUP-02";
const PLANNER_AGENT = "BEN-SUP-03";
const ALLOCATOR_AGENT = "BEN-SUP-04";
const CRITIC_AGENT = "BEN-SUP-05";
const DISCOVERY_ENTRYPOINT_AGENT = "BEN-DIS-01";
// Recovery/duplicate-delivery handling for the loadRunsForProspect() calls
// (PIL_AGENT_COMPLETE_ROSTER.md's per-failure-type recovery table). Budget
// exhaustion is not retried -- it halts the cycle and escalates to a human.
class OrchestratorBudgetExhaustedError extends Error {}

// Discovery and qualification bracket every research objective (spec §6:
// every path starts by finding/confirming the entity and ends by qualifying
// it), so both are always required regardless of goal phrasing.
function classifyGoal(goal: string): ResearchFamily[] {
  const lower = goal.toLowerCase();
  const matched = new Set<ResearchFamily>(
    ALL_FAMILIES.filter((family) => FAMILY_KEYWORDS[family].some((keyword) => lower.includes(keyword))),
  );
  matched.add("discovery");
  matched.add("qualification");
  matched.add("prospect_intelligence");
  return Array.from(matched);
}

function familyOfRun(run: ResearchRun): ResearchFamily | null {
  const plan = run.structured_plan as { agent_family?: string; run_type?: string } | null;
  const family = plan?.agent_family ?? plan?.run_type ?? null;
  return (ALL_FAMILIES as string[]).includes(family ?? "") ? (family as ResearchFamily) : null;
}

function tallyStatuses(runs: ResearchRun[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const run of runs) counts[run.status] = (counts[run.status] ?? 0) + 1;
  return counts;
}

export class ChiefProspectIntelligenceOrchestrator implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    try {
      return await this.runCycle(context, runner);
    } catch (err) {
      if (err instanceof OrchestratorBudgetExhaustedError) {
        return this.handleBudgetExhaustion(context, err.message);
      }
      throw err;
    }
  }

  private async runCycle(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    // 1. Observe current research state for the prospect.
    const priorRuns = context.prospectId ? await this.loadRunsForProspectWithRecovery(context, context.prospectId) : [];

    const completedFamilies = new Set(
      priorRuns.filter((r) => r.status === "completed").map(familyOfRun).filter((f): f is ResearchFamily => f !== null),
    );
    const activeFamilies = new Set(
      priorRuns
        .filter((r) => r.status === "planning" || r.status === "running")
        .map(familyOfRun)
        .filter((f): f is ResearchFamily => f !== null),
    );

    // 2. Assess what has been completed vs what the goal requires.
    const requiredFamilies = classifyGoal(context.goal);
    const gapFamilies = requiredFamilies.filter((f) => !completedFamilies.has(f) && !activeFamilies.has(f));

    // 3. Form the research plan.
    const plan = {
      requiredFamilies,
      completedFamilies: Array.from(completedFamilies),
      activeFamilies: Array.from(activeFamilies),
      gapFamilies,
    };
    await this.recordDecision(context, "orchestrator.plan_formed", { plan });

    const tokensUsed = await this.tryUseTool(context, runner, "T-MODEL", 200);

    // 4. Create and dispatch a pil_research_runs row per required agent
    // family that has no completed or in-flight coverage yet.
    const dispatchedRunIds: string[] = [];
    for (const family of gapFamilies) {
      const run = await createResearchRun({
        orgId: context.orgId,
        prospectId: context.prospectId,
        runType: family,
        goal: context.goal,
        triggeredBy: context.agentCode,
      });
      await advanceRunState(run.id, "running", { agent_family: family, dispatched_by: context.agentCode });
      dispatchedRunIds.push(run.id);
    }

    // 5. Monitor progress across all delegated runs for this prospect.
    const allRuns = context.prospectId
      ? await this.loadRunsForProspectWithRecovery(context, context.prospectId)
      : priorRuns;
    const statusCounts = tallyStatuses(allRuns);

    // 5b. Precedence check (roster section 23): a pending BEN-SUP-05 blocking
    // critic verdict or an unresolved BEN-SUP-06 recovery run for this
    // prospect/research run outranks the ordinary gap-based evaluation below.
    const researchRunIds = Array.from(new Set([context.runId, ...allRuns.map((r) => r.id)]));
    const blockedByCriticVerdict = await this.checkCriticBlock(context.orgId, researchRunIds);
    const blockedByUnresolvedRecovery = this.checkUnresolvedRecovery(allRuns);

    if (blockedByCriticVerdict || blockedByUnresolvedRecovery) {
      await this.recordDecision(context, "orchestrator.blocked_by_precedence", {
        blockedByCriticVerdict,
        blockedByUnresolvedRecovery,
      });
    }

    // 6. Evaluate aggregate results: the objective is satisfied only when
    // every required family already had completed coverage BEFORE this
    // cycle dispatched anything new, AND no higher-precedence block exists.
    const gapClosed = gapFamilies.length === 0 && requiredFamilies.every((f) => completedFamilies.has(f));
    const objectiveSatisfied = gapClosed && !blockedByCriticVerdict && !blockedByUnresolvedRecovery;

    // p5.2b (2026-09-15): was `... : objectiveSatisfied ? "completed" : "running"` --
    // "running" is the in-progress placeholder AgentRunner.createRun() itself
    // inserts; it is never a valid AgentResult a runner returns (confirmed
    // live: this made every non-satisfied evaluation pass leave its own
    // pil_agent_runs row stuck at status='running' forever). Whether the
    // broader multi-cycle objective is satisfied is tracked separately (in
    // `conclusions.objectiveSatisfied`, read by callers/pil_research_runs) --
    // THIS run's own unit of work (plan, evaluate, dispatch) is complete
    // either way once it reaches here without being blocked. Also folds in
    // `blockedByUnresolvedRecovery`, which previously fell through to the
    // same "running" bug despite the comment above treating it as an
    // equal-precedence blocking condition to blockedByCriticVerdict.
    const status: AgentRunStatus =
      blockedByCriticVerdict || blockedByUnresolvedRecovery ? "blocked" : "completed";

    const conclusions: Record<string, unknown> = {
      plan,
      dispatchedRunIds,
      statusCounts,
      objectiveSatisfied,
      blockedByCriticVerdict,
      blockedByUnresolvedRecovery,
    };

    await this.recordDecision(context, "orchestrator.evaluated", {
      objectiveSatisfied,
      statusCounts,
      dispatchedRunIds,
      blockedByCriticVerdict,
      blockedByUnresolvedRecovery,
    });

    // 7. Escalate consequential conclusions to a human.
    if (objectiveSatisfied && context.prospectId) {
      const prospect = await this.loadProspect(context.orgId, context.prospectId);
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "high_impact_action",
        subject_type: "pil_prospects",
        subject_id: context.prospectId,
        requested_by_agent_id: context.agentCode,
        priority: "normal",
        status: "pending",
        summary: `Research objective satisfied for prospect ${prospect?.display_name ?? context.prospectId}: all required agent families (${requiredFamilies.join(", ")}) completed.`,
        evidence_refs: [],
        assigned_to_user_id: null,
        resolved_at: null,
      });
      conclusions.humanReviewCreated = true;
    }

    // Delegate to the Strategy Architect (and the Discovery entry point when
    // discovery itself is a gap), plus the Planner and Allocator once there
    // is dispatched/completed work for them to act on -- but only while no
    // higher-precedence block (BEN-SUP-05 critic denial) is in effect.
    // Under a critic block this cycle halts forward orchestration entirely
    // rather than continuing to fan out strategy work underneath it.
    const delegations: DelegationRequest[] = [];
    if (!objectiveSatisfied && !blockedByCriticVerdict) {
      delegations.push({
        childAgentCode: STRATEGY_ARCHITECT_AGENT,
        objective: `Formalize a research strategy for prospect ${context.prospectId ?? "(portfolio-level)"}: goal="${context.goal}"; gaps=${gapFamilies.join(",") || "none"}`,
        maxAutonomy: "A2",
      });
      if (gapFamilies.includes("discovery")) {
        delegations.push({
          childAgentCode: DISCOVERY_ENTRYPOINT_AGENT,
          objective: `Discover candidate prospects matching goal="${context.goal}"`,
          maxAutonomy: "A2",
        });
      }
      if (dispatchedRunIds.length > 0) {
        const objective = `Produce an execution plan for the dispatched research runs (prospect ${context.prospectId ?? "(portfolio-level)"})`;
        delegations.push({ childAgentCode: PLANNER_AGENT, objective, maxAutonomy: "A2" });
        await this.recordDecision(context, "orchestrator.delegated", { childAgentCode: PLANNER_AGENT, objective });
      }
      if (completedFamilies.size > 0) {
        const objective = `Allocate portfolio budget across in-flight research for prospect ${context.prospectId ?? "(portfolio-level)"}`;
        delegations.push({ childAgentCode: ALLOCATOR_AGENT, objective, maxAutonomy: "A2" });
        await this.recordDecision(context, "orchestrator.delegated", { childAgentCode: ALLOCATOR_AGENT, objective });
      }
    }

    return {
      status,
      evidence: [],
      conclusions,
      delegations,
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
      error: null,
    };
  }

  // Loads research runs for the prospect, recovering once from a
  // duplicate-delivery error (retries a single fresh reload) and escalating
  // budget-exhaustion errors to the caller as a non-retryable halt.
  private async loadRunsForProspectWithRecovery(context: AgentContext, prospectId: string): Promise<ResearchRun[]> {
    try {
      return await this.loadRunsForProspect(context.orgId, prospectId);
    } catch (err) {
      const message = serializePilError(err);
      if (/duplicate|conflict/i.test(message)) {
        await this.recordDecision(context, "orchestrator.duplicate_delivery_recovered", { error: message });
        return await this.loadRunsForProspect(context.orgId, prospectId);
      }
      if (/budget|exhausted/i.test(message)) {
        throw new OrchestratorBudgetExhaustedError(message);
      }
      throw err;
    }
  }

  private async handleBudgetExhaustion(context: AgentContext, message: string): Promise<AgentResult> {
    await createReviewItem({
      organization_id: context.orgId,
      review_type: "policy_exception",
      subject_type: "pil_research_runs",
      subject_id: context.runId,
      requested_by_agent_id: context.agentCode,
      priority: "high",
      status: "pending",
      summary: `BEN-SUP-01 orchestration cycle for prospect ${context.prospectId ?? "(portfolio-level)"} halted by budget exhaustion: ${message}`,
      evidence_refs: [],
      assigned_to_user_id: null,
      resolved_at: null,
    });
    return {
      status: "blocked",
      evidence: [],
      conclusions: { blockedByBudgetExhaustion: true, reason: message },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: null,
    };
  }

  // BEN-SUP-05 precedence check: true when the latest policy decision for
  // any critic_review:<agentRunId> action tied to this prospect/research
  // run's agent runs is a 'deny' (i.e. not overridden by a later row).
  private async checkCriticBlock(orgId: string, researchRunIds: string[]): Promise<boolean> {
    if (researchRunIds.length === 0) return false;
    const client = getPilClient();

    const { data: agentRuns, error: agentRunsError } = await client
      .from("pil_agent_runs")
      .select("*")
      .eq("organization_id", orgId)
      .in("research_run_id", researchRunIds);
    if (agentRunsError) throw agentRunsError;
    const agentRunIds = ((agentRuns ?? []) as AgentRun[]).map((r) => r.id);
    if (agentRunIds.length === 0) return false;

    const actionKeys = agentRunIds.map((id) => `critic_review:${id}`);
    const { data: decisions, error: decisionsError } = await client
      .from("pil_policy_decisions")
      .select("*")
      .eq("organization_id", orgId)
      .eq("actor_agent_id", CRITIC_AGENT)
      .in("action_requested", actionKeys)
      .order("created_at", { ascending: true });
    if (decisionsError) throw decisionsError;

    const latestByAction = new Map<string, PolicyDecision>();
    for (const decision of (decisions ?? []) as PolicyDecision[]) {
      latestByAction.set(decision.action_requested, decision);
    }
    return Array.from(latestByAction.values()).some((d) => d.decision === "deny");
  }

  // BEN-SUP-06 precedence check: no dedicated pil_recovery_cases table
  // exists in the applied schema (confirmed against supabase/migrations/),
  // so this reuses the pil_research_runs rows already loaded for the
  // prospect -- any run whose structured_plan.recovery_of is set (spawned by
  // ResearchRecoveryInvestigatorAgent.spawnRecoveryRun) and that has not
  // itself reached "completed" is treated as an unresolved recovery.
  private checkUnresolvedRecovery(runs: ResearchRun[]): boolean {
    return runs.some((run) => {
      const plan = run.structured_plan as { recovery_of?: string } | null;
      return Boolean(plan?.recovery_of) && run.status !== "completed";
    });
  }

  private async loadRunsForProspect(orgId: string, prospectId: string): Promise<ResearchRun[]> {
    const { data, error } = await pilResearchRuns(orgId).eq("prospect_id", prospectId);
    if (error) throw error;
    return (data ?? []) as ResearchRun[];
  }

  private async loadProspect(orgId: string, prospectId: string): Promise<Prospect | null> {
    const { data, error } = await pilProspects(orgId).eq("id", prospectId).maybeSingle();
    if (error) throw error;
    return (data as Prospect | null) ?? null;
  }

  private async recordDecision(context: AgentContext, action: string, state: Record<string, unknown>): Promise<void> {
    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action,
      resource_type: "pil_research_runs",
      resource_id: context.runId,
      before_state: null,
      after_state: state,
      policy_decision: null,
      ip_address: null,
    });
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

export default ChiefProspectIntelligenceOrchestrator;
