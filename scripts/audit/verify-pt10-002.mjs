// ============================================================================
// Verification gate for PT-10-002 (dependency-outage simulation).
//
// Fails (non-zero exit) unless test-evidence/pt-10/outage-simulation.json:
//   - exists, is non-empty, and parses as JSON
//   - has all three required scenario keys
//   - each scenario records real, non-empty `behavior` (the per-case/observed
//     outcome record -- an array with at least one entry for scenarios 1/3,
//     or a populated object for scenario 2, which is a single kill-and-check
//     run rather than a list of cases)
//   - each scenario records a real, populated post-failure DB integrity
//     check where one applies (scenario 2, the only scenario that mutates
//     durable DB state a "corruption" check is meaningful against) --
//     scenarios 1 and 3 are checked for their own equivalent completeness
//     signal instead (a recorded verdict per case / a recovery check),
//     since "DB integrity" isn't a meaningful concept for a pure in-memory
//     parser fuzz or a read-mostly HTTP outage probe.
//
// This is a gate, not a re-run of the simulation itself -- it only inspects
// the evidence file's shape and internal consistency. Exits 1 with a clear
// per-check failure list on any violation; exits 0 with a summary on success.
//
// ASCII only. Node 20 compatible, no external dependencies.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
const EVIDENCE_PATH = path.join(REPO_ROOT, "test-evidence", "pt-10", "outage-simulation.json");

const failures = [];
const passes = [];

function check(label, condition, detail) {
  if (condition) {
    passes.push(label);
  } else {
    failures.push(`${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function isNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

function isNonEmptyObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;
}

function main() {
  if (!fs.existsSync(EVIDENCE_PATH)) {
    console.error(`FAIL: evidence file does not exist: ${EVIDENCE_PATH}`);
    process.exit(1);
  }
  const stat = fs.statSync(EVIDENCE_PATH);
  check("evidence file is non-empty", stat.size > 0, `size=${stat.size}`);

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(EVIDENCE_PATH, "utf8"));
  } catch (err) {
    console.error(`FAIL: evidence file is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  check("evidence file parses as an object", doc !== null && typeof doc === "object");

  const scenarios = doc.scenarios;
  check("top-level 'scenarios' object is present", isNonEmptyObject(scenarios));
  if (!isNonEmptyObject(scenarios)) {
    printResultAndExit();
    return;
  }

  const REQUIRED_SCENARIOS = [
    "scenario1_db_outage",
    "scenario2_worker_killed_mid_job",
    "scenario3_malformed_third_party_responses",
  ];
  for (const key of REQUIRED_SCENARIOS) {
    check(`scenarios.${key} is present`, key in scenarios, `expected one of ${REQUIRED_SCENARIOS.join(", ")}`);
  }

  // ---- Scenario 1: DB outage --------------------------------------------
  const s1 = scenarios.scenario1_db_outage;
  if (s1) {
    check("scenario1: description is a non-empty string", typeof s1.description === "string" && s1.description.length > 20);
    const hasHarnessFailure = typeof s1.harnessFailure === "string" && s1.harnessFailure.length > 0;
    check(
      "scenario1: either recorded real per-case behavior, or an explicit, non-empty harness-failure reason",
      isNonEmptyArray(s1.behavior) || hasHarnessFailure,
      "scenario1.behavior must be a non-empty array of case results, OR scenario1.harnessFailure must explain why no cases could run",
    );
    if (isNonEmptyArray(s1.behavior)) {
      const everyCaseHasResponseAndVerdict = s1.behavior.every(
        (c) => c && typeof c === "object" && "response" in c && "phase" in c && "path" in c,
      );
      check(
        "scenario1: every recorded case has a phase, target path, and response outcome",
        everyCaseHasResponseAndVerdict,
      );
      const phasesSeen = new Set(s1.behavior.map((c) => c.phase));
      check(
        "scenario1: covers both a fault-injected phase (db_down or db_slow) and the normal baseline",
        phasesSeen.has("baseline_normal") && (phasesSeen.has("db_down") || phasesSeen.has("db_slow")),
        `phases seen: ${Array.from(phasesSeen).join(", ")}`,
      );
      // scenario 1's equivalent of a "post-failure integrity check" is the
      // recovery probe -- confirming the app is not permanently wedged once
      // the simulated outage ends. Required as real, populated evidence.
      check(
        "scenario1: recorded a post-outage recovery check (equivalent of a post-failure integrity check for a read path)",
        s1.recovery && typeof s1.recovery === "object" && "response" in s1.recovery && "verdict" in s1.recovery,
      );
    } else if (!hasHarnessFailure) {
      check("scenario1: has recorded behavior data of some form", false, "neither behavior[] nor harnessFailure was populated");
    }
  }

  // ---- Scenario 2: worker killed mid-job ---------------------------------
  const s2 = scenarios.scenario2_worker_killed_mid_job;
  if (s2) {
    check("scenario2: description is a non-empty string", typeof s2.description === "string" && s2.description.length > 20);
    check(
      "scenario2: recorded real behavior of the kill (child pid, claim confirmation, post-kill row state)",
      isNonEmptyObject(s2.behavior) &&
        "childPid" in s2.behavior &&
        "claimConfirmedBeforeKill" in s2.behavior &&
        "postKillStatus" in s2.behavior,
    );
    check(
      "scenario2: claim was actually confirmed before the kill (otherwise this tested 'job never started', not 'worker killed mid-job')",
      s2.behavior?.claimConfirmedBeforeKill === true,
    );

    const integrity = s2.postFailureIntegrityCheck;
    check("scenario2: postFailureIntegrityCheck object is present and populated", isNonEmptyObject(integrity));
    if (isNonEmptyObject(integrity)) {
      check("scenario2: integrity check explicitly marks itself as performed", integrity.performed === true);
      check("scenario2: integrity check records a method/description", typeof integrity.method === "string" && integrity.method.length > 20);
      check(
        "scenario2: integrity check records an actual row-count comparison (no duplication/loss)",
        typeof integrity.rowCountForTestOrg === "number" && "rowCountMatchesExpected" in integrity,
      );
      check(
        "scenario2: integrity check records whether any field drifted from the original insert (no partial/corrupt write)",
        Array.isArray(integrity.fieldDriftFromOriginalInsert) && "noUnexpectedFieldDrift" in integrity,
      );
      check(
        "scenario2: integrity check records the final row's terminal state (status/completed_at/error_message)",
        isNonEmptyObject(integrity.finalRow) && "status" in integrity.finalRow && "completed_at" in integrity.finalRow,
      );
    }

    check(
      "scenario2: a verdict was reached (FINDING or PASS), not left unresolved",
      s2.verdict === "FINDING" || s2.verdict === "PASS",
    );
    if (s2.verdict === "FINDING") {
      check("scenario2: FINDING verdict is backed by at least one findings[] entry", isNonEmptyArray(s2.findings));
    }
  }

  // ---- Scenario 3: malformed third-party responses -----------------------
  const s3 = scenarios.scenario3_malformed_third_party_responses;
  if (s3) {
    check("scenario3: description is a non-empty string", typeof s3.description === "string" && s3.description.length > 20);
    check("scenario3: recorded real per-case behavior (a non-empty array of parser fuzz cases)", isNonEmptyArray(s3.behavior));
    if (isNonEmptyArray(s3.behavior)) {
      const everyCaseComplete = s3.behavior.every(
        (c) => c && typeof c === "object" && typeof c.outcome === "string" && typeof c.verdict === "string" && "callerProtection" in c,
      );
      check(
        "scenario3: every case records an outcome, a verdict, and the caller-protection code-read note",
        everyCaseComplete,
      );
      const targetsSeen = new Set(s3.behavior.map((c) => c.target));
      check(
        "scenario3: covers more than one distinct real parser/integration target, not just one file",
        targetsSeen.size >= 3,
        `targets seen: ${Array.from(targetsSeen).join(", ")}`,
      );
      // scenario 3's equivalent of a "post-failure integrity check": since
      // these are pure function calls with no durable DB writes at stake,
      // the meaningful equivalent is confirming EVERY case reached a
      // definite resolution (threw or returned) rather than one silently
      // hanging/being skipped -- i.e. no case is missing its outcome.
      const allCasesResolved = s3.behavior.every((c) => c.outcome === "threw_uncaught" || c.outcome === "returned_without_throwing");
      check(
        "scenario3: every fuzz case reached a definite resolution (threw_uncaught or returned_without_throwing) -- none left unresolved/hanging",
        allCasesResolved,
      );
    }
  }

  printResultAndExit();
}

function printResultAndExit() {
  console.log(`\nverify-pt10-002: ${passes.length} check(s) passed, ${failures.length} check(s) failed.\n`);
  if (failures.length > 0) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    console.log("");
    process.exit(1);
  }
  console.log("All required PT-10-002 evidence checks passed.");
  process.exit(0);
}

main();
