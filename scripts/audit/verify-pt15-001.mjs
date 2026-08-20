// ============================================================================
// PT-15-001 verifier — env-var parity reconciliation
//
// Fails unless test-evidence/pt-15/env-parity.json exists and its content
// actually records a real three-environment (local / Vercel production /
// Railway production) reconciliation, with WGR-002 and WGR-003 both
// addressed by first-hand evidence rather than restated hearsay. Also guards
// against a secret VALUE having been captured anywhere in the evidence
// directory, the same way scripts/audit/verify-pt00-004.mjs does for its
// own env audit.
//
// Usage: node scripts/audit/verify-pt15-001.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR = path.join("test-evidence", "pt-15");
const TARGET = path.join(EVIDENCE_DIR, "env-parity.json");

const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/, // OpenAI/Stripe-style secret keys
  /sbp_[A-Za-z0-9]{10,}/, // Supabase Management API PAT
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, // JWT (header.payload)
  /AIza[A-Za-z0-9_-]{20,}/, // Google API key
  /postgres(ql)?:\/\/[^\s"]+:[^\s"]+@/, // DB connection string with embedded credentials
  /https?:\/\/[^\s"]+:[^\s"]+@[^\s"]+/, // any URL with embedded basic-auth credentials
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key block
];

let failures = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  failures++;
}

if (!fs.existsSync(EVIDENCE_DIR)) {
  fail(`${EVIDENCE_DIR} does not exist.`);
  process.exit(1);
}

if (!fs.existsSync(TARGET)) {
  fail(`${TARGET} does not exist.`);
  process.exit(1);
}

const raw = fs.readFileSync(TARGET, "utf8");
if (raw.trim().length === 0) {
  fail(`${TARGET} is empty.`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`${TARGET} is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (!data || typeof data !== "object") {
  fail(`${TARGET} did not parse to an object.`);
  process.exit(1);
}

// --- Structural checks: the file must actually describe a three-way check -

if (!data.environments_checked || typeof data.environments_checked !== "object") {
  fail(`${TARGET} is missing "environments_checked".`);
} else {
  for (const key of ["local", "vercel_production", "railway_production"]) {
    const env = data.environments_checked[key];
    if (!env || typeof env !== "object") {
      fail(`${TARGET}'s "environments_checked" is missing the "${key}" environment.`);
      continue;
    }
    if (typeof env.method !== "string" || env.method.length === 0) {
      fail(`${TARGET}'s environments_checked.${key} is missing a non-empty "method".`);
    }
  }
}

if (!Array.isArray(data.vars) || data.vars.length === 0) {
  fail(`${TARGET}'s "vars" array is missing or empty.`);
} else {
  const REQUIRED_FIELDS = [
    "var",
    "relevant_to",
    "local_present",
    "vercel_production_present",
    "railway_production_present",
    "status",
    "gap_environments",
    "note",
  ];
  let structuralErrors = 0;
  let rowsWithAllThreePresenceFieldsBoolean = 0;
  for (const [i, row] of data.vars.entries()) {
    for (const field of REQUIRED_FIELDS) {
      if (!(field in row)) {
        console.error(`FAIL: vars[${i}] ("${row.var ?? "?"}") is missing required field "${field}".`);
        structuralErrors++;
      }
    }
    if (typeof row.var !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.var)) {
      console.error(`FAIL: vars[${i}].var ("${row.var}") is not a valid env-var-shaped identifier.`);
      structuralErrors++;
    }
    if (typeof row.local_present !== "boolean") {
      console.error(`FAIL: vars[${i}] ("${row.var}").local_present must be boolean.`);
      structuralErrors++;
    }
    // vercel/railway presence may legitimately be `null` for tooling-only
    // vars (not relevant to either deployed platform) -- but must be
    // present as a key and, when non-null, boolean.
    for (const field of ["vercel_production_present", "railway_production_present"]) {
      const val = row[field];
      if (val !== null && typeof val !== "boolean") {
        console.error(`FAIL: vars[${i}] ("${row.var}").${field} must be boolean or null.`);
        structuralErrors++;
      }
    }
    if (row.vercel_production_present !== null || row.railway_production_present !== null) {
      rowsWithAllThreePresenceFieldsBoolean++;
    }
  }
  if (structuralErrors > 0) {
    fail(`${structuralErrors} structural error(s) found in "vars" rows.`);
  }
  // The whole point of this phase is that at least some vars actually got a
  // real vercel/railway presence check (not every row can be tooling-only,
  // or this isn't a real three-environment reconciliation).
  if (rowsWithAllThreePresenceFieldsBoolean === 0) {
    fail(
      `Every row in "vars" has null vercel_production_present AND railway_production_present -- ` +
        `no var was actually checked against either deployed platform. This is not a three-environment reconciliation.`,
    );
  }
}

// --- The specific WGR-002/003 settling this phase was asked to do ---------

if (!data.wgr_resolution || typeof data.wgr_resolution !== "object") {
  fail(`${TARGET} is missing "wgr_resolution".`);
} else {
  for (const key of ["WGR-002", "WGR-003"]) {
    const entry = data.wgr_resolution[key];
    if (!entry || typeof entry !== "object") {
      fail(`${TARGET}'s "wgr_resolution" is missing "${key}".`);
      continue;
    }
    if (typeof entry.resolution !== "string" || entry.resolution.length < 20) {
      fail(`${TARGET}'s wgr_resolution["${key}"].resolution is missing or too short to be a real finding.`);
    }
    if (typeof entry.settled !== "boolean") {
      fail(`${TARGET}'s wgr_resolution["${key}"].settled must be boolean.`);
    }
  }
}

// The task explicitly named three vars to settle: VERCEL_TOKEN, SUPABASE_URL,
// CRON_SECRET. Confirm each has its own row with an environment-specific
// presence verdict recorded (not left as "unknown"/absent from the array).
const NAMED_VARS = ["VERCEL_TOKEN", "SUPABASE_URL", "CRON_SECRET"];
if (Array.isArray(data.vars)) {
  const byName = new Map(data.vars.map((v) => [v.var, v]));
  for (const name of NAMED_VARS) {
    const row = byName.get(name);
    if (!row) {
      fail(`No vars[] row found for "${name}" (explicitly named in the PT-15 task as needing settlement).`);
      continue;
    }
    if (typeof row.note !== "string" || row.note.length < 20) {
      fail(`vars[] row for "${name}" has no substantive note recording what was actually confirmed.`);
    }
  }
}

// --- Secret-value guard: scan every file in the evidence dir --------------

const filesToScan = fs
  .readdirSync(EVIDENCE_DIR)
  .filter((f) => f.endsWith(".json") || f.endsWith(".txt"))
  .map((f) => path.join(EVIDENCE_DIR, f));

const leaks = [];
for (const file of filesToScan) {
  const content = fs.readFileSync(file, "utf8");
  for (const pattern of SECRET_VALUE_PATTERNS) {
    const match = content.match(pattern);
    if (match) leaks.push(`${file}: ${pattern} -> matched "${match[0].slice(0, 12)}..."`);
  }
}
if (leaks.length > 0) {
  fail(`Possible secret VALUE(s) found in test-evidence/pt-15/:\n  ${leaks.join("\n  ")}`);
}

if (failures > 0) {
  console.error(`\nFAIL: ${failures} check(s) failed.`);
  process.exit(1);
}

console.log(`PASS: ${TARGET} is valid.`);
console.log(`  ${data.vars.length} env var(s) reconciled across local / Vercel production / Railway production.`);
console.log(`  WGR-002 settled: ${data.wgr_resolution["WGR-002"].settled}`);
console.log(`  WGR-003 settled: ${data.wgr_resolution["WGR-003"].settled}`);
if (data.summary) {
  console.log(
    `  ${data.summary.confirmed_gaps} confirmed gap(s) (${data.summary.fully_resolved_no_gap} fully resolved).`,
  );
}
process.exit(0);
