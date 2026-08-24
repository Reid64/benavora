// Real verification for the Applications & Pipeline treatment (frame #101B2D,
// accent #2E6B66) pass on /deadlines, per PAGE_TREATMENT_PROTOCOL_V2.md.
// Reuses the magic-link login technique from prior accent-verification scripts.
// Runs against whatever is currently on disk - invoked once before the edit
// (via git stash) and once after, by the calling shell.
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

mkdirSync("smoke-test-output", { recursive: true });

const label = process.argv[2] || "after";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
  await loginAsFaith(context);
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  await page.goto(BASE_URL + "/deadlines?view=list&completed=1", { waitUntil: "load", timeout: 30000 });
  await page
    .waitForFunction(
      () => !Array.from(document.querySelectorAll("*")).some((el) => el.textContent?.trim() === "Loading deadlines..."),
      { timeout: 20000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1000);

  const checks = await page.evaluate(() => {
    function hex(rgb) {
      const m = rgb?.match(/\d+/g);
      if (!m) return rgb;
      return "#" + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
    }
    const title = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.includes("Deadlines"));
    const listBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "List");
    const deadlinesTabBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Deadlines");
    const allFilterBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "All");
    const groupCards = Array.from(document.querySelectorAll("div")).filter(
      (d) => d.className === "overflow-hidden" && d.children.length > 0 && d.querySelector("h2"),
    );
    const firstGroupCard = groupCards[0] || null;
    // Row-level urgency legend probes - must NOT be repainted.
    const legendDots = Array.from(document.querySelectorAll("span.h-2.w-2.rounded-full")).map((el) => hex(getComputedStyle(el).backgroundColor));
    const rows = Array.from(document.querySelectorAll("div")).filter((d) => d.style && d.style.borderLeft);
    const overdueRow = rows.find((r) => getComputedStyle(r).borderLeftColor && hex(getComputedStyle(r).borderLeftColor) === "#EF4444");
    const weekRow = rows.find((r) => getComputedStyle(r).borderLeftColor && hex(getComputedStyle(r).borderLeftColor) === "#F59E0B");

    return {
      titleColor: title ? hex(getComputedStyle(title).color) : null,
      listBtnActive: listBtn ? listBtn.getAttribute("aria-pressed") : null,
      listBtnBg: listBtn ? hex(getComputedStyle(listBtn).backgroundColor) : null,
      listBtnText: listBtn ? hex(getComputedStyle(listBtn).color) : null,
      tabSwitcherWrapperBorder: deadlinesTabBtn ? hex(getComputedStyle(deadlinesTabBtn.parentElement).borderTopColor) : null,
      deadlinesTabBg: deadlinesTabBtn ? hex(getComputedStyle(deadlinesTabBtn).backgroundColor) : null,
      allFilterBg: allFilterBtn ? hex(getComputedStyle(allFilterBtn).backgroundColor) : null,
      firstGroupCardBg: firstGroupCard ? hex(getComputedStyle(firstGroupCard).backgroundColor) : null,
      firstGroupCardBorder: firstGroupCard ? hex(getComputedStyle(firstGroupCard).borderTopColor) : null,
      legendDots,
      overdueRowBg: overdueRow ? hex(getComputedStyle(overdueRow).backgroundColor) : null,
      overdueRowBorder: overdueRow ? hex(getComputedStyle(overdueRow).borderLeftColor) : null,
      weekRowBg: weekRow ? hex(getComputedStyle(weekRow).backgroundColor) : null,
      weekRowBorder: weekRow ? hex(getComputedStyle(weekRow).borderLeftColor) : null,
      pageBg: hex(getComputedStyle(document.body).backgroundColor),
      mainBg: (() => {
        const main = document.querySelector("main");
        return main ? hex(getComputedStyle(main).backgroundColor) : null;
      })(),
    };
  });

  await page.screenshot({ path: `smoke-test-output/deadlines-${label}-2026-08-17.png`, fullPage: true });

  console.log(`=== ${label.toUpperCase()} ===`);
  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
