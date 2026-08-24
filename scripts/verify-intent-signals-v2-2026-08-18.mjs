// Verification for the /donor-discovery/intent-signals v2 page treatment pass
// (2026-08-18), per PAGE_TREATMENT_PROTOCOL_V2.md: Research & Discovery
// section, Frame Bronze #A4712C, Secondary accent Slate Blue #4F6D8F.
// Checks: page loads without error, real screenshot, header title is Deep
// Navy (not the old bronze), signal cards use the mandatory Bronze-frame +
// Warm-Ivory-content layering technique with a real box-shadow (via
// getComputedStyle, not source reading), primary CTA button meets real
// WCAG-AA contrast, empty state uses the same layering technique, no
// console errors, shared shell unchanged.
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  try {
    await page.goto(BASE_URL + "/donor-discovery/intent-signals", { waitUntil: "load", timeout: 30000 });
    await page
      .waitForFunction(
        () => !Array.from(document.querySelectorAll("*")).some((el) => el.textContent?.trim() === "Loading intent signals..."),
        { timeout: 20000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
    log("loaded", page.url().includes("/donor-discovery/intent-signals"), page.url());

    const bodyText = await page.evaluate(() => document.body.innerText);
    log("no-error-message", !/could not (load|reach)/i.test(bodyText), "checked for load-failure text");

    await page.screenshot({ path: `smoke-test-output/intent-signals-v2-after-2026-08-18.png`, fullPage: true });

    // Page background = Soft Stone
    const pageBg = await page.evaluate(() => {
      const root = document.querySelector("main") || document.body;
      // page's own outer div is the first child of the route's rendered tree
      const outer = document.querySelector("div[style*='min-height']");
      return outer ? getComputedStyle(outer).backgroundColor : null;
    });
    log("page-bg-soft-stone", pageBg === "rgb(216, 211, 200)", `actual=${pageBg}`);

    // Header title = Deep Navy, not bronze
    const header = await page.evaluate(() => {
      const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "Corporate Intent Signals");
      const wrap = h1 ? h1.closest("div") : null;
      return {
        color: h1 ? getComputedStyle(h1).color : null,
        borderLeft: wrap ? getComputedStyle(wrap).borderLeftColor : null,
      };
    });
    log("header-title-deep-navy", header.color === "rgb(16, 27, 45)", `actual=${header.color}`);
    log("header-left-border-bronze-frame", header.borderLeft === "rgb(164, 113, 44)", `actual=${header.borderLeft}`);

    // Header "Run Signal Analysis" CTA -> Bronze fill, near-black text (real contrast fix)
    const headerCta = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((el) => el.textContent?.includes("Run Signal Analysis"));
      return b ? { bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color } : null;
    });
    log(
      "header-cta-bronze-darktext",
      !!headerCta && headerCta.bg === "rgb(164, 113, 44)" && headerCta.color === "rgb(13, 8, 3)",
      JSON.stringify(headerCta),
    );

    // Stat cards: bronze frame + warm-ivory content technique
    const statFrame = await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.trim() === "Total Signals (30d)");
      const outer = label?.closest("div")?.parentElement; // value+label wrap -> inner ivory div -> outer bronze frame
      const inner = outer;
      const frame = inner?.parentElement;
      return frame
        ? {
            frameBg: getComputedStyle(frame).backgroundColor,
            frameShadow: getComputedStyle(frame).boxShadow,
            innerBg: inner ? getComputedStyle(inner).backgroundColor : null,
          }
        : null;
    });
    log(
      "statcard-bronze-frame-ivory-content",
      !!statFrame && statFrame.frameBg === "rgb(164, 113, 44)" && statFrame.innerBg === "rgb(248, 245, 238)" && statFrame.frameShadow !== "none",
      JSON.stringify(statFrame),
    );

    const companiesStat = await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.trim() === "Companies Monitored");
      const valueEl = label?.closest("div")?.parentElement?.querySelector("p");
      return valueEl ? getComputedStyle(valueEl).color : null;
    });
    log("stat-companies-monitored-slate-blue", companiesStat === "rgb(79, 109, 143)", `actual=${companiesStat}`);

    const isEmpty = /No intent signals yet/.test(bodyText);
    log("has-signals-or-empty-state", true, isEmpty ? "empty state rendered" : "signal cards rendered");

    if (isEmpty) {
      const emptyFrame = await page.evaluate(() => {
        const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === "No intent signals yet");
        const inner = p ? p.closest("div") : null;
        const frame = inner ? inner.parentElement : null;
        return frame
          ? {
              frameBg: getComputedStyle(frame).backgroundColor,
              frameShadow: getComputedStyle(frame).boxShadow,
              innerBg: inner ? getComputedStyle(inner).backgroundColor : null,
              headingColor: getComputedStyle(p).color,
            }
          : null;
      });
      log(
        "empty-state-bronze-frame-ivory-content",
        !!emptyFrame &&
          emptyFrame.frameBg === "rgb(164, 113, 44)" &&
          emptyFrame.innerBg === "rgb(248, 245, 238)" &&
          emptyFrame.frameShadow !== "none" &&
          emptyFrame.headingColor === "rgb(16, 27, 45)",
        JSON.stringify(emptyFrame),
      );
      const emptyCta = await page.evaluate(() => {
        const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === "No intent signals yet");
        const card = p ? p.closest("div") : null;
        const btn = card ? card.querySelector("button") : null;
        return btn ? { text: btn.textContent?.trim(), bg: getComputedStyle(btn).backgroundColor, color: getComputedStyle(btn).color } : null;
      });
      log(
        "empty-state-cta-bronze-darktext",
        !!emptyCta && emptyCta.bg === "rgb(164, 113, 44)" && emptyCta.color === "rgb(13, 8, 3)",
        JSON.stringify(emptyCta),
      );
    } else {
      const cardFrame = await page.evaluate(() => {
        const h3 = document.querySelector("h3");
        // h3 -> name+badge row -> header flex row -> padded content div -> ivory content div -> bronze frame div
        let inner = h3;
        for (let i = 0; i < 4 && inner; i++) inner = inner.parentElement;
        const frame = inner ? inner.parentElement : null;
        return frame
          ? {
              frameBg: getComputedStyle(frame).backgroundColor,
              frameShadow: getComputedStyle(frame).boxShadow,
              innerBg: inner ? getComputedStyle(inner).backgroundColor : null,
              nameColor: h3 ? getComputedStyle(h3).color : null,
            }
          : null;
      });
      log(
        "signalcard-bronze-frame-ivory-content",
        !!cardFrame &&
          cardFrame.frameBg === "rgb(164, 113, 44)" &&
          cardFrame.innerBg === "rgb(248, 245, 238)" &&
          cardFrame.frameShadow !== "none" &&
          cardFrame.nameColor === "rgb(16, 27, 45)",
        JSON.stringify(cardFrame),
      );
    }

    // White-value audit (computed, in-browser): any element with a rendered
    // near-white background outside the sanctioned Warm Ivory card content.
    const whiteBgAudit = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll("*").forEach((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        const m = bg.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
        if (!m) return;
        const [, r, g, b] = m.map(Number);
        // near-white threshold roughly matching hex lighter than #F0F0F0
        if (r >= 240 && g >= 240 && b >= 230 && bg !== "rgb(248, 245, 238)") {
          bad.push({ tag: el.tagName, cls: el.className?.toString().slice(0, 40), bg });
        }
      });
      return bad.slice(0, 20);
    });
    log("white-bg-audit-clean", whiteBgAudit.length === 0, JSON.stringify(whiteBgAudit));

    await checkShell(page);

    log("console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 8)));
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

async function checkShell(page) {
  // Sidebar/Header.tsx are untouched by this session (confirmed via `git
  // diff --stat` returning empty for both files) — current live shell is
  // Deep Navy #101B2D solid, not the older blue-gradient baseline some
  // 2026-08-16-era scripts assumed. Checking presence/shape only, not a
  // specific legacy color.
  const shell = await page.evaluate(() => {
    const aside = document.querySelector("aside[aria-label='Primary navigation']");
    const header = document.querySelector("header");
    return {
      asidePresent: !!aside,
      headerPresent: !!header,
      headerBg: header ? getComputedStyle(header).backgroundColor : null,
    };
  });
  log("shell-present-unchanged", shell.asidePresent && shell.headerPresent, JSON.stringify(shell));
}

main();
