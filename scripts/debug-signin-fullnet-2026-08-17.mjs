// Follow-up debug: same as debug-signin-2026-08-17.mjs but logs EVERY request
// (no filter) plus request timing, to see what happens to the router.replace("/dashboard")
// navigation after a successful password sign-in.
import { chromium } from "playwright";
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
const BASE_URL = "http://localhost:3000";
const EMAIL = "info@faithfoundationsf.org";
const TEST_PASSWORD = "TempDebugPw!2026Aug17c";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: userList, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) throw listErr;
  const targetUser = userList.users.find((u) => u.email === EMAIL);
  if (!targetUser) throw new Error(`No auth user found for ${EMAIL}`);
  const { error: updErr } = await admin.auth.admin.updateUserById(targetUser.id, { password: TEST_PASSWORD });
  if (updErr) throw updErr;
  console.log(`[setup] Set temp password for ${EMAIL}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const start = Date.now();
  const netLog = [];
  page.on("request", (req) => {
    netLog.push({ t: Date.now() - start, phase: "request", url: req.url(), method: req.method(), resourceType: req.resourceType() });
  });
  page.on("requestfinished", async (req) => {
    const resp = await req.response().catch(() => null);
    netLog.push({
      t: Date.now() - start,
      phase: "finished",
      url: req.url(),
      status: resp ? resp.status() : null,
    });
  });
  page.on("requestfailed", (req) => {
    netLog.push({ t: Date.now() - start, phase: "failed", url: req.url(), failure: req.failure()?.errorText });
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      netLog.push({ t: Date.now() - start, phase: "framenavigated", url: frame.url() });
    }
  });

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 30000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", TEST_PASSWORD);
  console.log(`[click] t=${Date.now() - start}ms`);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(20000);
  console.log(`[after-wait] url=${page.url()} t=${Date.now() - start}ms`);

  console.log("\n=== FULL NETWORK/NAV TIMELINE ===");
  console.log(JSON.stringify(netLog, null, 2));

  await browser.close();
  const randomPw = `revoked-${Math.random().toString(36).slice(2)}!Ax`;
  await admin.auth.admin.updateUserById(targetUser.id, { password: randomPw });
  console.log("[cleanup] done");
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
