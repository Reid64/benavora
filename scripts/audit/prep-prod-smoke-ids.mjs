// One-off helper: find a real opportunity id for Faith Foundation (for the
// /api/ai/draft smoke check) and 3 real donor_discovery_directory prospect
// ids for that same org (for the /donor-discovery/prospects/[id] smoke
// check). Prints JSON to stdout only -- no writes.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

function loadEnv() {
  const raw = readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}
const env = loadEnv();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("id, organization_id")
    .eq("email", "info@faithfoundationsf.org")
    .maybeSingle();
  if (profErr || !profile) {
    console.log(JSON.stringify({ error: "profile lookup failed", profErr }));
    return;
  }
  const orgId = profile.organization_id;

  const { data: opp } = await admin
    .from("opportunities")
    .select("id, name")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: prospects } = await admin
    .from("donor_discovery_prospects")
    .select("id")
    .eq("organization_id", orgId)
    .limit(3);

  console.log(JSON.stringify({ orgId, opportunity: opp, prospects }, null, 2));
}
main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
