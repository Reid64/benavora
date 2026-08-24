// Follow-up pass: re-check /reports/simulate (crashed in the prior run, suspected
// build-process race corrupting .next/) plus 3 pages that were modified this session
// (section accents / nav work) but never got a screenshot in the main sweep.
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

const OUT_DIR = "smoke-test-output/full-pass-2026-08-16";
mkdirSync(OUT_DIR, { recursive: true });

const PAGES = [
  ["reports-simulate-retest", "/reports/simulate"],
  ["alerts", "/alerts"],
  ["admin-orgs", "/admin/orgs"],
  ["donor-discovery-prospects", "/donor-discovery/prospects"],
];

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${detail}`);
}

async function checkShell(page, label) {
  const shellInfo = await page.evaluate(() => {
    const aside = document.querySelector("aside[aria-label='Primary navigation']");
    const header = document.querySelector("header");
    const navColors = aside
      ? Array.from(aside.querySelectorAll("nav a, a#tour-nav-settings")).map((a) => getComputedStyle(a).color)
      : [];
    return {
      sidebarBg: aside ? getComputedStyle(aside).backgroundImage : null,
      headerBg: header ? getComputedStyle(header).backgroundColor : null,
      navColors,
    };
  });
  const sidebarOk = !!shellInfo.sidebarBg && shellInfo.sidebarBg.includes("29, 78, 216") && shellInfo.sidebarBg.includes("2, 132, 199");
  log(`${label}:shell-sidebar-gradient`, sidebarOk, String(shellInfo.sidebarBg));
  log(`${label}:shell-header-deep-blue`, shellInfo.headerBg === "rgb(29, 78, 216)", String(shellInfo.headerBg));
  const badNav = shellInfo.navColors.filter((c) => c !== "rgb(255, 255, 255)");
  log(`${label}:shell-nav-text-white`, shellInfo.navColors.length > 0 && badNav.length === 0, `total=${shellInfo.navColors.length} bad=${JSON.stringify(badNav)}`);
}

async function visit(page, name, path) {
  const consoleErrors = [];
  const handler = (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); };
  page.on("console", handler);
  try {
    await page.goto(BASE_URL + path, { waitUntil: "load", timeout: 45000 });
    const deadline = Date.now() + 25000;
    let cleanStreak = 0;
    while (Date.now() < deadline) {
      const stillLoading = await page.evaluate(() => {
        const textLoading = /loading|computing|searching/i.test(document.body.innerText);
        const skeletonLoading = document.querySelectorAll(".animate-pulse").length > 0;
        return textLoading || skeletonLoading;
      });
      cleanStreak = stillLoading ? 0 : cleanStreak + 1;
      if (cleanStreak >= 2) break;
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(500);
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 800));
    const isServerError = bodyText.includes("Server Error") || bodyText.includes("Application error");
    const is404 = bodyText.includes("404") && bodyText.toLowerCase().includes("not found");
    log(`${name}:loaded`, !is404 && !isServerError, `url=${page.url()} bodyStart=${JSON.stringify(bodyText.slice(0, 120))}`);
    await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
    await checkShell(page, name);
    log(`${name}:console-errors`, consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));
  } catch (err) {
    log(`${name}:fatal`, false, err.message || String(err));
  } finally {
    page.off("console", handler);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  for (const [name, path] of PAGES) {
    await visit(page, name, path);
  }
  await browser.close();
  console.log("\n=== RESULTS JSON ===");
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "ALL PASS" : "SOME FAILED"} (${results.length - failed.length}/${results.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}
main();
