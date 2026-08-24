// Live production computed-style check for /draft-generator (2026-08-17).
// Reads REAL rendered background-color via getComputedStyle against
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(BASE_URL + "/draft-generator", { waitUntil: "load", timeout: 45000 });
  await page
    .waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("p")).some(
          (p) => p.textContent?.trim() === "Loading opportunities...",
        ),
      { timeout: 20000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    function cs(el) {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        tag: el.tagName,
        className: el.className || null,
        backgroundColor: s.backgroundColor,
        background: s.background,
      };
    }

    // (a) page's root/outer container - report BOTH candidates since there
    // are two nested containers: the DashboardShell <main> wrapper, and the
    // draft-generator page's own root div.
    const mainEl = document.querySelector("main");
    const pageRootEl = mainEl ? mainEl.firstElementChild : null;
    const outerFlexShell = document.querySelector("body > div") || document.body.firstElementChild;

    // (b) wizard sidebar panel - identified by its "Grant Draft Wizard" label
    const wizardLabel = Array.from(document.querySelectorAll("p")).find(
      (p) => p.textContent?.trim() === "Grant Draft Wizard",
    );
    const wizardPanelEl = wizardLabel ? wizardLabel.parentElement : null;

    // (c) one of the 4 stat cards - identified by "Total Drafts" label
    const statLabel = Array.from(document.querySelectorAll("p")).find(
      (p) => p.textContent?.trim() === "Total Drafts",
    );
    const statCardEl = statLabel ? statLabel.parentElement : null;

    return {
      url: location.href,
      bodyBg: cs(document.body),
      outerFlexShell: cs(outerFlexShell),
      mainWrapper: cs(mainEl),
      pageRoot: cs(pageRootEl),
      wizardPanel: cs(wizardPanelEl),
      statCard: cs(statCardEl),
      statCardHTML: statCardEl ? statCardEl.outerHTML.slice(0, 300) : null,
      wizardPanelHTML: wizardPanelEl ? wizardPanelEl.outerHTML.slice(0, 200) : null,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors.slice(0, 10)));

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
