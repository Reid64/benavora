// PT-09-002 execution proof: AG-02 (eligibility_scoring / src/lib/agents/eligibility-scorer.ts)
// Trigger method: direct class invocation, matching AG-01's proven pattern.
// Real trigger path per inventory is scheduled (nightly pipeline, gated on
// org_autonomous_config.auto_score_enabled) + queue routeQueueItem() case
// 'eligibility_scoring'. For this proof we invoke the class directly:
// new EligibilityScorer({ client, organizationId }).run({ opportunityId }).
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-02.mjs

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

const { EligibilityScorer } = await import("../../../src/lib/agents/eligibility-scorer.ts");

const CANONICAL = "AG-02";
const WRITE_TABLES = ["opportunities", "agent_runs"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  // Use opportunity 3 (untouched by AG-01/AG-08's write columns) so this
  // agent's own columns (eligibility_score, recommendation, etc.) are
  // observed cleanly.
  const opp = env.opportunities[2];

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new EligibilityScorer({
      client: supabase,
      organizationId: orgId,
    });
    runOutcome = await agent.run({ opportunityId: opp.id });
    log.push(`agent.run() resolved: runId=${runOutcome.runId} tokensUsed=${runOutcome.tokensUsed} durationMs=${runOutcome.durationMs}`);
    log.push(`data: ${JSON.stringify(runOutcome.data)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? err.stack ?? err.message : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) after[t] = await countRows(db, t, "organization_id", orgId);

  const oppRow = await latestRow(db, "opportunities", "id", opp.id, "updated_at");
  const runRow = runOutcome?.runId
    ? (await db.query("select * from agent_runs where id = $1", [runOutcome.runId])).rows[0]
    : null;

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw; the error was captured by this harness (not silently swallowed by the app), but no successful write occurred. Classified ERROR-SWALLOWED per the task's taxonomy since run() is where a caller would expect a clean result or a surfaced failure, and this is that failure.";
  } else if (
    delta.agent_runs > 0 &&
    oppRow &&
    oppRow.eligibility_score !== null &&
    oppRow.recommendation !== null &&
    runOutcome.data.eligibilityScore != null
  ) {
    verdict = "WORKS";
    reasoning = `agent_runs row written (real BaseAgent logging), opportunities.eligibility_score/recommendation/match_percentage/is_high_priority patched with a real Claude-derived score (${oppRow.eligibility_score} -> ${oppRow.recommendation}) -- matches AG-02's documented intent (score fit, write recommendation + reasoning).`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "agent_runs row was written (the run executed) but the opportunity row was not meaningfully patched with a score/recommendation -- zero real business-table output despite a clean run.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor opportunities changed, and no error was surfaced -- the invocation itself never reached BaseAgent.run()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "eligibility_scoring",
    implementingFile: "src/lib/agents/eligibility-scorer.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new EligibilityScorer({ client, organizationId }).run({ opportunityId }). Real trigger path (per pt09-001/agent-inventory.json) is the nightly autonomous pipeline (worker/autonomous-orchestrator.ts runEligibilityScoringStep(), gated on org_autonomous_config.auto_score_enabled) and routeQueueItem() case 'eligibility_scoring' -- both ultimately construct and call this same class/method, so direct invocation is a faithful proof of the real write path.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      opportunities_patched: oppRow
        ? {
            id: oppRow.id,
            name: oppRow.name,
            eligibility_score: oppRow.eligibility_score,
            recommendation: oppRow.recommendation,
            recommendation_reasoning: oppRow.recommendation_reasoning,
            match_percentage: oppRow.match_percentage,
            is_high_priority: oppRow.is_high_priority,
            match_mismatch_reasons: oppRow.match_mismatch_reasons,
            updated_at: oppRow.updated_at,
          }
        : null,
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus: "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED-GATED+QUEUE (code exists, real write target, wired to both the nightly pipeline and the queue processor).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
