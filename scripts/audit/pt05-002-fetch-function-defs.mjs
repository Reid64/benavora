// Fetch the real definition of public.current_org_id() (and any sibling helper
// functions referenced by the fetched RLS policies) from production, read-only,
// so the local PT-05 stack can replicate the exact real enforcement logic
// instead of a guessed equivalent.
import fs from "node:fs";
import pg from "pg";

function loadEnv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv(".env.local");
const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await client.connect();
await client.query("SET default_transaction_read_only = on");

const res = await client.query(`
  select p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('current_org_id')
`);
const lines = [];
for (const row of res.rows) {
  lines.push("=== " + row.proname + " ===");
  lines.push(row.def);
  lines.push("");
}
await client.end();

const out = lines.join("\n") + "\n";
console.log(out);
fs.mkdirSync("test-evidence/pt-05", { recursive: true });
fs.writeFileSync("test-evidence/pt-05/current_org_id-function-def.txt", out, "utf8");
console.log("Wrote test-evidence/pt-05/current_org_id-function-def.txt");
