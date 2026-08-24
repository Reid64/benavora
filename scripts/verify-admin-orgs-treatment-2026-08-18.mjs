import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const PORT = process.env.PORT || "3002";
const BASE = `http://127.0.0.1:${PORT}`;

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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAsFaith(context) {
  const email = "info@faithfoundationsf.org";
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const hash = (verifyResp.headers.get("location") || "").split("#")[1];
  const params = new URLSearchParams(hash);
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token: params.get("access_token"), refresh_token: params.get("refresh_token") });
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain: "127.0.0.1", path: "/" })));
}

(async () => {
  mkdirSync("smoke-test-output", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await loginAsFaith(context);
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`${BASE}/admin/orgs`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);

  await page.screenshot({ path: "smoke-test-output/ADMIN-ORGS-AFTER-2026-08-18.png", fullPage: true });

  // Computed style: hero frame (navy fill)
  const heroBg = await page.evaluate(() => {
    const h1 = Array.from(document.querySelectorAll("h1")).find((el) => el.textContent?.includes("Organizations"));
    const frame = h1?.closest("div");
    return frame ? getComputedStyle(frame).backgroundColor : null;
  });

  // Computed style: table outer frame (navy) vs inner card (ivory)
  const frameCardColors = await page.evaluate(() => {
    // outer frame div wraps a table; find via table ancestor chain
    const table = document.querySelector("table");
    if (!table) return null;
    let card = table;
    while (card && card.parentElement && !(getComputedStyle(card).borderRadius && getComputedStyle(card).overflow === "hidden")) {
      card = card.parentElement;
    }
    const frame = card?.parentElement || null;
    return {
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
      frameBg: frame ? getComputedStyle(frame).backgroundColor : null,
      frameShadow: frame ? getComputedStyle(frame).boxShadow : null,
    };
  });

  // Computed style: Impersonate button vs surrounding
  const impersonateColors = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Impersonate"));
    if (!btn) return null;
    const cs = getComputedStyle(btn);
    return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor };
  });

  // Functionality: search filter still works
  const rowCountBefore = await page.locator("table tbody tr").count();
  await page.fill('input[placeholder="Search by org name..."]', "zzz_no_such_org_zzz");
  await page.waitForTimeout(300);
  const rowCountAfterBadFilter = await page.locator("table tbody tr").count();
  await page.fill('input[placeholder="Search by org name..."]', "");
  await page.waitForTimeout(300);
  const rowCountRestored = await page.locator("table tbody tr").count();

  console.log(JSON.stringify({
    heroBg,
    frameCardColors,
    impersonateColors,
    rowCountBefore,
    rowCountAfterBadFilter,
    rowCountRestored,
    consoleErrors: errors,
  }, null, 2));

  await browser.close();
})();
