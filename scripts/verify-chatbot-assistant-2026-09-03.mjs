// Verify ChatbotAssistant renders (fixed bottom-right toggle button) on the
// 7 pages it was added to: dashboard, opportunities, prospects (intelligence/pil/prospects),
// applications, engagement (email), resources (knowledge-base), settings.
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
const OUT_DIR = "test-evidence/chatbot-assistant";
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

const PAGES = [
  { path: "/dashboard", label: "dashboard" },
  { path: "/opportunities", label: "opportunities" },
  { path: "/intelligence/pil/prospects", label: "prospects-analysis" },
  { path: "/applications", label: "applications" },
  { path: "/email", label: "engagement" },
  { path: "/knowledge-base", label: "resources" },
  { path: "/settings", label: "settings" },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await loginAs(context, "info@faithfoundationsf.org");
  const page = await context.newPage();

  const results = [];
  for (const { path, label } of PAGES) {
    const errors = [];
    page.removeAllListeners("pageerror");
    page.on("pageerror", (err) => errors.push(String(err).slice(0, 300)));

    await page.goto(`${BASE_URL}${path}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1500);

    const toggleBtn = page.locator("button[aria-label='Open assistant'], button[aria-label='Close assistant']");
    const count = await toggleBtn.count();
    let box = null;
    if (count > 0) {
      box = await toggleBtn.first().boundingBox();
    }
    const vw = 1400, vh = 1000;
    const isBottomRight = box ? (box.x + box.width > vw - 150 && box.y + box.height > vh - 150) : false;

    // Click it open and verify the dialog + title text appear.
    let dialogOk = false;
    let titleText = "";
    if (count > 0) {
      await toggleBtn.first().click();
      await page.waitForTimeout(500);
      const dialog = page.locator("div[role='dialog']");
      dialogOk = (await dialog.count()) > 0;
      if (dialogOk) {
        titleText = (await dialog.locator("p").first().textContent()) || "";
      }
      await page.screenshot({ path: `${OUT_DIR}/${label}.png` });
      // close it again for cleanliness
      if ((await toggleBtn.count()) > 0) await toggleBtn.first().click();
    } else {
      await page.screenshot({ path: `${OUT_DIR}/${label}-MISSING.png` });
    }

    results.push({ path, label, buttonCount: count, isBottomRight, dialogOk, titleText, pageErrors: errors });
    console.log(JSON.stringify(results[results.length - 1]));
  }

  await browser.close();

  const allGood = results.every((r) => r.buttonCount === 1 && r.isBottomRight && r.dialogOk && r.pageErrors.length === 0);
  console.log(allGood ? "ALL_PAGES_PASS" : "SOME_PAGES_FAILED");
  if (!allGood) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
