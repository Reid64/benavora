// PT-01-003 verifier: confirms nav-resolution.json is non-empty and every
// entry has a resolved_status (plus the surface/label/target/verdict fields
// that give resolved_status meaning). Exits 0 only if all checks pass; exits
// 1 with a printed reason otherwise. ASCII only. Node 20 compatible.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const resultsPath = path.join(repoRoot, "test-evidence", "pt-01", "nav-resolution.json");

const VALID_VERDICTS = new Set(["CONFIRMED-OK", "CONFIRMED-BROKEN"]);

function fail(reason) {
  console.error(`PT-01-003 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  let resultsFile;
  try {
    resultsFile = assertJsonFileHasKey(resultsPath, "results");
  } catch (err) {
    fail(`nav-resolution.json check failed: ${err.message}`);
    return;
  }

  if (!Array.isArray(resultsFile.results)) {
    fail(`results[] is not an array in ${resultsPath}`);
    return;
  }
  if (resultsFile.results.length === 0) {
    fail(`results[] is empty in ${resultsPath} -- nav-resolution.json must be non-empty`);
    return;
  }

  const actualCount = resultsFile.results.length;
  if (resultsFile.totalEntries !== actualCount) {
    fail(
      `totalEntries field (${resultsFile.totalEntries}) does not match results[] length ` +
        `(${actualCount}) in ${resultsPath}`
    );
    return;
  }

  const REQUIRED_FIELDS = ["surface", "label", "target", "resolved_status", "verdict"];
  const badRows = [];
  const bySurface = {};

  for (const [idx, row] of resultsFile.results.entries()) {
    const rowId = row && row.target ? `${row.surface || "?"}:${row.label || "?"}(${row.target})` : `row[${idx}]`;
    if (!row || typeof row !== "object") {
      badRows.push({ id: `row[${idx}]`, reason: "row is not an object" });
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (!(field in row) || row[field] === null || row[field] === undefined || row[field] === "") {
        badRows.push({ id: rowId, reason: `missing/empty field "${field}"` });
      }
    }
    if ("verdict" in row && row.verdict !== undefined && !VALID_VERDICTS.has(row.verdict)) {
      badRows.push({ id: rowId, reason: `verdict "${row.verdict}" is not one of ${[...VALID_VERDICTS].join(", ")}` });
    }
    if (row.surface) {
      bySurface[row.surface] = (bySurface[row.surface] || 0) + 1;
    }
  }

  if (badRows.length > 0) {
    fail(
      `${badRows.length} row(s) missing/malformed required field(s): ` +
        badRows.slice(0, 15).map((b) => `${b.id} (${b.reason})`).join("; ") +
        (badRows.length > 15 ? "; ..." : "")
    );
    return;
  }

  // Cross-check block is expected (step 3 of the task) but not fatal if
  // absent -- warn rather than fail, since its presence isn't part of the
  // "non-empty + every entry has resolved_status" contract this verifier is
  // scoped to.
  if (!resultsFile.crossCheckPt00DeadNavClaim) {
    console.warn(
      "PT-01-003 WARN: nav-resolution.json has no crossCheckPt00DeadNavClaim block " +
        "(step 3's PT-00 deadNav cross-check) -- present in the reference implementation, not required by this verifier."
    );
  }

  const surfaceList = Object.entries(bySurface)
    .map(([s, n]) => `${s}=${n}`)
    .join(", ");

  console.log(
    `PT-01-003 PASS: nav-resolution.json has ${actualCount} entr${actualCount === 1 ? "y" : "ies"} ` +
      `across ${Object.keys(bySurface).length} surface(s) (${surfaceList}), every entry has ` +
      `surface/label/target/resolved_status/verdict populated.`
  );
  process.exit(0);
}

main();
