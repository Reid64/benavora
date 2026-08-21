// Creates one real Donor Discovery request through the real, authenticated
// POST /api/donor-discovery/requests route (magic-link auth as
// info@faithfoundationsf.org): states [TX], NTEE [P, X, L],
// assets >= 1,000,000, limit 200 (WGR-158/159 post-fix verification run).
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
const COOKIE_DOMAIN = "www.benavora.com";
const OUT_DIR = "test-evidence/remediation/dd-real-run-2";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// NTEE major-group taxonomy ids (migration 142).
const NTEE_TAXONOMY_IDS = {
  P: "544eff35-8e7e-45b8-adfb-da23ad1c45af",
  X: "35775d98-0bfc-4828-a3dc-519c7dabd637",
  L: "ce438d8e-80fd-4989-9f5d-2e012572dcbb",
};

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
  if (!access_token || !refresh_token) throw new Error("No tokens in magic-link redirect: " + location);
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  return setCookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function main() {
  const cookieHeader = await loginAndGetCookies();

  const body = {
    name: "TX Human Services/Religion/Housing >= $1M assets (post-fix run)",
    taxonomy_ids: [NTEE_TAXONOMY_IDS.P, NTEE_TAXONOMY_IDS.X, NTEE_TAXONOMY_IDS.L],
    geography: { states: ["TX"], min_assets: 1_000_000, limit: 200 },
  };

  const resp = await fetch(`${BASE_URL}/api/donor-discovery/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  console.log("Request ->", resp.status, JSON.stringify(json));

  writeFileSync(
    `${OUT_DIR}/request-creation.json`,
    JSON.stringify({ createdAt: new Date().toISOString(), body, status: resp.status, response: json }, null, 2),
  );
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
