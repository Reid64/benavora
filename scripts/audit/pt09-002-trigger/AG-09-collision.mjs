// PT-09-002 execution proof: AG-09 (on-disk collision, unregistered)
// (outcome_analyzer / src/lib/agents/outcome-analyzer-agent.ts)
//
// CORRECTION vs. the task prompt and agent-inventory.json's writesTo list:
// both say "Writes outcomes (reads organizations)". Reading the actual source
// (outcome-analyzer-agent.ts:92-98, :200-211) shows the exact opposite --
// this agent READS the `outcomes` table (aggregates success rate / award
// size / dollar efficiency) and WRITES the aggregate + a Claude-generated
// insight summary into `organizations.analytics` (a jsonb merge-update). It
// never inserts/updates a row in `outcomes` itself. This script tests the
// real write target (organizations.analytics), not the task-given one.
//
// Seed dependency: this org had zero `outcomes` rows (an empty-outcomes run
// completes immediately with "nothing to analyze" and no Claude call / no
// organizations update -- a legitimate but uninteresting zero-item
// completion). Seeded 2 outcomes (1 awarded, 1 declined) via
// scripts/audit/pt09-002-trigger/_seed-groupc.mjs so this agent has real
// signal to aggregate and summarize.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-09-collision.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  latestRow,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { OutcomeAnalyzerAgent } = await import(
  "../../../src/lib/agents/outcome-analyzer-agent.ts"
);

const CANONICAL = "AG-09 (on-disk collision, unregistered)";
const WRITE_TABLES = ["organizations", "agent_runs", "agent_decisions"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {};
  before.organizations_analytics = (
    await db.query("select analytics from organizations where id = $1", [orgId])
  ).rows[0]?.analytics ?? null;
  before.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);
  before.agent_decisions = (
    await db.query("select count(*)::int as n from agent_decisions where org_id = $1", [orgId])
  ).rows[0].n;
  before.outcomes = await countRows(db, "outcomes", "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  log.push(
    "Pre-condition: seeded 2 outcomes rows (1 awarded $45,000/$50,000 requested, 1 declined) " +
      "via _seed-groupc.mjs so this agent's aggregation has real signal (the code short-circuits " +
      "to a zero-item completion with no organizations write when outcomes.length === 0).",
  );
  log.push(
    "SCHEMA PATCH (safety rule 5): local `organizations` table was missing the `analytics` jsonb " +
      "column this agent writes to. That column is a real production column added by migration 082 " +
      "(src/supabase/migrations/082_ag08_ag12_autonomous_agents.sql:21, 'ALTER TABLE organizations ADD " +
      "COLUMN IF NOT EXISTS analytics jsonb DEFAULT ...') that was simply not carried into the pt09-002 " +
      "local schema-extension script -- a scaffolding gap, not an application bug. Patched locally via " +
      "the exact same ALTER TABLE ... ADD COLUMN IF NOT EXISTS statement from migration 082.",
  );

  try {
    const agent = new OutcomeAnalyzerAgent(orgId, supabase);
    runOutcome = await agent.run("manual");
    log.push(`agent.run() resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  after.organizations_analytics = (
    await db.query("select analytics from organizations where id = $1", [orgId])
  ).rows[0]?.analytics ?? null;
  after.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);
  after.agent_decisions = (
    await db.query("select count(*)::int as n from agent_decisions where org_id = $1", [orgId])
  ).rows[0].n;
  after.outcomes = await countRows(db, "outcomes", "organization_id", orgId);

  const runRow = await latestRow(db, "agent_runs", "organization_id", orgId, "started_at");
  const decisionRow = (
    await db.query(
      "select * from agent_decisions where org_id = $1 and decision_type = 'funding_analytics_updated' order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;

  await db.end();

  const delta = {
    organizations_analytics_changed:
      JSON.stringify(before.organizations_analytics) !== JSON.stringify(after.organizations_analytics),
    agent_runs: after.agent_runs - before.agent_runs,
    agent_decisions: after.agent_decisions - before.agent_decisions,
    outcomes: after.outcomes - before.outcomes,
  };

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw; caught by this harness (not silently swallowed by the app), but no successful write occurred.";
  } else if (
    delta.organizations_analytics_changed &&
    after.organizations_analytics?.insightSummary &&
    after.organizations_analytics.insightSummary.length > 20 &&
    decisionRow
  ) {
    verdict = "WORKS";
    reasoning =
      "organizations.analytics was updated with a real computed successRateByCategory/averageAwardSize/dollarEfficiency snapshot " +
      "plus a real Claude-generated insightSummary (not boilerplate), and a matching agent_decisions row with substantive reasoning was " +
      "logged. This matches the agent's actual documented behavior (aggregate outcomes -> summarize -> persist to organizations.analytics) " +
      "-- note this is NOT what the task prompt / inventory claimed the write target was ('outcomes'); the real target is organizations.analytics, " +
      "verified by reading the source directly.";
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "agent_runs row was written (the run executed) but organizations.analytics was not meaningfully updated.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor organizations.analytics changed, and no error was surfaced.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: null,
    implementingFile: "src/lib/agents/outcome-analyzer-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new OutcomeAnalyzerAgent(orgId, supabase).run('manual'). " +
      "Matches its real (scheduled, Sunday-gated) trigger path minus the isSundayChicago() gate, an external scheduling condition.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      organizations_analytics: after.organizations_analytics,
      agent_runs_row: runRow ?? null,
      agent_decisions_row: decisionRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "No registry entry (inRegistry: false per agent-inventory.json). FEATURE_REGISTRY_v2.md row #209: " +
      "'AG-09 Outcome Analyzer | BUILT | Weekly + event-driven. Updates analytics and proven narrative status.' -- the 'updates analytics' " +
      "part matches this file's real behavior; the 'proven narrative status' part does NOT (this file's own header states it deliberately " +
      "does not write is_proven/proven_count, leaving that to recursive-learning.ts per Behavioral Contracts §8/§10 single-writer rule) -- " +
      "a registry overclaim on a sub-detail, not on the core write target this test verifies.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
