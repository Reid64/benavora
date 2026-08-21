// WGR-156 remediation: export every donor_discovery_prospects row for the
// target org to a gzipped CSV before any deletion, plus a sha256 + row
// count so the backup is independently verifiable later.
import { spawn } from "node:child_process";
import { createWriteStream, createReadStream } from "node:fs";
import { createGzip } from "node:zlib";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: ".env.local" });

const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const TIMESTAMP = "20260821T164815Z";
const OUT_DIR = "test-evidence/remediation/wgr-156";
const OUT_FILE = path.join(OUT_DIR, `prospects-backup-${TIMESTAMP}.csv.gz`);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const sql = `\\copy (SELECT * FROM donor_discovery_prospects WHERE organization_id = '${ORG_ID}' ORDER BY created_at) TO STDOUT WITH CSV HEADER`;

  await new Promise((resolve, reject) => {
    const psql = spawn("psql", [databaseUrl, "-c", sql], {
      env: { ...process.env },
    });
    const gzip = createGzip();
    const out = createWriteStream(OUT_FILE);

    let stderr = "";
    psql.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    psql.stdout.pipe(gzip).pipe(out);

    out.on("finish", () => resolve());
    psql.on("error", reject);
    out.on("error", reject);
    psql.on("close", (code) => {
      if (code !== 0) reject(new Error(`psql exited ${code}: ${stderr}`));
    });
  });

  // Row count: count real CSV data lines (gunzip and count, minus 1 header).
  const rowCount = await new Promise((resolve, reject) => {
    const gunzip = spawn("gzip", ["-dc", OUT_FILE]);
    let lineCount = 0;
    let buf = "";
    gunzip.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        lineCount++;
        buf = buf.slice(idx + 1);
      }
    });
    gunzip.on("close", (code) => {
      if (code !== 0) return reject(new Error("gzip -dc failed"));
      if (buf.length > 0) lineCount++;
      resolve(lineCount - 1); // minus header row
    });
    gunzip.on("error", reject);
  });

  // sha256 of the compressed backup file itself.
  const sha256 = await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(OUT_FILE);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });

  console.log(JSON.stringify({ file: OUT_FILE, rowCount, sha256 }, null, 2));
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
