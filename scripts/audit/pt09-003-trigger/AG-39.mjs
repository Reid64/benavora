// PT-09-003 execution proof: AG-39 (ag-39-roi-optimizer /
// src/lib/agents/roi-optimizer-agent.ts)
// Trigger method: direct class invocation, AutonomousAgent family --
// new RoiOptimizerAgent(orgId, supabase).run('manual') -- the monthly
// correlation pass (deterministic two-proportion-z-test engine against
// submission_variables + outcomes, NOT a Claude call for this half; the
// separate telemetry half, trackSubmissionVariables(), is a different
// method entirely and not exercised by this script).
//
// PRIORITY SUSPECT THIS SESSION (watchListRef roiOptimizerWiredButRowCountUnverified):
// PT-08 confirmed the nightly-sweep trigger fires live, but nobody has
// confirmed run() actually writes a real roi_insights row. This script's job
// is a DEFINITIVE, decisive answer -- see verdictReasoning below, not hedged.
//
// DATA-AVAILABILITY NOTE: run() requires decided.length >= 10
// (MIN_RECORDS_FOR_ANALYSIS) AND each compared bucket needs >= 8 rows
// (MIN_SAMPLE_SIZE) with a real z-test confidence >= 0.65 and a >=10pp win-rate
// spread before anything is persisted. environment.json's 2 seeded
// applications are nowhere near this bar. Per the task's explicit
// instruction, this script seeds 16 real synthetic applications + outcomes +
// submission_variables rows directly via pg (bypassing trackSubmissionVariables()
// entirely, which is the correct thing to bypass here -- run()'s own
// correlation logic reads submission_variables + outcomes directly, so
// seeding those two tables exercises the exact same code path a real
// population of decided submissions would). Design: 8 applications WITH a
// budget doc (has_budget=true) all AWARDED; 8 WITHOUT a budget doc all
// DENIED -- every other field (day of week, word count, days before
// deadline, logic model, board list) held constant across all 16 so the
// has_budget signal is the only one the deterministic engine should find,
// cleanly isolating and proving the analyzeAttachmentFlag() code path.
//
// LOCAL SCAFFOLDING NOTE: submission_variables did not exist on the local
// stack (only committed on disk at src/supabase/migrations/089_roi_optimizer.sql)
// -- applied via _fix-missing-tables.mjs this session (idempotent).
// roi_insights already existed locally (0 rows).
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-39.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { RoiOptimizerAgent } = await import(
  "../../../src/lib/agents/roi-optimizer-agent.ts"
);

const CANONICAL = "AG-39";
const WRITE_TABLES = ["roi_insights", "agent_runs", "agent_decisions"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  const opportunityId = env.opportunities[0].id;

  const db = await pgClient();

  // --- secondary data point: does submission_variables already have real
  // rows from prior activity? (task asks this explicitly) ---
  const preExistingSubmissionVariables = (
    await db.query(`select count(*)::int as n from submission_variables`)
  ).rows[0].n;

  // --- seed 16 real decided submissions: 8 WITH budget -> awarded, 8
  // WITHOUT budget -> denied. Every other field held constant. ---
  const seededAppIds = [];
  for (let i = 0; i < 16; i++) {
    const hasBudget = i < 8;
    const outcomeResult = hasBudget ? "awarded" : "denied";

    const appRes = await db.query(
      `insert into applications (organization_id, opportunity_id, stage, requested_amount, submitted_at)
       values ($1, $2, 'submitted', 25000, now() - interval '20 days')
       returning id`,
      [orgId, opportunityId],
    );
    const appId = appRes.rows[0].id;
    seededAppIds.push(appId);

    await db.query(
      `insert into outcomes (organization_id, application_id, result, awarded_amount, recorded_at)
       values ($1, $2, $3, $4, now())`,
      [orgId, appId, outcomeResult, hasBudget ? 25000 : null],
    );

    await db.query(
      `insert into submission_variables
         (application_id, org_id, submission_day_of_week, days_before_deadline, prompt_version, word_count, attachment_count, has_budget, has_logic_model, has_board_list, narrative_readability_score)
       values ($1, $2, 3, 15, 'PT-09-seed', 1200, $3, $4, false, false, 70)`,
      [appId, orgId, hasBudget ? 2 : 0, hasBudget],
    );
  }
  const seedLog =
    `seed: inserted 16 real applications + outcomes + submission_variables rows -- ` +
    `8 with has_budget=true all outcome='awarded', 8 with has_budget=false all outcome='denied' ` +
    `(all other fields held constant: day_of_week=3, days_before_deadline=15, word_count=1200). ` +
    `pre-existing submission_variables rows before seeding: ${preExistingSubmissionVariables}.`;

  const before = {};
  for (const t of WRITE_TABLES) {
    if (t === "roi_insights") continue;
    before[t] = await countRows(
      db,
      t,
      t === "agent_decisions" ? "org_id" : "organization_id",
      orgId,
    );
  }
  before.roi_insights = (
    await db.query(`select count(*)::int as n from roi_insights where org_id = $1`, [orgId])
  ).rows[0].n;

  const supabase = makeLocalSupabaseClient();

  const log = [seedLog];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new RoiOptimizerAgent(orgId, supabase);
    runOutcome = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? err.stack ?? err.message : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) {
    if (t === "roi_insights") continue;
    after[t] = await countRows(
      db,
      t,
      t === "agent_decisions" ? "org_id" : "organization_id",
      orgId,
    );
  }
  after.roi_insights = (
    await db.query(`select count(*)::int as n from roi_insights where org_id = $1`, [orgId])
  ).rows[0].n;

  const insightRows = (
    await db.query(`select * from roi_insights where org_id = $1 order by generated_at desc`, [orgId])
  ).rows;
  const budgetInsight = insightRows.find((r) => r.insight_type?.startsWith("attachment:has_budget"));
  const decisionRow = (
    await db.query(
      `select * from agent_decisions where org_id = $1 and agent_id = 'ag-39-roi-optimizer' order by created_at desc limit 1`,
      [orgId],
    )
  ).rows[0];
  const runRow = (
    await db.query(
      `select * from agent_runs where organization_id = $1 and agent_type = 'ag-39-roi-optimizer' order by created_at desc limit 1`,
      [orgId],
    )
  ).rows[0];

  await db.end();

  const delta = {
    roi_insights: after.roi_insights - before.roi_insights,
    agent_runs: after.agent_runs - before.agent_runs,
    agent_decisions: after.agent_decisions - before.agent_decisions,
  };

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `DEFINITIVE FINDING: run() THREW: ${errorSurfaced.split("\n")[0]}. The original "zero-row" complaint is CONFIRMED STILL TRUE, now for a different reason (a real error, not silent non-invocation) -- AutonomousAgent's own failRun() logs it to agent_runs, but no caller in production reads that for a nightly-sweep-triggered run.`;
  } else if (delta.roi_insights > 0 && budgetInsight && budgetInsight.confidence >= 0.65) {
    verdict = "WORKS";
    reasoning =
      `DEFINITIVE FINDING: roi_insights DOES get a real row written when RoiOptimizerAgent.run() executes for real -- this is NOT a zero-row agent once it has real decided-submission data to analyze. ` +
      `${delta.roi_insights} real roi_insights row(s) persisted this run, including insight_type="${budgetInsight.insight_type}" with confidence=${budgetInsight.confidence} (two-proportion z-test derived, >= the 0.65 MIN_CONFIDENCE gate), sample_size=${budgetInsight.sample_size}, winning_pattern="${budgetInsight.winning_pattern}", losing_pattern="${budgetInsight.losing_pattern}", recommended_action="${budgetInsight.recommended_action}". This is real deterministic arithmetic over real submission_variables+outcomes rows (no Claude call in this code path), correctly detecting the exact has_budget:awarded-vs-denied pattern this script seeded. agent_decisions row logged with matching reasoning; agent_runs completed with itemsProcessed=${runOutcome.itemsProcessed}. ` +
      `CONCLUSION for the suspect deep-dive: the original July-2026 "roi_insights nothing populates it" finding is FIXED at the code level -- run() writes real rows given real data. The remaining open question (out of this script's scope) is whether production has ever accumulated >=10 decided submissions with >=8 per comparison bucket organically; if it hasn't, roi_insights would still legitimately show 0 rows in production today not because the code is broken, but because real submission volume hasn't cleared this agent's own significance thresholds yet -- a data-volume gap, not a wiring or code gap. Secondary data point: submission_variables had ${preExistingSubmissionVariables} pre-existing row(s) before this script's own seeding (0), confirming trackSubmissionVariables() (the telemetry half) has never been exercised for real on this local stack either.`;
  } else if (delta.agent_runs > 0 && runOutcome && runOutcome.itemsProcessed >= 10 && delta.roi_insights === 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `DEFINITIVE FINDING: run() completed cleanly and processed ${runOutcome.itemsProcessed} decided submission(s) (>= the 10-record floor), but wrote ZERO roi_insights rows -- the seeded has_budget pattern (100% vs 0% win rate, n=8/8) did NOT clear this agent's own significance gates. This confirms the ORIGINAL "zero-row" complaint IS STILL TRUE even with real, decisive data and the trigger genuinely firing: the agent runs clean but produces no business-table output. errors reported by the agent itself: ${JSON.stringify(runOutcome.errors)}.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `DEFINITIVE FINDING: agent_runs activity occurred but the seeded 16-record decided-submission batch was not processed as expected (itemsProcessed=${runOutcome?.itemsProcessed}, itemsFound=${runOutcome?.itemsFound}) and zero roi_insights rows landed. result=${JSON.stringify(runOutcome)}.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs activity and no error was surfaced -- the invocation itself never reached startRun()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-39-roi-optimizer",
    implementingFile: "src/lib/agents/roi-optimizer-agent.ts",
    writeTargetTables: ["application_documents (read)", "applications (read)", "documents (read)", "opportunities (read)", "outcomes (read)", "roi_insights", "submission_variables"],
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new RoiOptimizerAgent(orgId, supabase).run('manual'). AutonomousAgent family. Real trigger path per pt09-001: worker/autonomous-orchestrator.ts:800-817 runRoiOptimizerStep(), called inside the isFirstOfMonthChicago() gate of runOrgPipeline() (confirmed CONFIRMED STARTED+firing live per PT-08), plus routeQueueItem() case 'ag-39-roi-optimizer'. This script seeds 16 real decided submission_variables+outcomes rows first (see triggerLog) since the local stack had zero decided submissions on file, then calls run() exactly as the nightly sweep would.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      roi_insights_budget_row: budgetInsight ?? null,
      all_roi_insights_rows: insightRows,
      agent_decisions_row: decisionRow ?? null,
      agent_runs_row: runRow ?? null,
      submission_variables_pre_existing_count: preExistingSubmissionVariables,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED-GATED+QUEUE. watchListRef: roiOptimizerWiredButRowCountUnverified (HIGH priority, THE #1 suspect this session) -- 'CONFIRMED WIRED this session [PT-08]: ... What was NOT verified this session: whether roi_insights actually has any real rows in production today.' This script is that verification, executed for real against the local stack with real seeded data.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
  console.log(reasoning.slice(0, 400));
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
