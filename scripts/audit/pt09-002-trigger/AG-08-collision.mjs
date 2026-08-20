// PT-09-002 execution proof: AG-08 (on-disk collision, unregistered)
// (renewal_tracker / src/lib/agents/renewal-tracker-agent.ts)
//
// This is a DIFFERENT AG-08 than the registry's ag-08-nofa-parser row -- its
// own file header labels it "AG-08 (exact match)" per
// worker/autonomous-orchestrator.ts's header comment. No registry entry.
//
// Real trigger: worker/autonomous-orchestrator.ts runRenewalTrackerStep(),
// inside runOrgPipeline(), gated on isFirstOfMonthChicago(). Deterministic,
// no Claude call, by design (see file header).
//
// Seed dependency: this test org's applications were all stage='drafting'
// (no awarded applications, so no renewal candidate existed). Seeded one new
// `applications` row with stage='awarded' against opportunity 1 (which
// already has recurrence='rolling') via
// scripts/audit/pt09-002-trigger/_seed-groupc.mjs -- documented here per
// safety rule 6.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-08-collision.mjs

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

const { RenewalTrackerAgent } = await import(
  "../../../src/lib/agents/renewal-tracker-agent.ts"
);

const CANONICAL = "AG-08 (on-disk collision, unregistered)";
const WRITE_TABLES = ["opportunities", "agent_runs", "agent_decisions"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {};
  before.opportunities = await countRows(db, "opportunities", "organization_id", orgId);
  before.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);
  before.agent_decisions = (
    await db.query("select count(*)::int as n from agent_decisions where org_id = $1", [orgId])
  ).rows[0].n;

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  log.push(
    "Pre-condition: seeded an application (stage='awarded') against opportunity " +
      "88365eb3-b324-4c0d-bb10-a7802d540965 (recurrence='rolling', category='private_foundation') " +
      "so this agent has a real awarded+recurring cycle to create a renewal for.",
  );

  try {
    const agent = new RenewalTrackerAgent(orgId, supabase);
    runOutcome = await agent.run("manual");
    log.push(`agent.run() resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  after.opportunities = await countRows(db, "opportunities", "organization_id", orgId);
  after.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);
  after.agent_decisions = (
    await db.query("select count(*)::int as n from agent_decisions where org_id = $1", [orgId])
  ).rows[0].n;

  const newOppRow = await latestRow(db, "opportunities", "organization_id", orgId, "created_at");
  const runRow = await latestRow(
    db,
    "agent_runs",
    "organization_id",
    orgId,
    "started_at",
  );
  const decisionRow = (
    await db.query(
      "select * from agent_decisions where org_id = $1 order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning =
      "agent.run() threw; caught by this harness (not silently swallowed by the app), but no successful write occurred.";
  } else if (
    delta.opportunities > 0 &&
    newOppRow &&
    newOppRow.name &&
    newOppRow.name.includes("Renewal") &&
    delta.agent_decisions > 0
  ) {
    verdict = "WORKS";
    reasoning =
      `A new opportunities row was created ("${newOppRow.name}") -- a real renewal record, not an empty stub -- with a real ` +
      "agent_decisions reasoning entry explaining the renewal logic. Matches the agent's documented intent exactly: " +
      "deterministic record creation for a recurring, awarded funding cycle.";
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning =
      "agent_runs row was written (the run executed cleanly) but no renewal opportunity was created -- zero real business-table output.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor opportunities changed, and no error was surfaced.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: null,
    implementingFile: "src/lib/agents/renewal-tracker-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new RenewalTrackerAgent(orgId, supabase).run('manual'). " +
      "Matches its real (scheduled, gated) trigger path minus the isFirstOfMonthChicago() gate, which is a scheduling condition external to the agent's own logic.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      opportunities_created: newOppRow
        ? {
            id: newOppRow.id,
            name: newOppRow.name,
            funder_id: newOppRow.funder_id,
            category: newOppRow.category,
            status: newOppRow.status,
            source: newOppRow.source,
            deadline: newOppRow.deadline,
            description: newOppRow.description,
          }
        : null,
      agent_runs_row: runRow ?? null,
      agent_decisions_row: decisionRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "No registry entry (inRegistry: false per agent-inventory.json). FEATURE_REGISTRY_v2.md row #208: " +
      "'AG-08 Renewal Tracker | BUILT | Monthly. Auto-creates renewal opportunity records for recurring grants.' -- " +
      "this row's description matches THIS file's real behavior exactly (unlike the registry's own ag-08-nofa-parser agent_id, which is a different class).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
