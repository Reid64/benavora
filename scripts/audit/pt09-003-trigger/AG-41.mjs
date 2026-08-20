// PT-09-003 execution proof: AG-41 (Impact Simulation Agent)
// registryAgentId ag-41-impact-simulation / src/lib/agents/impact-simulation-agent.ts
//
// Trigger method: direct class invocation, AutonomousAgent family --
// new ImpactSimulationAgent(orgId, supabase).run('manual', scenarioType,
// scenarioParams, createdBy). Real trigger path per pt09-001: manual-only by
// design (WIRED-MANUAL-ONLY -- "a hypothetical scenario only has meaning in
// response to a specific question a human is asking"), the real production
// entry point is POST /api/agents/simulate. scenarioType='gain_funder' is
// used (a closed 4-value enum: lose_funder/gain_funder/program_expansion/
// budget_cut) with the one required param that branch validates
// (estimatedAnnualAmount).
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-41.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { ImpactSimulationAgent } = await import(
  "../../../src/lib/agents/impact-simulation-agent.ts"
);

const CANONICAL = "AG-41";
const WRITE_TABLES = ["agent_runs", "agent_decisions", "impact_simulations"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  const userId = env.org.userId;

  const db = await pgClient();
  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-41-impact-simulation"),
    impact_simulations: await countRows(db, "impact_simulations", "org_id", orgId),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new ImpactSimulationAgent(orgId, supabase);
    result_ = await agent.run("manual", "gain_funder", { estimatedAnnualAmount: 50000 }, userId);
    log.push(`agent.run('manual', 'gain_funder', {estimatedAnnualAmount:50000}, userId) resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-41-impact-simulation"),
    impact_simulations: await countRows(db, "impact_simulations", "org_id", orgId),
  };

  const runRow = (
    await db.query(
      "select * from agent_runs where agent_type='ag-41-impact-simulation' and organization_id=$1 order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const simRows = (
    await db.query("select * from impact_simulations where org_id=$1 order by generated_at desc limit 3", [orgId])
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}.`;
  } else if (delta.impact_simulations > 0 && simRows[0]) {
    verdict = "WORKS";
    const s = simRows[0];
    reasoning = `impact_simulations row written with real content: scenario_type=${s.scenario_type ?? "gain_funder"}, deterministic math + Claude narrative present (confidence=${s.confidence}). itemsFound=${result_.itemsFound}, itemsProcessed=${result_.itemsProcessed}. This confirms the real deterministic-math-first + one-Claude-call-for-narrative pipeline for the gain_funder branch works end-to-end.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly (itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}) but zero impact_simulations rows landed.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs, agent_decisions, or impact_simulations activity, and no error was surfaced.";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-41-impact-simulation",
    implementingFile: "src/lib/agents/impact-simulation-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new ImpactSimulationAgent(orgId, supabase).run('manual', 'gain_funder', {estimatedAnnualAmount:50000}, userId). AutonomousAgent family. Real trigger path per pt09-001/agent-inventory.json: WIRED-MANUAL-ONLY (by design -- no scheduler.ts job or routeQueueItem() case; real production entry point is POST /api/agents/simulate).",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      impact_simulations_rows: simRows,
      agent_runs_row: runRow,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-MANUAL-ONLY (by design).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
