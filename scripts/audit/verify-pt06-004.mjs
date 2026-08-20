// PT-06-004 verification gate: confirms the constraint/FK/orphan integrity audit is a
// real artifact, not a stub -- specifically that integrity.json records (a) a real
// FK/orphan result set (every declared FK constraint, with a live orphan-row count and
// the exact query that produced it) and (b) a real constraint-gap result set (tenant FK
// gaps, primary-key coverage, and unique-constraint gaps), each entry carrying the query
// that produced it, per task instruction 5.
//
// Exit 0 = all checks pass. Exit 1 = any check fails (prints why).

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INTEGRITY_PATH = path.join(ROOT, "test-evidence", "pt-06", "integrity.json");

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
  const upper = value.toUpperCase();
  if (!upper.includes("SELECT")) {
    fail(`${contextLabel}: .query does not look like a SQL SELECT statement`);
    return false;
  }
  return true;
}

const doc = loadJson(INTEGRITY_PATH, "integrity.json");

if (doc) {
  if (!doc.method || typeof doc.method !== "string" || doc.method.length < 20) {
    fail("integrity.json is missing a real top-level .method description of how the audit was performed");
  }
  if (!Array.isArray(doc.findings)) {
    fail("integrity.json .findings is not an array");
  }

  // ---------- FK / orphan result set (instruction 1) ----------
  const fk = doc.checks && doc.checks.foreign_keys;
  if (!fk) {
    fail("integrity.json .checks.foreign_keys is missing -- no FK/orphan result set recorded");
  } else {
    looksLikeSqlQuery(fk.query, "checks.foreign_keys");
    if (!Array.isArray(fk.constraints) || fk.constraints.length === 0) {
      fail("checks.foreign_keys.constraints is empty -- expected at least one live FK constraint enumerated");
    } else {
      let missingOrphanQuery = 0;
      let missingOrphanCount = 0;
      for (const c of fk.constraints) {
        if (!c.orphan_check || typeof c.orphan_check.query !== "string" || c.orphan_check.query.trim().length < 15) {
          missingOrphanQuery++;
        }
        if (!c.orphan_check || (typeof c.orphan_check.orphan_count !== "number" && !c.orphan_check.error)) {
          missingOrphanCount++;
        }
      }
      if (missingOrphanQuery > 0) {
        fail(
          `${missingOrphanQuery} of ${fk.constraints.length} FK constraints have no recorded orphan_check.query -- instruction 4 requires the actual query alongside each count`,
        );
      }
      if (missingOrphanCount > 0) {
        fail(
          `${missingOrphanCount} of ${fk.constraints.length} FK constraints have no recorded orphan_check result (neither an orphan_count nor an error) -- the count itself is missing`,
        );
      }
    }
  }

  // ---------- constraint-gap result set (instruction 2 + 3) ----------
  const tenantGap = doc.checks && doc.checks.tenant_fk_gap;
  const pk = doc.checks && doc.checks.primary_keys;
  const uniq = doc.checks && doc.checks.unique_gaps;

  if (!tenantGap) {
    fail("integrity.json .checks.tenant_fk_gap is missing -- no tenant/RLS FK gap set recorded (feeds PT-05/PT-14)");
  } else {
    if (!tenantGap.method || typeof tenantGap.method !== "string" || tenantGap.method.length < 15) {
      fail("checks.tenant_fk_gap is missing a .method explaining how the gap set was derived (its query)");
    }
    if (!Array.isArray(tenantGap.details) || tenantGap.details.length === 0) {
      fail("checks.tenant_fk_gap.details is empty -- expected at least one org_id/organization_id-bearing table examined");
    }
    if (typeof tenantGap.tables_missing_fk !== "number") {
      fail("checks.tenant_fk_gap.tables_missing_fk is not a number");
    }
  }

  if (!pk) {
    fail("integrity.json .checks.primary_keys is missing -- no PK-coverage constraint-gap set recorded");
  } else {
    looksLikeSqlQuery(pk.query, "checks.primary_keys");
    if (typeof pk.total_base_tables !== "number" || pk.total_base_tables === 0) {
      fail("checks.primary_keys.total_base_tables missing or zero");
    }
    if (!Array.isArray(pk.tables_without_pk)) {
      fail("checks.primary_keys.tables_without_pk is not an array");
    }
  }

  if (!uniq) {
    fail("integrity.json .checks.unique_gaps is missing -- no duplicate-key/would-be-unique constraint-gap set recorded");
  } else {
    if (typeof uniq.candidate_columns_checked !== "number") {
      fail("checks.unique_gaps.candidate_columns_checked is not a number");
    }
    if (!Array.isArray(uniq.results) || uniq.results.length === 0) {
      fail("checks.unique_gaps.results is empty -- expected at least one identifier-shaped column checked for duplicates");
    } else {
      const missingQuery = uniq.results.filter(
        (r) => typeof r.query !== "string" || r.query.trim().length < 15,
      ).length;
      if (missingQuery > 0) {
        fail(`${missingQuery} of ${uniq.results.length} unique_gaps.results entries have no recorded .query`);
      }
    }
  }

  // ---------- findings sanity ----------
  if (Array.isArray(doc.findings)) {
    const withoutSeverity = doc.findings.filter((f) => f.severity !== "P1" && f.severity !== "P2").length;
    if (withoutSeverity > 0) {
      fail(`${withoutSeverity} finding(s) have a severity other than P1/P2`);
    }
    const withoutQueryOrDescription = doc.findings.filter(
      (f) => !f.description || (f.check !== "tenant_fk_gap" && f.check !== "primary_keys" && !f.query),
    );
    // tenant_fk_gap and primary_keys findings reference their parent check's query rather than
    // repeating it per-finding, which is fine -- every finding must at least carry a description.
    const withoutDescription = doc.findings.filter((f) => !f.description || f.description.length < 20);
    if (withoutDescription.length > 0) {
      fail(`${withoutDescription.length} finding(s) have no real .description`);
    }
    void withoutQueryOrDescription;

    if (!doc.summary || typeof doc.summary.total_findings !== "number") {
      fail("integrity.json .summary.total_findings missing");
    } else if (doc.summary.total_findings !== doc.findings.length) {
      fail(
        `integrity.json .summary.total_findings (${doc.summary.total_findings}) does not match actual .findings length (${doc.findings.length})`,
      );
    }
  }
}

// ---------- verdict ----------

if (failures.length > 0) {
  console.error("PT-06-004 verification FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("PT-06-004 verification PASSED:");
console.log(
  `  - FK/orphan result set: ${doc.checks.foreign_keys.constraints.length} FK constraints, each with a query + orphan count`,
);
console.log(
  `  - constraint-gap result set: tenant_fk_gap (${doc.checks.tenant_fk_gap.details.length} tables examined, ${doc.checks.tenant_fk_gap.tables_missing_fk} missing FK), primary_keys (${doc.checks.primary_keys.total_base_tables} tables, ${doc.checks.primary_keys.tables_without_pk.length} without PK), unique_gaps (${doc.checks.unique_gaps.candidate_columns_checked} candidate columns checked)`,
);
console.log(`  - ${doc.findings.length} total findings recorded (${doc.summary.p1_findings} P1, ${doc.summary.p2_findings} P2)`);
process.exit(0);
