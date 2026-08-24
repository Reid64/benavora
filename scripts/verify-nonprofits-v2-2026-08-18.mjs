// Verification for the 2026-08-18 v2 (PAGE_TREATMENT_PROTOCOL_V2.md) pass on
// /nonprofits — Research & Discovery section, Bronze #A4712C frame / Slate
// Blue #4F6D8F accent, real two-layer frame+content depth technique.
// Reuses the magic-link login technique established in
// verify-section-accents-2026-08-15.mjs. Run with "before" or "after".
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const MODE = process.argv[2] === "after" ? "after" : "before";

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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  try {
    await page.goto(BASE_URL + "/nonprofits", { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2500);
    log("loaded", page.url().includes("/nonprofits"), page.url());

    await page.screenshot({
      path: `smoke-test-output/nonprofits-v2-${MODE}-2026-08-18.png`,
      fullPage: true,
    });

    // White-value audit — grep rendered inline styles for literal white/near-white
    // backgrounds/text, excluding the sanctioned Warm Ivory #F8F5EE. Scoped to
    // <main> (this page's own content) — the shared sidebar/header shell is
    // deliberately always-white nav text on a dark surface (out of scope for a
    // page-level pass, see benavora-real-logo-brand-palette-2026-08-15 memory).
    const whiteHits = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll("main *").forEach((el) => {
        const cs = getComputedStyle(el);
        for (const prop of ["backgroundColor", "color"]) {
          const v = cs[prop];
          if (v === "rgb(255, 255, 255)" || v === "rgba(255, 255, 255, 1)") {
            bad.push(`${el.tagName}.${el.className || ""}[${prop}]=${v}`);
          }
        }
      });
      return bad;
    });
    log("white-value-audit", whiteHits.length === 0, `count=${whiteHits.length} sample=${JSON.stringify(whiteHits.slice(0, 5))}`);

    const titleText = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("div"));
      const t = nodes.find((d) => d.textContent?.trim() === "Nonprofit Directory");
      return t ? t.textContent : null;
    });
    log("title-present", titleText === "Nonprofit Directory", String(titleText));

    const rowCount = await page.evaluate(() => {
      const grid = Array.from(document.querySelectorAll("span")).filter((s) => s.textContent === "Name");
      return grid.length;
    });
    log("table-header-present", rowCount >= 1, `count=${rowCount}`);

    const formOk = await page.evaluate(() => {
      const input = document.querySelector('input[name="search"]');
      const select = document.querySelector('select[name="state"]');
      const submit = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Search");
      return !!input && !!select && !!submit;
    });
    log("search-filter-form-intact", formOk, String(formOk));

    if (MODE === "after") {
      const BRONZE = "rgb(164, 113, 44)"; // #A4712C
      const SLATE_BLUE = "rgb(79, 109, 143)"; // #4F6D8F
      const IVORY = "rgb(248, 245, 238)"; // #F8F5EE

      // 1. Header frame — outer wrapper around the title carries the real Bronze fill.
      const headerFrame = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("main div, body > div div")).filter(
          (d) => d.textContent?.trim() === "Nonprofit Directory" && !d.closest("aside"),
        );
        const title = nodes[0];
        const innerCard = title ? title.parentElement : null; // Ivory inner card
        const frame = innerCard ? innerCard.parentElement : null; // Bronze frame
        return {
          innerCardBg: innerCard ? getComputedStyle(innerCard).backgroundColor : null,
          frameBg: frame ? getComputedStyle(frame).backgroundColor : null,
          frameShadow: frame ? getComputedStyle(frame).boxShadow : null,
        };
      });
      log("header-frame-bronze", headerFrame.frameBg === BRONZE, `actual=${headerFrame.frameBg}`);
      log("header-inner-card-ivory", headerFrame.innerCardBg === IVORY, `actual=${headerFrame.innerCardBg}`);
      log("header-frame-has-real-shadow", !!headerFrame.frameShadow && headerFrame.frameShadow !== "none", String(headerFrame.frameShadow));

      // 2. Table frame — same two-layer structure around the results table.
      const tableFrame = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span"));
        const nameLabel = spans.find((s) => s.textContent?.trim() === "Name");
        const headerRow = nameLabel ? nameLabel.parentElement : null;
        const innerCard = headerRow ? headerRow.parentElement : null; // Ivory inner card
        const frame = innerCard ? innerCard.parentElement : null; // Bronze frame
        return {
          innerCardBg: innerCard ? getComputedStyle(innerCard).backgroundColor : null,
          frameBg: frame ? getComputedStyle(frame).backgroundColor : null,
          tableHeaderBorder: headerRow ? getComputedStyle(headerRow).borderBottomColor : null,
        };
      });
      log("table-frame-bronze", tableFrame.frameBg === BRONZE, `actual=${tableFrame.frameBg}`);
      log("table-inner-card-ivory", tableFrame.innerCardBg === IVORY, `actual=${tableFrame.innerCardBg}`);
      log("table-header-row-accent", tableFrame.tableHeaderBorder === BRONZE, `actual=${tableFrame.tableHeaderBorder}`);

      // 3. Primary button (Search) — Bronze fill.
      const buttonBg = await page.evaluate(() => {
        const submit = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Search");
        return submit ? getComputedStyle(submit).backgroundColor : null;
      });
      log("search-button-bronze", buttonBg === BRONZE, `actual=${buttonBg}`);

      // 4. Secondary accent — website links / pagination links use Slate Blue.
      const websiteLinkColor = await page.evaluate(() => {
        const a = document.querySelector('a[target="_blank"][rel="noreferrer"]');
        return a ? getComputedStyle(a).color : null;
      });
      log("website-link-slate-blue", websiteLinkColor === SLATE_BLUE, `expected=${SLATE_BLUE} actual=${websiteLinkColor}`);

      // Revenue semantic-ish color untouched by this pass (status-adjacent, not brand).
      const revenueColor = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span"));
        const rev = spans.find((s) => /^\$/.test(s.textContent?.trim() ?? ""));
        return rev ? getComputedStyle(rev).color : null;
      });
      log("revenue-color-present", !!revenueColor, `actual=${revenueColor}`);

      // Shared shell (sidebar) unchanged by this page-scoped pass — current
      // sidebar is a solid navy fill (#101B2D), not a gradient.
      const sidebarBg = await page.evaluate(() => {
        const aside = document.querySelector("aside[aria-label='Primary navigation']");
        return aside ? getComputedStyle(aside).backgroundColor : null;
      });
      log("shell-sidebar-present", sidebarBg === "rgb(16, 27, 45)", String(sidebarBg));
    }

    log("console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 10)));
  } catch (err) {
    log("fatal", false, err.stack || String(err));
  } finally {
    await browser.close();
  }

  console.log("\n=== RESULTS JSON ===");
  console.log(JSON.stringify(results, null, 2));
  const allOk = results.every((r) => r.ok);
  console.log(`\n${allOk ? "ALL PASS" : "SOME FAILED"} (${results.filter((r) => r.ok).length}/${results.length})`);
  process.exit(allOk ? 0 : 1);
}

main();
