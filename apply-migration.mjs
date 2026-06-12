// Apply a SINGLE migration file to the linked Supabase project via the
// Management API. Mirrors deploy-migrations.mjs but takes one file as an
// argument, so already-applied (non-idempotent) migrations aren't re-run.
//
// Usage (PowerShell):
//   $env:SB_TOKEN_FILE="C:\path\to\supabase-access-token.txt"
//   node apply-migration.mjs supabase/migrations/003_onboarding.sql
//
// The token file should contain a Supabase personal access token (sbp_...).

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node apply-migration.mjs <path-to-migration.sql>");
  process.exit(1);
}
if (!process.env.SB_TOKEN_FILE) {
  console.error("Set SB_TOKEN_FILE to a file containing your Supabase access token (sbp_...).");
  process.exit(1);
}

const TOKEN = readFileSync(process.env.SB_TOKEN_FILE, "utf8").trim();
const REF = "vbjplpquqxxfbpazyalt";

const sql = "SET check_function_bodies = off;\n" + readFileSync(file, "utf8");

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
console.log(`[${file}] HTTP ${res.status}: ${text.slice(0, 500)}`);
process.exit(res.ok ? 0 : 1);
