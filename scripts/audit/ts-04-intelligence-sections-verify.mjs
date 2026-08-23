// TS-04: Intelligence sections verification (2026-08-23). Visits all 11
// /intelligence* pages as a real authenticated user (magic-link auth as
// info@faithfoundationsf.org, prod -- established pattern, see
// scripts/audit/ts-02-draft-generator-e2e-2026-08-23.mjs), screenshots each,
// records whether real (non-empty) data renders and how many console errors
// fire. For any page showing an empty state, calls its underlying API
// endpoint directly with the same session cookie to distinguish a UI-layer
// defect from a data/backend-layer defect. All steps run foreground and
// synchronous, no backgrounding.
import { chromium } from "playwright";
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
const COOKIE_DOMAIN = "www.benavora.com";
const OUT_DIR = "test-evidence/verification/ts-04";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PAGES = [
  {
    path: "/intelligence",
    shot: "intelligence-hub.png",
    apis: ["/api/intelligence/digital-twin", "/api/intelligence/reputation", "/api/intelligence/learning-network", "/api/intelligence/strategic-advisor", "/api/intelligence/community-need", "/api/intelligence/stats"],
  },
  { path: "/intelligence/match-feed", shot: "match-feed.png", apis: ["/api/intelligence/match-feed?limit=25"] },
  { path: "/intelligence/matches", shot: "matches.png", apis: ["/api/agents/semantic-matching"] },
  { path: "/intelligence/recommendations", shot: "recommendations.png", apis: ["/api/intelligence/recommendations"] },
  { path: "/intelligence/relationship-graph", shot: "relationship-graph.png", apis: ["/api/intelligence/relationship-graph", "/api/intelligence/relationship-graph/analytics"] },
  { path: "/intelligence/strategic-advisor", shot: "strategic-advisor.png", apis: ["/api/intelligence/strategic-advisor"] },
  { path: "/intelligence/twin", shot: "twin.png", apis: ["/api/intelligence/twin/completeness"] },
  { path: "/intelligence/community-need", shot: "community-need.png", apis: ["/api/intelligence/community-need"] },
  { path: "/intelligence/gap-analysis", shot: "gap-analysis.png", apis: ["/api/intelligence/gap-analysis"] },
  { path: "/intelligence/knowledge", shot: "knowledge.png", apis: ["/api/intelligence/knowledge-query"] },
  { path: "/intelligence-library", shot: "intelligence-library.png", apis: ["/api/intelligence/library/search", "/api/intelligence/proposals"] },
];

const NO_DATA_PATTERNS = [
  /no data/i,
  /no results/i,
  /nothing (found|here)/i,
  /no opportunities/i,
  /no matches/i,
  /no recommendations/i,
  /no signals/i,
  /no records/i,
  /0 results/i,
  /get started/i,
  /empty/i,
];

const report = { timestamp: null, baseUrl: BASE_URL, pages: [] };

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

async function main() {
  report.timestamp = new Date().toISOString();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const setCookies = await loginAndGetCookies();
  await context.addCookies(
    setCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: COOKIE_DOMAIN,
      path: "/",
      secure: true,
      sameSite: "Lax",
    })),
  );
  const cookieHeader = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  for (const p of PAGES) {
    const page = await context.newPage();
    let consoleErrors = 0;
    const errorMessages = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors++;
        errorMessages.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors++;
      errorMessages.push(String(err));
    });

    let loaded = true;
    let loadError = null;
    try {
      await page.goto(`${BASE_URL}${p.path}`, { waitUntil: "load", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    } catch (err) {
      loaded = false;
      loadError = String(err);
    }

    await page.screenshot({ path: `${OUT_DIR}/${p.shot}`, fullPage: true }).catch(() => {});

    const mainText = await page
      .evaluate(() => document.querySelector("main")?.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .catch(() => "");
    const textLen = mainText.length;
    const hasNoDataPhrase = NO_DATA_PATTERNS.some((re) => re.test(mainText));
    const realData = loaded && textLen > 300 && !hasNoDataPhrase;

    console.log(`[${loaded ? "LOADED" : "FAIL"}] ${p.path} :: textLen=${textLen} consoleErrors=${consoleErrors} realData=${realData}`);

    const entry = {
      path: p.path,
      screenshot: `${OUT_DIR}/${p.shot}`,
      loaded,
      loadError,
      textLen,
      hasNoDataPhrase,
      realData,
      consoleErrors,
      errorMessages: errorMessages.slice(0, 10),
      apiChecks: [],
    };

    if (!realData) {
      for (const apiPath of p.apis) {
        try {
          const resp = await fetch(`${BASE_URL}${apiPath}`, { headers: { Cookie: cookieHeader } });
          const status = resp.status;
          let bodySnippet = null;
          let apiHasData = false;
          try {
            const body = await resp.json();
            bodySnippet = JSON.stringify(body).slice(0, 500);
            if (Array.isArray(body)) apiHasData = body.length > 0;
            else if (body && typeof body === "object") {
              const arr = Object.values(body).find((v) => Array.isArray(v));
              apiHasData = arr ? arr.length > 0 : Object.keys(body).length > 0 && !body.error;
            }
          } catch {
            bodySnippet = "(non-JSON body)";
          }
          entry.apiChecks.push({ api: apiPath, status, apiHasData, bodySnippet });
          console.log(`    [API ${status}] ${apiPath} :: apiHasData=${apiHasData}`);
        } catch (err) {
          entry.apiChecks.push({ api: apiPath, status: null, apiHasData: false, error: String(err) });
        }
      }
    }

    report.pages.push(entry);
    await page.close();
  }

  await browser.close();
  writeFileSync(`${OUT_DIR}/ts-04-results.json`, JSON.stringify(report, null, 2));

  console.log("\n=== TS-04 Results Table ===");
  console.log("page | loads | real_data | console_errors");
  for (const e of report.pages) {
    console.log(`${e.path} | ${e.loaded ? "yes" : "no"} | ${e.realData ? "yes" : "no"} | ${e.consoleErrors}`);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
