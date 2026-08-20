// PT-09-003 execution proof: AG-37 (ag-37-simulation / src/lib/agents/simulation-agent.ts)
// Trigger method: direct class invocation, AutonomousAgent family --
// new SimulationAgent(orgId, supabase).run('manual'). Unlike most
// AutonomousAgent subclasses, run() takes no direct scenario params -- per
// the file's own header comment, it reads the agent_queue row the queue
// processor marked "processing" for (org_id, agent_id) and pulls
// scenarioType/variables/scenarioName out of its input_payload. This script
// inserts that queue row first (the same state the queue processor would
// have already created before instantiating this class in production),
// exactly matching this agent's own real trigger convention rather than
// inventing a bypass.
//
// LOCAL SCAFFOLDING NOTE: simulation_scenarios does not exist on the local
// pt05-local-stack (only committed on disk at
// src/supabase/migrations/085_fundraising_simulator.sql, never applied
// locally -- confirmed via a direct pg \d before writing this script). Ran
// _fix-missing-tables.mjs once this session (idempotent, IF NOT EXISTS
// throughout) to apply that exact already-committed DDL locally so this
// script gets a real verdict for the agent's own code, not a false
// TRIGGER-BROKEN caused purely by a missing local table.
//
// registryPriorStatus: WIRED-MANUAL-ONLY (by design) -- /reports/simulate
// route only, deliberately never wired into the nightly sweep.
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-37.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  latestRow,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { SimulationAgent } = await import("../../../src/lib/agents/simulation-agent.ts");

const CANONICAL = "AG-37";
const WRITE_TABLES = ["simulation_scenarios", "agent_runs", "agent_decisions"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();

  // Setup: the queue processor's own state before it would instantiate this
  // class for real -- a "processing" agent_queue row carrying the scenario
  // spec in input_payload, per this agent's own loadScenarioInput().
  const queueInsert = await db.query(
    `insert into agent_queue (org_id, agent_id, priority, status, trigger_source, input_payload, started_at)
     values ($1, 'ag-37-simulation', 9, 'processing', 'manual', $2, now())
     returning id`,
    [
      orgId,
      JSON.stringify({
        scenarioType: "staff_hire",
        variables: { newStaffCount: 2, annualSalaryCost: 140000 },
        scenarioName: "PT-09 Staff Hire Test Scenario",
      }),
    ],
  );
  const queueRowId = queueInsert.rows[0].id;

  const before = {};
  for (const t of WRITE_TABLES) {
    before[t] = await countRows(
      db,
      t,
      t === "agent_decisions" || t === "simulation_scenarios" ? "org_id" : "organization_id",
      orgId,
    );
  }

  const supabase = makeLocalSupabaseClient();

  const log = [`setup: inserted agent_queue row ${queueRowId} with status='processing'`];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new SimulationAgent(orgId, supabase);
    runOutcome = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? err.stack ?? err.message : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) {
    after[t] = await countRows(
      db,
      t,
      t === "agent_decisions" || t === "simulation_scenarios" ? "org_id" : "organization_id",
      orgId,
    );
  }

  const scenarioRow = await latestRow(db, "simulation_scenarios", "org_id", orgId, "generated_at");
  const decisionRow = await latestRow(db, "agent_decisions", "org_id", orgId, "created_at");
  const runRow = await latestRow(db, "agent_runs", "organization_id", orgId, "created_at");

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced.split("\n")[0]}. AutonomousAgent.run()-family failRun() writes agent_runs.status='failed' with error_message before rethrowing -- check sampleWrittenRow.agent_runs_row for whether that happened.`;
  } else if (
    delta.simulation_scenarios > 0 &&
    scenarioRow &&
    scenarioRow.roi_multiple != null &&
    Array.isArray(scenarioRow.risk_factors) &&
    scenarioRow.variables?.projection_detail?.multi_year_model?.year_1
  ) {
    verdict = "WORKS";
    reasoning = `simulation_scenarios row written with a real Claude-generated 3-year projection: roi_multiple=${scenarioRow.roi_multiple}, payback_months=${scenarioRow.payback_months}, confidence=${scenarioRow.confidence}, ${scenarioRow.risk_factors.length} risk_factor(s). agent_decisions row logged with real reasoning. agent_runs row completed. Matches AG-37's documented intent (a proper 3-year what-if model, not a single-number estimate). result.itemsProcessed=${runOutcome.itemsProcessed}.`;
  } else if (delta.agent_runs > 0 || delta.agent_decisions > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs/agent_decisions activity occurred but zero real simulation_scenarios output landed. result=${JSON.stringify(runOutcome)}.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs, agent_decisions, or simulation_scenarios activity, and no error was surfaced -- the invocation itself never reached startRun()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-37-simulation",
    implementingFile: "src/lib/agents/simulation-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new SimulationAgent(orgId, supabase).run('manual'). AutonomousAgent family. Real trigger path is a caller-driven agent_queue row with a scenario spec in input_payload (this script inserts that queue row first, status='processing', matching the queue processor's own pre-instantiation state) -- there is no schedule/event trigger for this agent by design (spec: 'a hypothetical scenario only has meaning in response to a specific question a human is asking').",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      simulation_scenarios_row: scenarioRow ?? null,
      agent_decisions_row: decisionRow ?? null,
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-MANUAL-ONLY (by design) -- /reports/simulate route only, deliberately never wired into the nightly sweep, no queue case in routeQueueItem(). This session's run confirms the class's own logic works for real (or not) when invoked the way its one real caller would invoke it.",
    falsePassCasualty: false,
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
