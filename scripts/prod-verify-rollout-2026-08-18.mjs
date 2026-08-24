// Live production verification of the 2026-08-17 v2 rollout (commit 514e6b0).
// Reads REAL computed-style values via getComputedStyle against
// https://benavora.com, authenticated as a real user (magic-link technique).
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
const BASE_URL = "https://benavora.com";
const COOKIE_DOMAIN = ".benavora.com";
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
  if (!access_token || !refresh_token) {
    throw new Error("No tokens in magic-link redirect: " + location);
  }
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  await context.addCookies(
    setCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: COOKIE_DOMAIN,
      path: "/",
      secure: true,
      sameSite: "Lax",
    })),
  );
}

async function checkPage(context, route, checks) {
  const page = await context.newPage();
  const failedReqs = [];
  page.on("response", (resp) => { if (resp.status() >= 400) failedReqs.push(resp.status() + " " + resp.url()); });
  await page.goto(BASE_URL + route, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(3000);

  // Also grab the x-vercel-id / deployment header from the document response.
  const resp = await page.goto(BASE_URL + route, { waitUntil: "load", timeout: 45000 });
  const headers = resp ? resp.headers() : {};

  const result = await page.evaluate(checks);
  console.log(`\n=== ${route} ===`);
  console.log("x-vercel-id:", headers["x-vercel-id"] || "(none)");
  console.log("x-vercel-cache:", headers["x-vercel-cache"] || "(none)");
  console.log("age:", headers["age"] || "(none)");
  console.log("cache-control:", headers["cache-control"] || "(none)");
  console.log("RESULT:", JSON.stringify(result, null, 2));
  if (failedReqs.length) console.log("failed reqs:", JSON.stringify(failedReqs.slice(0, 10)));
  await page.screenshot({ path: `smoke-test-output/PROD${route.replace(/\//g, "_")}-2026-08-18.png`, fullPage: false });
  await page.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await loginAsFaith(context);

  await checkPage(context, "/admin/orgs", () => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Impersonate"));
    return {
      found: !!btn,
      backgroundColor: btn ? getComputedStyle(btn).backgroundColor : null,
      borderColor: btn ? getComputedStyle(btn).borderColor : null,
      outerHTMLSample: btn ? btn.outerHTML.slice(0, 200) : null,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    };
  });

  await checkPage(context, "/compliance", () => {
    const h1 = document.querySelector("h1");
    return {
      h1Text: h1?.textContent?.trim() ?? null,
      h1Color: h1 ? getComputedStyle(h1).color : null,
      mainBg: document.querySelector("main") ? getComputedStyle(document.querySelector("main")).backgroundColor : null,
    };
  });

  await checkPage(context, "/email", () => {
    const h1 = document.querySelector("h1");
    return {
      h1Text: h1?.textContent?.trim() ?? null,
      h1Color: h1 ? getComputedStyle(h1).color : null,
    };
  });

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
