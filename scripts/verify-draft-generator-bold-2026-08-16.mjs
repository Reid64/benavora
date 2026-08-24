// Verification for the bold solid-fill accent capability test on /draft-generator
// (2026-08-16). Checks: page loads, sidebar is a solid #2563EB fill, the active
// wizard step uses a white/light treatment against it, stat cards carry an 8px
// #2563EB top bar, the primary CTA is solid #22D3EE with dark text, no console
// errors, and takes a full-page screenshot.
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  try {
    await page.goto(BASE_URL + "/draft-generator", { waitUntil: "load", timeout: 30000 });
    await page
      .waitForFunction(
        () => !Array.from(document.querySelectorAll("p")).some((p) => p.textContent?.trim() === "Loading opportunities..."),
        { timeout: 20000 },
      )
      .catch(() => {});
    await page.waitForTimeout(800);
    log("loaded", page.url().includes("/draft-generator"), page.url());

    await page.screenshot({ path: `smoke-test-output/draft-generator-bold-after-2026-08-16.png`, fullPage: true });
    await page.screenshot({ path: `smoke-test-output/draft-generator-bold-viewport-2026-08-16.png`, fullPage: false });

    // Sidebar solid fill
    const sidebar = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === "Grant Draft Wizard");
      const box = p ? p.closest("div").parentElement : null;
      return {
        bg: box ? getComputedStyle(box).backgroundColor : null,
        labelColor: p ? getComputedStyle(p).color : null,
      };
    });
    log("sidebar-solid-2563EB-fill", sidebar.bg === "rgb(37, 99, 235)", `actual=${sidebar.bg}`);
    log("sidebar-label-white", sidebar.labelColor === "rgb(255, 255, 255)", `actual=${sidebar.labelColor}`);

    // Active step: white/light row against the blue fill
    const steps = await page.evaluate(() => {
      const labels = ["Select Opportunity", "Customize", "Generate", "Review & Export"];
      return labels.map((label) => {
        const span = Array.from(document.querySelectorAll("span")).find((el) => el.textContent?.trim() === label);
        if (!span) return { label, found: false };
        const row = span.parentElement;
        return {
          label,
          found: true,
          textColor: getComputedStyle(span).color,
          rowBg: row ? getComputedStyle(row).backgroundColor : null,
        };
      });
    });
    for (const s of steps) log(`wizard-step:${s.label}`, s.found, JSON.stringify(s));
    const whiteActiveRow = steps.find((s) => s.rowBg === "rgb(255, 255, 255)");
    log("active-step-is-white-block", !!whiteActiveRow, JSON.stringify(steps.map((s) => s.rowBg)));

    // Stat cards top bar
    const cardBars = await page.evaluate(() => {
      const labels = ["Total Drafts", "AI Drafts Pending", "Drafts This Month", "Avg Confidence"];
      return labels.map((label) => {
        const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === label);
        const card = p ? p.parentElement : null;
        const cs = card ? getComputedStyle(card) : null;
        return { label, found: !!card, borderTopColor: cs?.borderTopColor, borderTopWidth: cs?.borderTopWidth };
      });
    });
    for (const c of cardBars) log(`stat-card-top-bar:${c.label}`, c.found && c.borderTopColor === "rgb(37, 99, 235)" && c.borderTopWidth === "8px", JSON.stringify(c));

    // Primary CTA: solid teal fill, dark text
    const cta = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((el) => /Generate (draft|new version)/.test(el.textContent || ""));
      return btn ? { bg: getComputedStyle(btn).backgroundColor, color: getComputedStyle(btn).color, text: btn.textContent } : null;
    });
    log("cta-solid-22D3EE", !!cta && cta.bg === "rgb(34, 211, 238)", JSON.stringify(cta));
    log("cta-dark-text", !!cta && cta.color === "rgb(15, 23, 42)", JSON.stringify(cta));

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

main();
