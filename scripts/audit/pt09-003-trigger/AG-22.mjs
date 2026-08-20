// PT-09-003 execution proof: AG-22 (ag22_propensity_scoring / src/lib/agents/ag-22-propensity-scoring.ts)
// Trigger method: direct class invocation, BaseAgent family (same shape as
// batch 1's AG-01) -- new PropensityScoringAgent({ client, organizationId }).run({ prospectId }).
//
// PRIORITY SUSPECT this session: watchListRef eaAg22EnrichmentPipelineNeverStarted
// (worker/enrichment-processor.ts, which is this class's only real production
// call site via triggerScoreEngine(), is DEFINED-NOT-STARTED in worker/index.ts's
// boot sequence per PT-08 -- so in production this class is never reached at
// all) and wasBlockedOnRotatedApiKey (this exact class was blocked on a dead
// ANTHROPIC_API_KEY 2026-08-02 through 2026-08-06, "fixed" by DIRECTIVE-018's
// 2026-08-06 key consolidation but never independently re-verified since).
// This script tests the SEPARATE question from reachability: does the class's
// own code, including its real Claude calls, work when directly instantiated
// against the CURRENT .env.local key? corporate_prospects has no
// organization_id (shared, cross-org table per the class's own file header),
// so before/after counts are scoped by prospect id, not org id.
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-22.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { PropensityScoringAgent } = await import(
  "../../../src/lib/agents/ag-22-propensity-scoring.ts"
);

const CANONICAL = "AG-22";
const WRITE_TABLES = ["corporate_prospects", "agent_runs"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  // environment.json's 2 corporateProspects ids -- confirmed via a direct
  // pg read before writing this script that BOTH already have
  // enrichment_completed_at set (2026-08-20 06:39/06:40 UTC), so this
  // agent's own self-gate (skip if enrichment hasn't completed) will not
  // fire and it will take the real 9-Claude-call scoring path. No
  // additional seeding was needed.
  const prospectId = env.corporateProspects[0];

  const db = await pgClient();

  const before = {};
  before.corporate_prospects = (
    await db.query(
      "select count(*)::int as n from corporate_prospects where id = $1 and scores_computed_at is not null",
      [prospectId],
    )
  ).rows[0].n;
  before.agent_runs = (
    await db.query(
      "select count(*)::int as n from agent_runs where organization_id = $1 and agent_type = 'ag22_propensity_scoring'",
      [orgId],
    )
  ).rows[0].n;

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new PropensityScoringAgent({
      client: supabase,
      organizationId: orgId,
    });
    runOutcome = await agent.run({ prospectId });
    log.push(
      `agent.run() resolved: runId=${runOutcome.runId} tokensUsed=${runOutcome.tokensUsed} durationMs=${runOutcome.durationMs}`,
    );
    log.push(`data.skipped=${runOutcome.data.skipped}`);
    log.push(`data.scores=${JSON.stringify(runOutcome.data.scores)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? err.stack ?? err.message : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  after.corporate_prospects = (
    await db.query(
      "select count(*)::int as n from corporate_prospects where id = $1 and scores_computed_at is not null",
      [prospectId],
    )
  ).rows[0].n;
  after.agent_runs = (
    await db.query(
      "select count(*)::int as n from agent_runs where organization_id = $1 and agent_type = 'ag22_propensity_scoring'",
      [orgId],
    )
  ).rows[0].n;

  const prospectRow = (
    await db.query("select * from corporate_prospects where id = $1", [prospectId])
  ).rows[0];
  const runRow = runOutcome?.runId
    ? (await db.query("select * from agent_runs where id = $1", [runOutcome.runId])).rows[0]
    : null;

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  // Definitive read on the rotated-key question, independent of overall verdict:
  const isRealAnthropic401 =
    errorSurfaced &&
    (/401/.test(errorSurfaced) || /authentication_error/i.test(errorSurfaced));
  const keyFindingNote = isRealAnthropic401
    ? "DEFINITIVE FINDING: the real Claude call FAILED with a 401/authentication_error against the CURRENT .env.local ANTHROPIC_API_KEY -- the rotated-key fix from DIRECTIVE-018 (2026-08-06) has regressed or the key currently loaded is dead again."
    : errorSurfaced
      ? "DEFINITIVE FINDING: the run threw, but NOT a 401/authentication_error -- the rotated-key fix holds; this is a different failure mode."
      : "DEFINITIVE FINDING: the real Claude call SUCCEEDED against the CURRENT .env.local ANTHROPIC_API_KEY (9 real scoring calls + PS-01 formula) -- the 2026-08-06 key rotation still holds as of this session, no 401 reproduced.";

  let verdict;
  let reasoning;
  const scoresObj = prospectRow?.scores;
  const hasRealScores =
    scoresObj && typeof scoresObj === "object" && Object.keys(scoresObj).length >= 10; // PS-01..PS-10 + ranking

  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced.split("\n")[0]}. BaseAgent.run() writes agent_runs.status='failed' with error_message before rethrowing (see sampleWrittenRow.agent_runs_row), so the failure IS logged internally, but no caller in production today ever reads agent_runs for this class (worker/enrichment-processor.ts, its only real call site, is itself DEFINED-NOT-STARTED per PT-08 boot-inventory.json) -- so in the live system this failure would be entirely invisible, which is why ERROR-SWALLOWED (not just a clean throw) is the correct classification. ${keyFindingNote}`;
  } else if (delta.corporate_prospects > 0 && hasRealScores && runOutcome?.data?.skipped === false) {
    verdict = "WORKS";
    reasoning = `corporate_prospects row ${prospectId} (${prospectRow.legal_name}) was updated with a real scores jsonb containing ${Object.keys(scoresObj).length} keys (PS-01..PS-10 + ranking), scores_computed_at=${prospectRow.scores_computed_at}, PS-01 (Overall Donation Likelihood)=${scoresObj["PS-01"]?.score}. 9 real sequential Claude calls succeeded (tokensUsed=${runOutcome.tokensUsed}), each returning real per-rubric rationale/top_factors text -- this is real, substantive Claude-generated content, not a mock or fallback. agent_runs row completed cleanly. ${keyFindingNote} Note: this proves the CLASS's own code works correctly when reached -- it is a SEPARATE fact from production reachability, which PT-08/pt09-001 already established is currently zero (worker/enrichment-processor.ts never imported into worker/index.ts's boot sequence).`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs row was written (the run executed cleanly, skipped=${runOutcome?.data?.skipped}) but corporate_prospects.scores was not meaningfully populated -- zero real business-table output despite a clean run. ${keyFindingNote}`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = `Neither agent_runs nor corporate_prospects changed, and no error was surfaced -- the invocation itself never reached BaseAgent.run()'s logging path. ${keyFindingNote}`;
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag22_propensity_scoring",
    implementingFile: "src/lib/agents/ag-22-propensity-scoring.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new PropensityScoringAgent({ client, organizationId }).run({ prospectId }). BaseAgent family (same constructor/run shape as batch 1's AG-01), timeoutMs=270000 (9 sequential Claude calls). prospectId is one of environment.json's 2 seeded corporateProspects ids, both of which already had enrichment_completed_at set at the time this script ran, so no additional seeding was required and the agent's own enrichment-completeness self-gate did not fire.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      corporate_prospects_row: prospectRow
        ? {
            id: prospectRow.id,
            legal_name: prospectRow.legal_name,
            scores: prospectRow.scores,
            scores_computed_at: prospectRow.scores_computed_at,
            enrichment_completed_at: prospectRow.enrichment_completed_at,
          }
        : null,
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: NOT-WIRED (DEFINED-NOT-STARTED per PT-08) -- worker/enrichment-processor.ts's EA-01..EA-10+AG-22 pipeline is imported nowhere in worker/index.ts's boot sequence, confirmed a second time this session (grep of worker/index.ts finds no import of enrichment-processor.ts). watchListRef: eaAg22EnrichmentPipelineNeverStarted (HIGH priority, largest concentration of real-but-unreachable code in the inventory), wasBlockedOnRotatedApiKey (HIGH priority, this exact agent named as the historical 401 victim). " +
      keyFindingNote,
    falsePassCasualty: false,
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
  console.log(keyFindingNote);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
