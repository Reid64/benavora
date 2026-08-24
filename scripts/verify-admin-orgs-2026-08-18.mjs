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
  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error("generateLink failed: " + error.message);
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

function rgbToHex(rgb) {
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const [, r, g, b] = m;
  return "#" + [r, g, b].map((x) => (+x).toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function main() {
  mkdirSync("smoke-test-output", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  const resp = await page.goto("http://localhost:3001/admin/orgs", { waitUntil: "load", timeout: 30000 });
  const status = resp ? resp.status() : null;
  await page.waitForTimeout(3000);

  await page.screenshot({ path: "smoke-test-output/admin-orgs-verify-2026-08-18.png", fullPage: true });

  const styleCheck = await page.evaluate(() => {
    // Header banner: the h1 "Organizations" heading's parent div (page.tsx banner)
    const h1 = Array.from(document.querySelectorAll("h1")).find((el) => el.textContent?.trim() === "Organizations");
    const header = h1 ? h1.parentElement : null;

    // Impersonate button
    const impersonateBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Impersonate"));

    // Navy frame: the div with the distinctive 3px padding wrapping the ivory card (frameStyle in OrgsListClient)
    let frameDiv = null;
    let cardDiv = null;
    const table = document.querySelector("table");
    if (table) {
      let anc = table.parentElement;
      for (let i = 0; i < 8 && anc; i++) {
        const cs = getComputedStyle(anc);
        const bg = cs.backgroundColor;
        const m = bg.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          const r = +m[1], g = +m[2], b = +m[3];
          if (!frameDiv && r < 40 && g < 60 && b < 80 && cs.padding === "3px") frameDiv = anc;
          if (!cardDiv && r > 230 && g > 220 && b > 200) cardDiv = anc;
        }
        anc = anc.parentElement;
      }
    }

    function describe(el) {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        cls: el.className?.toString().slice(0, 120),
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        borderBottomColor: cs.borderBottomColor,
        borderBottomWidth: cs.borderBottomWidth,
        boxShadow: cs.boxShadow,
        disabled: el.tagName === "BUTTON" ? el.disabled : undefined,
      };
    }

    return {
      header: describe(header),
      frameDiv: describe(frameDiv),
      cardDiv: describe(cardDiv),
      impersonateBtn: describe(impersonateBtn),
      impersonateCount: document.querySelectorAll("button").length && Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.includes("Impersonate")).length,
      rowCount: table ? table.querySelectorAll("tbody tr").length : null,
    };
  });

  // Search filter test
  let searchWorked = null;
  const searchInput = await page.$('input[placeholder="Search by org name..."]');
  let rowsBefore = null, rowsAfterSearch = null, noMatchTextShown = null, rowsAfterPartial = null;
  if (searchInput) {
    rowsBefore = await page.$$eval("table tbody tr", (rows) => rows.length);
    await searchInput.click();
    await searchInput.type("zzzznonexistentorgxyz", { delay: 20 });
    await page.waitForTimeout(500);
    rowsAfterSearch = await page.$$eval("table tbody tr", (rows) => rows.length).catch(() => null);
    noMatchTextShown = await page.locator("text=No organizations match these filters.").isVisible().catch(() => false);
    await searchInput.fill("");
    await page.waitForTimeout(300);
    // partial real query: search first org's name substring
    const firstOrgName = await page.$eval("table tbody tr:first-child td:first-child", (td) => td.textContent?.trim().slice(0, 4)).catch(() => null);
    if (firstOrgName) {
      await searchInput.click();
      await searchInput.type(firstOrgName, { delay: 20 });
      await page.waitForTimeout(500);
      rowsAfterPartial = await page.$$eval("table tbody tr", (rows) => rows.length).catch(() => null);
      await searchInput.fill("");
      await page.waitForTimeout(300);
    }
    searchWorked = (noMatchTextShown === true) || (rowsAfterPartial !== null && rowsAfterPartial < rowsBefore);
  }

  // Dropdown filter test
  let dropdownInfo = [];
  const selects = await page.$$("select");
  for (const sel of selects) {
    const name = await sel.evaluate((el) => el.name || el.id || el.getAttribute("aria-label") || "select");
    const options = await sel.$$eval("option", (opts) => opts.map((o) => o.value));
    let changed = false;
    if (options.length > 1) {
      const rowsBeforeSel = await page.$$eval("table tbody tr", (rows) => rows.length).catch(() => null);
      await sel.selectOption(options[1]);
      await page.waitForTimeout(500);
      const rowsAfterSel = await page.$$eval("table tbody tr", (rows) => rows.length).catch(() => null);
      changed = rowsBeforeSel !== rowsAfterSel;
      await sel.selectOption(options[0]);
      await page.waitForTimeout(300);
    }
    dropdownInfo.push({ name, optionCount: options.length, rowCountChangedOnSelect: changed });
  }

  const result = {
    pageStatus: status,
    consoleErrors: consoleErrors.slice(0, 15),
    styleCheck: {
      header: styleCheck.header ? { ...styleCheck.header, hex: rgbToHex(styleCheck.header.backgroundColor), borderHex: rgbToHex(styleCheck.header.borderBottomColor) } : null,
      frameDiv: styleCheck.frameDiv ? { ...styleCheck.frameDiv, hex: rgbToHex(styleCheck.frameDiv.backgroundColor) } : null,
      cardDiv: styleCheck.cardDiv ? { ...styleCheck.cardDiv, hex: rgbToHex(styleCheck.cardDiv.backgroundColor) } : null,
      impersonateBtn: styleCheck.impersonateBtn ? { ...styleCheck.impersonateBtn, hex: rgbToHex(styleCheck.impersonateBtn.backgroundColor) } : null,
      impersonateCount: styleCheck.impersonateCount,
      rowCount: styleCheck.rowCount,
    },
    searchTest: { rowsBefore, rowsAfterSearch, rowsAfterPartial, noMatchTextShown, searchWorked },
    dropdownTest: dropdownInfo,
  };

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
