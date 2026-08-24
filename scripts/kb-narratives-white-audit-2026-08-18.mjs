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
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const hash = (verifyResp.headers.get("location") || "").split("#")[1];
  const params = new URLSearchParams(hash);
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token: params.get("access_token"), refresh_token: params.get("refresh_token") });
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" })));
}

function isNearWhite(rgb) {
  const m = rgb.match(/\d+/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  return r > 235 && g > 235 && b > 235;
}

async function auditPage(page, url, label) {
  await page.goto(`http://localhost:3000${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  mkdirSync("smoke-test-output", { recursive: true });
  await page.screenshot({ path: `smoke-test-output/KB-WHITE-AUDIT-${label}.png`, fullPage: true });

  const findings = await page.evaluate(() => {
    const results = [];
    const all = document.querySelectorAll("main *");
    for (const el of all) {
      if (el.children.length > 0) continue; // leaf nodes only
      const text = (el.textContent || "").trim();
      if (!text) continue;
      const style = getComputedStyle(el);
      const color = style.color;
      // walk up for effective background
      let bgEl = el;
      let bg = "rgba(0, 0, 0, 0)";
      while (bgEl) {
        const s = getComputedStyle(bgEl);
        if (s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)") {
          bg = s.backgroundColor;
          break;
        }
        bgEl = bgEl.parentElement;
      }
      results.push({ text: text.slice(0, 60), color, bg, tag: el.tagName });
    }
    return results;
  });

  function isNearWhiteJs(rgb) {
    const m = rgb.match(/\d+/g);
    if (!m) return false;
    const [r, g, b] = m.map(Number);
    return r > 235 && g > 235 && b > 235;
  }

  const whiteOnWhite = findings.filter((f) => isNearWhiteJs(f.color) && isNearWhiteJs(f.bg));
  console.log(`\n=== ${label} (${url}) ===`);
  console.log(`Total leaf text nodes: ${findings.length}`);
  console.log(`White-on-white candidates: ${whiteOnWhite.length}`);
  for (const w of whiteOnWhite) {
    console.log(`  [${w.tag}] "${w.text}" color=${w.color} bg=${w.bg}`);
  }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await loginAsFaith(context);
  const page = await context.newPage();

  await auditPage(page, "/knowledge-base", "overview");
  await auditPage(page, "/knowledge-base/narratives", "narratives");

  await browser.close();
})();
