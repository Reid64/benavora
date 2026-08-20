// PT-06 verification gate: confirms the live schema census and the
// code-vs-schema cross-reference audit are both real, non-empty artifacts,
// and specifically that the known org_id/organization_id class of bug
// (discovery_matches, PT-02) is present in the recorded findings.
//
// Exit 0 = all checks pass. Exit 1 = any check fails (prints why).

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LIVE_SCHEMA_PATH = path.join(ROOT, "test-evidence", "pt-06", "live-schema.json");
const MISMATCH_PATH = path.join(ROOT, "test-evidence", "pt-06", "schema-mismatch.json");

const failures = [];

function fail(msg) {
  failures.push(msg);
}

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

// ---------- live-schema.json ----------

const liveSchema = loadJson(LIVE_SCHEMA_PATH, "live-schema.json");
if (liveSchema) {
  if (!liveSchema.tables || typeof liveSchema.tables !== "object") {
    fail("live-schema.json has no .tables object");
  } else {
    const tableCount = Object.keys(liveSchema.tables).length;
    if (tableCount === 0) {
      fail("live-schema.json .tables is empty -- census did not capture the live public schema");
    }
    if (typeof liveSchema.table_count !== "number" || liveSchema.table_count !== tableCount) {
      fail(
        `live-schema.json .table_count (${liveSchema.table_count}) does not match actual .tables entry count (${tableCount})`,
      );
    }
    if (typeof liveSchema.total_column_count !== "number" || liveSchema.total_column_count === 0) {
      fail("live-schema.json .total_column_count missing or zero -- no columns captured");
    }
  }
}

// ---------- schema-mismatch.json ----------

const mismatch = loadJson(MISMATCH_PATH, "schema-mismatch.json");
if (mismatch) {
  if (!mismatch.runtime_query_code) {
    fail("schema-mismatch.json has no .runtime_query_code section");
  } else {
    if (!Array.isArray(mismatch.runtime_query_code.missing_tables)) {
      fail("schema-mismatch.json .runtime_query_code.missing_tables is not an array");
    } else if (mismatch.runtime_query_code.missing_tables.length === 0) {
      fail(
        "schema-mismatch.json .runtime_query_code.missing_tables is empty -- expected at least one table the code references that doesn't exist live",
      );
    }
    if (!Array.isArray(mismatch.runtime_query_code.column_mismatches)) {
      fail("schema-mismatch.json .runtime_query_code.column_mismatches is not an array");
    } else if (mismatch.runtime_query_code.column_mismatches.length === 0) {
      fail(
        "schema-mismatch.json .runtime_query_code.column_mismatches is empty -- expected at least one column-name mismatch on a table that DOES exist",
      );
    }
  }

  // The org_id/organization_id case (discovery_matches, PT-02) must appear
  // specifically, per task instruction step 3/5.
  const orgIdCasePresent =
    !!mismatch.known_bug_confirmation?.present_in_findings &&
    Array.isArray(mismatch.runtime_query_code?.column_mismatches) &&
    mismatch.runtime_query_code.column_mismatches.some(
      (f) => f.table === "discovery_matches" && f.column === "organization_id",
    );
  if (!orgIdCasePresent) {
    fail(
      "schema-mismatch.json does not record the known org_id/organization_id case (discovery_matches.organization_id) -- PT-02's finding was not re-confirmed",
    );
  }

  if (!mismatch.method || typeof mismatch.method !== "string" || mismatch.method.length < 20) {
    fail("schema-mismatch.json is missing a real .method description of how the audit was performed");
  }
}

// ---------- verdict ----------

if (failures.length > 0) {
  console.error("PT-06 verification FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("PT-06 verification PASSED:");
console.log(`  - live-schema.json: ${liveSchema.table_count} tables, ${liveSchema.total_column_count} columns`);
console.log(
  `  - schema-mismatch.json: ${mismatch.runtime_query_code.missing_tables.length} missing tables, ${mismatch.runtime_query_code.column_mismatches.length} column mismatches`,
);
console.log(
  `  - org_id/organization_id case (discovery_matches, PT-02) confirmed present`,
);
process.exit(0);
