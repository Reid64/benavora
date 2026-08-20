// PT-09-003 execution proof: AG-43 (Funder Signal Monitor Agent, real name
// FunderSignalMonitorAgent -- NOT in the agent_registry table per pt09-001's
// watchList item ag43ExistsButUnregistered)
// registryAgentId n/a (unregistered) / src/lib/agents/funder-signal-monitor-agent.ts
//
// Trigger method: direct class invocation, AutonomousAgent family --
// new FunderSignalMonitorAgent(orgId, supabase).run('manual'). Real trigger
// path per pt09-001: no routeQueueItem() case, no scheduler.ts job found --
// likely manual/on-demand only, per the real POST /api/intelligence/
// signal-monitor route documented in STATE_OF_THE_BUILD.md's 2026-08-15
// session. loadFunders() is org-scoped, so environment.json's 3 seeded
// funders are used.
//
// LOCAL SCAFFOLDING NOTE: funder_relationship_signals did not exist locally
// -- applied via _fix-missing-tables.mjs earlier this session (migration
// 137).
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-43.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { FunderSignalMonitorAgent } = await import(
  "../../../src/lib/agents/funder-signal-monitor-agent.ts"
);

const CANONICAL = "AG-43 (beyond registered 1-42 range — NOT in registry)";
const WRITE_TABLES = ["agent_runs", "agent_decisions", "funder_relationship_signals"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-43-funder-signals"),
    funder_relationship_signals: await countRows(db, "funder_relationship_signals", "org_id", orgId),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new FunderSignalMonitorAgent(orgId, supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-43-funder-signals"),
    funder_relationship_signals: await countRows(db, "funder_relationship_signals", "org_id", orgId),
  };

  const runRow = (
    await db.query(
      "select * from agent_runs where agent_type='ag-43-funder-signals' and organization_id=$1 order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const signalRows = (
    await db.query("select * from funder_relationship_signals where org_id=$1 order by created_at desc limit 5", [orgId])
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}.`;
  } else if (delta.funder_relationship_signals > 0 && signalRows[0]) {
    verdict = "WORKS";
    const s = signalRows[0];
    reasoning = `funder_relationship_signals row(s) written with real content: source=${s.source}, signal_type=${s.signal_type}, signal_summary="${s.signal_summary}", relationship_score=${s.relationship_score}, mission_alignment=${s.mission_alignment}. itemsProcessed=${result_.itemsProcessed}. This confirms the real agent code works end-to-end even though it has zero agent_registry row (the unregistered-agent gap this session's pt09-001 pass found).`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly (itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}) but zero funder_relationship_signals rows landed -- likely the same class of "real web search against synthetic test funder names finds nothing real to cite" result AG-30 hit, not a broken trigger. See triggerLog/sampleWrittenRow.agent_runs_row.output_summary.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs, agent_decisions, or funder_relationship_signals activity, and no error was surfaced.";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: null,
    implementingFile: "src/lib/agents/funder-signal-monitor-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new FunderSignalMonitorAgent(orgId, supabase).run('manual'). AutonomousAgent family, org-scoped (loadFunders() uses environment.json's 3 seeded funders). Real trigger path per pt09-001: REGISTRY-GAP -- no agent_registry row exists (scripts/seed-agent-registry.ts's ROSTER stops at ag-42-change-monitor), no routeQueueItem() case, no scheduler.ts job found; real production entry point is POST /api/intelligence/signal-monitor per STATE_OF_THE_BUILD.md's 2026-08-15 session.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      funder_relationship_signals_rows: signalRows,
      agent_runs_row: runRow,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: REGISTRY-GAP -- real, working agent (per prior documented live verification), zero agent_registry row exists for it. watchListRef: ag43ExistsButUnregistered.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
