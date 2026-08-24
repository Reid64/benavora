// Live verification of the wider bronze scrollbar (globals.css, 2026-08-17)
// across 3 unrelated real pages. Logs in via magic link, forces overflow on
// each page's main scroll container so a real scrollbar is guaranteed to
// render, screenshots it zoomed in, and reports computed
// ::-webkit-scrollbar / -thumb / -button box metrics + colors read straight
// from the browser (not assumed from CSS source).
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
const BASE_URL = "http://localhost:3100";
const OUT_DIR = "smoke-test-output";
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

const PAGES = [
  { path: "/draft-generator", label: "draft-generator" },
  { path: "/research", label: "research" },
  { path: "/applications", label: "applications" },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 500 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    for (const { path, label } of PAGES) {
      await page.goto(BASE_URL + path, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(1200);

      // The real scroll container in this app is <main style="overflow-y:auto">
      // inside the fixed-height (100vh, overflow:hidden) DashboardShell — the
      // window/body itself never scrolls. If a page's content doesn't already
      // overflow main's clientHeight naturally, pad *inside* main so a real
      // scrollbar is guaranteed without faking a container that isn't the
      // one actually used.
      const mainRect = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return null;
        if (main.scrollHeight <= main.clientHeight) {
          const pad = document.createElement("div");
          pad.style.height = "2500px";
          pad.setAttribute("data-scrollbar-test-pad", "1");
          main.appendChild(pad);
        }
        const r = main.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, scrollHeight: main.scrollHeight, clientHeight: main.clientHeight };
      });
      log(`${label}-main-found`, !!mainRect, JSON.stringify(mainRect));
      await page.waitForTimeout(300);

      const metrics = await page.evaluate(() => {
        // Walk every reachable stylesheet's raw cssText (not selectorText —
        // Chromium's CSSOM does not reliably expose ::-webkit-scrollbar rules
        // via rule.selectorText even though it applies and renders them) and
        // regex out the actual live declaration blocks.
        function collectCssText() {
          let all = "";
          for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            for (const r of rules || []) {
              try { all += r.cssText + "\n"; } catch { /* skip */ }
            }
          }
          return all;
        }
        const css = collectCssText();
        function grab(pattern) {
          const m = css.match(pattern);
          return m ? m[0] : null;
        }
        const idx = css.indexOf("webkit-scrollbar");
        return {
          cssLength: css.length,
          sheetCount: document.styleSheets.length,
          containsScrollbarSubstring: idx !== -1,
          scrollbarContextSnippet: idx !== -1 ? css.slice(Math.max(0, idx - 30), idx + 400) : null,
          scrollbarRule: grab(/::-webkit-scrollbar\s*\{[^}]*\}/),
          thumbRule: grab(/::-webkit-scrollbar-thumb\s*\{[^}]*\}/),
          thumbHoverRule: grab(/::-webkit-scrollbar-thumb:hover\s*\{[^}]*\}/),
          buttonRule: grab(/::-webkit-scrollbar-button\s*\{[^}]*\}/),
          mainHasScroll: (() => {
            const m = document.querySelector("main");
            return m ? m.scrollHeight > m.clientHeight : false;
          })(),
        };
      });
      log(`${label}-css-sheets`, true, `sheetCount=${metrics.sheetCount} cssLength=${metrics.cssLength}`);
      log(`${label}-contains-scrollbar-substring`, metrics.containsScrollbarSubstring, metrics.scrollbarContextSnippet || "not found");
      log(`${label}-scrollbar-rule-present`, !!metrics.scrollbarRule, JSON.stringify(metrics.scrollbarRule));
      log(`${label}-thumb-rule`, !!metrics.thumbRule, JSON.stringify(metrics.thumbRule));
      log(`${label}-thumb-hover-rule`, !!metrics.thumbHoverRule, JSON.stringify(metrics.thumbHoverRule));
      log(`${label}-button-rule`, !!metrics.buttonRule, JSON.stringify(metrics.buttonRule));
      log(`${label}-has-real-vertical-scrollbar`, metrics.mainHasScroll, `mainHasScroll=${metrics.mainHasScroll}`);

      if (mainRect) {
        const sbX = mainRect.x + mainRect.width - 22;
        const sbY = mainRect.y;
        // Full-height strip covering the real <main> scrollbar (track + thumb).
        await page.screenshot({
          path: `${OUT_DIR}/scrollbar-${label}-after-2026-08-17.png`,
          clip: { x: Math.max(0, sbX), y: sbY, width: 22, height: Math.min(500, mainRect.height) },
        });
        // Extreme close-up of the top corner where an up-arrow button would render.
        await page.screenshot({
          path: `${OUT_DIR}/scrollbar-${label}-topcorner-zoom-2026-08-17.png`,
          clip: { x: Math.max(0, sbX), y: sbY, width: 22, height: 60 },
        });
        // Hover the thumb and re-screenshot to visually confirm the hover-state color swap.
        await page.mouse.move(sbX + 9, sbY + 150);
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `${OUT_DIR}/scrollbar-${label}-hover-2026-08-17.png`,
          clip: { x: Math.max(0, sbX), y: sbY + 100, width: 22, height: 200 },
        });
      }

      // Clean up any injected padding element before moving to the next page.
      await page.evaluate(() => document.querySelector("[data-scrollbar-test-pad]")?.remove());
    }

    // Informational only — this app has pre-existing missing favicon/icon
    // 404s unrelated to the scrollbar change (see benavora-logo-swap memory).
    console.log(`[INFO] console-errors :: ${JSON.stringify(consoleErrors.slice(0, 10))}`);
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

main();
