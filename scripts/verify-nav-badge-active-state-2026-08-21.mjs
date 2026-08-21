// Confirms the active/hover row background doesn't clip the badge: navigates
// to /alerts (making the Alerts row "active"), hovers the Deadlines row, and
// checks each row's own overflow + that badgeRect stays within rowRect.
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
const BASE_URL = "http://localhost:3100";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAs(context, email) {
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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await loginAs(context, "info@faithfoundationsf.org");
  const page = await context.newPage();

  // Active state: /alerts makes the Alerts row aria-current="page".
  await page.goto(`${BASE_URL}/alerts`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2000);

  const alertsRow = page.locator("aside a[aria-current='page']").first();
  const activeCheck = await alertsRow.evaluate((row) => {
    const badge = Array.from(row.querySelectorAll(":scope > span")).find((s) => {
      const cs = getComputedStyle(s);
      return cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)";
    });
    const rowRect = row.getBoundingClientRect();
    const rowOverflow = getComputedStyle(row).overflow;
    if (!badge) return { hasBadge: false, rowOverflow };
    const badgeRect = badge.getBoundingClientRect();
    const fullyWithinRow =
      badgeRect.left >= rowRect.left - 0.5 &&
      badgeRect.right <= rowRect.right + 0.5 &&
      badgeRect.top >= rowRect.top - 0.5 &&
      badgeRect.bottom <= rowRect.bottom + 0.5;
    return {
      hasBadge: true,
      rowOverflow,
      rowBg: getComputedStyle(row).backgroundColor,
      badgeVisible: getComputedStyle(badge).visibility !== "hidden" && badgeRect.width > 0,
      fullyWithinRow,
      rowRect: { left: rowRect.left, right: rowRect.right, width: rowRect.width },
      badgeRect: { left: badgeRect.left, right: badgeRect.right, width: badgeRect.width },
    };
  });
  console.log("ACTIVE STATE (Alerts, /alerts):", JSON.stringify(activeCheck, null, 2));

  // Hover state: hover the Deadlines row on /donor-discovery.
  await page.goto(`${BASE_URL}/donor-discovery`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2000);
  const deadlinesRow = page.locator("aside a", { hasText: "Deadlines" }).first();
  await deadlinesRow.hover();
  await page.waitForTimeout(300);
  const hoverCheck = await deadlinesRow.evaluate((row) => {
    const badge = Array.from(row.querySelectorAll(":scope > span")).find((s) => {
      const cs = getComputedStyle(s);
      return cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)";
    });
    const rowRect = row.getBoundingClientRect();
    const rowOverflow = getComputedStyle(row).overflow;
    if (!badge) return { hasBadge: false, rowOverflow };
    const badgeRect = badge.getBoundingClientRect();
    const fullyWithinRow =
      badgeRect.left >= rowRect.left - 0.5 &&
      badgeRect.right <= rowRect.right + 0.5 &&
      badgeRect.top >= rowRect.top - 0.5 &&
      badgeRect.bottom <= rowRect.bottom + 0.5;
    return {
      hasBadge: true,
      rowOverflow,
      rowBg: getComputedStyle(row).backgroundColor,
      badgeVisible: getComputedStyle(badge).visibility !== "hidden" && badgeRect.width > 0,
      fullyWithinRow,
    };
  });
  console.log("HOVER STATE (Deadlines, hovered):", JSON.stringify(hoverCheck, null, 2));

  await page.screenshot({ path: "test-evidence/remediation/ui-nav-badges/active-state-alerts.png" });
  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
