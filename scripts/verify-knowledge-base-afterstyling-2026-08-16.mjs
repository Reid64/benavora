// After-styling re-verification for /knowledge-base, per
// PAGE_TREATMENT_PROTOCOL.md's "real verification, every page, no
// exceptions" requirement. Read-only: does the page still load with real
// data, and do the new accent-color / CTA changes actually render?
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  const netFailures = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
  page.on("requestfailed", (req) => netFailures.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText}`));
  page.on("response", async (res) => {
    if (res.url().includes("/api/knowledge-base") || res.url().includes("knowledge_base") || res.url().includes("proven_narratives")) {
      if (res.status() >= 400) netFailures.push(`RESPONSE ${res.status()} ${res.url()}`);
    }
  });

  try {
    await page.goto(BASE_URL + "/knowledge-base", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(8000);

    const finalUrl = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasErrorBanner = /could not load/i.test(bodyText);
    const percentMatch = bodyText.match(/(\d{1,3})\s*%/);

    // Active nav item ("Overview") color check
    const navCheck = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      const overview = links.find((a) => a.textContent?.trim() === "Overview");
      if (!overview) return null;
      const cs = getComputedStyle(overview);
      return { color: cs.color, backgroundColor: cs.backgroundColor };
    });

    // Completeness bar fill color
    const barCheck = await page.evaluate(() => {
      // Find the "Profile Completeness" label, then find the fill bar nearby
      const spans = Array.from(document.querySelectorAll("span"));
      const label = spans.find((s) => s.textContent?.trim() === "Profile Completeness");
      if (!label) return null;
      const heroCard = label.closest("div")?.parentElement;
      if (!heroCard) return null;
      // the fill div is the nested div inside the track div
      const trackDivs = Array.from(heroCard.querySelectorAll("div")).filter(
        (d) => getComputedStyle(d).height === "6px"
      );
      const fill = trackDivs.find((d) => d.children.length === 0 || getComputedStyle(d).backgroundColor !== "rgba(0, 0, 0, 0)");
      return fill ? { backgroundColor: getComputedStyle(fill).backgroundColor, width: getComputedStyle(fill).width } : null;
    });

    // Edit Organization Profile button
    const editProfileBtn = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      const btn = links.find((a) => a.textContent?.trim() === "Edit Organization Profile");
      if (!btn) return null;
      const cs = getComputedStyle(btn);
      return { color: cs.color, backgroundColor: cs.backgroundColor, href: btn.getAttribute("href") };
    });

    // Add a Narrative CTA in empty state
    const addNarrativeBtn = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      const btn = links.find((a) => a.textContent?.trim() === "Add a Narrative");
      if (!btn) return null;
      const cs = getComputedStyle(btn);
      return { color: cs.color, backgroundColor: cs.backgroundColor, href: btn.getAttribute("href") };
    });

    const emptyStatePresent = /No proven narratives yet/.test(bodyText);

    // Metric card numbers
    const metricNumbers = await page.evaluate(() => {
      const labels = ["Narratives", "Standard answers", "Proven narratives"];
      return labels.map((l) => {
        const el = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.trim() === l);
        const value = el?.previousElementSibling?.textContent?.trim();
        return { label: l, value };
      });
    });

    await page.screenshot({ path: "smoke-test-output/knowledge-base-afterstyling-2026-08-16.png", fullPage: true });

    console.log("=== RESULT ===");
    console.log("final URL:", finalUrl);
    console.log("error banner present:", hasErrorBanner);
    console.log("percent match found:", percentMatch ? percentMatch[0] : "none");
    console.log("console/page errors:", JSON.stringify(consoleErrors, null, 2));
    console.log("network failures (api/table related, 4xx/5xx only):", JSON.stringify(netFailures, null, 2));
    console.log("nav 'Overview' active style:", JSON.stringify(navCheck));
    console.log("completeness bar fill:", JSON.stringify(barCheck));
    console.log("Edit Organization Profile button:", JSON.stringify(editProfileBtn));
    console.log("Add a Narrative button:", JSON.stringify(addNarrativeBtn));
    console.log("empty state present:", emptyStatePresent);
    console.log("metric numbers:", JSON.stringify(metricNumbers));
  } catch (err) {
    console.log("FATAL:", err.stack || String(err));
  } finally {
    await browser.close();
  }
}

main();
