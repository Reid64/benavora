// PT-09-003 execution proof: AG-38 (ag-38-self-improvement /
// src/lib/agents/self-improvement-agent.ts)
// Trigger method: direct class invocation -- new SelfImprovementAgent(supabase).run('manual').
// NOT an AutonomousAgent subclass (see file header) -- constructor(supabase)
// only, no orgId, since this is the first genuinely platform-wide agent in
// the codebase (its own agent_runs row has organization_id = null).
//
// DATA-AVAILABILITY NOTE (per task instructions): this agent's metrics
// engine reads "yesterday" (UTC calendar day) agent_runs/agent_decisions and
// a trailing-7-day agent_performance_metrics rollup. A direct pg check
// before writing this script found all 31 real agent_runs rows on the local
// stack dated within the SAME UTC hour as this session (2026-08-20 06:00
// UTC) -- none from "yesterday" (2026-08-19 UTC), so calculateAgentMetrics()
// would find zero rows and this agent would have nothing real to analyze.
// Per the task's explicit instruction to seed real history if the local
// environment lacks a meaningful sample, this script inserts a real,
// deliberately-underperforming batch of agent_runs (dated yesterday, UTC)
// for agent_type='ag-15-probability' under the seeded PT-09 org: 4
// completed (low confidence_score=45) + 6 failed, giving success_rate=40%
// (<75% CRITICAL, <50% ESCALATION), error_rate=60% (>40% RELIABILITY +
// ESCALATION), avg_confidence_score=45 (<60 LOW_CONFIDENCE) -- and a matching
// batch of agent_decisions (8 requiring review / 2 auto-approved, review_rate
// 80% > 40% HIGH_REVIEW_BURDEN). This is real seeded data the agent's own
// deterministic metrics/threshold code processes for real; only the input
// history is synthetic, not the agent's behavior against it.
//
// LOCAL SCAFFOLDING NOTE: improvement_proposals / agent_performance_metrics
// did not exist on the local stack (only committed on disk at
// src/supabase/migrations/087_continuous_improvement.sql +
// 100_self_improvement_hardening.sql) -- applied via _fix-missing-tables.mjs
// this session (idempotent), along with agent_runs.organization_id DROP NOT
// NULL (088_self_improvement_agent.sql) so this class's platform-level
// agent_runs insert (organization_id: null) succeeds.
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-38.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { SelfImprovementAgent } = await import(
  "../../../src/lib/agents/self-improvement-agent.ts"
);

const CANONICAL = "AG-38";
const TARGET_AGENT = "ag-15-probability";

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();

  // Seed: a real, deliberately-underperforming "yesterday" (UTC) batch for
  // TARGET_AGENT so identifyUnderperformers()/escalateCriticalAgents() have
  // real signal to act on.
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(12, 0, 0, 0);

  const seededRunIds = [];
  for (let i = 0; i < 4; i++) {
    const r = await db.query(
      `insert into agent_runs (organization_id, agent_type, status, confidence_score, items_processed, created_at, started_at, completed_at, trigger_source)
       values ($1, $2, 'completed', 45, 2, $3, $3, $3, 'schedule') returning id`,
      [orgId, TARGET_AGENT, yesterday.toISOString()],
    );
    seededRunIds.push(r.rows[0].id);
  }
  for (let i = 0; i < 6; i++) {
    const r = await db.query(
      `insert into agent_runs (organization_id, agent_type, status, error_message, created_at, started_at, completed_at, trigger_source)
       values ($1, $2, 'failed', 'PT-09 seeded failure for AG-38 underperformer test', $3, $3, $3, 'schedule') returning id`,
      [orgId, TARGET_AGENT, yesterday.toISOString()],
    );
    seededRunIds.push(r.rows[0].id);
  }
  for (let i = 0; i < 10; i++) {
    await db.query(
      `insert into agent_decisions (org_id, agent_id, decision_type, entity_type, entity_id, reasoning, confidence_score, action_taken, required_human_review, created_at)
       values ($1, $2, 'probability_scored', 'opportunity', $3, 'PT-09 seeded decision for AG-38 test', 45, 'seeded', $4, $5)`,
      [orgId, TARGET_AGENT, env.opportunities[0].id, i < 8, yesterday.toISOString()],
    );
  }
  const seedLog = `seed: inserted 10 agent_runs (4 completed@confidence=45, 6 failed) + 10 agent_decisions (8 required_human_review) for agent_type='${TARGET_AGENT}' dated ${yesterday.toISOString()} (UTC 'yesterday') -- success_rate=40%, error_rate=60%, avg_confidence=45, review_rate=80%, all four underperformance thresholds breached by design.`;

  const before = {
    improvement_proposals: (await db.query(`select count(*)::int as n from improvement_proposals`)).rows[0].n,
    agent_performance_metrics: (await db.query(`select count(*)::int as n from agent_performance_metrics`)).rows[0].n,
    agent_runs_platform_level: (await db.query(`select count(*)::int as n from agent_runs where organization_id is null`)).rows[0].n,
    alerts: await countRows(db, "alerts", "organization_id", orgId),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [seedLog];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new SelfImprovementAgent(supabase);
    runOutcome = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? err.stack ?? err.message : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    improvement_proposals: (await db.query(`select count(*)::int as n from improvement_proposals`)).rows[0].n,
    agent_performance_metrics: (await db.query(`select count(*)::int as n from agent_performance_metrics`)).rows[0].n,
    agent_runs_platform_level: (await db.query(`select count(*)::int as n from agent_runs where organization_id is null`)).rows[0].n,
    alerts: await countRows(db, "alerts", "organization_id", orgId),
  };

  const proposalRows = (
    await db.query(
      `select * from improvement_proposals order by proposed_at desc limit 5`,
    )
  ).rows;
  const metricRow = (
    await db.query(
      `select * from agent_performance_metrics where agent_id = $1 order by metric_date desc limit 1`,
      [TARGET_AGENT],
    )
  ).rows[0];
  const platformRunRow = (
    await db.query(
      `select * from agent_runs where organization_id is null order by created_at desc limit 1`,
    )
  ).rows[0];
  const alertRow = (
    await db.query(
      `select * from alerts where organization_id = $1 order by created_at desc limit 1`,
      [orgId],
    )
  ).rows[0];

  await db.end();

  const delta = {
    improvement_proposals: after.improvement_proposals - before.improvement_proposals,
    agent_performance_metrics: after.agent_performance_metrics - before.agent_performance_metrics,
    agent_runs_platform_level: after.agent_runs_platform_level - before.agent_runs_platform_level,
    alerts: after.alerts - before.alerts,
  };

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced.split("\n")[0]}. This class's own failRun() writes agent_runs.status='failed' (organization_id=null) before rethrowing -- check sampleWrittenRow.platform_agent_runs_row.`;
  } else if (delta.agent_performance_metrics > 0 && metricRow && metricRow.runs_total === 10) {
    if (delta.improvement_proposals > 0 || delta.alerts > 0) {
      verdict = "WORKS";
      reasoning = `Real 6-metric daily rollup written to agent_performance_metrics for '${TARGET_AGENT}' (runs_total=10, runs_successful=${metricRow.runs_successful}, runs_failed=${metricRow.runs_failed}, avg_confidence_score=${metricRow.avg_confidence_score}). ${delta.improvement_proposals > 0 ? `${delta.improvement_proposals} real Claude-generated improvement_proposals row(s) written for the seeded underperformer.` : "No proposal cleared confidence/dedup filtering this run,"} ${delta.alerts > 0 ? `${delta.alerts} real escalation alert(s) fired (success_rate 40%<50% and/or error_rate 60%>40% thresholds breached).` : ""} agent_runs row completed with organization_id=null (platform-wide, per file header). This matches AG-38's documented intent: metrics calculation + underperformance detection + immediate escalation all fired for real against the seeded underperforming agent.`;
    } else {
      verdict = "WIRED-NO-OUTPUT";
      reasoning = `agent_performance_metrics row written correctly (runs_total=10 for the seeded '${TARGET_AGENT}' batch, confirming the metrics engine itself works), but neither an improvement_proposals row nor an escalation alert was produced despite the seeded data crossing every documented threshold (success_rate 40%<75%, error_rate 60%>20%, avg_confidence 45<60, review_rate 80%>40%). result=${JSON.stringify(runOutcome)}.`;
    }
  } else if (runOutcome && runOutcome.success) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs row completed cleanly (organization_id=null) but the metrics engine did not produce the expected agent_performance_metrics row for the seeded '${TARGET_AGENT}' batch. result=${JSON.stringify(runOutcome)}.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No platform-level agent_runs activity and no error surfaced -- the invocation itself never reached startRun()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-38-self-improvement",
    implementingFile: "src/lib/agents/self-improvement-agent.ts",
    writeTargetTables: ["agent_decisions", "agent_performance_metrics", "agent_runs (read)", "alerts", "improvement_proposals", "profiles (read)"],
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new SelfImprovementAgent(supabase).run('manual'). NOT AutonomousAgent -- constructor(supabase) only, platform-wide (agent_runs.organization_id=null). Real trigger path is worker/scheduler.ts's own nightly job, CONFIRMED STARTED+firing live per PT-08. This script seeds a real 'yesterday' (UTC) underperforming batch for agent_type='ag-15-probability' (see triggerLog) since the local stack's real agent_runs history was all same-UTC-hour-as-this-session, outside this agent's own 'yesterday' analysis window.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      improvement_proposals_row: proposalRows[0] ?? null,
      all_recent_proposals: proposalRows,
      agent_performance_metrics_row: metricRow ?? null,
      platform_agent_runs_row: platformRunRow ?? null,
      escalation_alert_row: alertRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED+QUEUE -- real worker/scheduler.ts job, CONFIRMED STARTED+firing live per PT-08. watchList does not flag this agent specifically as a suspect; this run additionally verifies the metrics/underperformance/proposal-generation pipeline produces real output when given real (here, seeded) underperforming history, not just that the cron fires.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
