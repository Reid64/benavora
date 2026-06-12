import { readFileSync } from "node:fs";

const TOKEN = readFileSync(process.env.SB_TOKEN_FILE, "utf8").trim();
const REF = "vbjplpquqxxfbpazyalt";

async function runSql(label, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  console.log(`[${label}] HTTP ${res.status}: ${text.slice(0, 500)}`);
  if (!res.ok) process.exit(1);
}

const files = [
  "supabase/migrations/001_initial_schema.sql",
  "supabase/migrations/002_register_organization.sql",
  "supabase/migrations/003_onboarding.sql",
];
for (const f of files) {
  // SQL-language functions (current_org_id) reference tables created later in
  // the same migration; disable body validation so creation order doesn't matter.
  const sql = "SET check_function_bodies = off;\n" + readFileSync(f, "utf8");
  await runSql(f, sql);
}
console.log("DONE");
