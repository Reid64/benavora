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

const PAGES = [
  { name: "dashboard", url: "/dashboard", section: "Dashboard" },
  { name: "draft-generator", url: "/draft-generator", section: "Draft Generator" },
  { name: "research", url: "/research", section: "Research" },
  { name: "applications", url: "/applications", section: "Applications" },
  { name: "outreach", url: "/outreach", section: "Outreach" },
  { name: "admin-orgs", url: "/admin/orgs", section: "Admin (Impersonate)" },
  { name: "admin-sales-outreach", url: "/admin/sales-outreach", section: "Admin (FramedCard)" },
  { name: "admin-audit-log", url: "/admin/audit-log", section: "Admin (FramedCard)" },
  { name: "intelligence-matches", url: "/intelligence/matches", section: "Intelligence" },
  { name: "autoapply", url: "/autoapply", section: "AutoApply" },
];

async function main() {
  mkdirSync("smoke-test-output", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const p of PAGES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
    await loginAsFaith(context);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    let loadError = null;
    try {
      await page.goto(`http://localhost:3000${p.url}`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(3000);
    } catch (e) {
      loadError = e.message;
    }

    await page.screenshot({ path: `smoke-test-output/regression-${p.name}-2026-08-18.png`, fullPage: true }).catch(() => {});

    const check = loadError ? {} : await page.evaluate(() => {
      const out = {};
      const main = document.querySelector("main") || document.body;
      out.bodyText = document.body.innerText.slice(0, 120);

      // Find any element whose bg or text is unexpectedly transparent/unset where a
      // class name suggests it should have a background - i.e. detect any *-surface
      // class rendering as literally transparent (would indicate the rename broke).
      const surfaceEls = Array.from(document.querySelectorAll('[class*="bg-surface"]'));
      out.surfaceElCount = surfaceEls.length;
      const transparentSurface = surfaceEls.filter((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg === "rgba(0, 0, 0, 0)" || bg === "transparent";
      });
      out.transparentSurfaceCount = transparentSurface.length;
      out.transparentSurfaceSample = transparentSurface.slice(0, 5).map((el) => ({
        tag: el.tagName, cls: el.className?.toString().slice(0, 80),
      }));

      // Any element that STILL has literal "bg-white" as a class (rename miss check)
      const staleWhite = Array.from(document.querySelectorAll('[class~="bg-white"]'));
      out.staleBgWhiteCount = staleWhite.length;

      // Buttons: check every button has a non-transparent, non-black-on-black render
      const buttons = Array.from(document.querySelectorAll("button"));
      out.buttonCount = buttons.length;
      const unstyled = buttons.filter((b) => {
        const cs = getComputedStyle(b);
        return cs.backgroundColor === "rgba(0, 0, 0, 0)" && cs.border === "0px none rgb(0, 0, 0)" && !b.className.includes("ghost");
      });
      out.suspiciousUnstyledButtonCount = unstyled.length;

      return out;
    });

    results.push({ ...p, loadError, consoleErrors: consoleErrors.slice(0, 10), ...check });
    await context.close();
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
