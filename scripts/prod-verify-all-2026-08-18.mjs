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
const BASE_URL = "https://benavora.com";
const COOKIE_DOMAIN = ".benavora.com";
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
  await context.addCookies(
    setCookies.map((c) => ({ name: c.name, value: c.value, domain: COOKIE_DOMAIN, path: "/", secure: true, sameSite: "Lax" })),
  );
}

// route -> expected h1 rgb (or null to just report)
const PAGES = [
  ["/compliance", "rgb(16, 27, 45)"],
  ["/documents", "rgb(16, 27, 45)"],
  ["/outcomes", "rgb(16, 27, 45)"],
  ["/financials", "rgb(16, 27, 45)"],
  ["/marketplace", "rgb(16, 27, 45)"],
  ["/email", "rgb(163, 73, 47)"],
  ["/email/campaigns", "rgb(163, 73, 47)"],
  ["/email/templates", "rgb(163, 73, 47)"],
  ["/outreach", "rgb(163, 73, 47)"],
  ["/outreach/templates", "rgb(163, 73, 47)"],
  ["/command-center", "rgb(16, 27, 45)"],
  ["/admin/orgs", null],
  ["/admin/system", null],
  ["/import", "rgb(16, 27, 45)"],
  ["/admin/sales-outreach", "rgb(16, 27, 45)"],
  ["/admin/autoapply-ops", null],
  ["/admin/monitor", "rgb(16, 27, 45)"],
  ["/admin/improvements", "rgb(16, 27, 45)"],
  ["/admin/audit-log", "rgb(16, 27, 45)"],
  ["/settings", "rgb(16, 27, 45)"],
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await loginAsFaith(context);
  const page = await context.newPage();

  for (const [route, expected] of PAGES) {
    const resp = await page.goto(BASE_URL + route, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1200);
    const headers = resp ? resp.headers() : {};
    const result = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      return {
        h1Text: h1?.textContent?.trim() ?? null,
        h1Color: h1 ? getComputedStyle(h1).color : null,
      };
    });
    const match = expected === null ? "N/A" : result.h1Color === expected ? "MATCH" : "MISMATCH";
    console.log(
      `${route.padEnd(24)} vercel-cache=${(headers["x-vercel-cache"] || "-").padEnd(6)} h1="${result.h1Text}" color=${result.h1Color} expected=${expected ?? "-"} ${match}`,
    );
  }

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
