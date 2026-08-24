// Dashboard/Home page treatment verification — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Rich Gold #B88A2E. Secondary accent: Deep Navy #101B2D.
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

async function main() {
  const tag = process.argv[2] || "after";
  mkdirSync("smoke-test-output", { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  await page.goto(BASE_URL + "/dashboard", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3500);

  await page.screenshot({ path: `smoke-test-output/dashboard-${tag}-viewport-2026-08-18.png`, fullPage: false });
  await page.screenshot({ path: `smoke-test-output/dashboard-${tag}-full-2026-08-18.png`, fullPage: true });

  const result = await page.evaluate(() => {
    const out = {};
    const h1 = document.querySelector("h1");
    if (h1) { out.h1Text = h1.textContent?.trim(); out.h1Color = getComputedStyle(h1).color; }

    const main = document.querySelector("main") || document.body;
    out.pageBg = getComputedStyle(main.parentElement || main).backgroundColor;

    // white/near-white audit, scoped to the dashboard's own content root
    // (the deepest wrapper that has the Soft Stone bg), excluding global nav chrome.
    const offenders = [];
    const scanRoot = document.querySelector('[style*="D8D3C8"]') || document.body;
    scanRoot.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      for (const prop of ["color", "backgroundColor"]) {
        const v = cs[prop];
        const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          const [r, g, b] = [+m[1], +m[2], +m[3]];
          const isIvory = r === 248 && g === 245 && b === 238;
          const alphaZero = /rgba\([^)]+,\s*0\)/.test(v);
          if (r >= 240 && g >= 240 && b >= 240 && !isIvory && !alphaZero) {
            offenders.push({ tag: el.tagName, cls: el.className?.toString().slice(0, 60), prop, v });
          }
        }
      }
    });
    out.offenderCount = offenders.length;
    out.offendersSample = offenders.slice(0, 25);

    // Frame color check — the gold panelFrameStyle wrapper (backgroundColor #B88A2E).
    const frames = [...document.querySelectorAll("div")].filter(
      (el) => getComputedStyle(el).backgroundColor === "rgb(184, 138, 46)",
    );
    out.goldFrameCount = frames.length;
    out.goldFrameSampleBg = frames[0] ? getComputedStyle(frames[0]).backgroundColor : null;

    // Ivory inner-content check (Warm Ivory #F8F5EE).
    const inners = [...document.querySelectorAll("div")].filter(
      (el) => getComputedStyle(el).backgroundColor === "rgb(248, 245, 238)",
    );
    out.ivoryInnerCount = inners.length;

    // Header text (Deep Navy #101B2D) on Soft Stone.
    if (h1) out.h1ComputedRGB = getComputedStyle(h1).color;

    // AutoApply Engine button (secondary accent family, Teal gradient) — one real button check.
    const links = [...document.querySelectorAll("a")];
    const openAutoApply = links.find((a) => a.textContent?.trim() === "Open AutoApply");
    if (openAutoApply) {
      const cs = getComputedStyle(openAutoApply);
      out.autoApplyButton = { background: cs.backgroundImage || cs.backgroundColor, color: cs.color };
    }

    return out;
  });

  console.log(`=== dashboard (${tag}) ===`);
  console.log("url:", page.url());
  console.log("COMPUTED:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors.slice(0, 15)));

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
