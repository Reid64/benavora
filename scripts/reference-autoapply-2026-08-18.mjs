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

async function main() {
  mkdirSync("smoke-test-output", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  await page.goto("http://localhost:3000/autoapply", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: "smoke-test-output/REFERENCE-autoapply-full-2026-08-18.png", fullPage: true });
  await page.screenshot({ path: "smoke-test-output/REFERENCE-autoapply-viewport-2026-08-18.png", fullPage: false });

  const struct = await page.evaluate(() => {
    const out = {};

    // Sidebar
    const sidebar = document.querySelector("aside");
    if (sidebar) {
      const cs = getComputedStyle(sidebar);
      out.sidebar = { bg: cs.backgroundColor, borderRight: cs.borderRight };
    }

    // Stat cards - find elements with "Sessions Today" style labels
    const labels = Array.from(document.querySelectorAll("p, span, div")).filter((el) =>
      el.children.length === 0 && /^(Sessions Today|Success Rate|Total Applied|Avg\. Time|Queue Depth)$/i.test(el.textContent?.trim() || "")
    );
    out.statCards = labels.slice(0, 6).map((label) => {
      let el = label;
      // walk up up to 4 levels collecting bg/shadow/border info
      const chain = [];
      for (let i = 0; i < 4 && el; i++) {
        const cs = getComputedStyle(el);
        chain.push({
          tag: el.tagName,
          bg: cs.backgroundColor,
          boxShadow: cs.boxShadow,
          border: cs.border,
          borderRadius: cs.borderRadius,
          padding: cs.padding,
        });
        el = el.parentElement;
      }
      return { label: label.textContent?.trim(), chain };
    });

    // Any element with a top-border color hint (rainbow-border check)
    const topBorderEls = Array.from(document.querySelectorAll("*")).filter((el) => {
      const cs = getComputedStyle(el);
      return cs.borderTopWidth !== "0px" && cs.borderTopStyle !== "none";
    });
    out.topBorderSample = topBorderEls.slice(0, 10).map((el) => ({
      tag: el.tagName, cls: el.className?.toString().slice(0, 60),
      borderTop: getComputedStyle(el).borderTop,
    }));

    // h1 / page heading color
    const h1 = document.querySelector("h1");
    out.h1 = h1 ? { text: h1.textContent?.trim(), color: getComputedStyle(h1).color } : null;

    // Primary buttons
    const buttons = Array.from(document.querySelectorAll("button")).slice(0, 10).map((b) => ({
      text: b.textContent?.trim().slice(0, 30),
      bg: getComputedStyle(b).backgroundColor,
      color: getComputedStyle(b).color,
    }));
    out.buttons = buttons;

    // main background
    const main = document.querySelector("main");
    out.mainBg = main ? getComputedStyle(main).backgroundColor : null;

    return out;
  });

  console.log(JSON.stringify(struct, null, 2));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
