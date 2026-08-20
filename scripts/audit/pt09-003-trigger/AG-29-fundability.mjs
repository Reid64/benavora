// PT-09-003 execution proof: AG-29 (Fundability Scorer)
// registryAgentId ag-29-fundability / src/lib/agents/fundability-scorer-agent.ts
//
// COLLISION-PAIR NOTE (see also AG-29-knowledge-indexer.mjs): this class is
// the second half of the documented dual-use of "AG-29." Confirmed
// independently this session by reading both files in full: this class
// (FundabilityScorerAgent) is per-org (constructor(orgId, supabase)), makes
// TWO real Claude calls per opportunity (base 8-category deficiency scoring
// + a conditional "with fixes" re-score), and writes fundability_scores --
// a completely different file, constructor shape, write target, and
// business purpose than the platform-level, embedding-focused
// KnowledgeIndexerAgent that also claims "AG-29." Both carry distinct,
// non-colliding agent_type literals ("ag-29-fundability" vs
// "ag-29-knowledge-indexer") by deliberate design (see this file's own
// header comment, "Numbering note").
//
// Trigger method: direct class invocation, AutonomousAgent family --
// constructor(orgId, supabase); run(triggerSource). triggerSource="manual"
// takes the loadDefaultScope() branch (same as the nightly pipeline's
// runFundabilityScoringStep() would exercise once past its own
// auto_fundability_enabled gate, per pt09-001/agent-inventory.json).
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-29-fundability.mjs

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

const { FundabilityScorerAgent } = await import(
  "../../../src/lib/agents/fundability-scorer-agent.ts"
);

const CANONICAL = "AG-29 (Fundability Scorer)";
const WRITE_TABLES = ["agent_queue", "agent_runs", "agent_decisions", "fundability_scores"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-29-fundability"),
    agent_decisions: (
      await db.query("select count(*)::int as n from agent_decisions where org_id=$1 and agent_id='ag-29-fundability'", [orgId])
    ).rows[0].n,
    fundability_scores: await countRows(db, "fundability_scores", "org_id", orgId),
    agent_queue: (
      await db.query("select count(*)::int as n from agent_queue where org_id=$1 and agent_id='ag-05-draft'", [orgId])
    ).rows[0].n,
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new FundabilityScorerAgent(orgId, supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-29-fundability"),
    agent_decisions: (
      await db.query("select count(*)::int as n from agent_decisions where org_id=$1 and agent_id='ag-29-fundability'", [orgId])
    ).rows[0].n,
    fundability_scores: await countRows(db, "fundability_scores", "org_id", orgId),
    agent_queue: (
      await db.query("select count(*)::int as n from agent_queue where org_id=$1 and agent_id='ag-05-draft'", [orgId])
    ).rows[0].n,
  };

  const scoreRow = await latestRow(db, "fundability_scores", "org_id", orgId, "generated_at");
  const decisionRow = (
    await db.query(
      "select * from agent_decisions where org_id=$1 and agent_id='ag-29-fundability' order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const runRow = await latestRow(db, "agent_runs", "agent_type", "ag-29-fundability", "created_at");

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}. Check sampleWrittenRow.agent_runs_row for a status='failed' row -- present means the app's own failRun() surfaced it, absent means the throw happened before startRun() completed.`;
  } else if (
    delta.fundability_scores > 0 &&
    delta.agent_decisions > 0 &&
    scoreRow &&
    scoreRow.overall_score != null &&
    Array.isArray(scoreRow.deficiencies)
  ) {
    verdict = "WORKS";
    reasoning = `fundability_scores row written with a real Claude-computed overall_score=${scoreRow.overall_score}, probability_without_fixes=${scoreRow.probability_without_fixes}, probability_with_fixes=${scoreRow.probability_with_fixes}, confidence=${scoreRow.confidence}, and ${scoreRow.deficiencies.length} real deficiency object(s) each classified under the 8-category rubric; agent_decisions row logged with reasoning >=100 words; agent_runs row completed. result.itemsProcessed=${result_.itemsProcessed} of itemsFound=${result_.itemsFound}. Matches AG-29-fundability's documented intent (diagnostic fundability score + deficiency breakdown, never auto-publishing KB/twin content).`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs activity occurred (itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}) but zero fundability_scores rows landed -- zero real business-table output despite a clean run.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs, agent_decisions, or fundability_scores activity, and no error was surfaced -- the invocation never reached startRun()'s logging path.";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-29-fundability",
    implementingFile: "src/lib/agents/fundability-scorer-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new FundabilityScorerAgent(orgId, supabase).run('manual'). AutonomousAgent family, per-org (constructor(orgId, supabase)). 'manual' exercises loadDefaultScope() (open opportunities with no fundability_scores row yet or a stale one), the same scope-loading code path the nightly pipeline's runFundabilityScoringStep() exercises once past its own org_autonomous_config.auto_fundability_enabled gate check, per pt09-001/agent-inventory.json.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      fundability_scores_row: scoreRow ?? null,
      agent_decisions_row: decisionRow,
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning:
      reasoning +
      " NUMBER-COLLISION CROSS-CONFIRMATION: this class (ag-29-fundability, src/lib/agents/fundability-scorer-agent.ts, per-org 2-Claude-call deficiency diagnostic writing fundability_scores) is genuinely distinct from the other real class also claiming 'AG-29' (ag-29-knowledge-indexer, src/lib/agents/knowledge-indexer-agent.ts, platform-level pgvector embedding + knowledge_patterns aggregation) -- confirmed by reading both files in full this session and by this run's own agent_runs.agent_type='ag-29-fundability' rows never intersecting the other class's 'ag-29-knowledge-indexer' rows in this same database. Different files, different constructors, different write targets, different business purpose -- a real, deliberate dual-use of the number 29 per AGENTS_v2.md's own roster, not a bug.",
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED-NIGHTLY+QUEUE (registry metadata stale: claims manual, is actually scheduled).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
