// PT-09-003 execution proof: AG-26 (Funding Forecast Agent)
// registryAgentId ag-26-forecast / src/lib/agents/funding-forecast-agent.ts
//
// Trigger method: direct class invocation, AutonomousAgent family --
// new FundingForecastAgent(orgId, supabase).run('manual'). Real trigger path
// per pt09-001: 'AG-26 funding forecast monthly pipeline' worker/scheduler.ts
// job (hour 4), self-gated to 1st-of-month internally -- calling run()
// directly bypasses that internal date gate the same way batch 1's direct
// invocations bypassed other agents' own schedule gates.
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-26.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { FundingForecastAgent } = await import(
  "../../../src/lib/agents/funding-forecast-agent.ts"
);

const CANONICAL = "AG-26";
const WRITE_TABLES = ["agent_runs", "agent_decisions", "funding_forecasts"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-26-forecast"),
    funding_forecasts: await countRows(db, "funding_forecasts", "org_id", orgId),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new FundingForecastAgent(orgId, supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-26-forecast"),
    funding_forecasts: await countRows(db, "funding_forecasts", "org_id", orgId),
  };

  const runRow = (
    await db.query(
      "select * from agent_runs where agent_type='ag-26-forecast' and organization_id=$1 order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const forecastRows = (
    await db.query("select * from funding_forecasts where org_id=$1 order by created_at desc limit 5", [orgId])
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}.`;
  } else if (delta.funding_forecasts > 0 && forecastRows[0]) {
    verdict = "WORKS";
    const f = forecastRows[0];
    reasoning = `funding_forecasts row(s) written with real content: ${JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k]) => !["id", "org_id", "created_at"].includes(k))))}. itemsFound=${result_.itemsFound}, itemsProcessed=${result_.itemsProcessed}.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly (itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}) but zero funding_forecasts rows landed. See triggerLog/sampleWrittenRow.agent_runs_row.output_summary for the agent's own stated reason.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs, agent_decisions, or funding_forecasts activity, and no error was surfaced.";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-26-forecast",
    implementingFile: "src/lib/agents/funding-forecast-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new FundingForecastAgent(orgId, supabase).run('manual'). AutonomousAgent family. Real trigger path: WIRED-SCHEDULED (worker/scheduler.ts monthly job, self-gated to 1st-of-month internally; this direct call bypasses that date gate the same way batch 1's direct invocations did for other agents).",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      funding_forecasts_rows: forecastRows,
      agent_runs_row: runRow,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
