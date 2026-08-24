// Debug script: reproduce the reported "Sign In does nothing" bug on the real
// /login page (password auth), against a fresh localhost dev server.
// Sets a known temporary password on the FAITH Foundation test account via the
// admin API (this project's standing e2e test account per memory), then drives
// the actual UI: types credentials, clicks the real Sign In button, and logs
// every console message, every network request/response involving auth, and
// the final URL.
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
const TEST_PASSWORD = "TempDebugPw!2026Aug17";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // Find the user's id, set a known password so we can exercise the real
  // signInWithPassword() path the UI actually calls.
  const { data: userList, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) throw listErr;
  const targetUser = userList.users.find((u) => u.email === EMAIL);
  if (!targetUser) throw new Error(`No auth user found for ${EMAIL}`);
  const { error: updErr } = await admin.auth.admin.updateUserById(targetUser.id, { password: TEST_PASSWORD });
  if (updErr) throw updErr;
  console.log(`[setup] Set temp password for ${EMAIL} (user id ${targetUser.id})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleMsgs = [];
  page.on("console", (msg) => consoleMsgs.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => consoleMsgs.push({ type: "pageerror", text: err.stack || String(err) }));

  const netLog = [];
  page.on("requestfinished", async (req) => {
    const url = req.url();
    if (!/supabase|\/api\/auth|\/api\/audit/.test(url)) return;
    try {
      const resp = await req.response();
      let body = null;
      try { body = await resp.text(); } catch {}
      netLog.push({
        url,
        method: req.method(),
        status: resp ? resp.status() : null,
        statusText: resp ? resp.statusText() : null,
        bodySnippet: body ? body.slice(0, 500) : null,
      });
    } catch (e) {
      netLog.push({ url, method: req.method(), error: String(e) });
    }
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (!/supabase|\/api\/auth|\/api\/audit/.test(url)) return;
    netLog.push({ url, method: req.method(), failure: req.failure()?.errorText });
  });

  console.log(`[nav] going to ${BASE_URL}/login`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 30000 });
  console.log(`[nav] loaded, url=${page.url()}`);

  await page.fill("#email", EMAIL);
  await page.fill("#password", TEST_PASSWORD);

  const urlBeforeClick = page.url();
  console.log(`[click] clicking Sign in button, url before=${urlBeforeClick}`);
  await page.click('button[type="submit"]');

  // Give it a generous window to react (navigate, show error, etc).
  await page.waitForTimeout(5000);

  const urlAfterClick = page.url();
  console.log(`[result] url after click + 5s wait = ${urlAfterClick}`);
  console.log(`[result] navigated? ${urlAfterClick !== urlBeforeClick}`);

  const bodyText = await page.evaluate(() => document.body.innerText);
  const errorBanner = await page.evaluate(() => {
    const el = document.querySelector('[role="alert"]');
    return el ? el.textContent : null;
  });
  console.log(`[result] visible error banner: ${errorBanner}`);

  const buttonText = await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    return btn ? btn.textContent : null;
  });
  console.log(`[result] submit button text now: ${buttonText}`);

  await page.screenshot({ path: "smoke-test-output/signin-bug-after-click-2026-08-17.png", fullPage: true });

  console.log("\n=== CONSOLE MESSAGES ===");
  console.log(JSON.stringify(consoleMsgs, null, 2));

  console.log("\n=== NETWORK LOG (supabase/auth/audit only) ===");
  console.log(JSON.stringify(netLog, null, 2));

  await browser.close();

  // Restore: revert the account back to a state that won't leave a guessable
  // static password sitting on a real org's account. Generate a random, unused
  // password so nobody can sign in with the one printed in this log.
  const randomPw = `revoked-${Math.random().toString(36).slice(2)}${Date.now() % 100000}!Ax`;
  const { error: revertErr } = await admin.auth.admin.updateUserById(targetUser.id, { password: randomPw });
  if (revertErr) console.log(`[cleanup] WARNING: failed to revert password: ${revertErr.message}`);
  else console.log(`[cleanup] Reverted ${EMAIL} to a random unknown password (magic-link login still works for future smoke tests).`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
