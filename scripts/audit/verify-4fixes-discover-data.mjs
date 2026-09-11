import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

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
  console.log("SUPABASE URL:", url);

  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .select("id, name")
    .limit(5);
  console.log("\n== organizations ==", orgErr?.message || "");
  console.log(orgs);

  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, email, organization_id, role")
    .limit(10);
  console.log("\n== profiles ==", profErr?.message || "");
  console.log(profiles);

  const { data: opps, error: oppErr } = await admin
    .from("opportunities")
    .select("*")
    .eq("organization_id", "b1ab7402-dfc2-4712-869f-70ea3566cc1d")
    .limit(3);
  console.log("\n== opportunities (FAITH org) ==", oppErr?.message || "");
  console.log(JSON.stringify(opps, null, 2));

  const { data: apps, error: appErr } = await admin
    .from("applications")
    .select("id, organization_id, opportunity_id, stage, assigned_user_id, submitted_at, awarded_amount")
    .eq("organization_id", "b1ab7402-dfc2-4712-869f-70ea3566cc1d")
    .limit(10);
  console.log("\n== applications (FAITH org) ==", appErr?.message || "");
  console.log(JSON.stringify(apps, null, 2));

  const { data: prospects, error: prospErr } = await admin
    .from("corporate_prospects")
    .select("id, name, enrichment_completed_at, scores_computed_at")
    .not("enrichment_completed_at", "is", null)
    .limit(5);
  console.log("\n== corporate_prospects (enriched) ==", prospErr?.message || "");
  console.log(JSON.stringify(prospects, null, 2));

  const { data: funders, error: fundErr } = await admin
    .from("funder_relationships")
    .select("*")
    .limit(5);
  console.log("\n== funder_relationships (guess table) ==", fundErr?.message || "");
  console.log(funders);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
