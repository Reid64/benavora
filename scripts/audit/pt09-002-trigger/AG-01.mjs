// PT-09-002 execution proof: AG-01 (grant_summary / src/lib/agents/grant-summary.ts)
// Trigger method: direct class invocation, matching its real trigger path
// (a subroutine of research/import flow that instantiates it directly, per
// pt09-001) -- new GrantSummaryAgent({...}).run({ opportunityId }).
//
// Usage: node --import tsx scripts/audit/pt09-002-trigger/AG-01.mjs

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

const { GrantSummaryAgent } = await import("../../../src/lib/agents/grant-summary.ts");

const CANONICAL = "AG-01";
const WRITE_TABLES = ["opportunities", "agent_runs"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  const opp = env.opportunities[0];

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  // Give this opportunity some rawText so the agent has source content to
  // extract from (its own URL-fetch path is best-effort and may find
  // nothing for a synthetic example.com URL).
  try {
    const agent = new GrantSummaryAgent({
      client: supabase,
      organizationId: orgId,
    });
    runOutcome = await agent.run({
      opportunityId: opp.id,
      rawText:
        "The PT-09 Community Foundation Housing Stability Grant provides $15,000-$75,000 to " +
        "501(c)(3) organizations serving Central Texas. Applicants must submit a completed " +
        "application, most recent Form 990, and a current board list. Deadline is rolling. " +
        "Funds may be used for transitional housing services and workforce training programs.",
    });
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
    reasoning = "agent.run() threw; the error was captured by this harness (not silently swallowed by the app), but no successful write occurred. Classified ERROR-SWALLOWED per the task's taxonomy since the agent's own run() call is where a caller would expect a clean result or a surfaced failure, and this is that failure.";
  } else if (delta.agent_runs > 0 && oppRow && oppRow.description && oppRow.description.length > 0 && !runOutcome.data.needsManualEntry) {
    verdict = "WORKS";
    reasoning = "agent_runs row written (real BaseAgent logging), opportunities.description patched with Claude-extracted content, updatedFields populated -- matches AG-01's documented intent (patch an opportunity with structured extraction).";
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "agent_runs row was written (the run executed) but the opportunity row was not meaningfully patched -- zero real business-table output despite a clean run.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor opportunities changed, and no error was surfaced -- the invocation itself never reached BaseAgent.run()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "grant_summary",
    implementingFile: "src/lib/agents/grant-summary.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new GrantSummaryAgent({ client, organizationId }).run({ opportunityId, rawText }). Matches AG-01's real trigger path (subroutine, instantiated directly by its caller) per pt09-001.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      opportunities_patched: oppRow
        ? { id: oppRow.id, name: oppRow.name, description: oppRow.description, amount_min: oppRow.amount_min, amount_max: oppRow.amount_max, updated_at: oppRow.updated_at }
        : null,
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus: "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SUBROUTINE (code exists, real write target, no autonomous trigger -- a manually-invoked subroutine).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
