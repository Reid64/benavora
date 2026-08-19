// Shared helpers for the wiring-gap audit program.
// ASCII only. Node 20 compatible (uses only node:fs, node:path -- no external deps).

import fs from "node:fs";
import path from "node:path";

/**
 * Returns an ISO-8601 timestamp suitable for evidence filenames and register rows.
 * Example: 2026-08-18T23-14-05Z (colons replaced so it is filesystem-safe on Windows).
 */
export function timestamp() {
  return new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
}

/**
 * Throws with a clear message unless filePath exists and has non-zero size.
 * Returns the file's byte size on success.
 */
export function assertFileExistsNonEmpty(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`assertFileExistsNonEmpty: file does not exist: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`assertFileExistsNonEmpty: not a regular file: ${filePath}`);
  }
  if (stat.size === 0) {
    throw new Error(`assertFileExistsNonEmpty: file is empty: ${filePath}`);
  }
  return stat.size;
}

/**
 * Throws unless filePath exists, is non-empty, parses as JSON, and (if requiredKey is
 * given) has that key present at the top level. Returns the parsed JSON value on success.
 */
export function assertJsonFileHasKey(filePath, requiredKey) {
  assertFileExistsNonEmpty(filePath);
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`assertJsonFileHasKey: failed to parse JSON in ${filePath}: ${err.message}`);
  }
  if (requiredKey !== undefined) {
    if (parsed === null || typeof parsed !== "object" || !(requiredKey in parsed)) {
      throw new Error(
        `assertJsonFileHasKey: key "${requiredKey}" not found at top level of ${filePath}`
      );
    }
  }
  return parsed;
}

/**
 * Appends one finding row to the WIRING_GAP_REGISTER.md markdown table.
 * finding = { id, layer, severity, description, evidencePath, reproduction, scopeTag }
 * registerPath defaults to the canonical register location.
 */
export function appendFindingRow(finding, registerPath = defaultRegisterPath()) {
  const required = ["id", "layer", "severity", "description", "evidencePath", "reproduction", "scopeTag"];
  for (const key of required) {
    if (!finding || finding[key] === undefined || finding[key] === null || finding[key] === "") {
      throw new Error(`appendFindingRow: missing required field "${key}"`);
    }
  }

  if (!fs.existsSync(registerPath)) {
    throw new Error(`appendFindingRow: register not found at ${registerPath}`);
  }

  const row = buildTableRow(finding);
  fs.appendFileSync(registerPath, row + "\n", "utf8");
  return row;
}

function buildTableRow(finding) {
  const escape = (value) => String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return (
    "| " +
    [
      finding.id,
      finding.layer,
      finding.severity,
      finding.description,
      finding.evidencePath,
      finding.reproduction,
      finding.scopeTag,
    ]
      .map(escape)
      .join(" | ") +
    " |"
  );
}

function defaultRegisterPath() {
  // scripts/audit/evidence-lib.mjs -> repo root -> test-evidence/_register/WIRING_GAP_REGISTER.md
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  return path.join(here, "..", "..", "test-evidence", "_register", "WIRING_GAP_REGISTER.md");
}
