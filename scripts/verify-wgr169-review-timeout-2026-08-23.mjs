// WGR-169 fix verification: POST /api/ai/review against the same real
// 41,949-char draft (application 61c21595-9aea-4c45-a82e-3c7ace99bc73) that
// originally reproduced the 60s timeout, against a local `pnpm dev` server
// running the fixed ReviewAgent (timeoutMs 270_000). Self-contained: spawns
// and reaps its own dev-server child, nothing left running afterward.
import { spawn } from "node:child_process";
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
const BASE_URL = "http://localhost:3000";
const OUT_DIR = "test-evidence/remediation/wgr-169";
mkdirSync(OUT_DIR, { recursive: true });

const APPLICATION_ID = "61c21595-9aea-4c45-a82e-3c7ace99bc73";

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(BASE_URL)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) reject(new Error("dev server did not become ready in time"));
          else setTimeout(tryOnce, 1000);
        });
    };
    tryOnce();
  });
}

async function loginAndGetCookies() {
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
  const server = spawn("pnpm", ["run", "dev"], {
    cwd: process.cwd(),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});

  const report = { applicationId: APPLICATION_ID, timestamp: new Date().toISOString() };
  try {
    await waitForServer(60000);
    const cookieHeader = await loginAndGetCookies();

    const t0 = Date.now();
    const resp = await fetch(`${BASE_URL}/api/ai/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ applicationId: APPLICATION_ID }),
      signal: AbortSignal.timeout(290000),
    });
    const elapsedMs = Date.now() - t0;
    const body = await resp.json().catch(() => ({}));

    report.httpStatus = resp.status;
    report.elapsedMs = elapsedMs;
    report.timedOut = resp.status === 504 || body?.code === "timeout";
    report.bodyKeys = Object.keys(body ?? {});
    report.overallReadiness = body?.overallReadiness ?? null;

    console.log(`[review] status=${resp.status} elapsedMs=${elapsedMs} timedOut=${report.timedOut}`);
  } finally {
    server.kill("SIGTERM");
  }

  writeFileSync(`${OUT_DIR}/verify.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("FATAL", err.message);
  process.exitCode = 1;
});
