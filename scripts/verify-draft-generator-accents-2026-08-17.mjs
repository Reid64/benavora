// Verification of distinct accent-color buttons + side-box depth on
// Review & Export (2026-08-17, final pass). Logs in via magic link, opens a
// real existing draft, screenshots the button rows and side boxes zoomed
// in, checks computed fill/text colors for each button + box, and re-runs
// the white-value audit from prior passes.
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
const OUT_DIR = "smoke-test-output";
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

function luminance(rgbStr) {
  const m = rgbStr.match(/[\d.]+/g);
  if (!m) return null;
  const [r, g, b] = m.slice(0, 3).map(Number);
  function chan(c) {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

async function scanWhiteOnLight(page) {
  return page.evaluate(() => {
    function luminance(rgb) {
      const m = rgb.match(/\d+/g);
      if (!m) return null;
      const [r, g, b] = m.map(Number);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    function alphaOf(rgb) {
      const m = rgb.match(/[\d.]+/g);
      return m && m.length === 4 ? Number(m[3]) : 1;
    }
    function bgOf(el) {
      let node = el;
      while (node) {
        const c = getComputedStyle(node).backgroundColor;
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent" && alphaOf(c) >= 0.5) return c;
        node = node.parentElement;
      }
      return "rgb(255,255,255)";
    }
    const bad = [];
    for (const el of document.querySelectorAll("main *")) {
      if (el.children.length > 0) continue;
      const text = el.textContent?.trim();
      if (!text) continue;
      const cl = luminance(getComputedStyle(el).color);
      if (cl === null || cl < 0.85) continue;
      const bl = luminance(bgOf(el));
      if (bl !== null && bl > 0.55) bad.push({ text: text.slice(0, 40) });
    }
    return bad.slice(0, 30);
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1700 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    await page.goto(BASE_URL + "/draft-generator", { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes("Grant Draft Wizard"), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const opened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Open");
      if (btn) { btn.click(); return true; }
      return false;
    });
    log("opened-real-draft", opened, `opened=${opened}`);
    await page.waitForTimeout(1000);

    // Trigger a real Grant DNA score so the Slate Blue box is populated (not
    // just the skeleton) — click "Score Draft" and wait for it to resolve.
    const scoreClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Score Draft"));
      if (btn && !btn.disabled) { btn.click(); return true; }
      return false;
    });
    log("clicked-score-draft", scoreClicked, `scoreClicked=${scoreClicked}`);
    if (scoreClicked) {
      await page.waitForFunction(() => document.body.innerText.includes("Grant DNA Score") && !document.body.innerText.includes("Scoring..."), { timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // --- Full page screenshot ---
    await page.screenshot({ path: `${OUT_DIR}/accents-full-review-export-2026-08-17.png`, fullPage: true });

    // --- Zoomed screenshot of the action button rows (top of edit card + bottom toolbar) ---
    const buttonRowsBox = await page.evaluate(() => {
      const scoreBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Score Draft") || b.textContent?.includes("Scoring"));
      const copyBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Copy to clipboard") || b.textContent?.includes("Copied"));
      if (!scoreBtn || !copyBtn) return null;
      const r1 = scoreBtn.getBoundingClientRect();
      const r2 = copyBtn.getBoundingClientRect();
      return { x: Math.min(r1.x, r2.x) - 20, y: r1.y - 20, width: 700, height: (r2.y + r2.height) - r1.y + 40 };
    });
    if (buttonRowsBox) {
      await page.screenshot({
        path: `${OUT_DIR}/accents-button-rows-zoom-2026-08-17.png`,
        clip: { x: Math.max(0, buttonRowsBox.x), y: Math.max(0, buttonRowsBox.y), width: buttonRowsBox.width, height: Math.min(buttonRowsBox.height, 900) },
      });
    }
    log("button-rows-box-found", !!buttonRowsBox, JSON.stringify(buttonRowsBox));

    // --- Zoomed screenshot of the side rail ---
    const sidebarBox = await page.evaluate(() => {
      const h3 = Array.from(document.querySelectorAll("h3")).find((el) => el.textContent?.trim() === "Sources used");
      const rail = h3 ? h3.closest("div[style]")?.parentElement?.parentElement : null;
      if (!rail) return null;
      const r = rail.getBoundingClientRect();
      return { x: r.x - 10, y: r.y - 10, width: r.width + 20, height: r.height + 20 };
    });
    if (sidebarBox) {
      await page.screenshot({
        path: `${OUT_DIR}/accents-sidebar-zoom-2026-08-17.png`,
        clip: { x: Math.max(0, sidebarBox.x), y: Math.max(0, sidebarBox.y), width: sidebarBox.width, height: Math.min(sidebarBox.height, 1400) },
      });
    }
    log("sidebar-box-found", !!sidebarBox, JSON.stringify(sidebarBox));

    // --- Computed style + contrast checks, all 6 buttons ---
    const buttonChecks = await page.evaluate(() => {
      const labels = ["Score Draft", "Humanize", "Rescore", "Copy to clipboard", "Download .txt", "Download PDF"];
      return labels.map((label) => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes(label));
        if (!btn) return { label, found: false };
        const cs = getComputedStyle(btn);
        return { label, found: true, bg: cs.backgroundColor, color: cs.color, boxShadow: cs.boxShadow };
      });
    });
    const seenBgs = new Set();
    let allDistinct = true;
    for (const b of buttonChecks) {
      if (!b.found) { log(`button-found:${b.label}`, false, "not found"); continue; }
      log(`button:${b.label}`, true, JSON.stringify(b));
      if (seenBgs.has(b.bg)) allDistinct = false;
      seenBgs.add(b.bg);
      const ratio = contrastRatio(b.color, b.bg);
      log(`button-contrast:${b.label}`, ratio !== null && ratio >= 4.5, `ratio=${ratio?.toFixed(2)}`);
      log(`button-has-shadow:${b.label}`, b.boxShadow !== "none", `boxShadow=${b.boxShadow}`);
    }
    log("all-6-buttons-distinct-fill", allDistinct, `uniqueCount=${seenBgs.size}`);

    // --- Side box frame checks ---
    const boxChecks = await page.evaluate(() => {
      function frameOf(headingText) {
        const h = Array.from(document.querySelectorAll("h3")).find((el) => el.textContent?.trim() === headingText);
        return h ? h.closest("div[style]") : null;
      }
      const sources = frameOf("Sources used");
      const dna = frameOf("Grant DNA Score");
      const sectionScores = frameOf("Section scores");
      const rubric = frameOf("Scoring Optimization");
      return {
        sources: sources ? { bg: getComputedStyle(sources).backgroundColor, shadow: getComputedStyle(sources).boxShadow } : null,
        dna: dna ? { bg: getComputedStyle(dna).backgroundColor, shadow: getComputedStyle(dna).boxShadow } : null,
        sectionScores: sectionScores ? { bg: getComputedStyle(sectionScores).backgroundColor, shadow: getComputedStyle(sectionScores).boxShadow } : null,
        rubric: rubric ? { bg: getComputedStyle(rubric).backgroundColor, shadow: getComputedStyle(rubric).boxShadow } : null,
      };
    });
    log("side-box-frames", true, JSON.stringify(boxChecks));
    const frameBgs = new Set([boxChecks.sources?.bg, boxChecks.dna?.bg, boxChecks.sectionScores?.bg, boxChecks.rubric?.bg].filter(Boolean));
    log("side-boxes-distinct-frames", frameBgs.size >= 3, `distinctCount=${frameBgs.size}`);

    // --- Full white-value re-audit ---
    const whiteOnLight = await scanWhiteOnLight(page);
    log("re-audit-review-export-zero-white", whiteOnLight.length === 0, JSON.stringify(whiteOnLight));

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
