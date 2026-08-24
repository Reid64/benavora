// One-off probe for knw-004 live verification: confirm both test accounts
// exist and capture Faith Foundation's real opportunity titles so the
// isolation check can compare beta1's answer against them.
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
  for (const email of ["info@faithfoundationsf.org", "beta1@benavora-test.com"]) {
    const { data: profile, error } = await admin
      .from("profiles")
      .select("id, organization_id, role")
      .eq("email", email)
      .maybeSingle();
    console.log(email, JSON.stringify(profile), error?.message ?? "");
  }

  const { data: ffProfile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("email", "info@faithfoundationsf.org")
    .maybeSingle();
  if (ffProfile?.organization_id) {
    const { data: opps } = await admin
      .from("opportunities")
      .select("id, name")
      .eq("organization_id", ffProfile.organization_id)
      .limit(20);
    console.log("FAITH_OPPS", JSON.stringify(opps));
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
