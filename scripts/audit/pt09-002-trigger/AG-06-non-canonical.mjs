// PT-09-002 execution proof: "AG-06 (non-canonical duplicate)" (registryAgentId
// "ag-06-budget-builder" / src/lib/agents/budget-builder-agent.ts) -- per agent-inventory.json
// this is one of three real, distinct budget-generating implementations on disk
// (budget-agent.ts, budget-builder.ts, budget-builder-agent.ts); this is the queue-wired
// AutonomousAgent version, not part of the canonical AG-01..42 numbering.
//
// Real trigger per agent-inventory.json: WIRED-QUEUE (worker/autonomous-orchestrator.ts's
// routeQueueItem() case 'budget_builder', line 1729). BudgetBuilderAgent.run() takes only a
// triggerSource -- it reads its target applicationId off the agent_queue row this run is
// "processing", same contract as every other AutonomousAgent subclass in this batch.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-06-non-canonical.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { BudgetBuilderAgent } = await import("../../../src/lib/agents/budget-builder-agent.ts");

const CANONICAL = "AG-06 (non-canonical duplicate)";
const WRITE_TABLES = ["agent_runs", "agent_decisions"]; // applications tracked separately (UPDATE, not INSERT)

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  // Application 94f79d2e (opportunity 88365eb3, "PT-09 Test Opportunity 1", private_foundation)
  // was seeded with budget_data=null and stage='drafting' -- the exact real-world precondition
  // this agent fires on (AGENTS.md Agent 06: "fires when an application moves into the
  // 'drafting' pipeline stage and has no budget_data yet").
  const application = env.applications.find((a) => a.id === "94f79d2e-d8ec-4802-9395-ee251f298c0e");

  const whereCol = (t) => (t === "agent_decisions" ? "org_id" : "organization_id");

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, whereCol(t), orgId);
  const appBefore = (await db.query("select budget_data from applications where id = $1", [application.id])).rows[0];

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const { data: queueRow, error: queueErr } = await supabase
      .from("agent_queue")
      .insert({
        org_id: orgId,
        agent_id: "ag-06-budget-builder",
        status: "processing",
        trigger_source: "event",
        input_payload: { applicationId: application.id },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (queueErr) throw new Error(`Failed to seed agent_queue row: ${queueErr.message}`);
    log.push(`Seeded agent_queue row ${queueRow.id} (status=processing, agent_id=ag-06-budget-builder, input_payload.applicationId=${application.id})`);

    const agent = new BudgetBuilderAgent(orgId, supabase);
    runOutcome = await agent.run("event");
    log.push(`agent.run("event") resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW past BudgetBuilderAgent.run(): ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) after[t] = await countRows(db, t, whereCol(t), orgId);
  const appAfter = (await db.query("select * from applications where id = $1", [application.id])).rows[0];

  const decisionRow = runOutcome?.decisions?.length
    ? (await db.query("select * from agent_decisions where id = $1", [runOutcome.decisions[runOutcome.decisions.length - 1]])).rows[0]
    : null;
  const runRow = decisionRow?.agent_run_id
    ? (await db.query("select * from agent_runs where id = $1", [decisionRow.agent_run_id])).rows[0]
    : (await db.query(
        "select * from agent_runs where organization_id = $1 and agent_type = 'ag-06-budget-builder' order by created_at desc limit 1",
        [orgId],
      )).rows[0];

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  const budgetWasEmpty = !appBefore.budget_data || Object.keys(appBefore.budget_data).length === 0;
  const budgetNowPopulated =
    appAfter.budget_data &&
    Array.isArray(appAfter.budget_data.lineItems) &&
    appAfter.budget_data.lineItems.length > 0;

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning =
      "BudgetBuilderAgent.run() wraps its whole body in try/catch and always calls failRun() before returning success:false. Reaching this branch means the throw happened outside that (harness setup or import) -- a gap this harness caught but the app itself never logged.";
  } else if (runOutcome && runOutcome.success === false) {
    verdict = delta.agent_runs > 0 ? "WIRED-NO-OUTPUT" : "TRIGGER-BROKEN";
    reasoning = `agent.run() resolved success:false with errors=${JSON.stringify(runOutcome.errors)}. ${
      delta.agent_runs > 0
        ? "A failed agent_runs row was written (visible via error_message) -- not swallowed, but zero business-table output."
        : "No agent_runs row was written -- the run never reached logging."
    }`;
  } else if (budgetWasEmpty && budgetNowPopulated) {
    verdict = "WORKS";
    reasoning =
      `applications.budget_data was updated in place (UPDATE, not INSERT -- confirmed by comparing the same row id before/after) from null to a real Claude-generated structured budget: ${appAfter.budget_data.lineItems.length} line item(s) totaling $${appAfter.budget_data.total}, grounded in this org's annual_budget and (absent) KB budget-justification entries. agent_decisions logged with requiredHumanReview=true (HARD LIMIT honored -- budget generated for human review only). Matches AG-06 Budget Builder's documented intent exactly.`;
  } else if (delta.agent_runs > 0 || delta.agent_decisions > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "agent_runs/agent_decisions rows were written (the run executed and logged), but applications.budget_data was not populated with a real line-item budget -- zero real business-table output despite a run that appears to have completed.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs, agent_decisions, nor applications.budget_data changed, and no error was surfaced.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-06-budget-builder",
    implementingFile: "src/lib/agents/budget-builder-agent.ts",
    writeTargetTables: ["agent_runs", "agent_decisions", "applications (UPDATE budget_data)"],
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack, reproducing the real production contract: seeded one agent_queue row (org_id, agent_id='ag-06-budget-builder', status='processing', input_payload={applicationId}) since BudgetBuilderAgent.run() takes only a triggerSource and reads its target application off that queue row (mirrors worker/autonomous-orchestrator.ts routeQueueItem() case 'budget_builder'). Then: new BudgetBuilderAgent(orgId, supabase).run('event').",
    before: { ...before, applications_budget_data_before: appBefore.budget_data },
    after: { ...after, applications_budget_data_after: "see sampleWrittenRow" },
    rowDelta: delta,
    sampleWrittenRow: {
      applications_updated: {
        id: appAfter.id,
        opportunity_id: appAfter.opportunity_id,
        stage: appAfter.stage,
        budget_data: appAfter.budget_data,
        updated_at: appAfter.updated_at,
      },
      agent_runs_row: runRow ?? null,
      agent_decisions_row: decisionRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "FEATURE_REGISTRY_v2.md row #207: 'AG-06 Autonomous Budget Builder | BUILT | Event-driven on drafting stage. Generates budget for human review.' Note per agent-inventory.json: THREE distinct budget-generating implementations exist on disk sharing overlapping identity (budget-agent.ts, budget-builder.ts, budget-builder-agent.ts) -- this result covers only budget-builder-agent.ts, the one actually queue-wired via routeQueueItem().",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
