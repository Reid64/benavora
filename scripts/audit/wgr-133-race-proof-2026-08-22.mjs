// WGR-133 root-cause confirmation (2026-08-22): proves the exact race
// mechanism ResetPasswordPageClient.tsx's old code hit -- two concurrent
// exchangeCodeForSession(code) calls against the SAME single-use PKCE code,
// using the SAME client instance (so both share the one stored
// code_verifier, exactly mirroring React Strict Mode double-invoking the
// same component instance's mount effect twice). Driven entirely from Node
// (reliable connectivity in this sandbox) rather than a browser, since
// Playwright/Chromium's direct cross-origin calls to Supabase's Auth API
// were confirmed unreliable in this sandbox during this session (repeated
// silent failures -- zero new auth.flow_state rows, zero
// auth.audit_log_entries rows -- despite the client reporting success).
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
const EMAIL = "info@faithfoundationsf.org";

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { flowType: "pkce", autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

async function main() {
  console.log("Requesting a real password recovery (PKCE) from Node directly...");
  const { error: reqError } = await client.auth.resetPasswordForEmail(EMAIL, {
    redirectTo: "http://localhost:3103/reset-password",
  });
  if (reqError) throw new Error(`resetPasswordForEmail failed: ${reqError.message}`);
  console.log("Requested OK. Reading the real auth_code from auth.flow_state...");

  const { Client: PgClient } = await import("pg");
  const pg = new PgClient({ connectionString: env.DATABASE_URL });
  await pg.connect();
  const { rows } = await pg.query(
    `SELECT auth_code, created_at FROM auth.flow_state
     WHERE authentication_method = 'recovery'
     ORDER BY created_at DESC LIMIT 1`,
  );
  await pg.end();
  const authCode = rows[0]?.auth_code;
  console.log("Found auth_code:", authCode, "created_at:", rows[0]?.created_at);
  if (!authCode) throw new Error("No flow_state row found -- resetPasswordForEmail did not reach GoTrue.");

  console.log("\nFiring TWO concurrent exchangeCodeForSession(code) calls on the SAME client instance");
  console.log("(mirrors React Strict Mode double-invoking one component's mount effect twice)...\n");

  const [first, second] = await Promise.allSettled([
    client.auth.exchangeCodeForSession(authCode),
    client.auth.exchangeCodeForSession(authCode),
  ]);

  function describe(label, result) {
    if (result.status === "rejected") {
      console.log(`${label}: REJECTED -- ${result.reason}`);
      return;
    }
    const { data, error } = result.value;
    console.log(`${label}: session=${!!data?.session} error=${error ? error.message : "none"}`);
  }
  describe("Call A", first);
  describe("Call B", second);

  const aOk = first.status === "fulfilled" && !first.value.error && !!first.value.data?.session;
  const bOk = second.status === "fulfilled" && !second.value.error && !!second.value.data?.session;

  console.log(`\nExactly one call succeeded: ${aOk !== bOk ? "YES (confirms the real single-use PKCE race)" : "NO"}`);
  console.log(
    "This is exactly the mechanism the old ResetPasswordPageClient.tsx hit: one invocation's exchange",
    "succeeds, the other's fails with a consumed-code error and (in the old code) unconditionally set",
    "linkError=true even though the exchange, overall, succeeded. The fix (exchangedRef guard) makes the",
    "component only ever call exchangeCodeForSession once per mount, so it always takes the winning path.",
  );
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
