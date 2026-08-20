// PT-09-002 execution proof: AG-16 (ag-16-digital-twin / src/lib/intelligence/digital-twin-builder.ts)
// Trigger method: direct function call. This agent is NOT a BaseAgent/
// AutonomousAgent subclass -- it lives outside src/lib/agents/ and is a
// plain exported async function, buildDigitalTwin(orgId, supabase), found
// via a targeted follow-up grep per pt09-001 (the super()-literal scan of
// src/lib/agents/*.ts missed it because of its different directory).
// Real trigger paths per inventory: src/app/api/intelligence/digital-twin/
// route.ts (manual rebuild) and src/app/api/knowledge-base/route.ts
// (rebuild on Knowledge Base save) -- both call buildDigitalTwin() directly,
// so direct invocation here is a faithful proof of the real write path.
//
// Deterministic (no Claude call) -- assembles the twin purely from
// organizations/knowledge_base/board_members/outcomes/applications data
// already in the DB and upserts organizational_digital_twins.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-16.mjs

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

const { buildDigitalTwin } = await import("../../../src/lib/intelligence/digital-twin-builder.ts");

const CANONICAL = "AG-16";
const WRITE_TABLES = ["organizational_digital_twins"];

// LOCAL SCHEMA PATCH (documented per SAFETY RULE 5): the pt09-002 schema
// extension only ever ran `alter table ... add column if not exists` on
// organizational_digital_twins (it was a pt05 widen, not a fresh create), so
// it never got a unique constraint on organization_id. This function's own
// upsert (`{ onConflict: "organization_id" }`) requires one -- a genuine
// local scaffolding gap, not an application bug (probability-scoring-
// agent.ts's own header comment documents the real production schema having
// an equivalent real UNIQUE constraint on the sibling
// opportunity_probability_scores table via migration 093, confirming this
// class of constraint is real/expected in production, just missing from
// this generated local widen). Added via a one-time idempotent ALTER TABLE
// before first invoking the agent; see
// scripts/audit/pt09-002-trigger/_fix-digital-twin-constraint.mjs for the
// exact statement run.

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let twin = null;

  try {
    twin = await buildDigitalTwin(orgId, supabase);
    log.push(`buildDigitalTwin() resolved: twin_completeness_score=${twin.twin_completeness_score}`);
    log.push(`twin: ${JSON.stringify(twin)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? err.stack ?? err.message : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) after[t] = await countRows(db, t, "organization_id", orgId);

  const twinRow = await latestRow(db, "organizational_digital_twins", "organization_id", orgId, "updated_at");

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "buildDigitalTwin() threw; the error was captured by this harness (not silently swallowed by the app), but no successful write occurred. Classified ERROR-SWALLOWED since the function's own contract is to return a twin or throw a clear error, and the caller here (this harness) is where that error surfaced, but nothing else in the app would ever see it either since this function has no agent_runs logging of its own.";
  } else if (
    twinRow &&
    twinRow.mission &&
    Array.isArray(twinRow.board_composition) &&
    twinRow.board_composition.length > 0 &&
    twinRow.twin_completeness_score != null
  ) {
    verdict = "WORKS";
    reasoning = `organizational_digital_twins row upserted with real content genuinely derived from this org's seeded data: mission="${twinRow.mission}", ${twinRow.board_composition.length} board member(s), twin_completeness_score=${twinRow.twin_completeness_score} -- matches AG-16's documented intent (assemble and persist an organizational profile twin). Note: this function has no agent_runs logging of its own (it is not a BaseAgent/AutonomousAgent subclass), so agent_runs is correctly not among its write targets.`;
  } else if (twinRow) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "organizational_digital_twins row was written but is an effectively empty stub (no mission, no board composition, zero completeness) -- looks built, does nothing.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No organizational_digital_twins row was written and no error was surfaced -- the invocation never reached the upsert.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-16-digital-twin",
    implementingFile: "src/lib/intelligence/digital-twin-builder.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct function invocation via tsx against the local pt05-local-stack: buildDigitalTwin(orgId, supabase). Not a class -- a plain exported async function, matching its real callers (src/app/api/intelligence/digital-twin/route.ts manual rebuild, src/app/api/knowledge-base/route.ts rebuild-on-save) which both call it the same way.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      organizational_digital_twins_row: twinRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus: "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-EVENT+MANUAL-API (found and confirmed via targeted follow-up grep -- lives under src/lib/intelligence/ instead of src/lib/agents/, the only real agent in the roster implemented there). Onboarding-completion trigger (a third path the registry description claims) was not independently confirmed by that prior session.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
