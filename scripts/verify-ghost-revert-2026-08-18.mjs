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

const CHECKS = [
  { url: "/compliance", section: "Compliance", buttonText: null },
  { url: "/outreach", section: "Outreach" },
  { url: "/outreach/templates", section: "Outreach Templates" },
  { url: "/email/campaigns", section: "Email Campaigns" },
  { url: "/email/templates", section: "Email Templates" },
  { url: "/outcomes", section: "Outcomes" },
  { url: "/admin/audit-log", section: "Admin Audit Log" },
  { url: "/admin/autoapply-ops", section: "Admin AutoApply Ops" },
  { url: "/admin/sales-outreach", section: "Admin Sales Outreach" },
  { url: "/admin/orgs", section: "Admin Orgs (Impersonate)" },
];

async function main() {
  mkdirSync("smoke-test-output", { recursive: true });
  const browser = await chromium.launch({ headless: true });

  for (const c of CHECKS) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
    await loginAsFaith(context);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://localhost:3000${c.url}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.map((b) => {
        const cs = getComputedStyle(b);
        return {
          text: b.textContent?.trim().slice(0, 30),
          bg: cs.backgroundColor,
          color: cs.color,
          border: cs.border,
        };
      }).filter((b) => b.text);
    });

    await page.screenshot({ path: `smoke-test-output/ghost-revert-${c.url.replace(/\//g, "_")}-2026-08-18.png`, fullPage: true });
    console.log(`\n=== ${c.section} (${c.url}) === errors:${JSON.stringify(errors)}`);
    console.log(JSON.stringify(info, null, 2));
    await context.close();
  }

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
