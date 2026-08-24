import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";
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
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" })));
}

const GOLD_RGB = "rgb(184, 138, 46)";
const BRONZE_RGB = "rgb(164, 113, 44)";

const PAGES = [
  { name: "dashboard", url: "/dashboard", expect: GOLD_RGB, wait: 4000 },
  { name: "opportunities", url: "/opportunities", expect: BRONZE_RGB, wait: 4000 },
  { name: "donor-discovery", url: "/donor-discovery", expect: BRONZE_RGB, wait: 4000 },
  { name: "donor-discovery-prospects", url: "/donor-discovery/prospects", expect: BRONZE_RGB, wait: 4000 },
  { name: "donor-discovery-intent-signals", url: "/donor-discovery/intent-signals", expect: BRONZE_RGB, wait: 4000 },
  { name: "nonprofits", url: "/nonprofits", expect: BRONZE_RGB, wait: 4000 },
  { name: "foundations", url: "/foundations", expect: BRONZE_RGB, wait: 4000 },
  { name: "funders", url: "/funders", expect: BRONZE_RGB, wait: 4000 },
  { name: "contacts", url: "/contacts", expect: BRONZE_RGB, wait: 4000 },
  { name: "knowledge-base", url: "/knowledge-base", expect: GOLD_RGB, wait: 4000 },
  { name: "alerts", url: "/alerts", expect: GOLD_RGB, wait: 4000 },
  { name: "activity", url: "/activity", expect: GOLD_RGB, wait: 4000 },
];

async function main() {
  mkdirSync("smoke-test-output", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const p of PAGES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
    await loginAsFaith(context);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
    let loadError = null;
    try {
      await page.goto(`http://localhost:3000${p.url}`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(p.wait);
    } catch (e) {
      loadError = e.message;
    }

    const audit = loadError ? {} : await page.evaluate((expectRgb) => {
      const main = document.querySelector("main") || document.body;
      let matchCount = 0;
      const offenders = [];
      main.querySelectorAll("*").forEach((el) => {
        const cs = getComputedStyle(el);
        for (const prop of ["color", "backgroundColor"]) {
          const v = cs[prop];
          if (v === expectRgb) matchCount++;
          const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (!m) continue;
          const [, r, g, b, a] = m;
          const alpha = a === undefined ? 1 : parseFloat(a);
          if (alpha < 0.5) continue;
          const isIvory = (+r === 248 && +g === 245 && +b === 238) || (+r === 247 && +g === 245 && +b === 241) || (+r === 251 && +g === 250 && +b === 247);
          const isStone = +r === 216 && +g === 211 && +b === 200;
          if (+r >= 240 && +g >= 240 && +b >= 240 && !isIvory && !isStone) {
            offenders.push({ tag: el.tagName, cls: el.className?.toString().slice(0, 60), prop, v });
          }
        }
      });
      const h1 = document.querySelector("h1");
      return {
        matchCount,
        offenderCount: offenders.length,
        offenderSample: offenders.slice(0, 5),
        h1: h1 ? { text: h1.textContent?.trim().slice(0, 40), color: getComputedStyle(h1).color } : null,
      };
    }, p.expect);

    await page.screenshot({ path: `smoke-test-output/FINAL-${p.name}-2026-08-18.png`, fullPage: false }).catch(() => {});
    results.push({ name: p.name, loadError, consoleErrors: consoleErrors.slice(0, 5), ...audit });
    await context.close();
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
