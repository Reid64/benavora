// PT-09-003 execution proof: AG-42 (Change Monitor Agent, CM-01)
// registryAgentId ag-42-change-monitor / src/lib/agents/change-monitor-agent.ts
//
// Trigger method: direct class invocation, AutonomousAgent family --
// PLATFORM-LEVEL/UNSCOPED (constructor takes only `supabase`, internally
// provisions/uses SYSTEM_ORG_ID, same pattern as AG-36). run('manual') scans
// corporate_prospects + foundation_directory across all orgs.
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-42.mjs

import {
  setupLocalEnv,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { ChangeMonitorAgent } = await import(
  "../../../src/lib/agents/change-monitor-agent.ts"
);

const CANONICAL = "AG-42";
const WRITE_TABLES = ["agent_runs", "agent_decisions", "corporate_monitoring_events", "foundation_directory"];

async function main() {
  const db = await pgClient();
  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-42-change-monitor"),
    corporate_monitoring_events: await countRows(db, "corporate_monitoring_events"),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new ChangeMonitorAgent(supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-42-change-monitor"),
    corporate_monitoring_events: await countRows(db, "corporate_monitoring_events"),
  };

  const runRow = (
    await db.query(
      "select * from agent_runs where agent_type='ag-42-change-monitor' order by created_at desc limit 1",
    )
  ).rows[0] ?? null;
  const eventRows = (
    await db.query("select * from corporate_monitoring_events order by created_at desc limit 5")
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}. Check sampleWrittenRow.agent_runs_row for a status='failed' row.`;
  } else if (delta.corporate_monitoring_events > 0 && eventRows[0]) {
    verdict = "WORKS";
    const e = eventRows[0];
    reasoning = `corporate_monitoring_events row(s) written with real content: event_type=${e.event_type}, description="${e.description}", change_detected=${JSON.stringify(e.change_detected)}. itemsFound=${result_.itemsFound}, itemsProcessed=${result_.itemsProcessed}, changesDetected present in outputPayload.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly (itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}) but zero corporate_monitoring_events rows landed -- most likely a genuine "checked N entities, 0 real-world changes detected" result against environment.json's 2 seeded corporateProspects + 1 seeded foundationDirectory row (no prior snapshot to diff against on a first-ever run, or a real diff finding nothing changed). See triggerLog/sampleWrittenRow.agent_runs_row.output_summary.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs, agent_decisions, or corporate_monitoring_events activity, and no error was surfaced -- the invocation never reached startRun()'s logging path.";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-42-change-monitor",
    implementingFile: "src/lib/agents/change-monitor-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new ChangeMonitorAgent(supabase).run('manual'). AutonomousAgent family, platform-level/unscoped (constructor takes only supabase; internally provisions/uses SYSTEM_ORG_ID, same pattern as AG-36). Real trigger path: WIRED-SCHEDULED ('AG-42 change monitor daily pipeline' worker/scheduler.ts job, hour 5, CONFIRMED STARTED+firing live per PT-08).",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      corporate_monitoring_events_rows: eventRows,
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
