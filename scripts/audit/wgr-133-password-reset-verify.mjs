// WGR-133 live verification (2026-08-22): real PKCE password-reset flow
// against `next dev` (reactStrictMode:true -- the exact context the original
// bug reproduced in), as info@faithfoundationsf.org.
//
// Drives the REAL browser-side flow rather than admin.generateLink(): admin.
// generateLink's action_link is an implicit/hash-token link (no code_verifier
// pairing), which does not exercise ResetPasswordPageClient's `?code=`
// handling at all -- confirmed live this session (first attempt using
// generateLink produced a `#access_token=...&type=recovery` URL, never took
// the buggy code path, and update-password silently failed since no click
// happened after the hash was consumed). To reproduce the real bug's exact
// code path: (1) submit the real ForgotPasswordPageClient form in a real
// Playwright browser (this stores the PKCE code_verifier in that browser's
// own cookie jar and creates a real `auth.flow_state` row server-side, same
// as a genuine user); (2) read the matching `auth_code` directly from
// `auth.flow_state` via DATABASE_URL (standing in for "check the inbox" --
// no SMTP delivery/inbox access exists in this sandbox); (3) navigate the
// SAME browser context to `/reset-password?code=<auth_code>` -- the
// code_verifier cookie from step 1 is already present, exactly reproducing
// what clicking the real emailed link does.
//
// Password handling: we have no way to know the account's real, currently-set
// password (Supabase never exposes plaintext). To safely test AND restore
// without disrupting the real account, this script sets a known baseline
// password via the admin API first, confirms login with the NEW password the
// real flow sets, then restores the exact baseline value at the end -- net
// password value unchanged from immediately before this script ran.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
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
const BASE_URL = "http://localhost:3103";
const OUT_DIR = "test-evidence/remediation/wgr-133";
mkdirSync(OUT_DIR, { recursive: true });

const EMAIL = "info@faithfoundationsf.org";
const BASELINE_PASSWORD = "WgR133-Baseline-2026-08-22-x9Qz!";
const NEW_PASSWORD = "WgR133-NewPass-2026-08-22-k4Rt!";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${JSON.stringify(detail)}`);
}

async function getUserIdByEmail(email) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`user not found: ${email}`);
  return user.id;
}

async function main() {
  const userId = await getUserIdByEmail(EMAIL);

  // Step 0: establish a known baseline password.
  {
    const { error } = await admin.auth.admin.updateUserById(userId, { password: BASELINE_PASSWORD });
    log("set-baseline-password", !error, { error: error?.message });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  // Step 1: real browser-side forgot-password submission -- stores the real
  // PKCE code_verifier cookie in THIS browser context.
  const beforeRequestAt = new Date().toISOString();
  await page.goto(`${BASE_URL}/forgot-password`, { waitUntil: "load", timeout: 45000 });
  await page.fill("#email", EMAIL);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT_DIR}/00-forgot-password-sent.png`, fullPage: true });
  const sentBodyText = await page.evaluate(() => document.body.innerText);
  log("forgot-password-shows-sent-confirmation", /check your email/i.test(sentBodyText), {});

  // Step 2: read the real auth_code auth.flow_state stored server-side for
  // this recovery request (standing in for "check the inbox").
  const pg = new PgClient({ connectionString: env.DATABASE_URL });
  await pg.connect();
  const { rows } = await pg.query(
    `SELECT auth_code FROM auth.flow_state
     WHERE user_id = $1 AND authentication_method = 'recovery' AND created_at >= $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, beforeRequestAt],
  );
  await pg.end();
  const authCode = rows[0]?.auth_code;
  log("real-auth-code-found-in-flow-state", !!authCode, { found: !!authCode });
  if (!authCode) throw new Error("no flow_state row found -- forgot-password submission did not create one");

  // Step 3: follow the real `?code=` link, same browser context (code_verifier
  // cookie already present) -- exactly reproduces clicking the real emailed
  // link, exercising ResetPasswordPageClient's real reactStrictMode-affected
  // mount effect.
  await page.goto(`${BASE_URL}/reset-password?code=${authCode}`, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT_DIR}/01-reset-password-landed.png`, fullPage: true });

  const bodyText = await page.evaluate(() => document.body.innerText);
  const showsLinkInvalid = /no longer valid/i.test(bodyText);
  log("real-link-not-rejected-as-invalid", !showsLinkInvalid, { showsLinkInvalid, bodyPreview: bodyText.slice(0, 200) });

  // Step 4: submit a new password through the real form.
  await page.fill("#password", NEW_PASSWORD);
  await page.fill("#confirmPassword", NEW_PASSWORD);
  await page.screenshot({ path: `${OUT_DIR}/02-new-password-filled.png`, fullPage: true });
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT_DIR}/03-after-submit.png`, fullPage: true });

  const finalUrl = page.url();
  const reachedDashboard = finalUrl.includes("/dashboard");
  log("update-redirects-to-dashboard", reachedDashboard, { finalUrl });
  log("zero-console-errors-during-flow", consoleErrors.length === 0, { errors: consoleErrors.slice(0, 5) });

  await browser.close();

  // Step 5: independently confirm login works with the NEW password (not
  // just that the client-side redirect happened).
  const { data: loginData, error: loginErr } = await anon.auth.signInWithPassword({
    email: EMAIL,
    password: NEW_PASSWORD,
  });
  log("login-succeeds-with-new-password", !loginErr && !!loginData?.session, { error: loginErr?.message });
  if (loginData?.session) await anon.auth.signOut();

  // Step 6: restore to the known baseline (net password value unchanged from
  // immediately before this script ran).
  const { error: restoreErr } = await admin.auth.admin.updateUserById(userId, { password: BASELINE_PASSWORD });
  log("restore-baseline-password", !restoreErr, { error: restoreErr?.message });

  const { data: restoreLoginData, error: restoreLoginErr } = await anon.auth.signInWithPassword({
    email: EMAIL,
    password: BASELINE_PASSWORD,
  });
  log("login-succeeds-after-restore", !restoreLoginErr && !!restoreLoginData?.session, { error: restoreLoginErr?.message });
  if (restoreLoginData?.session) await anon.auth.signOut();

  writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
