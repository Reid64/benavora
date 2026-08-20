// PT-09-003 execution proof: AG-25 (Deadline Prediction, dual-use number)
// registryAgentId ag-25-deadline-prediction / src/lib/agents/deadline-prediction-agent.ts
//
// Trigger method: direct class invocation, AutonomousAgent family --
// new DeadlinePredictionAgent(orgId, supabase).run('manual'). Real trigger
// path per pt09-001: nightly 2AM pipeline (runDeadlinePredictionStep, gated
// on auto_deadline_prediction_enabled) + routeQueueItem() case
// 'deadline_prediction'.
//
// LOCAL SCAFFOLDING NOTE: deadline_predictions did not exist locally --
// applied via _fix-missing-tables-2.mjs this session (migration 097).
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-25-deadline-prediction.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { DeadlinePredictionAgent } = await import(
  "../../../src/lib/agents/deadline-prediction-agent.ts"
);

const CANONICAL = "AG-25 (Deadline Prediction, dual-use number)";
const WRITE_TABLES = ["agent_runs", "agent_decisions", "deadline_predictions", "alerts", "opportunities"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-25-deadline-prediction"),
    deadline_predictions: await countRows(db, "deadline_predictions", "org_id", orgId),
    alerts: await countRows(db, "alerts", "organization_id", orgId),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new DeadlinePredictionAgent(orgId, supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-25-deadline-prediction"),
    deadline_predictions: await countRows(db, "deadline_predictions", "org_id", orgId),
    alerts: await countRows(db, "alerts", "organization_id", orgId),
  };

  const runRow = (
    await db.query(
      "select * from agent_runs where agent_type='ag-25-deadline-prediction' and organization_id=$1 order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const predictionRows = (
    await db.query("select * from deadline_predictions where org_id=$1 order by created_at desc limit 5", [orgId])
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}. Check sampleWrittenRow.agent_runs_row for a status='failed' row.`;
  } else if (delta.deadline_predictions > 0 && predictionRows[0]) {
    verdict = "WORKS";
    const p = predictionRows[0];
    reasoning = `deadline_predictions row(s) written with real content: source=${p.source}, predicted_deadline=${p.predicted_deadline}, confidence=${p.confidence}, urgency_tier=${p.urgency_tier}. itemsFound=${result_.itemsFound}, itemsProcessed=${result_.itemsProcessed}. This confirms the agent's real per-funder/per-opportunity deadline detection (description_text/sam_gov/web_search/cycle_pattern/estimated_cycle) succeeded against environment.json's seeded opportunities/funders.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly (itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}) but zero deadline_predictions rows landed. Likely cause: environment.json's 3 seeded opportunities already have real deadline values set at seed time, so this agent's own "only predict when a deadline is missing/ambiguous" gate may have found nothing to predict for -- see triggerLog/sampleWrittenRow.agent_runs_row.output_summary for the agent's own stated reason.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs, agent_decisions, or deadline_predictions activity, and no error was surfaced -- the invocation never reached startRun()'s logging path.";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-25-deadline-prediction",
    implementingFile: "src/lib/agents/deadline-prediction-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new DeadlinePredictionAgent(orgId, supabase).run('manual'). AutonomousAgent family. Real trigger path per pt09-001/agent-inventory.json: WIRED-SCHEDULED-GATED+QUEUE (nightly 2AM pipeline gated on auto_deadline_prediction_enabled, plus routeQueueItem() case 'deadline_prediction').",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      deadline_predictions_rows: predictionRows,
      agent_runs_row: runRow,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED-GATED+QUEUE. This is one half of the AG-25 number-collision pair (numberCollisionPairs watchList item) -- registry documents this as a deliberate dual-use canonical number alongside AG-25 Disaster Response.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
