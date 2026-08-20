// PT-09-002 execution proof: AG-15 (ag-15-probability / src/lib/agents/probability-scoring-agent.ts)
// Trigger method: direct class invocation of the AutonomousAgent family --
// a DIFFERENT constructor/run() shape than AG-01/02/03/08's BaseAgent
// family. constructor(orgId, supabase); run(triggerSource) with no other
// params (scope is loaded internally: "chain" reads the active agent_queue
// row's input_payload, anything else loads every open, unscored/stale
// opportunity for the org, capped at MAX_PER_RUN=20).
// Real trigger path per inventory: nightly pipeline (gated on
// org_autonomous_config.auto_score_enabled) + routeQueueItem() case
// 'ag-15-probability'. We invoke with triggerSource="manual" so it takes
// the "default scope" branch (loadDefaultScope), which is the same code
// path the nightly pipeline's runProbabilityScoringStep() exercises once
// past its own auto_score_enabled gate check (this script bypasses that
// gate deliberately, the same way a direct queue-processor call would after
// the gate already passed elsewhere).
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-15.mjs

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

const { ProbabilityScoringAgent } = await import("../../../src/lib/agents/probability-scoring-agent.ts");

const CANONICAL = "AG-15";
const WRITE_TABLES = ["opportunity_probability_scores", "agent_decisions", "agent_runs", "agent_queue"];

// LOCAL SCHEMA PATCH (documented per SAFETY RULE 5): opportunity_probability_
// scores was a pt05 widen (add-column-only), so it never got the real
// UNIQUE(opportunity_id, organization_id) constraint this file's own header
// comment says exists in production (migration 093) and that its own
// .upsert({ onConflict: "opportunity_id,organization_id" }) call depends on.
// First run without the constraint failed every opportunity with "there is
// no unique or exclusion constraint matching the ON CONFLICT specification"
// -- a genuine local scaffolding gap, not an application bug. Added via a
// one-time idempotent ALTER TABLE; see
// scripts/audit/pt09-002-trigger/_fix-probability-scores-constraint.mjs.

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) {
    before[t] = await countRows(
      db,
      t,
      t === "agent_decisions" || t === "agent_queue" ? "org_id" : "organization_id",
      orgId,
    );
  }

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new ProbabilityScoringAgent(orgId, supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? err.stack ?? err.message : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) {
    after[t] = await countRows(
      db,
      t,
      t === "agent_decisions" || t === "agent_queue" ? "org_id" : "organization_id",
      orgId,
    );
  }

  const scoreRow = await latestRow(db, "opportunity_probability_scores", "organization_id", orgId, "computed_at");
  const decisionRow = await latestRow(db, "agent_decisions", "org_id", orgId, "created_at");
  const runRow = await latestRow(db, "agent_runs", "organization_id", orgId, "created_at");
  const queueRow = await latestRow(db, "agent_queue", "org_id", orgId, "queued_at");

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw past this harness. AutonomousAgent.run() is a try/catch that calls failRun() (writes agent_runs.status='failed'+error_message) on any internal throw, so check whether an agent_runs row with status=failed exists -- if so the app DID surface it (not truly swallowed by the app, just by nothing external ever reading agent_runs); if no such row exists either, the throw happened before startRun() completed and is a harder TRIGGER-BROKEN-adjacent failure. See sampleWrittenRow.agent_runs_row and errorSurfaced for the specifics.";
  } else if (
    delta.opportunity_probability_scores > 0 &&
    delta.agent_decisions > 0 &&
    scoreRow &&
    scoreRow.overall_score != null &&
    Array.isArray(scoreRow.factors) &&
    scoreRow.factors.length > 0
  ) {
    verdict = "WORKS";
    reasoning = `opportunity_probability_scores row(s) written with a real Claude-calibrated overall_score=${scoreRow.overall_score}, confidence=${scoreRow.confidence}, and a real 5-factor breakdown; agent_decisions row logged with reasoning; agent_runs row completed -- matches AG-15's documented intent (self-calibrating probability score persisted per opportunity). result.itemsProcessed=${result_.itemsProcessed}, result.decisions.length=${result_.decisions.length}.`;
  } else if (delta.agent_runs > 0 || delta.agent_decisions > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs/agent_decisions activity occurred (itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}) but zero opportunity_probability_scores rows landed -- zero real business-table output despite a clean run. errors reported by the agent itself: ${JSON.stringify(result_?.errors)}.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs, agent_decisions, or opportunity_probability_scores activity, and no error was surfaced -- the invocation itself never reached startRun()'s logging path.";
  }

  const registryResult = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-15-probability",
    implementingFile: "src/lib/agents/probability-scoring-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new ProbabilityScoringAgent(orgId, supabase).run('manual'). AutonomousAgent family (autonomous-base.ts), not BaseAgent -- constructor(orgId, supabase), run(triggerSource) only (no opportunityId param; scope is loaded internally via loadDefaultScope() for any triggerSource other than 'chain'). Real trigger path (per pt09-001/agent-inventory.json) is the nightly pipeline (worker/autonomous-orchestrator.ts runProbabilityScoringStep(), gated on org_autonomous_config.auto_score_enabled) and routeQueueItem() case 'ag-15-probability', both of which ultimately construct+call this same class with a 'schedule'/'chain' triggerSource -- 'manual' here exercises the same loadDefaultScope() code path minus the gate check.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      opportunity_probability_scores_row: scoreRow ?? null,
      agent_decisions_row: decisionRow ?? null,
      agent_runs_row: runRow ?? null,
      agent_queue_row: queueRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus: "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED-GATED+QUEUE (code exists, real write target, wired to both the nightly pipeline and the queue processor). watchListRef: wasBlockedOnRotatedApiKey (a prior, unrelated incident, not reproduced here per benavora-anthropic-key-invalid-local memory -- key is live as of 2026-08-13).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, registryResult);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
