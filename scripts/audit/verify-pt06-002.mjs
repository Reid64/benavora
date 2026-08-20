// ============================================================================
// PT-06-002 verifier -- migration drift map (applied vs. on-disk).
//
// Exits non-zero unless:
//   1. test-evidence/pt-06/applied-migrations.json exists, parses, and
//      records the tracking-table query result (proving the check for a
//      real migration-tracking table actually happened).
//   2. test-evidence/pt-06/migration-drift.json exists, parses, and its
//      three primary buckets (appliedAndOnDisk, onDiskNotApplied,
//      noDdlUnverifiable) partition the on-disk file set with NO overlap
//      and NO gaps (every file lands in exactly one bucket).
//   3. The four migrations already known (from PT-02's WGR-006/007/008/009
//      findings) to back real, currently-500ing routes -- 086_white_label,
//      083_followup_sequences, 103_schoolfunder, 087_notification_preferences
//      -- each appear in the ON-DISK-NOT-APPLIED bucket, tying this session's
//      drift map to real, previously-confirmed user-facing breakage.
//
// Usage: node scripts/audit/verify-pt06-002.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const APPLIED_FILE = path.join("test-evidence", "pt-06", "applied-migrations.json");
const DRIFT_FILE = path.join("test-evidence", "pt-06", "migration-drift.json");

let errors = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}

// --- 1. applied-migrations.json ---------------------------------------------

let applied = null;
if (!fs.existsSync(APPLIED_FILE)) {
  fail(`${APPLIED_FILE} does not exist.`);
} else {
  const raw = fs.readFileSync(APPLIED_FILE, "utf8");
  if (raw.trim().length === 0) {
    fail(`${APPLIED_FILE} is empty.`);
  } else {
    try {
      applied = JSON.parse(raw);
    } catch (err) {
      fail(`${APPLIED_FILE} is not valid JSON: ${err.message}`);
    }
  }
}

if (applied) {
  if (!applied.trackingTableQuery || typeof applied.trackingTableQuery !== "object") {
    fail(`${APPLIED_FILE}.trackingTableQuery is missing -- no evidence the production migration-tracking table was actually queried.`);
  } else {
    if (!applied.trackingTableQuery.result) {
      fail(`${APPLIED_FILE}.trackingTableQuery.result is missing.`);
    }
    if (!applied.trackingTableQuery.evidence) {
      fail(`${APPLIED_FILE}.trackingTableQuery.evidence is missing -- no raw query result recorded.`);
    }
  }
  if (!Array.isArray(applied.appliedMigrations)) {
    fail(`${APPLIED_FILE}.appliedMigrations must be an array.`);
  } else if (applied.appliedMigrations.length === 0) {
    fail(`${APPLIED_FILE}.appliedMigrations is empty -- zero migrations recorded as applied is implausible for a live production system.`);
  }
}

// --- 2. migration-drift.json --------------------------------------------------

let drift = null;
if (!fs.existsSync(DRIFT_FILE)) {
  fail(`${DRIFT_FILE} does not exist.`);
} else {
  const raw = fs.readFileSync(DRIFT_FILE, "utf8");
  if (raw.trim().length === 0) {
    fail(`${DRIFT_FILE} is empty.`);
  } else {
    try {
      drift = JSON.parse(raw);
    } catch (err) {
      fail(`${DRIFT_FILE} is not valid JSON: ${err.message}`);
    }
  }
}

if (drift) {
  for (const key of ["appliedAndOnDisk", "onDiskNotApplied", "noDdlUnverifiable"]) {
    if (!Array.isArray(drift[key])) {
      fail(`${DRIFT_FILE}.${key} must be an array.`);
    }
  }

  if (Array.isArray(drift.appliedAndOnDisk) && Array.isArray(drift.onDiskNotApplied) && Array.isArray(drift.noDdlUnverifiable)) {
    // Partition check: no file (directory+filename) appears in more than one bucket.
    const seen = new Map(); // key -> bucket name
    const buckets = {
      appliedAndOnDisk: drift.appliedAndOnDisk,
      onDiskNotApplied: drift.onDiskNotApplied,
      noDdlUnverifiable: drift.noDdlUnverifiable,
    };
    for (const [bucketName, entries] of Object.entries(buckets)) {
      for (const entry of entries) {
        if (!entry.filename || !entry.directory) {
          fail(`${bucketName} has an entry missing filename/directory.`);
          continue;
        }
        const key = `${entry.directory}/${entry.filename}`;
        if (seen.has(key)) {
          fail(`Partition overlap: ${key} appears in both "${seen.get(key)}" and "${bucketName}".`);
        } else {
          seen.set(key, bucketName);
        }
      }
    }

    if (!drift.counts || typeof drift.counts.totalMigrationFilesOnDisk !== "number") {
      fail(`${DRIFT_FILE}.counts.totalMigrationFilesOnDisk is missing or not a number.`);
    } else if (seen.size !== drift.counts.totalMigrationFilesOnDisk) {
      fail(
        `Partition does not cover every on-disk file: ${seen.size} distinct files across the three buckets, ` +
          `but ${drift.counts.totalMigrationFilesOnDisk} total files on disk were recorded.`,
      );
    }

    if (!drift.partitionIntegrity || drift.partitionIntegrity.noOverlapAcrossBuckets !== true) {
      fail(`${DRIFT_FILE}.partitionIntegrity.noOverlapAcrossBuckets is not true.`);
    }
    if (!drift.partitionIntegrity || drift.partitionIntegrity.matchesTotalOnDiskFiles !== true) {
      fail(`${DRIFT_FILE}.partitionIntegrity.matchesTotalOnDiskFiles is not true.`);
    }

    // --- 3. Cross-reference the 4 known missing-table 500s (WGR-006/007/008/009) ---
    const REQUIRED_UNAPPLIED = [
      { wgrId: "WGR-006", filename: "086_white_label.sql", table: "consultant_client_access" },
      { wgrId: "WGR-007", filename: "083_followup_sequences.sql", table: "followup_sequences" },
      { wgrId: "WGR-008", filename: "103_schoolfunder.sql", table: "schoolfunder" },
      { wgrId: "WGR-009", filename: "087_notification_preferences.sql", table: "notification_preferences" },
    ];
    for (const req of REQUIRED_UNAPPLIED) {
      const hit = drift.onDiskNotApplied.find((r) => r.filename === req.filename);
      if (!hit) {
        fail(
          `${req.wgrId}'s migration file "${req.filename}" (backing the "${req.table}" gap) was not found in ` +
            `onDiskNotApplied -- the drift map does not tie back to this already-confirmed real breakage.`,
        );
      }
    }
  }

  if (!drift.appliedNotOnDisk || !Array.isArray(drift.appliedNotOnDisk.entries)) {
    fail(`${DRIFT_FILE}.appliedNotOnDisk.entries must be an array (even if empty).`);
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(`PASS: ${APPLIED_FILE} records the tracking-table query and an applied-migrations list.`);
console.log(`PASS: ${DRIFT_FILE} partitions all on-disk migration files with no overlap.`);
console.log(`PASS: all 4 known missing-table 500s (WGR-006/007/008/009) map to a real unapplied migration.`);
process.exit(0);
