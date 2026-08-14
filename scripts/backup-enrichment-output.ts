// ============================================================================
// BENAVORA — enrichment-output/ -> DATAOCEAN (D:\) dated backup
//
// FEATURE_REGISTRY_v2.md row D7 (CRITICAL): enrichment-output/ has never been
// backed up to D:\, so every enrichment/scraper rerun silently overwrites
// whatever the prior run produced with no recovery path. This copies the
// full current contents of enrichment-output/ to a dated subfolder under
// D:\dataocean\enrichment-backups\<YYYY-MM-DD>\, before an enrichment
// script's own writes begin.
//
// Safe to call repeatedly: the destination folder is dated (one per calendar
// day). A PRIOR day's folder is never touched. Calling this again the same
// day re-syncs today's folder — expected, since every enrichment script
// wired to call this does so as its own first step, so a second script
// running later the same day should still snapshot whatever is in
// enrichment-output/ right before ITS writes begin, not silently no-op.
//
// D:\ is a local Windows drive on the dev machine only — it will not exist on
// the Railway worker or in a sandboxed/CI environment. Every caller MUST
// treat a failed/unreachable backup as non-fatal: backupEnrichmentOutput()
// never throws — it returns { ok: false, reason } — log it and continue.
// A missing DATAOCEAN drive must never block a real enrichment run.
//
//   pnpm backup:enrichment
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = path.resolve("./enrichment-output");
const BACKUP_ROOT = process.env.DATAOCEAN_BACKUP_ROOT ?? "D:\\dataocean\\enrichment-backups";

export interface BackupResult {
  ok: boolean;
  reason?: string;
  destDir?: string;
  filesCopied: string[];
  totalBytes: number;
}

function todayStamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Recursively copies srcDir into destDir, preserving structure. Returns total
// bytes copied and appends each copied file's path (relative to baseSrc) to
// filesCopied.
function copyRecursive(srcDir: string, destDir: string, baseSrc: string, filesCopied: string[]): number {
  let bytes = 0;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      bytes += copyRecursive(srcPath, destPath, baseSrc, filesCopied);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      bytes += fs.statSync(destPath).size;
      filesCopied.push(path.relative(baseSrc, srcPath));
    }
  }
  return bytes;
}

export async function backupEnrichmentOutput(): Promise<BackupResult> {
  const filesCopied: string[] = [];

  if (!fs.existsSync(SOURCE_DIR)) {
    const reason = `Source directory does not exist yet: ${SOURCE_DIR} — nothing to back up.`;
    console.log(`[backup-enrichment-output] ${reason}`);
    return { ok: true, reason, filesCopied, totalBytes: 0 };
  }

  const driveRoot = path.parse(BACKUP_ROOT).root; // e.g. "D:\"
  let driveReachable = true;
  try {
    fs.accessSync(driveRoot, fs.constants.F_OK);
  } catch {
    driveReachable = false;
  }

  if (!driveReachable) {
    const reason =
      `DATAOCEAN drive root ${driveRoot} is not reachable from this process. ` +
      `Skipping backup WITHOUT blocking the caller — verify D:\\ is mounted/accessible ` +
      `(this is expected/normal on the Railway worker, which has no D:\\ drive).`;
    console.error(`[backup-enrichment-output] WARNING: ${reason}`);
    return { ok: false, reason, filesCopied, totalBytes: 0 };
  }

  const destDir = path.join(BACKUP_ROOT, todayStamp());

  try {
    const totalBytes = copyRecursive(SOURCE_DIR, destDir, SOURCE_DIR, filesCopied);

    console.log(
      `[backup-enrichment-output] Backed up ${filesCopied.length} file(s), ` +
        `${formatBytes(totalBytes)} total, to ${destDir}`,
    );
    for (const f of filesCopied) {
      console.log(`  - ${f}`);
    }

    return { ok: true, destDir, filesCopied, totalBytes };
  } catch (error) {
    const reason = `Backup copy failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[backup-enrichment-output] WARNING: ${reason}`);
    return { ok: false, reason, filesCopied, totalBytes: 0 };
  }
}

async function main() {
  const result = await backupEnrichmentOutput();
  if (!result.ok) {
    console.error(`\nBackup did not complete: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDone. ${result.filesCopied.length} file(s) backed up${result.destDir ? ` to ${result.destDir}` : ""}.`);
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
