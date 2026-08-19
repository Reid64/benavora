// ============================================================================
// PT-00-004 verifier — env-var audit (names/presence only)
//
// Confirms test-evidence/pt-00/env-audit.json is real, non-empty evidence,
// and — critically — guards against the audit having accidentally captured a
// secret VALUE instead of just names/presence/status. Exits non-zero on any
// failure so this can be wired into a CI/gate step.
//
// Usage: node scripts/audit/verify-pt00-004.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const TARGET = path.join("test-evidence", "pt-00", "env-audit.json");

// Patterns that look like a real captured secret VALUE rather than a variable
// name, a status string, or a file path. If any of these match anywhere in
// the raw file text, treat it as a leak and fail loudly — this check runs
// against the raw text, not just parsed field values, so it also catches a
// secret smuggled into a "note" or "referenced_in" string.
const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/, // OpenAI/Stripe-style secret keys
  /sbp_[A-Za-z0-9]{10,}/, // Supabase Management API PAT
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, // JWT (header.payload)
  /AIza[A-Za-z0-9_-]{20,}/, // Google API key
  /postgres(ql)?:\/\/[^\s"]+:[^\s"]+@/, // DB connection string with embedded credentials
  /https?:\/\/[^\s"]+:[^\s"]+@[^\s"]+/, // any URL with embedded basic-auth credentials
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key block
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(TARGET)) {
  fail(`${TARGET} does not exist.`);
}

const raw = fs.readFileSync(TARGET, "utf8");

if (raw.trim().length === 0) {
  fail(`${TARGET} is empty.`);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`${TARGET} is not valid JSON: ${err.message}`);
}

if (!data || typeof data !== "object") {
  fail(`${TARGET} did not parse to an object.`);
}

if (!Array.isArray(data.vars) || data.vars.length === 0) {
  fail(`${TARGET}'s "vars" array is missing or empty — audit contains no findings.`);
}

// Structural check: every row must have the required fields with the right
// shapes (booleans/strings only — never something that could hold a raw
// secret value under an unexpected key).
const REQUIRED_FIELDS = ["var", "referenced_in", "present_in_env_local", "production_required", "status"];
let structuralErrors = 0;
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
  if (typeof row.present_in_env_local !== "boolean") {
    console.error(`FAIL: vars[${i}] ("${row.var}").present_in_env_local must be boolean.`);
    structuralErrors++;
  }
  if (typeof row.production_required !== "boolean") {
    console.error(`FAIL: vars[${i}] ("${row.var}").production_required must be boolean.`);
    structuralErrors++;
  }
  if (typeof row.status !== "string" || row.status.length === 0) {
    console.error(`FAIL: vars[${i}] ("${row.var}").status must be a non-empty string.`);
    structuralErrors++;
  }
  if (!Array.isArray(row.referenced_in)) {
    console.error(`FAIL: vars[${i}] ("${row.var}").referenced_in must be an array.`);
    structuralErrors++;
  }
}
if (structuralErrors > 0) {
  fail(`${structuralErrors} structural error(s) found in "vars" rows.`);
}

// Secret-value guard: scan the ENTIRE raw file text, not just specific
// fields, so a secret accidentally placed anywhere still trips this.
const leaks = [];
for (const pattern of SECRET_VALUE_PATTERNS) {
  const match = raw.match(pattern);
  if (match) leaks.push(`${pattern} -> matched "${match[0].slice(0, 12)}..."`);
}
if (leaks.length > 0) {
  fail(`Possible secret VALUE(s) found in ${TARGET}:\n  ${leaks.join("\n  ")}`);
}

// Sanity: this audit exists to enumerate findings against DIRECTIVE-019 —
// if it reports zero production-required vars at all, something is wrong
// with the categorization logic that produced it (not just "clean").
const requiredCount = data.vars.filter((r) => r.production_required === true).length;
if (requiredCount === 0) {
  fail(`0 vars marked production_required=true — audit is almost certainly incomplete.`);
}

console.log(`PASS: ${TARGET} is valid.`);
console.log(`  ${data.vars.length} env var(s) audited, ${requiredCount} marked production_required.`);
const findings = data.vars.filter((r) => r.production_required && !r.present_in_env_local);
if (findings.length > 0) {
  console.log(`  ${findings.length} finding(s) (production_required + absent from .env.local):`);
  for (const f of findings) {
    console.log(`    [${f.severity ?? "?"}] ${f.var}`);
  }
} else {
  console.log("  0 findings — every production_required var is present.");
}
process.exit(0);
