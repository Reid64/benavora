// Part 2 verification (2026-08-21): AutoApply four-color stat cards +
// Donor Discovery (Discover Prospects violet, six-color funnel, rust
// top-prospects buttons, varied stat numbers). Real getComputedStyle on the
// live rendered page, logged in as an onboarded real org.
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
const BASE_URL = "http://localhost:3100";
const AA_OUT = "test-evidence/remediation/ui-autoapply";
const DD_OUT = "test-evidence/remediation/ui-donor-discovery";
mkdirSync(AA_OUT, { recursive: true });
mkdirSync(DD_OUT, { recursive: true });

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

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${detail}`);
}

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
  // Faith Foundation is real, onboarded, has data across pages.
  await loginAs(context, "info@faithfoundationsf.org");
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGE ERROR:", String(err).slice(0, 200)));

  // === AutoApply ===
  await page.goto(`${BASE_URL}/autoapply`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${AA_OUT}/autoapply-top-cards.png` });

  const AA_EXPECTED = [
    { label: "Sessions Today", hex: "#2E6B66" },
    { label: "Success Rate", hex: "#7A5980" },
    { label: "Avg Fill Time", hex: "#4F6D8F" },
    { label: "Forms Queued", hex: "#C17817" },
  ];
  for (const { label, hex } of AA_EXPECTED) {
    const band = page.locator("div", { hasText: label }).filter({ hasText: label }).last();
    const bandLocator = page.locator(`text="${label}"`).first();
    const bg = await bandLocator.evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null);
    const color = await bandLocator.evaluate((el) => getComputedStyle(el).color).catch(() => null);
    log(
      `autoapply-band[${label}]-bg`,
      bg === hexToRgb(hex),
      `background-color: ${bg} (expected ${hexToRgb(hex)})`,
    );
  }

  // === Donor Discovery ===
  await page.goto(`${BASE_URL}/donor-discovery`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DD_OUT}/donor-discovery-top.png` });

  const discoverBtn = page.locator("a", { hasText: "Discover Prospects" }).first();
  const discoverBg = await discoverBtn.evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null);
  log("discover-prospects-button-violet", discoverBg === hexToRgb("#5B21B6"), `background-color: ${discoverBg} (expected ${hexToRgb("#5B21B6")})`);

  // Scroll to funnel
  const funnelHeading = page.locator("text=Pipeline Funnel").first();
  await funnelHeading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DD_OUT}/donor-discovery-funnel.png` });

  const FUNNEL_COLORS = {
    New: "#2E6B66",
    Reviewing: "#7A5980",
    Contacted: "#4F6D8F",
    Applied: "#C17817",
    Received: "#A3492F",
    Rejected: "#5C6935",
  };
  const funnelInfo = await page.evaluate((colors) => {
    const cards = Array.from(document.querySelectorAll("a[href*='/donor-discovery/prospects?stage=']"));
    return cards.map((a) => {
      const outer = a.parentElement;
      const outerBg = outer ? getComputedStyle(outer).backgroundColor : null;
      const valueEl = a.querySelector("p");
      const valueColor = valueEl ? getComputedStyle(valueEl).color : null;
      const label = a.querySelector("p:last-child")?.textContent?.trim() ?? "";
      return { label, outerBg, valueColor };
    });
  }, FUNNEL_COLORS);
  for (const stage of funnelInfo) {
    const expectedHex = FUNNEL_COLORS[stage.label];
    log(
      `funnel[${stage.label}]-frame-color`,
      expectedHex ? stage.outerBg === hexToRgb(expectedHex) : false,
      `label="${stage.label}" outerBg=${stage.outerBg} expected=${expectedHex ? hexToRgb(expectedHex) : "?"}`,
    );
  }

  // Top Prospects rust buttons
  const topProspectsHeading = page.locator("text=Top Prospects").first();
  await topProspectsHeading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DD_OUT}/donor-discovery-top-prospects.png` });
  const reviewBtns = page.locator("a", { hasText: /^Review$/ });
  const reviewCount = await reviewBtns.count();
  log("top-prospects-review-buttons-count", true, `found ${reviewCount} 'Review' buttons`);
  if (reviewCount > 0) {
    const bg = await reviewBtns.first().evaluate((el) => getComputedStyle(el).backgroundColor);
    log("top-prospects-review-button-rust", bg === hexToRgb("#A3492F"), `background-color: ${bg} (expected ${hexToRgb("#A3492F")})`);
  }

  // Stat numbers varied (DarkStatCard row)
  const statInfo = await page.evaluate(() => {
    const labels = ["Active Requests", "Avg Score", "New & Reviewing", "Contacted This Month"];
    return labels.map((label) => {
      const labelEl = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.trim() === label);
      if (!labelEl) return { label, found: false };
      const valueEl = labelEl.previousElementSibling;
      return { label, found: true, color: valueEl ? getComputedStyle(valueEl).color : null };
    });
  });
  const expectedStatColors = {
    "Active Requests": "#4F6D8F",
    "Avg Score": "#C17817",
    "New & Reviewing": "#A3492F",
    "Contacted This Month": "#5C6935",
  };
  const uniqueColors = new Set();
  for (const s of statInfo) {
    uniqueColors.add(s.color);
    log(
      `dark-stat[${s.label}]-color`,
      s.found && s.color === hexToRgb(expectedStatColors[s.label]),
      `color=${s.color} expected=${hexToRgb(expectedStatColors[s.label])}`,
    );
  }
  log("dark-stat-cards-all-distinct", uniqueColors.size === 4, `${uniqueColors.size} distinct colors among 4 cards (was 1: all bronze)`);

  await browser.close();

  console.log("\n=== Results summary ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}: ${r.detail}`);

  const failCount = results.filter((r) => !r.ok).length;
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
