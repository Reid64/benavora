// PT-09-003 execution proof: AG-35 (Community Need Predictor)
// registryAgentId ag-35-community-need / src/lib/agents/community-need-predictor-agent.ts
//
// Trigger method: direct class invocation, AutonomousAgent family --
// constructor(orgId, supabase); run(triggerSource). "manual" exercises the
// same DATA_SOURCE_MATRIX web-search loop a future scheduled/gated slot
// would (org_autonomous_config has no auto_community_need_enabled toggle
// per this file's own header, so there is no gate to bypass here).
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-35.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { CommunityNeedPredictorAgent } = await import(
  "../../../src/lib/agents/community-need-predictor-agent.ts"
);

const CANONICAL = "AG-35";
const WRITE_TABLES = ["agent_runs", "agent_decisions", "community_need_signals", "alerts"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-35-community-need"),
    agent_decisions: (
      await db.query("select count(*)::int as n from agent_decisions where org_id=$1 and agent_id='ag-35-community-need'", [orgId])
    ).rows[0].n,
    community_need_signals: await countRows(db, "community_need_signals", "org_id", orgId),
    alerts: await countRows(db, "alerts", "organization_id", orgId),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new CommunityNeedPredictorAgent(orgId, supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-35-community-need"),
    agent_decisions: (
      await db.query("select count(*)::int as n from agent_decisions where org_id=$1 and agent_id='ag-35-community-need'", [orgId])
    ).rows[0].n,
    community_need_signals: await countRows(db, "community_need_signals", "org_id", orgId),
    alerts: await countRows(db, "alerts", "organization_id", orgId),
  };

  const runRow = (
    await db.query(
      "select * from agent_runs where agent_type='ag-35-community-need' and organization_id=$1 order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const signalRows = (
    await db.query("select * from community_need_signals where org_id=$1 order by created_at desc limit 6", [orgId])
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}. Check sampleWrittenRow.agent_runs_row for a status='failed' row -- present means failRun() surfaced it, absent means the throw happened before startRun() completed.`;
  } else if (delta.community_need_signals > 0 && signalRows[0]?.signal_description) {
    verdict = "WORKS";
    reasoning = `community_need_signals row(s) written with real, Claude-web-search-grounded content: signal_category="${signalRows[0].signal_category}", signal_description="${signalRows[0].signal_description}", trend_direction=${signalRows[0].trend_direction}, severity=${signalRows[0].severity}, predicted_demand_increase=${signalRows[0].predicted_demand_increase}%. This confirms the DATA_SOURCE_MATRIX's grounded web searches (census/housing/employment/health/education/disaster, for "${env.org.email}"'s Central Texas service area) found real, citable current data and the deterministic severity/demand-increase computation ran against it. itemsFound=${result_.itemsFound}, itemsProcessed=${result_.itemsProcessed}, itemsQueued=${result_.itemsQueued}.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly (itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}) but zero community_need_signals rows landed -- either no applicable data-source category's web search returned real, citable evidence (usedWebSearch=false discards the response per this file's own grounding rule), or every search's JSON failed validateCategorySignal(). See triggerLog/errors for the per-category detail this agent's own researchCategory() collects.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs, agent_decisions, or community_need_signals activity, and no error was surfaced -- the invocation never reached startRun()'s logging path.";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-35-community-need",
    implementingFile: "src/lib/agents/community-need-predictor-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new CommunityNeedPredictorAgent(orgId, supabase).run('manual'). AutonomousAgent family, per-org. No org_autonomous_config gate exists for this agent (auto_community_need_enabled is not a real column), so 'manual' exercises the same code path any future orchestrator registration would.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      community_need_signals_rows: signalRows,
      agent_runs_row: runRow,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED-GATED+QUEUE (registry metadata stale: claims manual, is actually scheduled).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
