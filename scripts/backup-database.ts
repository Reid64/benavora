// ============================================================================
// BENAVORA — Off-provider database backups (Supabase Postgres -> AWS S3)
//
// Supabase PITR only protects against Supabase-side incidents (account lock,
// billing dispute, regional outage, accidental project deletion). This script
// streams a full `pg_dump` off the Supabase host directly into S3 so a copy
// of prod exists outside Supabase entirely. Bucket-level durability (object
// versioning, cross-region replication, 90-day retention) is provisioned
// separately — see infra/aws/backup-bucket/README.md — this script only
// produces and uploads the dump.
//
// Credentials never touch argv or a shell string: DATABASE_URL is parsed in
// Node and the password is passed to pg_dump via the PGPASSWORD env var
// (argv is visible to other processes on the same host via `ps`; env vars of
// a child process are not). The dump is streamed pg_dump -> gzip -> S3
// multipart upload with no local temp file, so this is safe to run against a
// prod-sized database on a small CI/Railway container.
//
//   npx tsx scripts/backup-database.ts            # daily backup
//   npx tsx scripts/backup-database.ts --weekly    # weekly-tagged backup
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const S3_BUCKET = process.env.BACKUP_S3_BUCKET ?? "benavora-prod-backups";
const S3_REGION = process.env.BACKUP_S3_REGION ?? "us-east-1";

export type BackupSchedule = "daily" | "weekly";

export interface BackupResult {
  bucket: string;
  key: string;
  schedule: BackupSchedule;
}

function parseDatabaseUrl(raw: string) {
  const url = new URL(raw);
  if (!url.password) {
    throw new Error("DATABASE_URL has no password component");
  }
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "postgres",
  };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function backupDatabase(schedule: BackupSchedule = "daily"): Promise<BackupResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  const { host, port, user, password, database } = parseDatabaseUrl(databaseUrl);

  const stamp = timestamp();
  const key = `database-dumps/${schedule}/prod-${stamp}.sql.gz`;

  console.log(`[backup-database] starting ${schedule} pg_dump of ${database}@${host} -> s3://${S3_BUCKET}/${key}`);

  const dump = spawn(
    "pg_dump",
    ["-h", host, "-p", port, "-U", user, "-d", database, "--no-password", "-F", "p"],
    { env: { ...process.env, PGPASSWORD: password } },
  );

  let stderr = "";
  dump.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const gzip = createGzip();
  dump.stdout.pipe(gzip);

  // pg_dump exiting non-zero must not let the S3 upload complete "normally"
  // with a truncated file. dump.stdout ending is indistinguishable from a
  // clean finish to a plain .pipe(), so on a bad exit we actively error the
  // gzip stream — that propagates into the Upload's Body and fails it,
  // instead of silently uploading a partial dump as if it were valid.
  dump.once("close", (code) => {
    if (code !== 0) {
      gzip.destroy(new Error(`pg_dump exited with code ${code}: ${stderr.trim()}`));
    }
  });
  dump.once("error", (err) => {
    gzip.destroy(err);
  });

  const s3 = new S3Client({ region: S3_REGION });
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: S3_BUCKET,
      Key: key,
      Body: gzip,
      ServerSideEncryption: "AES256",
      Metadata: { "backup-type": "full", "backup-schedule": schedule, timestamp: stamp },
      Tagging: `backup-schedule=${schedule}`,
    },
  });

  try {
    await upload.done();
  } catch (err) {
    // Best-effort: if the failure happened after a multipart upload was
    // already initiated, clean up the incomplete parts rather than leaving
    // them for the lifecycle rule's AbortIncompleteMultipartUpload to catch
    // up to in 7 days.
    await upload.abort().catch(() => {});
    throw err instanceof Error ? err : new Error(String(err));
  }

  console.log(`[backup-database] uploaded s3://${S3_BUCKET}/${key}`);
  return { bucket: S3_BUCKET, key, schedule };
}

async function main() {
  const schedule: BackupSchedule = process.argv.includes("--weekly") ? "weekly" : "daily";
  try {
    await backupDatabase(schedule);
  } catch (error) {
    console.error(`[backup-database] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
