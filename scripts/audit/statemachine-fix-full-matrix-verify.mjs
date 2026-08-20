// Exhaustive parity check: the DB trigger (migration 141) vs. the app's own
// getTransitionRule() — using the SAME 144-pair (12x12) transition matrix
// already captured as evidence for WGR-130 (test-evidence/pt-03/
// kanban-auth.json #kanban.transition_matrix), the app's own ground truth.
// For every (from, to) pair, sets a throwaway row to `from` (trigger
// disabled for setup only), then attempts the real UPDATE to `to` (trigger
// enabled) inside a savepoint so the row resets for the next pair. Asserts
// the trigger's allow/reject decision matches the app's `allowed` field for
// all 144 pairs — not just the two cases in the primary before/after repro.
//
// Run: node scripts/audit/statemachine-fix-full-matrix-verify.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DB_URL = process.env.STACK_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const OUT_DIR = path.join(process.cwd(), "test-evidence", "remediation", "statemachine-fix");
fs.mkdirSync(OUT_DIR, { recursive: true });

const matrix = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "test-evidence", "pt-03", "kanban-auth.json"), "utf8"),
).kanban.transition_matrix;

async function main() {
  // Pick one real throwaway row to reuse across all 144 tests.
  const idResult = execFileSync(
    "psql",
    [DB_URL, "-t", "-A", "-c", "SELECT id FROM applications LIMIT 1;"],
    { encoding: "utf8" },
  ).trim();
  const testId = idResult;
  if (!testId) throw new Error("No application row found to test against.");

  const sqlLines = [
    "CREATE TEMP TABLE test_results (from_stage text, to_stage text, expected boolean, actual boolean, error_message text);",
  ];

  for (const { from, to, allowed } of matrix) {
    const from_sql = from.replace(/'/g, "''");
    const to_sql = to.replace(/'/g, "''");
    sqlLines.push(`
DO $do$
BEGIN
  ALTER TABLE applications DISABLE TRIGGER trg_enforce_application_stage_transition;
  UPDATE applications SET stage = '${from_sql}' WHERE id = '${testId}';
  ALTER TABLE applications ENABLE TRIGGER trg_enforce_application_stage_transition;
  BEGIN
    UPDATE applications SET stage = '${to_sql}' WHERE id = '${testId}';
    INSERT INTO test_results VALUES ('${from_sql}', '${to_sql}', ${allowed}, true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO test_results VALUES ('${from_sql}', '${to_sql}', ${allowed}, false, SQLERRM);
  END;
END;
$do$;`);
  }

  sqlLines.push("SELECT row_to_json(test_results) FROM test_results;");

  const sqlFile = path.join(OUT_DIR, ".full-matrix-test.sql");
  fs.writeFileSync(sqlFile, sqlLines.join("\n"));

  const output = execFileSync("psql", [DB_URL, "-t", "-A", "-f", sqlFile], { encoding: "utf8" });
  fs.unlinkSync(sqlFile);

  const rows = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l));

  const allMismatches = rows.filter((r) => r.expected !== r.actual);
  // The trigger only fires WHEN NEW.stage IS DISTINCT FROM OLD.stage — a
  // same-value write is a no-op, not a transition, so the trigger correctly
  // lets it through even though getTransitionRule() separately reports
  // allowed:false for from===to ("already in this stage", a UI-level
  // message, not a data-integrity concern — nothing actually changes).
  // Expected, benign, and documented here rather than silently ignored.
  const expectedSelfPairDivergence = allMismatches.filter((r) => r.from_stage === r.to_stage);
  const realMismatches = allMismatches.filter((r) => r.from_stage !== r.to_stage);

  const summary = {
    capturedAt: new Date().toISOString(),
    totalPairs: rows.length,
    matchCount: rows.length - allMismatches.length,
    expectedSelfPairDivergenceCount: expectedSelfPairDivergence.length,
    realMismatchCount: realMismatches.length,
    allRealTransitionsMatch: realMismatches.length === 0,
  };

  const result = { summary, realMismatches, expectedSelfPairDivergence, allResults: rows };
  const outFile = path.join(OUT_DIR, "statemachine-full-matrix-verify.json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  if (realMismatches.length > 0) {
    console.log("REAL MISMATCHES:", JSON.stringify(realMismatches, null, 2));
    process.exit(1);
  }
}

main();
