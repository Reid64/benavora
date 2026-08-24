// Verify /applications Page Treatment Protocol v2 pass (2026-08-17).
// Frame: #101B2D (Deep Navy). Accent: #2E6B66 (Teal). Section: Applications & Pipeline.
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  await page.goto(BASE_URL + "/applications", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1200);

  await page.screenshot({ path: "smoke-test-output/applications-treatment-after-viewport-2026-08-17.png", fullPage: false });
  await page.screenshot({ path: "smoke-test-output/applications-treatment-after-full-2026-08-17.png", fullPage: true });

  // Computed-style check: header title (should be #101B2D), first row frame (should be #101B2D bg),
  // active "All" tab (should be #101B2D bg), Renewals button (should be #2E6B66 bg).
  const result = await page.evaluate(() => {
    const out = {};
    const h1 = document.querySelector("h1");
    if (h1) out.h1Color = getComputedStyle(h1).color;

    const renewalsLink = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes("Renewals"));
    if (renewalsLink) out.renewalsBg = getComputedStyle(renewalsLink).backgroundColor;

    const allTabBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("All"));
    if (allTabBtn) out.allTabBg = getComputedStyle(allTabBtn).backgroundColor;

    const firstRowFrame = document.querySelector('[role="button"][tabindex="0"]');
    if (firstRowFrame) out.rowFrameBg = getComputedStyle(firstRowFrame).backgroundColor;
    if (firstRowFrame) {
      const inner = firstRowFrame.firstElementChild;
      if (inner) out.rowInnerBg = getComputedStyle(inner).backgroundColor;
    }

    // White-value scan scoped to the page's own content (<main>), excluding
    // the global sidebar/header chrome which intentionally keeps white nav
    // text (confirmed by-design, out of this page's scope).
    const offenders = [];
    document.querySelectorAll("main *").forEach((el) => {
      const cs = getComputedStyle(el);
      for (const prop of ["color", "backgroundColor"]) {
        const v = cs[prop];
        const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          const [r, g, b] = [+m[1], +m[2], +m[3]];
          // near-white threshold matching #F0F0F0 (240,240,240), excluding sanctioned Warm Ivory (#F8F5EE ~ 248,245,238)
          const isIvory = r === 248 && g === 245 && b === 238;
          if (r >= 240 && g >= 240 && b >= 240 && !isIvory) {
            offenders.push({ tag: el.tagName, cls: el.className?.toString().slice(0, 60), prop, v });
          }
        }
      }
    });
    const mainEl = document.querySelector("main");
    if (mainEl) out.mainBg = getComputedStyle(mainEl).backgroundColor;

    out.offenderCount = offenders.length;
    out.offendersSample = offenders.slice(0, 20);
    return out;
  });

  console.log("COMPUTED STYLES:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors.slice(0, 10)));
  console.log("url:", page.url());

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
