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

const PAGES = [
  { name: "admin-system", url: "/admin/system", wait: 4000 },
  { name: "command-center", url: "/command-center", wait: 4000 },
  { name: "admin-autoapply-ops", url: "/admin/autoapply-ops", wait: 9000 },
  { name: "admin-monitor", url: "/admin/monitor", wait: 4000 },
  { name: "admin-improvements", url: "/admin/improvements", wait: 4000 },
  { name: "applications", url: "/applications", wait: 4000 },
];

async function main() {
  mkdirSync("smoke-test-output", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const p of PAGES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
    await loginAsFaith(context);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    await page.goto(`http://localhost:3000${p.url}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(p.wait);

    const audit = await page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      const offenders = [];
      main.querySelectorAll("*").forEach((el) => {
        const cs = getComputedStyle(el);
        for (const prop of ["color", "backgroundColor"]) {
          const v = cs[prop];
          const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (!m) continue;
          const [, r, g, b, a] = m;
          const alpha = a === undefined ? 1 : parseFloat(a);
          if (alpha === 0) continue;
          const isIvory = (+r === 248 && +g === 245 && +b === 238) || (+r === 247 && +g === 245 && +b === 241) || (+r === 251 && +g === 250 && +b === 247);
          const isPureWhiteText = prop === "color" && +r === 255 && +g === 255 && +b === 255;
          // pure white text is fine on dark backgrounds (sidebar, navy table headers) - only flag it if
          // its own background isn't dark.
          if (+r >= 240 && +g >= 240 && +b >= 240 && !isIvory) {
            if (isPureWhiteText) {
              // check ancestor for a dark bg within 3 levels
              let anc = el;
              let onDark = false;
              for (let i = 0; i < 4 && anc; i++) {
                const bg = getComputedStyle(anc).backgroundColor;
                const bm = bg.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (bm && +bm[1] < 60 && +bm[2] < 60 && +bm[3] < 80) { onDark = true; break; }
                anc = anc.parentElement;
              }
              if (onDark) continue;
            }
            offenders.push({
              tag: el.tagName,
              cls: el.className?.toString().slice(0, 70),
              prop,
              v,
            });
          }
        }
      });
      return { offenderCount: offenders.length, sample: offenders.slice(0, 15) };
    });

    results.push({ name: p.name, consoleErrors: consoleErrors.slice(0, 10), ...audit });
    await context.close();
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
