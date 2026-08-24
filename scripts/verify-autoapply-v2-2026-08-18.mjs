// Verify /autoapply v2 rollout (Draft & Automation, Rich Gold #B88A2E frame).
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

async function main() {
  const tag = process.argv[2] || "check";
  mkdirSync("smoke-test-output", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  await page.goto("http://localhost:3000/autoapply", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);

  await page.screenshot({ path: `smoke-test-output/autoapply-${tag}-viewport-2026-08-18.png`, fullPage: false });
  await page.screenshot({ path: `smoke-test-output/autoapply-${tag}-full-2026-08-18.png`, fullPage: true });

  const result = await page.evaluate(() => {
    const out = {};
    const main = document.querySelector("main");
    out.mainBg = main ? getComputedStyle(main).backgroundColor : null;

    const h1 = document.querySelector("h1");
    out.h1Text = h1?.textContent?.trim() ?? null;
    out.h1Color = h1 ? getComputedStyle(h1).color : null;

    // Outer page wrapper div (first child of main, or main's direct content div)
    const outerDiv = document.querySelector("main > div");
    out.outerDivBg = outerDiv ? getComputedStyle(outerDiv).backgroundColor : null;

    // Stat cards: find divs whose text includes "Sessions Today"
    const statLabel = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.trim() === "Sessions Today");
    if (statLabel) {
      // walk up to find the card-ish ancestor with a background
      let el = statLabel.parentElement;
      out.statCardBg = el ? getComputedStyle(el).backgroundColor : null;
      let frameEl = el?.parentElement ?? null;
      out.statFrameBg = frameEl ? getComputedStyle(frameEl).backgroundColor : null;
      out.statFrameShadow = frameEl ? getComputedStyle(frameEl).boxShadow : null;
    }

    // Live Session Viewer panel
    const lsvHeading = Array.from(document.querySelectorAll("h3")).find((h) => h.textContent?.trim() === "Live Session Viewer");
    if (lsvHeading) {
      const inner = lsvHeading.closest("div")?.parentElement ?? null;
      out.lsvInnerBg = inner ? getComputedStyle(inner).backgroundColor : null;
      const frame = inner?.parentElement ?? null;
      out.lsvFrameBg = frame ? getComputedStyle(frame).backgroundColor : null;
      out.lsvHeadingColor = getComputedStyle(lsvHeading).color;
    }

    // Buttons: Add to Queue, Settings, Start Session
    const addToQueueBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Add to Queue");
    out.addToQueueBg = addToQueueBtn ? getComputedStyle(addToQueueBtn).backgroundColor : null;
    const settingsBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Settings"));
    out.settingsBg = settingsBtn ? getComputedStyle(settingsBtn).backgroundColor : null;
    out.settingsColor = settingsBtn ? getComputedStyle(settingsBtn).color : null;
    const startSessionBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Start Session");
    out.startSessionBg = startSessionBtn ? getComputedStyle(startSessionBtn).backgroundColor : null;

    // Worker status / IDLE preservation check
    out.idleText = document.body.innerText.includes("IDLE") ? "found" : (document.body.innerText.includes("ACTIVE") ? "ACTIVE-found" : "neither-found");
    out.workerOnlineText = document.body.innerText.includes("Worker Online") ? "found" : (document.body.innerText.includes("Worker Offline") ? "Worker Offline-found" : (document.body.innerText.includes("No worker data") ? "no-worker-data" : "not-found"));

    // White-value scan scoped to <main>
    const offenders = [];
    document.querySelectorAll("main *").forEach((el) => {
      const cs = getComputedStyle(el);
      for (const prop of ["color", "backgroundColor"]) {
        const v = cs[prop];
        const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          const [r, g, b] = [+m[1], +m[2], +m[3]];
          const isIvory = r === 248 && g === 245 && b === 238;
          const alphaZero = /rgba\([^)]+,\s*0\)/.test(v);
          if (r >= 240 && g >= 240 && b >= 240 && !isIvory && !alphaZero) {
            offenders.push({ tag: el.tagName, cls: el.className?.toString().slice(0, 50), prop, v });
          }
        }
      }
    });
    out.offenderCount = offenders.length;
    out.offendersSample = offenders.slice(0, 15);

    return out;
  });

  console.log(`=== /autoapply (${tag}) ===`);
  console.log(JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors.slice(0, 10)));

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
