// Sets a specific password on the FAITH Foundation test account (user id
// b3ef4d39-fdc2-4d3a-9e93-1e1888b576b4, info@faithfoundationsf.org) via the
// Supabase service-role admin client, then immediately verifies it with a
// real signInWithPassword call and reports the actual session result.
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

const USER_ID = "b3ef4d39-fdc2-4d3a-9e93-1e1888b576b4";
const EMAIL = "info@faithfoundationsf.org";
const NEW_PASSWORD = "Fasterman1945#@#";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`[1] updateUserById(${USER_ID}) setting new password...`);
  const { data: updData, error: updErr } = await admin.auth.admin.updateUserById(USER_ID, {
    password: NEW_PASSWORD,
  });
  if (updErr) {
    console.log("[1] FAIL — updateUserById errored:");
    console.log(JSON.stringify(updErr, null, 2));
    process.exit(1);
  }
  console.log(`[1] OK — updateUserById succeeded. Returned user.id=${updData.user?.id}, email=${updData.user?.email}`);

  console.log(`\n[2] signInWithPassword(${EMAIL}, <new password>)...`);
  const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
    email: EMAIL,
    password: NEW_PASSWORD,
  });

  if (signInErr) {
    console.log("[2] FAIL — signInWithPassword errored:");
    console.log(JSON.stringify(signInErr, null, 2));
    process.exit(1);
  }

  const session = signInData.session;
  const user = signInData.user;
  const idMatches = user?.id === USER_ID;
  const hasAccessToken = typeof session?.access_token === "string" && session.access_token.length > 20;

  console.log("[2] Response received:");
  console.log(`    user.id            = ${user?.id}`);
  console.log(`    user.email         = ${user?.email}`);
  console.log(`    id matches target? = ${idMatches}`);
  console.log(`    access_token       = ${session?.access_token ? session.access_token.slice(0, 24) + "..." + session.access_token.slice(-8) : null}`);
  console.log(`    token_type         = ${session?.token_type}`);
  console.log(`    expires_at         = ${session?.expires_at}`);
  console.log(`    refresh_token pres.= ${typeof session?.refresh_token === "string" && session.refresh_token.length > 10}`);

  if (idMatches && hasAccessToken) {
    console.log("\n=== RESULT: PASS — real session returned, user.id matches target ===");
  } else {
    console.log("\n=== RESULT: FAIL — session missing or user.id mismatch ===");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
