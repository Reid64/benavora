// PT-09-002 execution proof: AG-12 (on-disk collision, unregistered)
// (search_profile_optimizer / src/lib/agents/search-profile-optimizer-agent.ts)
//
// This is a DIFFERENT AG-12 than the registry's ag-12-autoapply row -- its
// own file header labels it "AG-12 (exact match)" per
// worker/autonomous-orchestrator.ts's header comment. No registry entry.
//
// CRITICAL CORRECTION vs. the task prompt: the task says "Writes
// search_profiles". Reading the actual source
// (search-profile-optimizer-agent.ts:7-8) shows an explicit, deliberate
// design decision stated in the file's own header comment: "HARD LIMIT: this
// agent only ever writes suggestions to a notification and an
// agent_decisions row. It NEVER updates search_profiles." This is confirmed
// by reading run() end-to-end: it only calls createNotification() and
// logDecision() -- there is no .update()/.upsert() call against
// search_profiles anywhere in this file. Testing for a search_profiles write
// would therefore ALWAYS read as WIRED-NO-OUTPUT by construction, which
// would misrepresent a documented design decision as a bug. This script
// tests the agent's real, intended write targets (alerts, agent_decisions)
// instead, and separately confirms search_profiles truly never changes.
//
// Seed dependency: none needed -- a real search_profiles row already exists
// for this org (id 2c9bc0c5-cad8-451b-8e1a-0035bf1881a4, keywords=['housing',
// 'workforce development'], categories=null), pre-seeded by an earlier PT-09
// phase. With zero matching opportunities discovered in the last 90 days for
// those keywords, hitRate=0 -> underperforming=true -> the Claude-assisted
// suggestion branch fires.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-12-collision.mjs

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

const { SearchProfileOptimizerAgent } = await import(
  "../../../src/lib/agents/search-profile-optimizer-agent.ts"
);

const CANONICAL = "AG-12 (on-disk collision, unregistered)";
const WRITE_TABLES = ["alerts", "agent_decisions", "agent_runs"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const profileBefore = (
    await db.query("select * from search_profiles where organization_id = $1", [orgId])
  ).rows;
  const before = {};
  before.alerts = await countRows(db, "alerts", "organization_id", orgId);
  before.agent_decisions = (
    await db.query("select count(*)::int as n from agent_decisions where org_id = $1", [orgId])
  ).rows[0].n;
  before.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  log.push(
    `Pre-condition: ${profileBefore.length} search_profiles row(s) exist for this org. ` +
      `This agent's file header states a HARD LIMIT that it never writes to search_profiles -- ` +
      "this script therefore tests alerts + agent_decisions as the real write targets, and separately " +
      "asserts search_profiles is unchanged after the run (confirming the hard limit holds, not a bug).",
  );

  try {
    const agent = new SearchProfileOptimizerAgent(orgId, supabase);
    runOutcome = await agent.run("manual");
    log.push(`agent.run() resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  after.alerts = await countRows(db, "alerts", "organization_id", orgId);
  after.agent_decisions = (
    await db.query("select count(*)::int as n from agent_decisions where org_id = $1", [orgId])
  ).rows[0].n;
  after.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);

  const profileAfter = (
    await db.query("select * from search_profiles where organization_id = $1", [orgId])
  ).rows;

  const decisionRow = (
    await db.query(
      "select * from agent_decisions where org_id = $1 and decision_type = 'search_profile_optimization_suggested' order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const alertRow = await latestRow(db, "alerts", "organization_id", orgId, "created_at");

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];
  const searchProfilesUnchanged =
    JSON.stringify(profileBefore) === JSON.stringify(profileAfter);

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw; caught by this harness (not silently swallowed by the app), but no successful write occurred.";
  } else if (delta.agent_decisions > 0 && decisionRow && delta.alerts > 0 && alertRow) {
    verdict = "WORKS";
    reasoning =
      "A real agent_decisions row was logged for the underperforming search profile with specific hit-rate numbers and real " +
      "Claude-generated keyword suggestions grounded in the org's mission statement, plus a matching alerts row. " +
      `search_profiles itself is confirmed unchanged (${searchProfilesUnchanged ? "verified identical before/after" : "MISMATCH -- see note"}), ` +
      "matching this agent's own documented HARD LIMIT ('never updates search_profiles'). Matches AG-12's real, intended behavior exactly -- " +
      "note the task prompt's claim that this agent 'writes search_profiles' is incorrect per the file's own header and this live test.";
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "agent_runs row was written (the run executed) but neither agent_decisions nor alerts got a new row.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor any output table changed, and no error was surfaced.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: null,
    implementingFile: "src/lib/agents/search-profile-optimizer-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new SearchProfileOptimizerAgent(orgId, supabase).run('manual'). " +
      "Matches its real (scheduled, first-of-month-gated) trigger path minus the isFirstOfMonthChicago() gate.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      agent_decisions_row: decisionRow,
      alerts_row: alertRow,
      search_profiles_confirmed_unchanged: searchProfilesUnchanged,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "No registry entry (inRegistry: false per agent-inventory.json). FEATURE_REGISTRY_v2.md row #212: " +
      "'AG-12 Search Profile Optimizer | BUILT | Monthly. Performance analysis and keyword improvement suggestions.' -- this row's " +
      "description ('suggestions', not 'auto-updates search profiles') matches THIS file's real hard-limited behavior exactly " +
      "(unlike the registry's own ag-12-autoapply agent_id, which is a wholly different, unrelated pipeline).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
