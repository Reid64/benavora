// Live verification of the draft-editor unresolved-gaps UX remediation
// (2026-08-20). Logs in as a real user via magic link (no password), opens
// a real draft with multiple live [NEEDS INPUT] gaps, and screenshots the
// before/after behavior of: all-gaps highlighting, active-gap distinction,
// badge-click auto-scroll, next-gap auto-scroll, and count decrementing as
// gaps are resolved.
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
const APP_ID = "581f6778-5984-4226-ba8a-2b792042319d";
const OUT_DIR = "test-evidence/remediation/gaps-ux";
mkdirSync(OUT_DIR, { recursive: true });

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

async function gapState(page) {
  return page.evaluate(() => {
    // Read-only mode: highlighted spans have id="gap-N". Edit mode: they're
    // unidentified spans inside the aria-hidden backdrop layer.
    const spans = Array.from(
      document.querySelectorAll('[id^="gap-"], div[aria-hidden] span'),
    );
    const countBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("unresolved gap"),
    );
    const activeIdx = spans.findIndex((s) => getComputedStyle(s).backgroundColor.includes("0.55"));
    const activeSpan = activeIdx >= 0 ? spans[activeIdx] : null;
    let activeOnScreen = null;
    if (activeSpan) {
      const clip = activeSpan.closest("[aria-hidden]")?.parentElement?.getBoundingClientRect();
      const r = activeSpan.getBoundingClientRect();
      activeOnScreen = clip ? r.bottom > clip.top && r.top < clip.bottom : null;
    }
    return {
      spanCount: spans.length,
      countLabel: countBtn ? countBtn.textContent.trim() : null,
      spanBackgrounds: spans.map((s) => getComputedStyle(s).backgroundColor),
      activeOnScreen,
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const mode = process.argv[2]; // "before" or "after"

  await page.goto(`${BASE_URL}/draft-generator/${APP_ID}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("textarea", { timeout: 20000 });
  await page.waitForTimeout(1500); // allow backdrop highlight nodes to paint

  const state0 = await gapState(page);
  log("initial-load", state0.spanCount > 0, `${mode}: ${state0.spanCount} gap spans, badge="${state0.countLabel}"`);
  await page.screenshot({ path: `${OUT_DIR}/${mode}-01-loaded.png`, fullPage: false });

  // Click the "N unresolved gaps" badge -> should jump/scroll/focus the first gap.
  const badge = page.locator("button", { hasText: "unresolved gap" }).first();
  await badge.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT_DIR}/${mode}-02-badge-click-first-gap.png`, fullPage: false });

  // Click "Next gap →" twice -> active gap should advance each time, auto-scrolling.
  const nextBtn = page.locator("button", { hasText: "Next gap" });
  await nextBtn.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT_DIR}/${mode}-03-next-gap-1.png`, fullPage: false });
  await nextBtn.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT_DIR}/${mode}-04-next-gap-2.png`, fullPage: false });

  const stateAfterNav = await gapState(page);
  const strongCount = stateAfterNav.spanBackgrounds.filter((bg) => bg.includes("0.55")).length;
  const weakCount = stateAfterNav.spanBackgrounds.filter((bg) => bg.includes("0.22")).length;
  log(
    "all-gaps-highlighted-one-active",
    stateAfterNav.spanCount > 1 && strongCount === 1 && weakCount === stateAfterNav.spanCount - 1,
    `${mode}: ${stateAfterNav.spanCount} spans, ${strongCount} active(strong), ${weakCount} inactive(weak), badge="${stateAfterNav.countLabel}"`,
  );
  log(
    "active-gap-scrolled-into-view",
    stateAfterNav.activeOnScreen === true,
    `${mode}: activeOnScreen=${stateAfterNav.activeOnScreen}`,
  );

  // Resolve the first gap by editing it out of the textarea value directly
  // (simulates the operator typing over the placeholder), then confirm the
  // count decrements.
  const before = await gapState(page);
  await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    const newVal = ta.value.replace(/\[NEEDS INPUT[^\]]*\]/, "Filled in by operator.");
    nativeSetter.call(ta, newVal);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(800);
  const after = await gapState(page);
  log(
    "gap-resolved-decrements-count",
    after.spanCount === before.spanCount - 1,
    `${mode}: ${before.spanCount} -> ${after.spanCount}, badge="${after.countLabel}"`,
  );
  await page.screenshot({ path: `${OUT_DIR}/${mode}-05-after-resolve-one-gap.png`, fullPage: false });

  await browser.close();

  console.log("\n=== Console errors captured ===");
  console.log(consoleErrors.length ? consoleErrors.join("\n") : "(none)");

  console.log("\n=== Results summary ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}: ${r.detail}`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
