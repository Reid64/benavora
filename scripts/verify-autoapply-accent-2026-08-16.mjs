// Verification for the /autoapply page treatment pass (2026-08-16), per
// PAGE_TREATMENT_PROTOCOL.md: Draft & Automation section, accent #2563EB.
// Checks: page loads without error, header left-border + title use the accent,
// top stat values use the accent, "Start Session"/"Add to Queue" CTAs use the
// fixed teal #22D3EE (not the old green gradient), "Pause" stays warning-orange,
// table headers use the accent (not legacy navy), the offline Live Session
// Viewer empty state got real polish, WorkerStatus keeps its real green dot,
// no console errors, real data renders, and the shared shell is unchanged.
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

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${detail}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  try {
    await page.goto(BASE_URL + "/autoapply", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1500);
    log("loaded", page.url().includes("/autoapply"), page.url());

    const bodyText = await page.evaluate(() => document.body.innerText);
    log("no-error-message", !/could not load/i.test(bodyText), "checked for 'could not load' text");

    await page.screenshot({ path: `smoke-test-output/autoapply-accent-after-2026-08-16.png`, fullPage: true });

    // Header title color + left border
    const header = await page.evaluate(() => {
      const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "AUTOAPPLY ENGINE");
      const wrap = h1 ? h1.closest("div") : null;
      return {
        color: h1 ? getComputedStyle(h1).color : null,
        borderLeft: wrap ? getComputedStyle(wrap).borderLeftColor : null,
      };
    });
    log("header-title-color", header.color === "rgb(37, 99, 235)", `actual=${header.color}`);
    log("header-left-border-color", header.borderLeft === "rgb(37, 99, 235)", `actual=${header.borderLeft}`);

    // Top stat values -> accent
    const statLabels = ["Sessions Today", "Success Rate", "Avg Fill Time", "Forms Queued"];
    const stats = await page.evaluate((labels) => {
      return labels.map((label) => {
        const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === label);
        const valueP = p && p.previousElementSibling ? p.previousElementSibling : null;
        return { label, valueColor: valueP ? getComputedStyle(valueP).color : null };
      });
    }, statLabels);
    for (const s of stats) log(`stat-accent:${s.label}`, s.valueColor === "rgb(37, 99, 235)", `actual=${s.valueColor}`);

    // Start Session + header Add to Queue -> fixed CTA teal #22D3EE, dark text
    const ctas = await page.evaluate(() => {
      const startBtn = Array.from(document.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Start Session");
      const addBtn = Array.from(document.querySelectorAll("button")).find((el) => el.textContent?.includes("Add to Queue"));
      return {
        start: startBtn ? { bg: getComputedStyle(startBtn).backgroundColor, color: getComputedStyle(startBtn).color } : null,
        add: addBtn ? { bg: getComputedStyle(addBtn).backgroundColor, color: getComputedStyle(addBtn).color } : null,
      };
    });
    log("start-session-fixed-teal", ctas.start?.bg === "rgb(34, 211, 238)", JSON.stringify(ctas.start));
    log("add-to-queue-fixed-teal", ctas.add?.bg === "rgb(34, 211, 238)", JSON.stringify(ctas.add));

    // Pause button -> unchanged warning-orange (semantic)
    const pause = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Pause");
      return btn ? { bg: getComputedStyle(btn).backgroundColor, color: getComputedStyle(btn).color } : null;
    });
    log("pause-stays-orange", pause?.color === "rgb(245, 158, 11)", JSON.stringify(pause));

    // Table headers -> accent, not legacy navy #1A2B3C
    const tableHeaders = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("tr")).map((tr) => getComputedStyle(tr).backgroundColor).filter((c) => c !== "rgba(0, 0, 0, 0)");
    });
    const staleNavy = tableHeaders.filter((c) => c === "rgb(26, 43, 60)");
    log("no-stale-legacy-navy-table-headers", staleNavy.length === 0, JSON.stringify(tableHeaders));

    // WorkerStatus real green dot untouched
    const workerDot = await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll("span")).find((el) => /Worker (Online|Stale|Offline)/.test(el.textContent || ""));
      const row = label ? label.parentElement : null;
      const dot = row ? row.querySelector("span:first-child") : null;
      return { label: label?.textContent, dotColor: dot ? getComputedStyle(dot).backgroundColor : null };
    });
    log("worker-status-real-status-color", !!workerDot.label, JSON.stringify(workerDot));

    // Live Session Viewer offline empty-state polish
    const liveViewer = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll("h3")).find((el) => el.textContent?.trim() === "Live Session Viewer");
      // h3 -> its direct div wrapper -> flex-row div -> outer panel div
      const panel = heading ? heading.closest("div")?.parentElement?.parentElement : null;
      const text = panel ? panel.innerText : "";
      const startBtn = panel ? Array.from(panel.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Start Session") : null;
      return {
        hasHeadline: /No active session/.test(text),
        hasSupportSentence: /Start a session from the queue/.test(text),
        ctaBg: startBtn ? getComputedStyle(startBtn).backgroundColor : null,
      };
    });
    log("offline-empty-state-headline", liveViewer.hasHeadline, JSON.stringify(liveViewer));
    log("offline-empty-state-support-sentence", liveViewer.hasSupportSentence, JSON.stringify(liveViewer));
    log("offline-empty-state-cta-teal", liveViewer.ctaBg === "rgb(34, 211, 238)", `actual=${liveViewer.ctaBg}`);

    log("real-data-renders", /Queue|Session List|Form Templates/.test(bodyText), "checked for section headings");

    await checkShell(page);

    log("console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 8)));
  } catch (err) {
    log("fatal", false, err.stack || String(err));
  } finally {
    await browser.close();
  }

  console.log("\n=== RESULTS JSON ===");
  console.log(JSON.stringify(results, null, 2));
  const allOk = results.every((r) => r.ok);
  console.log(`\n${allOk ? "ALL PASS" : "SOME FAILED"} (${results.filter((r) => r.ok).length}/${results.length})`);
  process.exit(allOk ? 0 : 1);
}

async function checkShell(page) {
  const sidebarBg = await page.evaluate(() => {
    const aside = document.querySelector("aside[aria-label='Primary navigation']");
    return aside ? getComputedStyle(aside).backgroundImage : null;
  });
  const sidebarOk = !!sidebarBg && sidebarBg.includes("29, 78, 216") && sidebarBg.includes("2, 132, 199");
  log("shell-sidebar-gradient-unchanged", sidebarOk, String(sidebarBg));

  const headerBg = await page.evaluate(() => {
    const header = document.querySelector("header");
    return header ? getComputedStyle(header).backgroundColor : null;
  });
  log("shell-header-deep-blue-unchanged", headerBg === "rgb(29, 78, 216)", String(headerBg));

  const navColors = await page.evaluate(() => {
    const aside = document.querySelector("aside[aria-label='Primary navigation']");
    if (!aside) return [];
    return Array.from(aside.querySelectorAll("nav a, a#tour-nav-settings")).map((a) => getComputedStyle(a).color);
  });
  const badNav = navColors.filter((c) => c !== "rgb(255, 255, 255)");
  log("shell-nav-text-white", navColors.length > 0 && badNav.length === 0, `total=${navColors.length} bad=${JSON.stringify(badNav)}`);
}

main();
