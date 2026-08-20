// PT-09-002 execution proof: AG-03 (deadline_extraction / src/lib/agents/deadline-extractor.ts)
// Trigger method: direct class invocation, matching AG-01's proven pattern.
// Real trigger path per inventory: queue only (worker/autonomous-orchestrator.ts
// routeQueueItem() case 'deadline_extraction'). No scheduled path found.
//
// Note on write targets: the inventory entry lists writesTo ["deadlines",
// "opportunities"], but reading the actual source (deadline-extractor.ts)
// shows it only ever INSERTs into `deadlines` -- it SELECTs opportunities for
// its input facts but never UPDATEs the opportunities row. This script
// tracks `deadlines` as the real write target and documents the inventory
// discrepancy here rather than silently trusting the stale claim.
//
// This agent is deterministic (no Claude call, tokensUsed always 0) -- it
// derives deadline records purely from the opportunity's own `deadline` and
// `recurrence` columns plus a report-mention regex.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-03.mjs

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

const { DeadlineExtractor } = await import("../../../src/lib/agents/deadline-extractor.ts");

const CANONICAL = "AG-03";
const WRITE_TABLES = ["deadlines", "agent_runs"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  // Opportunity 3 already has a real deadline (2026-10-09) and its
  // description/eligibility_requirements text does not mention "report",
  // so this run should produce an application_deadline + up-to-3 follow_up
  // reminders (no reporting_deadline, no renewal_date since recurrence is
  // null, not "annual").
  const opp = env.opportunities[2];

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, "organization_id", orgId);
  const beforeDeadlinesForOpp = await countRows(db, "deadlines", "opportunity_id", opp.id);

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new DeadlineExtractor({
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
  const afterDeadlinesForOpp = await countRows(db, "deadlines", "opportunity_id", opp.id);

  const deadlineRows = (
    await db.query(
      "select * from deadlines where opportunity_id = $1 order by due_date asc",
      [opp.id],
    )
  ).rows;
  const runRow = runOutcome?.runId
    ? (await db.query("select * from agent_runs where id = $1", [runOutcome.runId])).rows[0]
    : null;

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];
  const deadlinesForOppDelta = afterDeadlinesForOpp - beforeDeadlinesForOpp;

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw; the error was captured by this harness (not silently swallowed by the app), but no successful write occurred. Classified ERROR-SWALLOWED since run() is where a caller would expect a clean result or a surfaced failure, and this is that failure.";
  } else if (delta.agent_runs > 0 && deadlinesForOppDelta > 0 && deadlineRows.some((r) => r.deadline_type === "application_deadline")) {
    verdict = "WORKS";
    reasoning = `agent_runs row written (real BaseAgent logging), ${deadlinesForOppDelta} real deadlines row(s) inserted for the opportunity including an application_deadline anchored to its real deadline date -- matches AG-03's documented deterministic intent.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "agent_runs row was written (the run executed) but zero deadlines rows were created for this opportunity -- zero real business-table output despite a clean run.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor deadlines changed, and no error was surfaced -- the invocation itself never reached BaseAgent.run()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "deadline_extraction",
    implementingFile: "src/lib/agents/deadline-extractor.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new DeadlineExtractor({ client, organizationId }).run({ opportunityId }). Real trigger path (per pt09-001/agent-inventory.json) is routeQueueItem() case 'deadline_extraction' in worker/autonomous-orchestrator.ts, which constructs and calls this same class/method -- direct invocation is a faithful proof of the real write path. No scheduled/nightly trigger path was found for this agent.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      deadlines_inserted_for_opportunity: deadlineRows.map((r) => ({
        id: r.id,
        deadline_type: r.deadline_type,
        due_date: r.due_date,
        title: r.title,
      })),
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus: "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-QUEUE (code exists, real write target, wired to the queue processor only). Note: the inventory's writesTo list includes 'opportunities', but this script found the real code never updates that table (read-only lookup) -- documented as an inventory discrepancy above.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
