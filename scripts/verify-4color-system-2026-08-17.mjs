// Verify the final 4-color system (cobalt/teal/gray/violet) on /draft-generator,
// against a real local dev server, authenticated as a real user. Screenshots +
// computes REAL WCAG contrast ratios from getComputedStyle, not assumptions.
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("PAGEERROR: " + err.message));

  await page.goto(BASE_URL + "/draft-generator", { waitUntil: "load", timeout: 30000 });
  await page
    .waitForFunction(
      () => !Array.from(document.querySelectorAll("p")).some((p) => p.textContent?.trim() === "Loading opportunities..."),
      { timeout: 20000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1000);

  await page.screenshot({ path: "smoke-test-output/draft-generator-4color-viewport-2026-08-17.png", fullPage: false });
  await page.screenshot({ path: "smoke-test-output/draft-generator-4color-full-2026-08-17.png", fullPage: true });

  const result = await page.evaluate(() => {
    // Real WCAG 2.1 relative-luminance + contrast-ratio implementation.
    function srgbToLinear(c) {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    function luminance(r, g, b) {
      return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
    }
    function parseRGB(str) {
      const m = str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
    }
    // Composite a (possibly translucent) foreground color over a background color.
    function composite(fg, bg) {
      const a = fg.a;
      return {
        r: fg.r * a + bg.r * (1 - a),
        g: fg.g * a + bg.g * (1 - a),
        b: fg.b * a + bg.b * (1 - a),
      };
    }
    function contrastRatio(c1, c2) {
      const l1 = luminance(c1.r, c1.g, c1.b);
      const l2 = luminance(c2.r, c2.g, c2.b);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }
    // Walk up the DOM to find the nearest ancestor with an opaque (a=1) background,
    // compositing any translucent backgrounds along the way. That's the real
    // effective backdrop a text node renders against.
    function effectiveBackground(el) {
      let node = el;
      let bg = { r: 255, g: 255, b: 255 }; // page default fallback
      const stack = [];
      while (node) {
        const bgStr = getComputedStyle(node).backgroundColor;
        const parsed = parseRGB(bgStr);
        if (parsed && parsed.a > 0) stack.push(parsed);
        if (parsed && parsed.a === 1) break;
        node = node.parentElement;
      }
      for (let i = stack.length - 1; i >= 0; i--) bg = composite(stack[i], bg);
      return bg;
    }

    const root = document.querySelector("main") || document.body;
    const results = [];
    const seen = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      const hasDirectText = Array.from(node.childNodes).some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
      );
      if (hasDirectText && node.offsetParent !== null) {
        const cs = getComputedStyle(node);
        const fg = parseRGB(cs.color);
        const bg = effectiveBackground(node);
        if (fg) {
          const ratio = contrastRatio(fg, bg);
          const fontSize = parseFloat(cs.fontSize);
          const fontWeight = parseInt(cs.fontWeight, 10) || 400;
          const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
          const threshold = isLarge ? 3.0 : 4.5;
          const text = node.textContent.trim().slice(0, 60);
          const key = text + "|" + cs.color + "|" + JSON.stringify(bg);
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              text,
              color: cs.color,
              effectiveBg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
              fontSize,
              fontWeight,
              ratio: Math.round(ratio * 100) / 100,
              threshold,
              pass: ratio >= threshold,
            });
          }
        }
      }
      node = walker.nextNode();
    }
    return results;
  });

  const failures = result.filter((r) => !r.pass);
  console.log("TOTAL TEXT NODES CHECKED:", result.length);
  console.log("FAILURES:", failures.length);
  console.log(JSON.stringify(failures, null, 2));
  console.log("---ALL RESULTS (sample of 20)---");
  console.log(JSON.stringify(result.slice(0, 20), null, 2));

  console.log("console errors:", JSON.stringify(consoleErrors.slice(0, 15)));

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
