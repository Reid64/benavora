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

const PLUM_RGB = "rgb(122, 89, 128)"; // #7A5980
const GOLD_RGB = "rgb(184, 138, 46)"; // #B88A2E
const BRONZE_RGB = "rgb(164, 113, 44)"; // #A4712C

const PAGES = [
  { name: "intelligence-hub", url: "/intelligence", expect: PLUM_RGB },
  { name: "intelligence-library", url: "/intelligence-library", expect: PLUM_RGB },
  { name: "intelligence-library-dashboard", url: "/intelligence-library/dashboard", expect: PLUM_RGB },
  { name: "intelligence-twin", url: "/intelligence/twin", expect: PLUM_RGB },
  { name: "intelligence-match-feed", url: "/intelligence/match-feed", expect: PLUM_RGB },
  { name: "intelligence-knowledge", url: "/intelligence/knowledge", expect: PLUM_RGB },
  { name: "intelligence-recommendations", url: "/intelligence/recommendations", expect: PLUM_RGB },
  { name: "intelligence-competitors", url: "/intelligence/competitors", expect: PLUM_RGB },
  { name: "intelligence-matches", url: "/intelligence/matches", expect: PLUM_RGB },
  { name: "intelligence-reputation", url: "/intelligence/reputation", expect: PLUM_RGB },
  { name: "intelligence-disaster", url: "/intelligence/disaster", expect: PLUM_RGB },
  { name: "intelligence-community-need", url: "/intelligence/community-need", expect: PLUM_RGB },
  { name: "intelligence-donor-intent", url: "/intelligence/donor-intent", expect: PLUM_RGB },
  { name: "intelligence-relationship-graph", url: "/intelligence/relationship-graph", expect: PLUM_RGB },
  { name: "intelligence-strategic-advisor", url: "/intelligence/strategic-advisor", expect: PLUM_RGB },
  { name: "reports", url: "/reports", expect: PLUM_RGB },
  { name: "reports-board-report", url: "/reports/board-report", expect: PLUM_RGB },
  { name: "reports-simulate", url: "/reports/simulate", expect: PLUM_RGB },
  { name: "reports-roi", url: "/reports/roi", expect: PLUM_RGB },
  { name: "reports-forecast", url: "/reports/forecast", expect: PLUM_RGB },
  { name: "agents-marketplace", url: "/agents/marketplace", expect: GOLD_RGB },
  { name: "research", url: "/research", expect: BRONZE_RGB },
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
      const main = document.querySelector("main") || document.body;
      let matchCount = 0;
      const distinctFrameBgs = new Map();
      main.querySelectorAll("*").forEach((el) => {
        const cs = getComputedStyle(el);
        const bg = cs.backgroundColor;
        if (bg === expectRgb) matchCount++;
        const m = bg.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) return;
        const [, r, g, b, a] = m;
        const alpha = a === undefined ? 1 : parseFloat(a);
        if (alpha < 0.5) return;
        const isStone = +r === 216 && +g === 211 && +b === 200;
        const isIvory = (+r === 248 && +g === 245 && +b === 238) || (+r === 247 && +g === 245 && +b === 241) || (+r === 251 && +g === 250 && +b === 247);
        const hasShadow = cs.boxShadow && cs.boxShadow !== "none";
        const hasRadius = parseFloat(cs.borderRadius) > 0;
        if (!isStone && !isIvory && (hasShadow || hasRadius)) {
          distinctFrameBgs.set(bg, (distinctFrameBgs.get(bg) || 0) + 1);
        }
      });
      const h1 = document.querySelector("h1");
      return {
        matchCount,
        distinctFrameBgs: Array.from(distinctFrameBgs.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6),
        h1: h1 ? { text: h1.textContent?.trim().slice(0, 50), color: getComputedStyle(h1).color } : null,
        bodySample: document.body.innerText.slice(0, 100),
      };
    }, p.expect);

    await page.screenshot({ path: `smoke-test-output/PHASE1B-${p.name}-2026-08-18.png`, fullPage: true }).catch(() => {});
    results.push({ ...p, loadError, consoleErrors, ...audit });
    await context.close();
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
