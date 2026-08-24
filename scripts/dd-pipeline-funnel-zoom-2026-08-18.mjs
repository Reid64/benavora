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

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  await page.goto("http://localhost:3000/donor-discovery", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  mkdirSync("smoke-test-output", { recursive: true });

  const info = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a")).filter((a) =>
      a.getAttribute("href")?.includes("/donor-discovery/prospects?stage="),
    );
    return links.map((el) => {
      const s = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        text: el.textContent.trim().replace(/\s+/g, " "),
        bg: s.backgroundColor,
        border: s.borderColor,
        borderWidth: s.borderWidth,
        boxShadow: s.boxShadow,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      };
    });
  });
  console.log(JSON.stringify(info, null, 2));

  const el = await page.$("text=Pipeline Funnel");
  if (el) {
    const box = await el.boundingBox();
    if (box) {
      await page.screenshot({
        path: "smoke-test-output/DD-PIPELINE-FUNNEL-ZOOM-after-2026-08-18.png",
        clip: { x: 0, y: box.y - 20, width: 1440, height: 260 },
      });
    }
  }

  await browser.close();
})();
