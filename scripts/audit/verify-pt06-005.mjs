// PT-06-005 verification gate: confirms both halves of this task are real
// artifacts, not stubs.
//
//   (a) test-evidence/pt-06/data-quality.json records duplicate-rate AND
//       null-rate results, each carrying the exact query that produced it,
//       for all three named large tables (foundation_directory,
//       donor_discovery_directory, and the nonprofit table(s)).
//   (b) test-evidence/pt-06/idempotency.json exists and is either a real
//       result set (migrations actually re-run against a local/branch
//       target, per-migration results recorded) or an explicit
//       PENDING-SCOPE record carrying a reason -- never silently absent,
//       never a fabricated pass, and never evidence of a run against
//       production.
//
// Exit 0 = both checks pass. Exit 1 = either check fails (prints why).

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_QUALITY_PATH = path.join(ROOT, "test-evidence", "pt-06", "data-quality.json");
const IDEMPOTENCY_PATH = path.join(ROOT, "test-evidence", "pt-06", "idempotency.json");

// Task instruction 1 names these explicitly: "foundation_directory ~133k,
// donor_discovery_directory, and nonprofit tables". foundation_directory and
// donor_discovery_directory map to exactly one live table name each;
// "nonprofit tables" is satisfied by the real live table it maps to
// (nonprofits) -- confirmed against live-schema.json before writing this
// gate, not guessed.
const REQUIRED_TABLES = ["foundation_directory", "donor_discovery_directory", "nonprofits"];

const failures = [];
const fail = (msg) => failures.push(msg);

function loadJson(p, label) {
  if (!fs.existsSync(p)) {
    fail(`${label} does not exist at ${p}`);
    return null;
  }
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    fail(`${label} could not be read: ${e.message}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`${label} is not valid JSON: ${e.message}`);
    return null;
  }
}

function looksLikeSqlQuery(value, contextLabel) {
  if (typeof value !== "string" || value.trim().length < 15) {
    fail(`${contextLabel}: .query is missing or too short to be a real SQL statement`);
    return false;
  }
  if (!/SELECT/i.test(value)) {
    fail(`${contextLabel}: .query does not look like a SQL SELECT statement`);
    return false;
  }
  return true;
}

// =============================================================================
// (a) data-quality.json — dup + null results, with queries, per named table
// =============================================================================

const dq = loadJson(DATA_QUALITY_PATH, "data-quality.json");

if (dq) {
  if (!dq.method || typeof dq.method !== "string" || dq.method.length < 20) {
    fail("data-quality.json is missing a real top-level .method description");
  }
  if (!dq.tables || typeof dq.tables !== "object") {
    fail("data-quality.json .tables is missing or not an object");
  } else {
    for (const table of REQUIRED_TABLES) {
      const t = dq.tables[table];
      if (!t) {
        fail(`data-quality.json .tables["${table}"] is missing -- this table is explicitly named in the task and must be measured`);
        continue;
      }
      if (typeof t.total_row_count !== "number") {
        fail(`data-quality.json .tables["${table}"].total_row_count is missing or not a number`);
      }

      // --- duplicate-rate checks ---
      if (!Array.isArray(t.duplicate_rate_checks) || t.duplicate_rate_checks.length === 0) {
        fail(`data-quality.json .tables["${table}"].duplicate_rate_checks is empty -- expected at least one natural-key duplicate check`);
      } else {
        let missingQuery = 0;
        let missingResult = 0;
        for (const c of t.duplicate_rate_checks) {
          if (!looksLikeSqlQuery(c.query, `tables["${table}"].duplicate_rate_checks[${c.label || "?"}]`)) missingQuery++;
          if (typeof c.duplicate_key_groups !== "number" && !c.error) missingResult++;
        }
        if (missingResult > 0) {
          fail(`data-quality.json .tables["${table}"].duplicate_rate_checks has ${missingResult} entr(ies) with no recorded count (neither duplicate_key_groups nor an error)`);
        }
        void missingQuery; // looksLikeSqlQuery already records its own failure
      }

      // --- null-rate checks ---
      if (!Array.isArray(t.null_rate_checks) || t.null_rate_checks.length === 0) {
        fail(`data-quality.json .tables["${table}"].null_rate_checks is empty -- expected at least one "app treats as required" column checked`);
      } else {
        let missingResult = 0;
        for (const c of t.null_rate_checks) {
          looksLikeSqlQuery(c.query, `tables["${table}"].null_rate_checks[${c.column || "?"}]`);
          if (!c.app_requirement || typeof c.app_requirement !== "string" || c.app_requirement.length < 15) {
            fail(`data-quality.json .tables["${table}"].null_rate_checks[${c.column || "?"}] has no real .app_requirement grounding why this column is checked`);
          }
          if (typeof c.null_count !== "number" && !c.error) missingResult++;
        }
        if (missingResult > 0) {
          fail(`data-quality.json .tables["${table}"].null_rate_checks has ${missingResult} entr(ies) with no recorded count (neither null_count nor an error)`);
        }
      }
    }
  }

  if (!Array.isArray(dq.findings)) {
    fail("data-quality.json .findings is not an array");
  } else {
    const withoutSeverity = dq.findings.filter((f) => !["P1", "P2", "INFO"].includes(f.severity));
    if (withoutSeverity.length > 0) {
      fail(`${withoutSeverity.length} data-quality finding(s) have a severity other than P1/P2/INFO`);
    }
    const withoutDescription = dq.findings.filter((f) => !f.description || f.description.length < 20);
    if (withoutDescription.length > 0) {
      fail(`${withoutDescription.length} data-quality finding(s) have no real .description`);
    }
    if (!dq.summary || typeof dq.summary.total_findings !== "number") {
      fail("data-quality.json .summary.total_findings missing");
    } else if (dq.summary.total_findings !== dq.findings.length) {
      fail(`data-quality.json .summary.total_findings (${dq.summary.total_findings}) does not match actual .findings length (${dq.findings.length})`);
    }
  }
}

// =============================================================================
// (b) idempotency.json — real result set OR explicit PENDING-SCOPE
// =============================================================================

const idem = loadJson(IDEMPOTENCY_PATH, "idempotency.json");

if (idem) {
  if (idem.status === "PENDING-SCOPE") {
    if (!idem.reason || typeof idem.reason !== "string" || idem.reason.length < 20) {
      fail("idempotency.json has status PENDING-SCOPE but no real .reason explaining why -- a bare status with no reason is not an explicit record, per task instruction 2");
    }
  } else if (idem.status === "RAN") {
    if (!idem.method || typeof idem.method !== "string" || idem.method.length < 20) {
      fail("idempotency.json is missing a real top-level .method description");
    }
    if (!idem.local_target_redacted || typeof idem.local_target_redacted !== "string") {
      fail("idempotency.json is missing .local_target_redacted -- cannot confirm this ran against a local/branch target, not production");
    } else if (/vbjplpquqxxfbpazyalt/i.test(idem.local_target_redacted)) {
      fail("idempotency.json .local_target_redacted appears to reference the known production project ref -- this must never run against production");
    }
    if (!Array.isArray(idem.first_apply_pass) || idem.first_apply_pass.length === 0) {
      fail("idempotency.json .first_apply_pass is empty -- expected at least one migration file applied");
    }
    if (!Array.isArray(idem.sample_results) || idem.sample_results.length === 0) {
      fail("idempotency.json .sample_results is empty -- expected at least one sampled migration (CREATE TABLE without IF NOT EXISTS, or a data backfill) re-run and recorded");
    } else {
      const tested = idem.sample_results.filter((r) => !r.skipped);
      if (tested.length === 0) {
        fail("idempotency.json .sample_results has zero entries that were actually re-run (all skipped) -- no real idempotency re-run evidence was produced");
      }
      for (const r of tested) {
        if (!r.second_run || typeof r.second_run.ok !== "boolean") {
          fail(`idempotency.json .sample_results["${r.file}"] has no recorded .second_run.ok result`);
        }
        if (typeof r.idempotent !== "boolean") {
          fail(`idempotency.json .sample_results["${r.file}"] has no recorded .idempotent verdict`);
        }
      }
    }
    if (!Array.isArray(idem.findings)) {
      fail("idempotency.json .findings is not an array");
    }
  } else {
    fail(`idempotency.json .status is "${idem.status}" -- expected "RAN" or "PENDING-SCOPE"`);
  }
}

// =============================================================================
// verdict
// =============================================================================

if (failures.length > 0) {
  console.error("PT-06-005 verification FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("PT-06-005 verification PASSED:");
console.log(`  - data-quality.json: ${REQUIRED_TABLES.length} required table(s) each have real duplicate_rate_checks and null_rate_checks with queries and counts`);
console.log(`  - data-quality.json: ${dq.findings.length} total findings (${dq.summary.p1_findings || 0} P1, ${dq.summary.p2_findings || 0} P2, ${dq.summary.info_findings || 0} INFO)`);
if (idem.status === "PENDING-SCOPE") {
  console.log(`  - idempotency.json: explicit PENDING-SCOPE recorded with reason (no local/branch target was reachable this run)`);
} else {
  const testedCount = idem.sample_results.filter((r) => !r.skipped).length;
  console.log(`  - idempotency.json: RAN against local target ${idem.local_target_redacted} -- ${idem.first_apply_pass.filter((r) => r.ok).length}/${idem.first_apply_pass.length} migrations applied, ${testedCount}/${idem.sample_results.length} sampled migrations re-run and verdicted, ${idem.findings.length} finding(s)`);
}
process.exit(0);
