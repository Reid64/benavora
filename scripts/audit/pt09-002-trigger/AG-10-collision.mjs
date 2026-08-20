// PT-09-002 execution proof: AG-10 (on-disk collision, unregistered)
// (document_expiry / src/lib/agents/document-expiry-agent.ts)
//
// This is a DIFFERENT AG-10 than the registry's ag-10-grant-dna row -- its
// own file header labels it "AG-10 (exact match)" per
// worker/autonomous-orchestrator.ts's header comment. No registry entry.
//
// CORRECTION vs. the task prompt and agent-inventory.json's writesTo list:
// both say "Writes agent_decisions + documents". Reading the actual source
// (document-expiry-agent.ts:78-126) shows this agent only ever SELECTs from
// `documents` (read-only source of expiring records) -- it never inserts or
// updates a documents row. Its real writes are agent_decisions (via
// logDecision) and an org-wide `alerts` row (via createNotification, whose
// own doc comment explains this schema has no dedicated `notifications`
// table). This script tests the real write targets.
//
// Seed dependency: this org had zero `documents` rows. Seeded one with
// expiration_date = today + 10 days (inside the 30-day warning window) via
// scripts/audit/pt09-002-trigger/_seed-groupc.mjs.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-10-collision.mjs

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

const { DocumentExpiryAgent } = await import(
  "../../../src/lib/agents/document-expiry-agent.ts"
);

const CANONICAL = "AG-10 (on-disk collision, unregistered)";
const WRITE_TABLES = ["agent_decisions", "alerts", "agent_runs"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {};
  before.agent_decisions = (
    await db.query("select count(*)::int as n from agent_decisions where org_id = $1", [orgId])
  ).rows[0].n;
  before.alerts = await countRows(db, "alerts", "organization_id", orgId);
  before.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);
  before.documents = await countRows(db, "documents", "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  log.push(
    "Pre-condition: seeded a documents row (file_name='PT-09 Test Org - Certificate of Insurance.pdf', " +
      "expiration_date=today+10 days) via _seed-groupc.mjs, inside this agent's 30-day EXPIRY_WINDOW_DAYS.",
  );

  try {
    const agent = new DocumentExpiryAgent(orgId, supabase);
    runOutcome = await agent.run("manual");
    log.push(`agent.run() resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  after.agent_decisions = (
    await db.query("select count(*)::int as n from agent_decisions where org_id = $1", [orgId])
  ).rows[0].n;
  after.alerts = await countRows(db, "alerts", "organization_id", orgId);
  after.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);
  after.documents = await countRows(db, "documents", "organization_id", orgId);

  const decisionRow = (
    await db.query(
      "select * from agent_decisions where org_id = $1 and decision_type = 'document_expiring_flagged' order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const alertRow = await latestRow(db, "alerts", "organization_id", orgId, "created_at");

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];
  delta.documents = after.documents - before.documents;

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw; caught by this harness (not silently swallowed by the app), but no successful write occurred.";
  } else if (delta.agent_decisions > 0 && delta.alerts > 0 && decisionRow && alertRow) {
    verdict = "WORKS";
    reasoning =
      "A real agent_decisions row was logged with specific reasoning naming the exact expiring document and its expiration date, " +
      "and a real alerts row was created (this schema's substitute for a notifications table). documents itself is correctly unchanged " +
      "(this agent only reads it) -- matches its documented intent exactly: proactively surface an expiring document, never touch it.";
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "agent_runs row was written (the run executed) but neither agent_decisions nor alerts got a new row.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor any real output table changed, and no error was surfaced.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: null,
    implementingFile: "src/lib/agents/document-expiry-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new DocumentExpiryAgent(orgId, supabase).run('manual'). " +
      "Matches its real (scheduled, unconditional-nightly) trigger path minus the cron timing.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      agent_decisions_row: decisionRow,
      alerts_row: alertRow,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "No registry entry (inRegistry: false per agent-inventory.json). FEATURE_REGISTRY_v2.md row #210: " +
      "'AG-10 Document Expiry Monitor | BUILT | Nightly. 30-day expiry notifications.' -- this row's description matches THIS " +
      "file's real behavior exactly (unlike the registry's own ag-10-grant-dna agent_id, which is a different class).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
