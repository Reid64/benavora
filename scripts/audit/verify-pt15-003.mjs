// ============================================================================
// PT-15-003 verifier — final register consolidation + closing deliverables.
//
// Fails unless:
//   1. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      and every WGR-* row in it carries a real severity (P0/P1/P2/P3), a
//      real evidence path (a "test-evidence/" reference somewhere in the
//      row), and a scope tag drawn from the register's own legend
//      (CONFIRMED-BROKEN / UNVERIFIED / PENDING-SCOPE / CONFIRMED-OK /
//      RESOLVED) — not a stray/non-standard value.
//   2. The register has no duplicate WGR-* IDs.
//   3. The register's findings are actually sorted P0 -> P3 (top to bottom).
//   4. test-evidence/pt-15/GO-NO-GO.md exists, is non-empty, and states an
//      explicit go/no-go verdict.
//   5. test-evidence/pt-15/REMEDIATION-BACKLOG.md exists, is non-empty, and
//      is organized into the ranked waves it claims to be.
//   6. No secret VALUE appears in any of the three files (same convention as
//      verify-pt15-001.mjs / verify-pt15-002.mjs / verify-pt00-004.mjs).
//
// This is a structural/consistency check on the closing deliverables, not a
// re-verification of every underlying finding — PT-00 through PT-14's own
// verify-pt*.mjs scripts already did that per-phase.
//
// Usage: node scripts/audit/verify-pt15-003.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const REGISTER_PATH = path.join("test-evidence", "_register", "WIRING_GAP_REGISTER.md");
const GO_NO_GO_PATH = path.join("test-evidence", "pt-15", "GO-NO-GO.md");
const BACKLOG_PATH = path.join("test-evidence", "pt-15", "REMEDIATION-BACKLOG.md");

const VALID_SEVERITIES = ["P0", "P1", "P2", "P3"];
const VALID_SCOPE_TAGS = ["CONFIRMED-BROKEN", "UNVERIFIED", "PENDING-SCOPE", "CONFIRMED-OK", "RESOLVED"];
const SEVERITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/, // OpenAI/Stripe-style secret keys
  /sbp_[A-Za-z0-9]{10,}/, // Supabase Management API PAT
  /sb_secret_[A-Za-z0-9]{10,}/, // Supabase new-format secret key
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, // JWT (header.payload) -- catches anon/service-role keys
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
function warn(message) {
  console.warn(`WARN: ${message}`);
}

function requireNonEmptyFile(p, label) {
  if (!fs.existsSync(p)) {
    fail(`${label} (${p}) does not exist.`);
    return null;
  }
  const raw = fs.readFileSync(p, "utf8");
  if (raw.trim().length === 0) {
    fail(`${label} (${p}) is empty.`);
    return null;
  }
  return raw;
}

function scanForSecrets(label, p, content) {
  for (const pattern of SECRET_VALUE_PATTERNS) {
    const match = content.match(pattern);
    // A real credential never contains a placeholder marker; this register
    // (and this doc) legitimately quotes reproduction commands like
    // `http://scraperapi:<key-or-fake>@proxy...` as guidance, not a leak.
    if (match && !/[<>]/.test(match[0])) {
      fail(`Possible secret VALUE found in ${label} (${p}): ${pattern} -> matched "${match[0].slice(0, 12)}..."`);
    }
  }
}

// --- 1/2/3/6a. Register: exists, non-empty, every row complete, no dupes, sorted --

const registerRaw = requireNonEmptyFile(REGISTER_PATH, "Consolidated register");

let rows = [];
if (registerRaw !== null) {
  scanForSecrets("register", REGISTER_PATH, registerRaw);

  const lines = registerRaw.split("\n");
  const rowLines = lines.filter((l) => l.startsWith("| WGR-"));

  if (rowLines.length === 0) {
    fail(`${REGISTER_PATH} has no "| WGR-..." rows -- register appears empty of findings.`);
  }

  const seenIds = new Set();
  const duplicateIds = [];

  for (const line of rowLines) {
    // Split on "|" -- reliable for the first few and last field even when a
    // row's Finding/Evidence/Reproduction text contains embedded literal "|"
    // characters (shell pipes, etc.): those never appear before the Severity
    // column (index 3) or after the Scope Tag column (the second-to-last
    // split segment, since the row always ends in "| <tag> |").
    const parts = line.split("|");
    const id = (parts[1] ?? "").trim();
    const severity = (parts[3] ?? "").trim();
    const scopeTag = (parts[parts.length - 2] ?? "").trim();
    const hasEvidenceRef = line.includes("test-evidence/");

    if (seenIds.has(id)) duplicateIds.push(id);
    seenIds.add(id);

    if (!/^WGR-\d+$/.test(id)) {
      fail(`Row does not have a well-formed WGR-* ID: "${id}"`);
      continue;
    }
    if (!VALID_SEVERITIES.includes(severity)) {
      fail(`${id}: severity is missing or invalid (got ${JSON.stringify(severity)}); must be one of ${VALID_SEVERITIES.join(", ")}.`);
    }
    if (!VALID_SCOPE_TAGS.includes(scopeTag)) {
      fail(`${id}: scope tag is missing or non-standard (got ${JSON.stringify(scopeTag)}); must be one of ${VALID_SCOPE_TAGS.join(", ")}.`);
    }
    if (!hasEvidenceRef) {
      fail(`${id}: row has no "test-evidence/" evidence path reference anywhere.`);
    }

    rows.push({ id, severity, scopeTag });
  }

  if (duplicateIds.length > 0) {
    fail(`Duplicate WGR-* IDs found in register: ${[...new Set(duplicateIds)].join(", ")}`);
  }

  // Sort check: severity rank must be non-decreasing top to bottom (P0 block,
  // then P1 block, then P2 block, then P3 block -- order *within* a severity
  // tier is not constrained).
  let sortViolation = null;
  for (let i = 1; i < rows.length; i++) {
    const prevRank = SEVERITY_RANK[rows[i - 1].severity];
    const curRank = SEVERITY_RANK[rows[i].severity];
    if (curRank !== undefined && prevRank !== undefined && curRank < prevRank) {
      sortViolation = { index: i, prevId: rows[i - 1].id, prevSev: rows[i - 1].severity, curId: rows[i].id, curSev: rows[i].severity };
      break;
    }
  }
  if (sortViolation) {
    fail(
      `Register is not sorted P0 -> P3: row ${sortViolation.index} (${sortViolation.curId}, ${sortViolation.curSev}) ` +
        `comes after ${sortViolation.prevId} (${sortViolation.prevSev}), which is a higher-numbered (lower-priority) severity.`,
    );
  }

  // RESOLVED cross-check: the task explicitly names WGR-017 and WGR-029..032
  // as findings that must be marked RESOLVED with their fix commit recorded
  // in this consolidation pass.
  const mustBeResolved = ["WGR-017", "WGR-029", "WGR-030", "WGR-031", "WGR-032"];
  for (const id of mustBeResolved) {
    const row = rows.find((r) => r.id === id);
    if (!row) {
      fail(`${id} not found in register at all -- expected to be present and marked RESOLVED.`);
    } else if (row.scopeTag !== "RESOLVED") {
      fail(`${id} is expected to be marked RESOLVED in this consolidation pass (got scope tag ${JSON.stringify(row.scopeTag)}).`);
    }
  }
  const resolvedRowsHaveCommit = rows
    .filter((r) => r.scopeTag === "RESOLVED")
    .every((r) => {
      const line = lines.find((l) => l.startsWith(`| ${r.id} `));
      return line && /RESOLVED commit `[0-9a-f]{7,}`/.test(line);
    });
  if (!resolvedRowsHaveCommit) {
    fail(`At least one RESOLVED row does not cite a real commit hash ("RESOLVED commit \`<hash>\`") in its finding text.`);
  }
}

// --- 4. GO-NO-GO.md ------------------------------------------------------------

const goNoGoRaw = requireNonEmptyFile(GO_NO_GO_PATH, "GO/NO-GO verdict doc");
if (goNoGoRaw !== null) {
  scanForSecrets("GO-NO-GO.md", GO_NO_GO_PATH, goNoGoRaw);

  if (!/\*\*Verdict:\s*(GO|NO-GO)\.?\*\*/.test(goNoGoRaw)) {
    fail(`${GO_NO_GO_PATH} does not state an explicit "**Verdict: GO.**" or "**Verdict: NO-GO.**" line.`);
  }
  if (!/open P0/i.test(goNoGoRaw)) {
    fail(`${GO_NO_GO_PATH} does not appear to enumerate open P0 findings (no "open P0" text found).`);
  }
  if (!/open P1/i.test(goNoGoRaw)) {
    fail(`${GO_NO_GO_PATH} does not appear to enumerate open P1 findings (no "open P1" text found).`);
  }
  if (!/known limit/i.test(goNoGoRaw)) {
    fail(`${GO_NO_GO_PATH} does not appear to contain a known-limits section.`);
  }
  // Every P0/P1 WGR ID actually in the register should be referenced
  // somewhere in the doc (cross-check, not a full itemization requirement --
  // some may be folded into a prose summary rather than a table row).
  if (rows.length > 0) {
    const openP0P1 = rows.filter((r) => (r.severity === "P0" || r.severity === "P1") && r.scopeTag !== "RESOLVED" && r.scopeTag !== "CONFIRMED-OK");
    const missingFromDoc = openP0P1.filter((r) => !goNoGoRaw.includes(r.id));
    if (missingFromDoc.length > 0) {
      fail(
        `${GO_NO_GO_PATH} does not mention ${missingFromDoc.length} open P0/P1 register ID(s) at all: ` +
          `${missingFromDoc.slice(0, 10).map((r) => r.id).join(", ")}${missingFromDoc.length > 10 ? ", ..." : ""}`,
      );
    }
  }
}

// --- 5. REMEDIATION-BACKLOG.md --------------------------------------------------

const backlogRaw = requireNonEmptyFile(BACKLOG_PATH, "Remediation backlog");
if (backlogRaw !== null) {
  scanForSecrets("REMEDIATION-BACKLOG.md", BACKLOG_PATH, backlogRaw);

  for (const wave of ["Wave 0", "Wave 1", "Wave 2", "Wave 3"]) {
    if (!backlogRaw.includes(wave)) {
      fail(`${BACKLOG_PATH} is missing a "${wave}" section -- backlog is not organized into the claimed ranked waves.`);
    }
  }
  if (rows.length > 0) {
    const openP0 = rows.filter((r) => r.severity === "P0" && r.scopeTag !== "RESOLVED" && r.scopeTag !== "CONFIRMED-OK");
    const missingFromBacklog = openP0.filter((r) => !backlogRaw.includes(r.id));
    if (missingFromBacklog.length > 0) {
      fail(
        `${BACKLOG_PATH} does not mention ${missingFromBacklog.length} open P0 register ID(s): ` +
          `${missingFromBacklog.map((r) => r.id).join(", ")}`,
      );
    }
  }
}

// --- Summary ---------------------------------------------------------------

if (failures > 0) {
  console.error(`\nFAIL: ${failures} check(s) failed.`);
  process.exit(1);
}

const bySeverity = {};
for (const r of rows) bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
const byScope = {};
for (const r of rows) byScope[r.scopeTag] = (byScope[r.scopeTag] || 0) + 1;

console.log(`PASS: register + GO-NO-GO.md + REMEDIATION-BACKLOG.md all present, non-empty, and structurally consistent.`);
console.log(`  Register: ${rows.length} rows, sorted P0->P3, no duplicate IDs.`);
console.log(`  By severity: ${JSON.stringify(bySeverity)}`);
console.log(`  By scope tag: ${JSON.stringify(byScope)}`);
console.log(`  WGR-017 and WGR-029..032 confirmed RESOLVED with a cited commit.`);
process.exit(0);
