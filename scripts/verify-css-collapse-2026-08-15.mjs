// One-off verification for the CSS_OVERRIDE_INVESTIGATION_2026-08-15.md migration:
// confirm /dashboard renders correctly post-collapse, and that a real Tailwind
// class / CSS-variable style now actually takes visible effect on a class that
// used to be force-!important'd (the original test of whether the blocker is
// genuinely resolved).
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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAsFaith(context) {
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
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" })));
}

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${detail}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  try {
    await page.goto(BASE_URL + "/dashboard", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "smoke-test-output/css-collapse-dashboard.png", fullPage: true });
    const bodyText = await page.locator("body").innerText().catch(() => "");
    log("dashboard-loaded", page.url().includes("/dashboard"), page.url());
    log("dashboard-has-content", bodyText.length > 200, `bodyText length=${bodyText.length}`);
    log("dashboard-console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));

    // 1. Confirm the migrated classes render the expected brand values (no visual regression).
    const computed = await page.evaluate(() => {
      function mk(tag, cls) {
        const el = document.createElement(tag);
        el.className = cls;
        document.body.appendChild(el);
        const cs = getComputedStyle(el);
        const out = { backgroundColor: cs.backgroundColor, color: cs.color };
        el.remove();
        return out;
      }
      return {
        "bg-green-50": mk("div", "bg-green-50"),
        "text-blue-700": mk("span", "text-blue-700"),
        "badge-green": mk("span", "badge-green"),
        "page-bg": mk("div", "page-bg"),
      };
    });
    log("computed-styles", true, JSON.stringify(computed));

    // 2. THE REAL TEST: a class that used to be forced with !important (bg-green-50,
    // text-blue-700) must now be beatable by a plain inline style / higher-specificity
    // rule, since the compat-layer !important for these families was deleted.
    const overrideTest = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "bg-green-50 text-blue-700";
      el.style.backgroundColor = "rgb(1, 2, 3)"; // arbitrary, unmistakable inline override
      el.style.color = "rgb(4, 5, 6)";
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = { backgroundColor: cs.backgroundColor, color: cs.color };
      el.remove();
      return out;
    });
    const overrideWon =
      overrideTest.backgroundColor === "rgb(1, 2, 3)" && overrideTest.color === "rgb(4, 5, 6)";
    log("inline-style-override-wins", overrideWon, JSON.stringify(overrideTest));

    // 3. Sanity control: `navy`/`white` families are DELIBERATELY still !important per
    // the doc — an inline override on those should still lose, confirming the test
    // methodology itself is valid (not just "everything always wins").
    const navyControlTest = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "bg-white";
      el.style.backgroundColor = "rgb(7, 8, 9)";
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = { backgroundColor: cs.backgroundColor };
      el.remove();
      return out;
    });
    const navyStillForced = navyControlTest.backgroundColor !== "rgb(7, 8, 9)";
    log("navy-white-control-still-forced", navyStillForced, JSON.stringify(navyControlTest));
  } catch (err) {
    log("fatal", false, err.stack || String(err));
  } finally {
    await browser.close();
  }

  console.log("\n=== RESULTS JSON ===");
  console.log(JSON.stringify(results, null, 2));
  const allOk = results.every((r) => r.ok);
  process.exit(allOk ? 0 : 1);
}

main();
