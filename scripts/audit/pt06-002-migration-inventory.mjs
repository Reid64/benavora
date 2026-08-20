// ============================================================================
// PT-06-002 -- inventory every migration file on disk across BOTH known
// migration directories (the two-parallel-directories collision PT-02
// flagged): src/supabase/migrations and supabase/migrations.
//
// For each file, records: filename, directory, extracted numeric prefix
// (the migration "number"), byte size, and a sha256 content hash.
//
// Also computes and records findings:
//   - crossDirectoryCollisions: the same numeric prefix appears in BOTH
//     directories (the exact ambiguity PT-02 flagged -- which directory's
//     copy, if either, is what actually ran against production is unknown
//     from the filesystem alone).
//   - withinDirectoryDuplicates: the same numeric prefix appears more than
//     once inside a single directory (a different, narrower problem --
//     even a single directory's own numbering is not always unique).
//   - sequenceGaps: per directory, gaps in the ascending numeric sequence
//     of distinct prefixes actually present on disk.
//
// git worktree checkouts under .claude/worktrees/** are detected but
// deliberately excluded from the inventory -- they are other branches'
// working copies of this same repository (confirmed via `git worktree
// list`), not independent migration sources that could have been applied
// to production. Their existence and exclusion is recorded for
// transparency, not silently dropped.
//
// Evidence: test-evidence/pt-06/migration-files.json
//
// Usage: node scripts/audit/pt06-002-migration-inventory.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const KNOWN_DIRS = [
  path.join("src", "supabase", "migrations"),
  path.join("supabase", "migrations"),
];

const OUT_DIR = path.join("test-evidence", "pt-06");
const OUT_FILE = path.join(OUT_DIR, "migration-files.json");

function sha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function extractPrefix(filename) {
  const m = filename.match(/^(\d+)/);
  return m ? m[1] : null;
}

function inventoryDir(dir) {
  if (!fs.existsSync(dir)) {
    return { dir, exists: false, files: [] };
  }
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();

  const files = entries.map((filename) => {
    const fullPath = path.join(dir, filename);
    const stat = fs.statSync(fullPath);
    const prefixRaw = extractPrefix(filename);
    return {
      filename,
      directory: dir.split(path.sep).join("/"),
      prefixRaw,
      prefixNumeric: prefixRaw !== null ? parseInt(prefixRaw, 10) : null,
      bytes: stat.size,
      sha256: sha256(fullPath),
    };
  });

  return { dir, exists: true, files };
}

function findSequenceGaps(files) {
  const distinctPrefixes = [
    ...new Set(files.map((f) => f.prefixNumeric).filter((n) => n !== null)),
  ].sort((a, b) => a - b);
  if (distinctPrefixes.length === 0) return { min: null, max: null, missing: [] };
  const min = distinctPrefixes[0];
  const max = distinctPrefixes[distinctPrefixes.length - 1];
  const present = new Set(distinctPrefixes);
  const missing = [];
  for (let n = min; n <= max; n++) {
    if (!present.has(n)) missing.push(n);
  }
  return { min, max, missing };
}

function findWithinDirDuplicates(files) {
  const byPrefix = new Map();
  for (const f of files) {
    if (f.prefixRaw === null) continue;
    if (!byPrefix.has(f.prefixRaw)) byPrefix.set(f.prefixRaw, []);
    byPrefix.get(f.prefixRaw).push(f.filename);
  }
  const dups = [];
  for (const [prefix, filenames] of byPrefix.entries()) {
    if (filenames.length > 1) {
      dups.push({ prefix, filenames });
    }
  }
  return dups.sort((a, b) => a.prefix.localeCompare(b.prefix, undefined, { numeric: true }));
}

function findCrossDirCollisions(dirResults) {
  // Map prefix -> [{directory, filenames}]
  const byPrefix = new Map();
  for (const dirResult of dirResults) {
    if (!dirResult.exists) continue;
    const localByPrefix = new Map();
    for (const f of dirResult.files) {
      if (f.prefixRaw === null) continue;
      if (!localByPrefix.has(f.prefixRaw)) localByPrefix.set(f.prefixRaw, []);
      localByPrefix.get(f.prefixRaw).push(f.filename);
    }
    for (const [prefix, filenames] of localByPrefix.entries()) {
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
      byPrefix.get(prefix).push({ directory: dirResult.dir.split(path.sep).join("/"), filenames });
    }
  }
  const collisions = [];
  for (const [prefix, entries] of byPrefix.entries()) {
    if (entries.length > 1) {
      collisions.push({ prefix, entries });
    }
  }
  return collisions.sort((a, b) => a.prefix.localeCompare(b.prefix, undefined, { numeric: true }));
}

function findOtherMigrationDirs() {
  // Best-effort repo-wide search for any other directory literally named
  // "migrations" (case-insensitive), excluding node_modules/.next and the
  // two known dirs.
  let found = [];
  try {
    const raw = execSync(
      'powershell -NoProfile -Command "Get-ChildItem -Recurse -Directory -Filter migrations -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch \'node_modules|\\\\.next\' } | Select-Object -ExpandProperty FullName"',
      { encoding: "utf8", cwd: process.cwd() },
    );
    found = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    found = [`<search failed: ${err.message}>`];
  }
  return found;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const dirResults = KNOWN_DIRS.map(inventoryDir);

  const perDirectory = dirResults.map((dr) => ({
    directory: dr.dir.split(path.sep).join("/"),
    exists: dr.exists,
    fileCount: dr.files.length,
    files: dr.files,
    withinDirectoryDuplicates: findWithinDirDuplicates(dr.files),
    sequenceGaps: findSequenceGaps(dr.files),
  }));

  const crossDirectoryCollisions = findCrossDirCollisions(dirResults);

  const otherDirsFoundRaw = findOtherMigrationDirs();
  const knownDirsNormalized = KNOWN_DIRS.map((d) => path.resolve(d));
  const otherDirsFound = otherDirsFoundRaw.filter((p) => {
    if (p.startsWith("<search failed")) return true;
    const resolved = path.resolve(p);
    if (knownDirsNormalized.includes(resolved)) return false;
    return true;
  });
  const worktreeDirs = otherDirsFound.filter((p) => /\.claude[\\/]worktrees/i.test(p));
  const trulyOtherDirs = otherDirsFound.filter((p) => !/\.claude[\\/]worktrees/i.test(p));

  const totalFiles = perDirectory.reduce((sum, d) => sum + d.fileCount, 0);

  const output = {
    generatedAt: new Date().toISOString(),
    knownDirectories: KNOWN_DIRS.map((d) => d.split(path.sep).join("/")),
    perDirectory,
    crossDirectoryCollisions,
    otherMigrationDirectoriesFound: {
      note:
        "Repo-wide search for any directory literally named 'migrations'. Git worktree " +
        "checkouts (.claude/worktrees/**) are OTHER BRANCHES' working copies of this same " +
        "repository (confirmed via `git worktree list`), not independent migration sources " +
        "that could have reached production -- listed here for transparency, excluded from " +
        "the collision/gap analysis above.",
      gitWorktreeCopiesExcluded: worktreeDirs,
      otherDirectoriesNotYetKnown: trulyOtherDirs,
    },
    summary: {
      totalFilesAcrossKnownDirectories: totalFiles,
      crossDirectoryCollisionCount: crossDirectoryCollisions.length,
      withinDirectoryDuplicateCount: perDirectory.reduce(
        (sum, d) => sum + d.withinDirectoryDuplicates.length,
        0,
      ),
      sequenceGapCountByDirectory: Object.fromEntries(
        perDirectory.map((d) => [d.directory, d.sequenceGaps.missing.length]),
      ),
    },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  total files (known dirs): ${totalFiles}`);
  for (const d of perDirectory) {
    console.log(
      `  ${d.directory}: ${d.fileCount} files, ${d.withinDirectoryDuplicates.length} within-dir duplicate prefix(es), ` +
        `${d.sequenceGaps.missing.length} sequence gap(s) (range ${d.sequenceGaps.min}-${d.sequenceGaps.max})`,
    );
  }
  console.log(`  cross-directory prefix collisions: ${crossDirectoryCollisions.length}`);
  console.log(`  git worktree migration dirs excluded: ${worktreeDirs.length}`);
  console.log(`  other, not-yet-known migration dirs: ${trulyOtherDirs.length}`);
}

main();
