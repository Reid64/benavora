// Creates real Donor Discovery requests through the real, authenticated
// POST /api/donor-discovery/requests route (magic-link auth as
// info@faithfoundationsf.org), exactly like the "New Discovery" wizard
// does. Two requests:
//   1. Literally as task-specified: geography {states:["TX"]} -- documents
//      the real UI/worker geography-support mismatch live.
//   2. Adapted to a working radius geography (Houston, TX, 30mi -- Places
//      API hard-caps radius at ~31mi, so "all of TX" is not achievable in
//      one real request) -- the one expected to actually complete.
// Both use the same 3 NAICS taxonomy nodes chosen as the closest real
// analogs to NTEE P/X/L (no NTEE taxonomy exists in this system):
//   813110 Religious Organizations            (X religion-related)
//   624230 Emergency and Other Relief Services (P human services)
//   624229 Other Community Housing Services    (L housing)
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
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

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const NAICS_TAXONOMY_IDS = [
  "1f3bd5f4-53de-4400-b034-d273fc3392fb", // 813110 Religious Organizations
  "5cd58a03-e6a8-4c24-b994-451273f86666", // 624230 Emergency and Other Relief Services
  "b054acec-891f-4585-8b26-debd5b03ca81", // 624229 Other Community Housing Services
];

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

  // Request A: literally as task-specified (states geography) -- expect
  // 201 then a real worker-side failure once claimed.
  const bodyA = {
    name: "TX Human Services/Religion/Housing (states geography, WGR test)",
    taxonomy_ids: NAICS_TAXONOMY_IDS,
    geography: { states: ["TX"] },
  };
  const respA = await fetch(`${BASE_URL}/api/donor-discovery/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify(bodyA),
  });
  const jsonA = await respA.json();
  console.log("Request A (states geography) ->", respA.status, JSON.stringify(jsonA));

  // Request B: adapted radius geography around Houston, TX -- expected to
  // actually complete through the real pipeline.
  const bodyB = {
    name: "TX Human Services/Religion/Housing (Houston 30mi radius)",
    taxonomy_ids: NAICS_TAXONOMY_IDS,
    geography: { center: { lat: 29.7604, lng: -95.3698 }, radius_mi: 30 },
  };
  const respB = await fetch(`${BASE_URL}/api/donor-discovery/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify(bodyB),
  });
  const jsonB = await respB.json();
  console.log("Request B (radius geography) ->", respB.status, JSON.stringify(jsonB));

  writeFileSync(
    "test-evidence/remediation/dd-real-run/request-creation.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        requestA: { body: bodyA, status: respA.status, response: jsonA },
        requestB: { body: bodyB, status: respB.status, response: jsonB },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
