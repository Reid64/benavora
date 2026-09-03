// Verify the new "Google for Nonprofits" nav item appears under Resources
// in the sidebar, per nav-items.ts edit adding it as a Resources child.
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
const BASE_URL = process.argv[2] || "http://localhost:3000";
const OUT_DIR = "test-evidence/google-nonprofit-nav";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAs(context, email) {
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
  const domain = new URL(BASE_URL).hostname;
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain, path: "/" })));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await loginAs(context, "info@faithfoundationsf.org");
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGE ERROR:", String(err).slice(0, 200)));

  await page.goto(`${BASE_URL}/knowledge-base`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Resources section needs to be the active/expanded section to show children.
  const resourcesRow = page.locator("aside[aria-label='Primary navigation'] a", { hasText: "Resources" }).first();
  if (await resourcesRow.count() === 0) {
    console.log("Could not find Resources row in sidebar");
  }

  const found = await page.locator("aside[aria-label='Primary navigation'] a", { hasText: "Google for Nonprofits" }).count();
  console.log(`"Google for Nonprofits" link count in sidebar: ${found}`);

  await page.locator("aside[aria-label='Primary navigation']").screenshot({ path: `${OUT_DIR}/sidebar.png` });
  console.log(`Screenshot saved to ${OUT_DIR}/sidebar.png`);

  if (found > 0) {
    const href = await page.locator("aside[aria-label='Primary navigation'] a", { hasText: "Google for Nonprofits" }).first().getAttribute("href");
    console.log(`href = ${href}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
