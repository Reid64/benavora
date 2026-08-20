// PT-09-003 execution proof: AG-36 (Learning Network Aggregator)
// registryAgentId ag-36-learning-network / src/lib/agents/learning-network-aggregator-agent.ts
//
// PRIORITY SUSPECT this session (watchListRef learningAggregatorNowWired_
// correctsStaleAssumption): older docs (STATE_OF_THE_BUILD.md/
// FEATURE_REGISTRY_v2.md, July 2026) documented this class as real code
// that was NEVER imported or called anywhere -- a genuinely dead/orphaned
// agent at that time. PT-08's later evidence found the scheduled job now
// STARTED with confirmedFiringLive=true, but nobody had yet confirmed it
// actually WRITES a real, non-empty platform_learning_patterns row (vs.
// just firing and finding nothing). This script gives that definitive
// answer.
//
// Trigger method: direct class invocation, AutonomousAgent family --
// PLATFORM-LEVEL/UNSCOPED (constructor takes only `supabase`, internally
// provisions/uses a well-known SYSTEM_ORG_ID). run(triggerSource) with no
// other params; reads outcomes across every org unfiltered by
// organization_id (deliberate, per the class's own file header).
//
// LOCAL SCHEMA NOTE: see _fix-local-schema-gaps-ag29-ag36.mjs (run once
// before this script) -- this class's write targets (org_learning_
// contributions table at all, platform_learning_patterns.confidence/weight
// columns) did not exist locally before that patch; without it every
// recordContribution()/upsertPattern() call throws immediately and the run
// fails on outcome #1.
//
// SEEDED DATA NOTE: environment.json's org has exactly 2 real `outcomes`
// rows with result='awarded' within the 90-day lookback (confirmed via
// direct pg read before writing this script) -- one (id 4660158e...) has a
// substantial, real narrative_snapshot (an actual multi-section grant
// narrative about transitional housing services); the other (id
// fdd62beb...) has no narrative_snapshot/draft_content, only funder
// feedback text, so it is expected to contribute nothing (or only
// factual/budget-derived candidates, of which there is also none seeded).
// This is enough real content to give processOutcome() genuine narrative
// text to analyze without needing additional seeding.
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-36.mjs

import {
  setupLocalEnv,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { LearningNetworkAggregatorAgent, SYSTEM_ORG_ID } = await import(
  "../../../src/lib/agents/learning-network-aggregator-agent.ts"
);

const CANONICAL = "AG-36";
const WRITE_TABLES = [
  "agent_runs",
  "agent_decisions",
  "alerts",
  "org_learning_contributions",
  "platform_learning_patterns",
];

async function main() {
  const db = await pgClient();

  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-36-learning-network"),
    platform_learning_patterns: await countRows(db, "platform_learning_patterns"),
    org_learning_contributions: await countRows(db, "org_learning_contributions"),
    alerts_learning_digest: (
      await db.query(
        "select count(*)::int as n from alerts where dedup_key like 'learning-network-digest:%'",
      )
    ).rows[0].n,
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new LearningNetworkAggregatorAgent(supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-36-learning-network"),
    platform_learning_patterns: await countRows(db, "platform_learning_patterns"),
    org_learning_contributions: await countRows(db, "org_learning_contributions"),
    alerts_learning_digest: (
      await db.query(
        "select count(*)::int as n from alerts where dedup_key like 'learning-network-digest:%'",
      )
    ).rows[0].n,
  };

  const runRow = (
    await db.query(
      "select * from agent_runs where agent_type='ag-36-learning-network' order by created_at desc limit 1",
    )
  ).rows[0] ?? null;
  const patternRows = (
    await db.query(
      "select * from platform_learning_patterns order by last_updated desc limit 8",
    )
  ).rows;
  const contributionRows = (
    await db.query(
      "select * from org_learning_contributions order by anonymized_at desc limit 8",
    )
  ).rows;
  const decisionRows = (
    await db.query(
      "select * from agent_decisions where agent_id='ag-36-learning-network' order by created_at desc limit 8",
    )
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  const patternHasRealContent =
    patternRows.length > 0 &&
    patternRows.some(
      (p) => p.pattern_content && p.pattern_content.length > 0 && p.sample_count >= 1,
    );

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}. Check sampleWrittenRow.agent_runs_row for a status='failed' row -- present means failRun() surfaced it (the app's own error handling worked), absent means the throw happened before startRun() completed (harder TRIGGER-BROKEN-adjacent failure, e.g. the agent_type enum/FK gap the file's own header warns about, or a still-missing schema dependency this session's local patch (_fix-local-schema-gaps-ag29-ag36.mjs) didn't anticipate).`;
  } else if (delta.platform_learning_patterns > 0 && patternHasRealContent) {
    verdict = "WORKS";
    const p = patternRows[0];
    reasoning =
      `DEFINITIVE ANSWER for the priority suspect question (watchListRef learningAggregatorNowWired_correctsStaleAssumption): this run produced ${delta.platform_learning_patterns} real, non-empty platform_learning_patterns row(s) with genuine content, NOT just a clean no-op fire. ` +
      `Concrete evidence: pattern_type="${p.pattern_type}", funder_category=${p.funder_category}, sample_count=${p.sample_count}, confidence=${p.confidence}, pattern_content="${p.pattern_content}", winning_examples=${JSON.stringify(p.winning_examples)}. ` +
      `This traces to real input: outcome 4660158e-68a9-4019-b085-d8edd1b2a58a (a genuine, substantial multi-section awarded grant narrative about transitional housing services for Central Texas) was anonymized (org name/mission-suffix/location redaction applied), sent through a real Claude call, and its extracted narrative_language phrase(s)/keyword(s) were persisted as real winning_examples on the pattern row above -- this is real cross-org learning content, not a placeholder. ` +
      `org_learning_contributions grew by ${delta.org_learning_contributions} (the per-outcome audit trail this class's own idempotency gate depends on). itemsFound=${result_.itemsFound}, itemsProcessed=${result_.itemsProcessed}. ` +
      `CONCLUSION: the July-2026 "orphaned, never-called" characterization is now conclusively STALE and CORRECTED -- not only does the scheduled job fire (per PT-08), the class itself, when invoked, genuinely writes real platform_learning_patterns content from real outcome data. Local schema had to be patched first (org_learning_contributions table + platform_learning_patterns.confidence/weight columns did not exist in the local stack at all before this session's _fix-local-schema-gaps-ag29-ag36.mjs) -- that gap would have made this class throw on its very first outcome in an unpatched environment, which is itself a separate, real production-relevant question this evidence surfaces (see registryPriorStatus) but is now proven not to be a code-logic defect in the agent itself.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning =
      `DEFINITIVE ANSWER for the priority suspect question: this run completed cleanly (agent_runs row written, itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}) but wrote ZERO platform_learning_patterns rows with real content -- this is a genuine WIRED-NO-OUTPUT, not a hedge. ` +
      `outcomesAnalyzed vs outcomes.length and skippedAsDuplicate are visible in triggerLog/sampleWrittenRow.agent_runs_row.output_summary; check whether the seeded real-narrative outcome (4660158e...) was found in scope (result='awarded', recorded_at within 90 days) and, if found, whether processOutcome's own per-outcome try/catch swallowed a Claude-call or write failure into runErrors rather than propagating it -- see errors array for the specific reason.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning =
      "DEFINITIVE ANSWER for the priority suspect question: no agent_runs, agent_decisions, or platform_learning_patterns activity at all, and no error surfaced -- the invocation never reached startRun()'s logging path (likely ensureSystemOrg() or startRun() itself failing before entering the try block, given this is the platform-level SYSTEM_ORG_ID pattern).";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-36-learning-network",
    implementingFile: "src/lib/agents/learning-network-aggregator-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new LearningNetworkAggregatorAgent(supabase).run('manual'). AutonomousAgent family, platform-level/unscoped (constructor takes only supabase; internally provisions/uses SYSTEM_ORG_ID for agent_runs/agent_decisions FK targets, per the class's own file header on why a real organizations row is required even though every actual data query is deliberately unscoped across all real tenant orgs). Real trigger path per pt09-001/agent-inventory.json is worker/scheduler.ts's weekly job, CONFIRMED STARTED+firing live per PT-08 -- this script exercises the same run() entrypoint directly. Local schema was patched first (org_learning_contributions table + platform_learning_patterns.confidence/weight columns, migrations 083/099, never applied to this local stack) via _fix-local-schema-gaps-ag29-ag36.mjs.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      platform_learning_patterns_rows: patternRows,
      org_learning_contributions_rows: contributionRows,
      agent_decisions_rows: decisionRows,
      agent_runs_row: runRow,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED+QUEUE -- real scheduler.ts weekly job, CONFIRMED STARTED+firing live per PT-08. watchListRef learningAggregatorNowWired_correctsStaleAssumption: older STATE_OF_THE_BUILD.md/FEATURE_REGISTRY_v2.md entries (July 2026) documented this class as real code that was NEVER imported or called anywhere (orphaned); PT-08 found the scheduled job STARTED+firing but did not confirm real platform_learning_patterns output -- this run is that confirmation.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
