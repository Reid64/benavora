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
const BASE_URL = "https://www.benavora.com";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAndGetCookies() {
  const email = "info@faithfoundationsf.org";
  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const location = verifyResp.headers.get("location") || "";
  const hash = location.split("#")[1];
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  return setCookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

const cookieHeader = await loginAndGetCookies();

async function checkPost(path, payload) {
  console.log(`\n>>> POST ${path} (starting, up to 290s)...`);
  const start = Date.now();
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(290000),
  });
  const elapsed = Date.now() - start;
  const body = await resp.text();
  console.log(`=== POST ${path} => ${resp.status} (${elapsed}ms) ===`);
  console.log("content-type:", resp.headers.get("content-type"));
  console.log("x-vercel-error:", resp.headers.get("x-vercel-error"));
  console.log("body:", body.slice(0, 2000));
}

await checkPost("/api/intelligence/strategic-advisor", {});
await checkPost("/api/intelligence/community-need", {});
