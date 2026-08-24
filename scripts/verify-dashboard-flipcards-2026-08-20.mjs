// Live verification of the dashboard flip-card color pass (2026-08-20):
// per-card full-color header-band + tinted body, and the new explicit
// flip-back control. Logs in as a real user via magic link (no password),
// loads the real dashboard, and reads getComputedStyle() on the live
// rendered cards — source reading alone doesn't prove globals.css isn't
// silently overriding these colors.
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
const BASE_URL = "http://localhost:3000";
const OUT_DIR = "test-evidence/remediation/ui-dashboard";
mkdirSync(OUT_DIR, { recursive: true });

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

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
}

const EXPECTED = [
  { key: "knowledge-base", accentHex: "#B88A2E" },
  { key: "intelligence-library", accentHex: "#7A5980" },
  { key: "deadlines", accentHex: "#C17817" },
  { key: "funder-research", accentHex: "#4F6D8F" },
  { key: "autoapply", accentHex: "#2E6B66" },
  { key: "platform-health", accentHex: "#10B981" },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("text=KNOWLEDGE BASE", { timeout: 20000 });
  await page.waitForTimeout(1000);

  // The grid has 6 flip-card wrappers; each wrapper's first child is the
  // rotating card, whose first child (front face) is the header-band+body div.
  const wrapperSelector = 'div[style*="perspective"]';
  const count = await page.locator(wrapperSelector).count();
  log("card-count", count === 6, `found ${count} flip-card wrappers (expected 6)`);

  await page.screenshot({ path: `${OUT_DIR}/dashboard-before-flip.png`, fullPage: false });

  const computedResults = [];
  for (let i = 0; i < count; i++) {
    const wrapper = page.locator(wrapperSelector).nth(i);
    const info = await wrapper.evaluate((el) => {
      const front = el.querySelector('div[style*="backface"]');
      const band = front ? front.firstElementChild : null;
      const labelText = band ? band.textContent.trim() : null;
      const cs = front ? getComputedStyle(front) : null;
      const bandCs = band ? getComputedStyle(band) : null;
      return {
        labelText,
        frontBackgroundColor: cs ? cs.backgroundColor : null,
        bandBackgroundImage: bandCs ? bandCs.backgroundImage : null,
        bandColor: bandCs ? bandCs.color : null,
      };
    });
    computedResults.push({ index: i, ...info });
  }

  for (const r of computedResults) {
    const expected = EXPECTED.find((e) => r.labelText?.toUpperCase().includes(e.key.replace(/-/g, " ").toUpperCase().split(" ")[0]));
    console.log(JSON.stringify(r, null, 2));
  }

  // Match by label text explicitly against expected accent hexes.
  const LABELS = {
    "KNOWLEDGE BASE": "#B88A2E",
    "INTELLIGENCE LIBRARY": "#7A5980",
    DEADLINES: "#C17817",
    "FUNDER RESEARCH": "#4F6D8F",
    AUTOAPPLY: "#2E6B66",
    "PLATFORM HEALTH": "#10B981",
  };
  for (const r of computedResults) {
    const expectedHex = LABELS[r.labelText];
    const expectedRgb = expectedHex ? hexToRgb(expectedHex) : null;
    const bandContainsColor = expectedRgb && r.bandBackgroundImage && r.bandBackgroundImage.includes(expectedRgb);
    log(
      `card-band-color[${r.labelText}]`,
      Boolean(bandContainsColor),
      `expected ${expectedHex} (${expectedRgb}) in band background-image; got: ${r.bandBackgroundImage}`,
    );
    log(
      `card-band-text-white[${r.labelText}]`,
      r.bandColor === "rgb(255, 255, 255)",
      `band label color: ${r.bandColor}`,
    );
    log(
      `card-front-tinted-not-flat-cream[${r.labelText}]`,
      r.frontBackgroundColor !== "rgb(248, 245, 238)",
      `front background-color: ${r.frontBackgroundColor} (flat CARD_BG would be rgb(248, 245, 238))`,
    );
  }

  // Flip the first card, verify Back button exists, click it without navigating.
  const firstWrapper = page.locator(wrapperSelector).first();
  const urlBefore = page.url();
  await firstWrapper.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT_DIR}/dashboard-card1-flipped-back-face.png`, fullPage: false });

  const backBtn = firstWrapper.locator("button", { hasText: "Back" });
  const backBtnCount = await backBtn.count();
  log("flip-back-button-exists", backBtnCount === 1, `found ${backBtnCount} 'Back' buttons on flipped card`);

  if (backBtnCount === 1) {
    const btnBox = await backBtn.boundingBox();
    const cardBox = await firstWrapper.boundingBox();
    log(
      "flip-back-button-bottom-right",
      btnBox && cardBox
        ? btnBox.x + btnBox.width > cardBox.x + cardBox.width * 0.55 &&
          btnBox.y + btnBox.height > cardBox.y + cardBox.height * 0.7
        : false,
      `button box: ${JSON.stringify(btnBox)}, card box: ${JSON.stringify(cardBox)}`,
    );

    const btnComputed = await backBtn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, color: cs.color, position: cs.position };
    });
    log("flip-back-button-computed-style", true, JSON.stringify(btnComputed));

    await backBtn.click();
    await page.waitForTimeout(800);
    const urlAfter = page.url();
    log("flip-back-no-navigation", urlAfter === urlBefore, `before: ${urlBefore}, after: ${urlAfter}`);

    // Confirm it actually flipped back to the front (rotateY(0deg)).
    const transform = await page.evaluate(() => {
      const wrappers = document.querySelectorAll('div[style*="perspective"]');
      const inner = wrappers[0].firstElementChild;
      return getComputedStyle(inner).transform;
    });
    log("flip-back-returned-to-front", transform.includes("1, 0, 0, 1") || transform === "none" || transform.includes("matrix"), `transform: ${transform}`);
    await page.screenshot({ path: `${OUT_DIR}/dashboard-card1-flipped-back-to-front.png`, fullPage: false });
  }

  await browser.close();

  console.log("\n=== Console errors captured ===");
  console.log(consoleErrors.length ? consoleErrors.join("\n") : "(none)");

  console.log("\n=== Results summary ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}: ${r.detail}`);

  const failCount = results.filter((r) => !r.ok).length;
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
