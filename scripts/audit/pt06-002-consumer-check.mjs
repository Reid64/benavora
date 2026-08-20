// ============================================================================
// PT-06-002 -- for every ON-DISK-NOT-APPLIED migration in migration-drift.json,
// grep src/ and worker/ for real code references to the missing table names,
// to separate "confirmed real breakage" (a live route/agent queries a table
// that doesn't exist) from "schema drift with no live consumer found" (the
// table was never referenced by any app code this session could find).
//
// This is a coarse, table-name-level grep sweep, not a full read of every
// call site -- it is meant to prioritize which of the 57 drift entries are
// worth a full manual register finding, not to replace that manual read for
// the ones ultimately registered.
//
// Usage: node scripts/audit/pt06-002-consumer-check.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const DRIFT_FILE = path.join("test-evidence", "pt-06", "migration-drift.json");
const OUT_FILE = path.join("test-evidence", "pt-06", "consumer-check.json");

const drift = JSON.parse(fs.readFileSync(DRIFT_FILE, "utf8"));

function grepCount(term) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-ChildItem -Recurse -Include *.ts,*.tsx -Path src,worker -ErrorAction SilentlyContinue | Select-String -SimpleMatch -Pattern '${term}').Count"`,
      { encoding: "utf8" },
    ).trim();
    return parseInt(out, 10) || 0;
  } catch {
    return 0;
  }
}

function grepFiles(term) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-ChildItem -Recurse -Include *.ts,*.tsx -Path src,worker -ErrorAction SilentlyContinue | Select-String -SimpleMatch -Pattern '${term}').Path | Get-Unique"`,
      { encoding: "utf8" },
    );
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((p) => path.relative(process.cwd(), p).split(path.sep).join("/"));
  } catch {
    return [];
  }
}

const results = [];
for (const entry of drift.onDiskNotApplied) {
  const tableNames = Object.keys(entry.requiredTables);
  const perTable = tableNames.map((t) => {
    const count = grepCount(t);
    const files = count > 0 ? grepFiles(t).slice(0, 8) : [];
    return { table: t, referenceCount: count, referencingFiles: files };
  });
  const hasLiveConsumer = perTable.some((t) => t.referenceCount > 0);
  results.push({
    filename: entry.filename,
    directory: entry.directory,
    prefixRaw: entry.prefixRaw,
    missingCount: entry.missing.length,
    perTable,
    hasLiveConsumer,
  });
}

results.sort((a, b) => (b.hasLiveConsumer ? 1 : 0) - (a.hasLiveConsumer ? 1 : 0) || b.missingCount - a.missingCount);

fs.writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + "\n", "utf8");

console.log(`Wrote ${OUT_FILE}`);
console.log(`  entries with a confirmed live-code consumer: ${results.filter((r) => r.hasLiveConsumer).length} of ${results.length}`);
for (const r of results) {
  console.log(`  ${r.hasLiveConsumer ? "[CONSUMER]" : "[no ref found]"} ${r.directory}/${r.filename} -- ${r.perTable.map((t) => `${t.table}:${t.referenceCount}`).join(", ")}`);
}
