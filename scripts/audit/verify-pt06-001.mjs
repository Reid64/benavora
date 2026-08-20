// ============================================================================
// PT-06-001 verifier — preflight, read-only connection proof, migration-file
// inventory.
//
// Exits non-zero unless:
//   1. test-evidence/pt-06/connection-proof.txt exists, is non-empty, and
//      shows a successful "select 1" AND a real, engine-rejected write
//      attempt (proving the connection was actually read-only-safe, not
//      just requested to be).
//   2. test-evidence/pt-06/migration-files.json exists, is valid JSON, is
//      non-empty, and every recorded file entry has a directory and a
//      sha256 hash.
//
// Usage: node scripts/audit/verify-pt06-001.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const CONN_PROOF = path.join("test-evidence", "pt-06", "connection-proof.txt");
const MIGRATION_INVENTORY = path.join("test-evidence", "pt-06", "migration-files.json");

let errors = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}

// --- 1. connection-proof.txt -----------------------------------------------

if (!fs.existsSync(CONN_PROOF)) {
  fail(`${CONN_PROOF} does not exist.`);
} else {
  const text = fs.readFileSync(CONN_PROOF, "utf8");
  if (text.trim().length === 0) {
    fail(`${CONN_PROOF} is empty.`);
  } else {
    if (!/select 1: SUCCESS/.test(text)) {
      fail(`${CONN_PROOF} does not show a successful "select 1".`);
    }
    if (!/\bok\b\s*:\s*1|"ok":1/.test(text)) {
      fail(`${CONN_PROOF} does not show the "select 1" result value.`);
    }
    if (!/RESULT:\s*PASS/.test(text)) {
      fail(`${CONN_PROOF} does not record an overall PASS result.`);
    }
    if (/RESULT:\s*HALT/.test(text)) {
      fail(`${CONN_PROOF} records a HALT result -- connection was not proven read-only-safe.`);
    }
    if (!/25006|read.only.sql.transaction|REJECTED AS EXPECTED/i.test(text)) {
      fail(
        `${CONN_PROOF} does not show evidence that a real write attempt was rejected by ` +
          `Postgres (SQLSTATE 25006) -- read-only enforcement is not demonstrated, only claimed.`,
      );
    }
  }
}

// --- 2. migration-files.json -------------------------------------------------

if (!fs.existsSync(MIGRATION_INVENTORY)) {
  fail(`${MIGRATION_INVENTORY} does not exist.`);
} else {
  const raw = fs.readFileSync(MIGRATION_INVENTORY, "utf8");
  if (raw.trim().length === 0) {
    fail(`${MIGRATION_INVENTORY} is empty.`);
  } else {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      fail(`${MIGRATION_INVENTORY} is not valid JSON: ${err.message}`);
    }

    if (data) {
      if (!Array.isArray(data.perDirectory) || data.perDirectory.length === 0) {
        fail(`${MIGRATION_INVENTORY}.perDirectory must be a non-empty array.`);
      } else {
        let totalFiles = 0;
        for (const dirEntry of data.perDirectory) {
          if (!dirEntry.directory) {
            fail(`A perDirectory entry is missing "directory".`);
            continue;
          }
          if (!Array.isArray(dirEntry.files)) {
            fail(`${dirEntry.directory}: "files" must be an array.`);
            continue;
          }
          if (dirEntry.exists && dirEntry.files.length === 0) {
            fail(`${dirEntry.directory}: marked exists=true but has zero files recorded.`);
          }
          totalFiles += dirEntry.files.length;
          for (const [i, f] of dirEntry.files.entries()) {
            const label = f.filename ?? `${dirEntry.directory}[${i}]`;
            if (!f.filename) fail(`${dirEntry.directory}[${i}] is missing "filename".`);
            if (!f.directory) fail(`${label}: missing "directory" field on the file entry.`);
            if (!f.sha256 || typeof f.sha256 !== "string" || f.sha256.length !== 64) {
              fail(`${label}: missing or malformed "sha256" (expected a 64-char hex hash).`);
            }
            if (typeof f.bytes !== "number") {
              fail(`${label}: missing or non-numeric "bytes".`);
            }
          }
        }
        if (totalFiles === 0) {
          fail(`${MIGRATION_INVENTORY} records zero files across all directories -- inventory did not run.`);
        }

        // Known-directory sanity: both of the two directories PT-02 flagged
        // must actually be present in the inventory (by name), and each
        // must be marked as existing on disk (the collision can't be real
        // otherwise).
        const requiredDirs = ["src/supabase/migrations", "supabase/migrations"];
        for (const req of requiredDirs) {
          const entry = data.perDirectory.find((d) => d.directory === req);
          if (!entry) {
            fail(`Required known migration directory "${req}" is not present in perDirectory.`);
          } else if (entry.exists !== true) {
            fail(`Required known migration directory "${req}" is recorded as not existing.`);
          }
        }
      }

      if (!Array.isArray(data.crossDirectoryCollisions)) {
        fail(`${MIGRATION_INVENTORY}.crossDirectoryCollisions must be an array (even if empty).`);
      }

      if (!data.summary || typeof data.summary !== "object") {
        fail(`${MIGRATION_INVENTORY}.summary object is missing.`);
      } else if (typeof data.summary.totalFilesAcrossKnownDirectories !== "number") {
        fail(`${MIGRATION_INVENTORY}.summary.totalFilesAcrossKnownDirectories must be a number.`);
      }
    }
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(`PASS: ${CONN_PROOF} shows a proven read-only-safe connection.`);
console.log(`PASS: ${MIGRATION_INVENTORY} is a non-empty, per-file directory+hash migration inventory.`);
process.exit(0);
