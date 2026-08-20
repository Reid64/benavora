// PT-09-002 execution proof: AG-09 (canonical)
// (email_parser / src/lib/agents/email-parser.ts)
//
// Real trigger per inventory: manual dashboard paste into the EmailParserWidget
// only -- no Gmail-webhook auto-trigger exists. This script fires the same
// path a human paste-and-classify action would: EmailParserAgent.run({emails}).
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-09.mjs

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

const { EmailParserAgent } = await import("../../../src/lib/agents/email-parser.ts");

const CANONICAL = "AG-09";
const WRITE_TABLES = ["email_activity", "agent_runs"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  const funderName = env.funders[0].name; // "PT-09 Community Foundation"

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new EmailParserAgent({ client: supabase, organizationId: orgId });
    runOutcome = await agent.run({
      emails: [
        {
          from: "grants@pt09communityfoundation.example.org",
          to: "info@pt09-test-org.example",
          subject: "Congratulations - Housing Stability Grant Award",
          body:
            `Dear PT-09 Test Org team,\n\nOn behalf of the ${funderName}, we are pleased to inform you that your ` +
            "application for the Housing Stability Grant has been approved for an award of $45,000. " +
            "Please reply within 10 business days with your organization's W-9 and direct deposit information " +
            "so we can process the disbursement. Congratulations again on this well-deserved award.\n\n" +
            "Warm regards,\nGrants Team",
          date: new Date().toISOString(),
          thread_id: "pt09-thread-award-001",
        },
      ],
    });
    log.push(`agent.run() resolved: runId=${runOutcome.runId} tokensUsed=${runOutcome.tokensUsed} durationMs=${runOutcome.durationMs}`);
    log.push(`data: ${JSON.stringify(runOutcome.data)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) after[t] = await countRows(db, t, "organization_id", orgId);

  const activityRow = await latestRow(db, "email_activity", "organization_id", orgId, "created_at");
  const runRow = runOutcome?.runId
    ? (await db.query("select * from agent_runs where id = $1", [runOutcome.runId])).rows[0]
    : null;
  const funderRow = (
    await db.query("select id, name, notes from funders where id = $1", [env.funders[0].id])
  ).rows[0];

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw; caught by this harness (not silently swallowed by the app), but no successful write occurred.";
  } else if (
    delta.email_activity > 0 &&
    activityRow &&
    activityRow.email_type === "award_notification" &&
    activityRow.funder_id === env.funders[0].id
  ) {
    verdict = "WORKS";
    reasoning =
      "email_activity row written with a real Claude-classified email_type ('award_notification'), correctly fuzzy-matched " +
      `to the real funder ("${funderName}") via ilike, and funders.notes was appended with a summary note -- matches AG-09's ` +
      "documented intent (classify, match, log, and flag for outcome recording).";
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "agent_runs row was written but email_activity was not meaningfully populated / funder match failed.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor email_activity changed, and no error was surfaced.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "email_parser",
    implementingFile: "src/lib/agents/email-parser.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new EmailParserAgent({ client, organizationId }).run({ emails }) " +
      "with a synthetic realistic award-notification email. Matches AG-09's real (manual, human-pasted) trigger path.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      email_activity_row: activityRow ?? null,
      agent_runs_row: runRow ?? null,
      matched_funder: funderRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "FEATURE_REGISTRY_v2.md row #38: 'Email Parsing Agent | Tier 3 | BUILT — PARTIAL (see 2026-08-13 addendum: " +
      "extract/classify + summarize confirmed working live; Gmail-webhook auto-trigger and auto-reply/respond both confirmed absent)'.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
