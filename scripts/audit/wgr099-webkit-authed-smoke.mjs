// WGR-099 STEP 3: WebKit smoke test against authenticated dashboard pages,
// via the established magic-link auth pattern (see scripts/audit/ts-01-*.mjs).
import { webkit } from "playwright";
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
const OUT_DIR = "test-evidence/remediation/wgr-099";
mkdirSync(OUT_DIR, { recursive: true });

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
  if (!access_token || !refresh_token) throw new Error("No tokens in magic-link redirect: " + location);
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  return setCookies;
}

const PAGES = [
  { path: "/dashboard", file: "dashboard.png" },
  { path: "/opportunities", file: "opportunities.png" },
  { path: "/draft-generator", file: "draft-generator.png" },
  { path: "/donor-discovery", file: "donor-discovery.png" },
];

async function main() {
  const setCookies = await loginAndGetCookies();
  const cookies = setCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: "www.benavora.com",
    path: c.options?.path || "/",
    httpOnly: !!c.options?.httpOnly,
    secure: true,
    sameSite: "Lax",
  }));

  const browser = await webkit.launch();
  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();

  const results = [];
  for (const p of PAGES) {
    const errors = [];
    const onConsole = (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    };
    const onPageError = (err) => errors.push(String(err));
    page.on("console", onConsole);
    page.on("pageerror", onPageError);

    let loadError = null;
    let bodyText = "";
    let finalUrl = "";
    try {
      await page.goto(BASE_URL + p.path, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      bodyText = await page.evaluate(() => document.body?.innerText || "");
      finalUrl = page.url();
    } catch (e) {
      loadError = String(e);
      finalUrl = page.url();
    }

    await page.screenshot({ path: `${OUT_DIR}/${p.file}`, fullPage: true }).catch((e) => {
      loadError = loadError || `screenshot failed: ${e}`;
    });

    page.off("console", onConsole);
    page.off("pageerror", onPageError);

    const authenticated = !finalUrl.includes("/login");
    const rendered = !loadError && bodyText.trim().length > 20 && authenticated;
    results.push({
      path: p.path,
      finalUrl,
      authenticated,
      loadError,
      textLen: bodyText.trim().length,
      rendered,
      consoleErrors: errors.length,
      errorMessages: errors,
    });
    console.log(`[${p.path}] finalUrl=${finalUrl} authenticated=${authenticated} rendered=${rendered} textLen=${bodyText.trim().length} consoleErrors=${errors.length}`);
    for (const e of errors) console.log(`  [console error] ${e}`);
  }

  await browser.close();

  writeFileSync(`${OUT_DIR}/step3-authed-smoke.json`, JSON.stringify({ timestamp: new Date().toISOString(), baseUrl: BASE_URL, browser: "webkit", results }, null, 2));
  console.log("\nWritten:", `${OUT_DIR}/step3-authed-smoke.json`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
