import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import pg from "pg";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
});

async function main() {
  const { count: propensityCount, error: propErr } = await admin
    .from("propensity_scores")
    .select("*", { count: "exact", head: true });
  console.log("propensity_scores total rows:", propensityCount, propErr?.message || "");

  const { count: narrativeCount, error: narrErr } = await admin
    .from("proven_narratives")
    .select("*", { count: "exact", head: true });
  console.log("proven_narratives total rows:", narrativeCount, narrErr?.message || "");

  const { data: narrByOrg, error: narrOrgErr } = await admin
    .from("proven_narratives")
    .select("organization_id")
    .limit(1000);
  if (!narrOrgErr) {
    const byOrg = {};
    for (const r of narrByOrg) byOrg[r.organization_id] = (byOrg[r.organization_id] || 0) + 1;
    console.log("proven_narratives by org:", byOrg);
  }

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const constraintCheck = await client.query(`
    SELECT conname, contype FROM pg_constraint
    WHERE conrelid = 'success_probability_scores'::regclass AND contype = 'u'
  `);
  console.log("success_probability_scores unique constraints:", constraintCheck.rows);
  await client.end();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
