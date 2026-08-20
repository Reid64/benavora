// Applies pt09-002-schema-extension.sql to the local pt05-local-stack Postgres
// (never production -- hard-refuses if the connection string contains the
// production ref, same guard pattern as pt05-001-provision-isolation-env.mjs).
//
// Usage: node scripts/audit/pt09-002-apply-schema.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const SQL_PATH = path.join(__dirname, "pt09-002-schema-extension.sql");

function assertNotProduction(connectionString) {
  if (connectionString.includes(PRODUCTION_REF)) {
    throw new Error(`REFUSING: connection string contains production ref "${PRODUCTION_REF}".`);
  }
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`REFUSING: host "${url.hostname}" is not a local target.`);
  }
  return url;
}

async function main() {
  assertNotProduction(LOCAL_DB_URL);
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  const dbInfo = await client.query("select current_database(), inet_server_addr(), inet_server_port()");
  console.log("Connected to:", dbInfo.rows[0]);
  try {
    await client.query(sql);
    console.log("Schema extension applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
