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

// rgb targets for the two colors relevant to this audit
const GOLD_RGB = "rgb(184, 138, 46)"; // #B88A2E
const BRONZE_RGB = "rgb(164, 113, 44)"; // #A4712C

const PAGES = [
  { name: "dashboard", url: "/dashboard", section: "Dashboard/Home", expect: GOLD_RGB, expectLabel: "Gold #B88A2E" },
  { name: "opportunities", url: "/opportunities", section: "Research & Discovery", expect: BRONZE_RGB, expectLabel: "Bronze #A4712C" },
  { name: "donor-discovery", url: "/donor-discovery", section: "Research & Discovery", expect: BRONZE_RGB, expectLabel: "Bronze #A4712C" },
  { name: "donor-discovery-prospects", url: "/donor-discovery/prospects", section: "Research & Discovery", expect: BRONZE_RGB, expectLabel: "Bronze #A4712C" },
  { name: "donor-discovery-intent-signals", url: "/donor-discovery/intent-signals", section: "Research & Discovery", expect: BRONZE_RGB, expectLabel: "Bronze #A4712C" },
  { name: "nonprofits", url: "/nonprofits", section: "Research & Discovery", expect: BRONZE_RGB, expectLabel: "Bronze #A4712C" },
  { name: "foundations", url: "/foundations", section: "Research & Discovery", expect: BRONZE_RGB, expectLabel: "Bronze #A4712C" },
  { name: "funders", url: "/funders", section: "Research & Discovery", expect: BRONZE_RGB, expectLabel: "Bronze #A4712C" },
  { name: "contacts", url: "/contacts", section: "Research & Discovery", expect: BRONZE_RGB, expectLabel: "Bronze #A4712C" },
  { name: "knowledge-base", url: "/knowledge-base", section: "Draft & Automation", expect: GOLD_RGB, expectLabel: "Gold #B88A2E" },
  { name: "alerts", url: "/alerts", section: "Draft & Automation", expect: GOLD_RGB, expectLabel: "Gold #B88A2E" },
  { name: "activity", url: "/activity", section: "Draft & Automation", expect: GOLD_RGB, expectLabel: "Gold #B88A2E" },
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
      await page.waitForTimeout(4000);
    } catch (e) {
      loadError = e.message;
    }

    const audit = loadError ? {} : await page.evaluate((expectRgb) => {
      const out = {};
      // Scan every element for backgroundColor matching the expected rgb, and separately
      // collect the set of distinct "frame-like" background colors (elements whose bg is
      // NOT the page bg #D8D3C8, NOT ivory #F8F5EE/#F7F5F1, NOT transparent, and has
      // either a box-shadow or rounded corners - i.e. looks like an intentional frame).
      const pageEls = Array.from(document.querySelectorAll("main *, [class*='min-h-screen'] *"));
      let matchCount = 0;
      const distinctFrameBgs = new Map();
      for (const el of pageEls) {
        const cs = getComputedStyle(el);
        const bg = cs.backgroundColor;
        if (bg === expectRgb) matchCount++;
        const m = bg.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) continue;
        const [, r, g, b, a] = m;
        const alpha = a === undefined ? 1 : parseFloat(a);
        if (alpha < 0.5) continue;
        const isStone = +r === 216 && +g === 211 && +b === 200;
        const isIvory = (+r === 248 && +g === 245 && +b === 238) || (+r === 247 && +g === 245 && +b === 241) || (+r === 251 && +g === 250 && +b === 247);
        const isTransparent = alpha === 0;
        const hasShadow = cs.boxShadow && cs.boxShadow !== "none";
        const hasRadius = parseFloat(cs.borderRadius) > 0;
        if (!isStone && !isIvory && !isTransparent && (hasShadow || hasRadius)) {
          const key = bg;
          distinctFrameBgs.set(key, (distinctFrameBgs.get(key) || 0) + 1);
        }
      }
      out.matchCount = matchCount;
      out.distinctFrameBgs = Array.from(distinctFrameBgs.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

      const h1 = document.querySelector("h1");
      out.h1 = h1 ? { text: h1.textContent?.trim().slice(0, 60), color: getComputedStyle(h1).color } : null;

      const main = document.querySelector("main") || document.querySelector("[class*='min-h-screen']");
      out.mainBg = main ? getComputedStyle(main).backgroundColor : null;

      out.bodySample = document.body.innerText.slice(0, 150);
      return out;
    }, p.expect);

    await page.screenshot({ path: `smoke-test-output/PHASE1-${p.name}-2026-08-18.png`, fullPage: true }).catch(() => {});

    results.push({ ...p, loadError, consoleErrors, ...audit });
    await context.close();
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
