// PT-01-005 verifier: confirms test-evidence/pt-01/claimed-fixes-reverify.json
// has all 5 of the mandated "claimed fixes" items, and that each row has a
// non-empty current_state and an evidence_file that actually exists on disk
// (a screenshot path that doesn't resolve to a real file is not evidence).
// Exits 0 only if all checks pass; exits 1 with a printed reason otherwise.
// ASCII only. Node 20 compatible.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const resultsPath = path.join(repoRoot, "test-evidence", "pt-01", "claimed-fixes-reverify.json");

const REQUIRED_ITEMS = [
  "Integrations Configure",
  'Grants.gov "Run Now"',
  "Scraping Targets link",
  "Branding logo upload",
  "Billing nav",
];

const VALID_VERDICTS = new Set(["CONFIRMED-OK", "CONFIRMED-BROKEN", "UNVERIFIED", "PENDING-SCOPE"]);

function fail(reason) {
  console.error(`PT-01-005 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  let file;
  try {
    file = assertJsonFileHasKey(resultsPath, "items");
  } catch (err) {
    fail(`claimed-fixes-reverify.json check failed: ${err.message}`);
    return;
  }

  if (!Array.isArray(file.items)) {
    fail(`items[] is not an array in ${resultsPath}`);
    return;
  }
  if (file.items.length === 0) {
    fail(`items[] is empty in ${resultsPath}`);
    return;
  }

  const badRows = [];
  const seenItems = new Set();

  for (const [idx, row] of file.items.entries()) {
    const rowId = row && row.item ? row.item : `row[${idx}]`;
    if (!row || typeof row !== "object") {
      badRows.push({ id: rowId, reason: "row is not an object" });
      continue;
    }
    seenItems.add(row.item);

    for (const field of ["item", "prior_claim", "current_state", "verdict"]) {
      if (!(field in row) || row[field] === null || row[field] === undefined || row[field] === "") {
        badRows.push({ id: rowId, reason: `missing/empty field "${field}"` });
      }
    }
    if (!("evidence_file" in row)) {
      badRows.push({ id: rowId, reason: 'missing field "evidence_file" (may legitimately be null only if the item could not be captured, but the key must be present)' });
    }
    if (row.verdict !== undefined && !VALID_VERDICTS.has(row.verdict)) {
      badRows.push({ id: rowId, reason: `verdict "${row.verdict}" is not one of ${[...VALID_VERDICTS].join(", ")}` });
    }

    // Every row must have a real evidence_file that exists on disk -- per this
    // task's own mandate ("an evidence_file that exists on disk"), null is not
    // acceptable for any of the 5 mandated items, since every one of them was
    // reachable and screenshotable this run.
    if (!row.evidence_file) {
      badRows.push({ id: rowId, reason: "evidence_file is null/empty -- every mandated item must have a real screenshot" });
    } else {
      const evidencePath = path.join(repoRoot, row.evidence_file);
      if (!fs.existsSync(evidencePath)) {
        badRows.push({ id: rowId, reason: `evidence_file "${row.evidence_file}" does not exist on disk` });
      } else if (fs.statSync(evidencePath).size === 0) {
        badRows.push({ id: rowId, reason: `evidence_file "${row.evidence_file}" exists but is empty` });
      }
    }
  }

  if (badRows.length > 0) {
    fail(
      `${badRows.length} row(s) missing/malformed required field(s): ` +
        badRows.map((b) => `${b.id} (${b.reason})`).join("; ")
    );
    return;
  }

  const missingItems = REQUIRED_ITEMS.filter((name) => !seenItems.has(name));
  if (missingItems.length > 0) {
    fail(`${missingItems.length} mandated item(s) missing from items[]: ${missingItems.join(", ")}`);
    return;
  }

  const byVerdict = {};
  for (const row of file.items) {
    byVerdict[row.verdict] = (byVerdict[row.verdict] || 0) + 1;
  }

  console.log(
    `PT-01-005 PASS: claimed-fixes-reverify.json has all ${REQUIRED_ITEMS.length} mandated item(s), ` +
      `each with a non-empty current_state and an existing, non-empty evidence_file. ` +
      `Verdicts: ${Object.entries(byVerdict).map(([k, v]) => `${k}=${v}`).join(", ")}.`
  );
  process.exit(0);
}

main();
