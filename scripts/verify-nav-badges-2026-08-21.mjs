// Verification for the nav-badge reflow (right-aligned flex child, rust
// palette) instead of the old absolute-positioned overlay circle. Logs in
// as a real onboarded org, opens /donor-discovery, and checks getComputedStyle
// + boundingClientRect on each visible badge (Intent Signals, plus Alerts/
// Applications/Deadlines if their counts are > 0 today).
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
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
const BASE_URL = process.argv[2] || "http://localhost:3100";
const IS_PROD = BASE_URL.includes("benavora.com");
const OUT_DIR = "test-evidence/remediation/ui-nav-badges";
mkdirSync(OUT_DIR, { recursive: true });

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
  const domain = new URL(BASE_URL).hostname;
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain, path: "/" })));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await loginAs(context, "info@faithfoundationsf.org");
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGE ERROR:", String(err).slice(0, 200)));

  await page.goto(`${BASE_URL}/donor-discovery`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  const shotName = IS_PROD ? "sidebar-prod.png" : "sidebar.png";
  await page.locator("aside[aria-label='Primary navigation']").screenshot({ path: `${OUT_DIR}/${shotName}` });

  // Collect every nav row that currently has a visible badge, plus the row's
  // own bounding rect and the icon's rect for the intersection check.
  const badgeInfo = await page.evaluate(() => {
    const nav = document.querySelector("aside[aria-label='Primary navigation']");
    const rows = Array.from(nav.querySelectorAll("a"));
    const results = [];
    for (const row of rows) {
      const svg = row.querySelector("svg");
      // A "badge" is any span child of the row that is not the label span
      // (label spans have no background-color of their own).
      const spans = Array.from(row.querySelectorAll(":scope > span"));
      const badge = spans.find((s) => {
        const cs = getComputedStyle(s);
        return cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
      });
      if (!badge) continue;
      const rowRect = row.getBoundingClientRect();
      const badgeRect = badge.getBoundingClientRect();
      const iconRect = svg ? svg.getBoundingClientRect() : null;
      const cs = getComputedStyle(badge);
      const label = row.textContent?.trim() ?? "";
      const intersectsIcon = iconRect
        ? !(badgeRect.right < iconRect.left ||
            badgeRect.left > iconRect.right ||
            badgeRect.bottom < iconRect.top ||
            badgeRect.top > iconRect.bottom)
        : false;
      results.push({
        label,
        text: badge.textContent?.trim() ?? "",
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        marginLeft: cs.marginLeft,
        borderRadius: cs.borderRadius,
        rowRect: { left: rowRect.left, right: rowRect.right, top: rowRect.top, bottom: rowRect.bottom, width: rowRect.width },
        badgeRect: { left: badgeRect.left, right: badgeRect.right, top: badgeRect.top, bottom: badgeRect.bottom, width: badgeRect.width, height: badgeRect.height },
        iconRect: iconRect
          ? { left: iconRect.left, right: iconRect.right, top: iconRect.top, bottom: iconRect.bottom }
          : null,
        rightGap: rowRect.right - badgeRect.right,
        intersectsIcon,
      });
    }
    return results;
  });

  for (const b of badgeInfo) {
    b.checks = {
      backgroundIsRust: b.backgroundColor === "rgb(163, 73, 47)",
      marginLeftAutoResolved: parseFloat(b.marginLeft) > 0,
      withinRightGap: b.rightGap >= 0 && b.rightGap <= 12,
      noIconIntersection: !b.intersectsIcon,
    };
  }

  const output = {
    capturedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    badgeCount: badgeInfo.length,
    badges: badgeInfo,
  };
  const fileName = IS_PROD ? "live-after.json" : "live-before.json";
  writeFileSync(`${OUT_DIR}/${fileName}`, JSON.stringify(output, null, 2));

  console.log(`\n=== Badge evidence (${BASE_URL}) ===`);
  for (const b of badgeInfo) {
    console.log(`${b.label} :: text="${b.text}" bg=${b.backgroundColor} marginLeft=${b.marginLeft} rightGap=${b.rightGap.toFixed(1)}px intersectsIcon=${b.intersectsIcon}`);
    console.log(`  checks: ${JSON.stringify(b.checks)}`);
  }
  if (badgeInfo.length === 0) {
    console.log("No badges with count > 0 were visible today (all counts are 0) — nothing to assert on.");
  }

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
