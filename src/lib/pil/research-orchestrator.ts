import { getPilClient } from "@/lib/pil/db";
import { getAgentsByFamily } from "@/lib/pil/agent-registry-service";
import { AgentRunner } from "@/lib/pil/agent-runner";
import type { AgentContext, AgentResult } from "@/lib/pil/agent-runner";
import { listTools } from "@/lib/pil/tools";
import { advanceRunState, failRun } from "@/lib/pil/workflow";
import { logAction } from "@/lib/pil/audit";
import { createReviewItem } from "@/lib/pil/human-review";
import { populateQueue } from "@/lib/autoapply/auto-queue-populator";
import { WebhookNotifier } from "@/lib/autoapply/webhook-notifier";
import type { AgentFamily, ResearchRun, ResearchRunStatus } from "@/lib/pil/types";

// Worker that drives one pil_research_runs row through all 9 agent families
// in sequence (PROSPECT_INTELLIGENCE_ARCHITECTURE.md's family order:
// Supervisory -> Discovery -> Prospect Intelligence -> Relationship
// Intelligence -> Qualification -> Strategy -> Knowledge Integrity ->
// Operations -> Application), then hands qualified prospects to AutoApply.
//
// This deliberately does not follow a literal "status='pending' /
// pil_agent_run_events / per-family *_status columns" design -- none of
// those exist in the applied schema:
//   - ResearchRunStatus (types.ts) is exactly planning|running|completed|
//     failed|cancelled. There is no "pending" and no per-family status
//     column on pil_research_runs. Per-family progress is instead folded
//     into structured_plan (workflow.ts's own established pattern -- see
//     BEN-SUP-04.ts's pauseRun()), so a run can be resumed mid-family after
//     a restart without re-running already-completed agents.
//   - pil_agent_run_events does not exist anywhere in the schema (confirmed
//     by grep -- see BEN-SUP-04.ts's "Starvation guard" comment). Every
//     agent execution is already durably recorded as its own pil_agent_runs
//     row by AgentRunner.run(), and every family-boundary/run-lifecycle
//     event below goes through pil_audit_log (audit.ts), the schema's real
//     append-only event log.
//   - The agent roster per family is read live from pil_agent_registry
//     (getAgentsByFamily) rather than hardcoded, so newly-added/deactivated
//     agents (e.g. BEN-REL-07/08, migration 164) are picked up without
//     editing this file.
//   - BEN-SUP-08 (Executive Intelligence Narrative Agent) is registered
//     under the supervisory family but its mission is to synthesize a
//     *completed* run's evidence into pil_prospect_dossiers -- running it as
//     part of the initial SUP-family pass (before DIS/INT/REL/... have
//     gathered any evidence) would produce an empty dossier. It is excluded
//     from the generic SUP-family batch below and instead run once, on its
//     own, immediately before the run is marked completed.
//   - There is no separate "autoapply-queue-populator" webhook target in
//     this codebase. The real analog is src/lib/autoapply/auto-queue-
//     populator.ts's populateQueue() (an in-process call, run here directly
//     rather than over HTTP) plus WebhookNotifier's 'queue_populated' event
//     (webhook-notifier.ts), which is this codebase's actual outbound-
//     webhook mechanism for org-configured endpoints/Slack. Both are
//     invoked after a run completes.

const DOSSIER_AGENT_ID = "BEN-SUP-08";
const MAX_DELEGATION_DEPTH = 3;
// Fallback per-agent token budget when a run has no explicit token_budget
// (pil_research_runs.token_budget is nullable -- POST /api/pil/research
// never sets it today). AgentRunner.run() enforces the real spend limit via
// checkBudget()/cost_budgets; this value only seeds AgentContext.budget,
// which pil_delegated_tasks.token_budget inherits for any child delegation.
const DEFAULT_AGENT_TOKEN_BUDGET = 100_000;

const TERMINAL_STATUSES = new Set<ResearchRunStatus>(["completed", "failed", "cancelled"]);

const FAMILY_SEQUENCE: { code: string; family: AgentFamily }[] = [
  { code: "SUP", family: "supervisory" },
  { code: "DIS", family: "discovery" },
  { code: "INT", family: "prospect_intelligence" },
  { code: "REL", family: "relationship_intelligence" },
  { code: "QLF", family: "qualification" },
  { code: "STR", family: "strategy" },
  { code: "KNW", family: "knowledge_integrity" },
  { code: "OPS", family: "operations_evaluation_learning" },
  { code: "APP", family: "application" },
];

export class ResearchOrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchOrchestrationError";
  }
}

interface FamilyProgressEntry {
  status: "running" | "completed";
  completedAgents: string[];
  completedAt?: string;
}

type FamilyProgress = Partial<Record<string, FamilyProgressEntry>>;

async function getRunOrThrow(runId: string): Promise<ResearchRun> {
  const { data, error } = await getPilClient().from("pil_research_runs").select("*").eq("id", runId).single();
  if (error) throw error;
  return data as ResearchRun;
}

function getFamilyProgress(run: ResearchRun): FamilyProgress {
  const raw = (run.structured_plan as { family_progress?: unknown } | null)?.family_progress;
  return raw && typeof raw === "object" ? (raw as FamilyProgress) : {};
}

async function saveProgress(run: ResearchRun, progress: FamilyProgress): Promise<ResearchRun> {
  const { data, error } = await getPilClient()
    .from("pil_research_runs")
    .update({ structured_plan: { ...run.structured_plan, family_progress: progress } })
    .eq("id", run.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as ResearchRun;
}

async function executeFamilyAgent(run: ResearchRun, agentCode: string, permittedTools: string[]): Promise<AgentResult> {
  const context: AgentContext = {
    agentCode,
    orgId: run.organization_id,
    prospectId: run.prospect_id,
    runId: run.id,
    goal: run.natural_language_query ?? `Deep research on prospect ${run.prospect_id}`,
    plan: run.structured_plan,
    tools: permittedTools,
    budget: run.token_budget ?? DEFAULT_AGENT_TOKEN_BUDGET,
    depth: MAX_DELEGATION_DEPTH,
  };
  return new AgentRunner().run(context);
}

async function escalateFailure(run: ResearchRun, reason: string): Promise<void> {
  await createReviewItem({
    organization_id: run.organization_id,
    // "critic_block" is the closest existing pil_human_review_queue.review_type
    // (migration 160's CHECK constraint) for "a run stopped and needs a human
    // to look at it" -- the same value BEN-SUP-04/BEN-SUP-05 use for their own
    // run-level blocks.
    review_type: "critic_block",
    subject_type: "pil_research_runs",
    subject_id: run.id,
    // p5.2b (2026-09-15): was the literal "research-orchestrator", which is
    // not a row in pil_agent_registry -- pil_human_review_queue.requested_by_agent_id
    // has a real FK to that table (unlike logAction's actor_id below, which
    // has no such constraint), so every escalation crashed on an FK
    // violation instead of filing the review item, MASKING the real
    // `reason` this function exists to surface (confirmed live this
    // session: a real orchestration failure came back as an opaque FK
    // error instead). BEN-SUP-01 is this system's own registered "Chief
    // Prospect Intelligence Orchestrator" (see its own agent file), the
    // correct attribution for a run-level (not single-agent) escalation.
    requested_by_agent_id: "BEN-SUP-01",
    priority: "urgent",
    status: "pending",
    summary: `Research run ${run.id} failed: ${reason}`,
    evidence_refs: [],
    assigned_to_user_id: null,
    resolved_at: null,
  });
  await logAction({
    organization_id: run.organization_id,
    actor_type: "system",
    actor_id: "research-orchestrator",
    action: "research_run.escalated",
    resource_type: "pil_research_runs",
    resource_id: run.id,
    before_state: null,
    after_state: { reason },
    policy_decision: null,
    ip_address: null,
  });
}

async function runAutoApplyQueuePopulation(run: ResearchRun): Promise<void> {
  const client = getPilClient();
  try {
    const result = await populateQueue({ organizationId: run.organization_id, supabase: client, dry_run: false });
    await logAction({
      organization_id: run.organization_id,
      actor_type: "system",
      actor_id: "research-orchestrator",
      action: "research_run.queue_populated",
      resource_type: "pil_research_runs",
      resource_id: run.id,
      before_state: null,
      after_state: result,
      policy_decision: null,
      ip_address: null,
    });
    await new WebhookNotifier().notify({
      orgId: run.organization_id,
      event: "queue_populated",
      data: { count: result.queued, researchRunId: run.id, prospectId: run.prospect_id },
      supabase: client,
    });
  } catch (err) {
    // Queue population failing after a successful research run shouldn't
    // flip a completed run back to failed -- log it so a human notices via
    // the audit trail rather than losing the completed dossier.
    const message = err instanceof Error ? err.message : String(err);
    await logAction({
      organization_id: run.organization_id,
      actor_type: "system",
      actor_id: "research-orchestrator",
      action: "research_run.queue_population_failed",
      resource_type: "pil_research_runs",
      resource_id: run.id,
      before_state: null,
      after_state: { error: message },
      policy_decision: null,
      ip_address: null,
    });
  }
}

// Runs every active, non-dossier agent in each family in order. Returns
// `paused: true` if an agent came back "blocked" (requires human review --
// AgentRunner.run() already filed the pil_human_review_queue item and never
// executed the agent), so the run stays "running" and a later poll can
// resume it once that review is resolved, rather than treating a normal
// human-in-the-loop pause as a failure.
async function runFamilies(initialRun: ResearchRun, permittedTools: string[]): Promise<{ run: ResearchRun; paused: boolean }> {
  let run = initialRun;
  let progress = getFamilyProgress(run);

  for (const { code, family } of FAMILY_SEQUENCE) {
    if (progress[code]?.status === "completed") continue;

    const roster = (await getAgentsByFamily(family))
      .filter((agent) => agent.active && agent.agent_id !== DOSSIER_AGENT_ID)
      .sort((a, b) => a.agent_id.localeCompare(b.agent_id));

    const entry = progress[code] ?? { status: "running", completedAgents: [] };
    progress = { ...progress, [code]: entry };

    for (const agentDef of roster) {
      if (entry.completedAgents.includes(agentDef.agent_id)) continue;

      const result = await executeFamilyAgent(run, agentDef.agent_id, permittedTools);

      if (result.status === "failed") {
        throw new ResearchOrchestrationError(`${agentDef.agent_id} (family ${code}) failed: ${result.error ?? "unknown error"}`);
      }
      if (result.status === "blocked") {
        await logAction({
          organization_id: run.organization_id,
          actor_type: "system",
          actor_id: "research-orchestrator",
          action: "research_run.paused_for_review",
          resource_type: "pil_research_runs",
          resource_id: run.id,
          before_state: null,
          after_state: { blockedOnAgent: agentDef.agent_id, family: code },
          policy_decision: null,
          ip_address: null,
        });
        return { run, paused: true };
      }

      entry.completedAgents.push(agentDef.agent_id);
      run = await saveProgress(run, progress);
    }

    progress = { ...progress, [code]: { status: "completed", completedAgents: entry.completedAgents, completedAt: new Date().toISOString() } };
    run = await saveProgress(run, progress);

    await logAction({
      organization_id: run.organization_id,
      actor_type: "system",
      actor_id: "research-orchestrator",
      action: "research_run.family_completed",
      resource_type: "pil_research_runs",
      resource_id: run.id,
      before_state: null,
      after_state: { family: code, agentCount: roster.length },
      policy_decision: null,
      ip_address: null,
    });
  }

  return { run, paused: false };
}

// Drives a single research run to completion (or a resumable pause / a
// terminal failure). Safe to call repeatedly for the same runId: already-
// completed families/agents are skipped via structured_plan.family_progress.
export async function orchestrateResearchRun(runId: string): Promise<ResearchRun> {
  let run = await getRunOrThrow(runId);

  if (TERMINAL_STATUSES.has(run.status)) {
    return run;
  }

  if (!run.prospect_id) {
    await escalateFailure(run, "research run has no prospect_id -- this orchestrator drives a single-prospect pipeline");
    await failRun(runId, "missing prospect_id");
    return getRunOrThrow(runId);
  }

  if (run.status === "planning") {
    run = await advanceRunState(runId, "running");
  }

  const permittedTools = listTools().map((tool) => tool.name);

  try {
    const familiesResult = await runFamilies(run, permittedTools);
    run = familiesResult.run;
    if (familiesResult.paused) {
      return run;
    }

    const dossierResult = await executeFamilyAgent(run, DOSSIER_AGENT_ID, permittedTools);
    if (dossierResult.status === "failed") {
      throw new ResearchOrchestrationError(`${DOSSIER_AGENT_ID} (dossier synthesis) failed: ${dossierResult.error ?? "unknown error"}`);
    }
    if (dossierResult.status === "blocked") {
      await logAction({
        organization_id: run.organization_id,
        actor_type: "system",
        actor_id: "research-orchestrator",
        action: "research_run.paused_for_review",
        resource_type: "pil_research_runs",
        resource_id: run.id,
        before_state: null,
        after_state: { blockedOnAgent: DOSSIER_AGENT_ID, family: "DOSSIER" },
        policy_decision: null,
        ip_address: null,
      });
      return run;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await escalateFailure(run, message);
    await failRun(runId, message);
    return getRunOrThrow(runId);
  }

  run = await advanceRunState(runId, "completed");
  await runAutoApplyQueuePopulation(run);
  return run;
}

export interface PendingRunsPollResult {
  runId: string;
  status: ResearchRunStatus;
}

// Polls for research runs that still have work to do -- newly created
// ("planning") and partially-complete ("running") -- and drives each one in
// turn. There is no "pending" status in the applied schema (see this file's
// header); "planning" is the real initial state createResearchRun leaves a
// run in.
export async function pollAndOrchestratePendingRuns(options: { orgId?: string; limit?: number } = {}): Promise<PendingRunsPollResult[]> {
  const { orgId, limit = 10 } = options;

  let query = getPilClient()
    .from("pil_research_runs")
    .select("id, prospect_id")
    .in("status", ["planning", "running"] satisfies ResearchRunStatus[])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (orgId) {
    query = query.eq("organization_id", orgId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const results: PendingRunsPollResult[] = [];
  for (const row of (data ?? []) as { id: string; prospect_id: string | null }[]) {
    // Discovery-type runs (POST /api/pil/discover) are deliberately created
    // with no prospect_id -- a discovery run plans a multi-prospect search,
    // it doesn't drive one prospect through the family pipeline below. This
    // orchestrator only knows how to drive single-prospect runs (see the
    // prospect_id guard inside orchestrateResearchRun). Without this skip,
    // every poll would immediately fail-and-escalate every discovery run
    // instead of leaving it for whatever process is meant to fan discovery
    // results out into real per-prospect runs -- that fan-out doesn't exist
    // yet (tracked separately, not part of this wiring pass), so for now
    // these rows are simply left alone rather than mass-failed.
    if (!row.prospect_id) continue;
    try {
      const finished = await orchestrateResearchRun(row.id);
      results.push({ runId: row.id, status: finished.status });
    } catch {
      // orchestrateResearchRun already marks the run failed and escalates
      // internally; reaching this catch means even that recovery path
      // errored (e.g. the DB write itself failed). Record it and continue
      // with the rest of the batch rather than letting one bad run abort
      // every other pending run.
      results.push({ runId: row.id, status: "failed" });
    }
  }
  return results;
}
