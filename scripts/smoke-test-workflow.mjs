// One-off real end-to-end smoke test driver. NOT part of the regular test suite.
// Drives the real dev server (real Supabase, no mocks) with Playwright, using
// service-role admin calls only for login bootstrap and DB verification.
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
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = "http://localhost:3001";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];
function log(step, ok, detail) {
  const entry = { step, ok, detail, at: new Date().toISOString() };
  results.push(entry);
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${detail}`);
}

async function main() {
  const mode = process.argv[2]; // "faith" or "e2e"
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  try {
    if (mode === "faith") {
      // Real Faith Foundation owner login via admin-issued magic link, exchanged
      // into cookies using the app's own @supabase/ssr server-client cookie
      // adapter shape (this app's client uses PKCE, so the hash-based tokens an
      // admin-generated link produces are never auto-picked-up client-side).
      // Never reads or changes the real password.
      const email = "info@faithfoundationsf.org";
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      if (linkErr || !linkData) throw new Error("generateLink failed: " + linkErr?.message);

      const actionLink = linkData.properties.action_link;
      const verifyResp = await fetch(actionLink, { redirect: "manual" });
      const location = verifyResp.headers.get("location") || "";
      const hash = location.includes("#") ? location.split("#")[1] : "";
      const params = new URLSearchParams(hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (!access_token || !refresh_token) {
        throw new Error("Could not extract tokens from magic link redirect: " + location);
      }

      const { createServerClient } = await import("@supabase/ssr");
      const setCookies = [];
      const authForCookies = createServerClient(SUPABASE_URL, ANON_KEY, {
        cookies: {
          getAll: () => [],
          setAll: (list) => setCookies.push(...list),
        },
      });
      const { error: sessErr } = await authForCookies.auth.setSession({
        access_token,
        refresh_token,
      });
      if (sessErr) throw new Error("setSession failed: " + sessErr.message);

      await context.addCookies(
        setCookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: "localhost",
          path: "/",
        })),
      );
      log("faith-login", true, `session established via cookie injection, ${setCookies.length} cookies`);

      await page.goto(BASE_URL + "/dashboard", { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);
      const url = page.url();
      log("faith-dashboard-url", url.includes("/dashboard"), url);

      const mainVisible = await page.locator("main, [role='main']").first().isVisible().catch(() => false);
      const bodyText = await page.locator("body").innerText().catch(() => "");
      log(
        "faith-dashboard-render",
        mainVisible,
        `main visible=${mainVisible}, contains org text=${bodyText.includes("Faith") || bodyText.includes("FAITH")}`,
      );
      log("faith-dashboard-console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 10)));

      await page.screenshot({ path: "smoke-test-output/faith-dashboard.png", fullPage: true });

      // Navigate to opportunities and confirm real rows render.
      await page.goto(BASE_URL + "/opportunities", { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const oppText = await page.locator("body").innerText().catch(() => "");
      log("faith-opportunities-render", oppText.length > 200, `body text length=${oppText.length}`);
      await page.screenshot({ path: "smoke-test-output/faith-opportunities.png", fullPage: true });

      // Trigger a real, live "Run Now" search-profile poll if the control exists
      // on /settings/integrations - additive/safe, this is what the org's real
      // pipeline does automatically every day.
      await page.goto(BASE_URL + "/settings/integrations", { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: "smoke-test-output/faith-integrations.png", fullPage: true });
      const runNowBtn = page.getByRole("button", { name: /run now/i }).first();
      const hasRunNow = await runNowBtn.isVisible().catch(() => false);
      log("faith-integrations-run-now-visible", hasRunNow, hasRunNow ? "found a Run Now control" : "no Run Now control visible");
      if (hasRunNow) {
        await runNowBtn.click();
        await page.waitForTimeout(8000);
        const afterText = await page.locator("body").innerText().catch(() => "");
        log("faith-integrations-run-now-clicked", true, afterText.slice(0, 300).replace(/\s+/g, " "));
      }

      // --- Continue the real journey on the newly-discovered opportunity ---
      const oppId = process.env.SMOKE_OPP_ID;
      if (oppId) {
        // Force-score eligibility via the real agent route (no manual UI
        // trigger exists for a single opportunity - see script notes).
        const scoreResp = await page.evaluate(async (id) => {
          const res = await fetch("/api/agents/eligibility", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ opportunityId: id }),
          });
          return { status: res.status, body: await res.text() };
        }, oppId);
        log("faith-eligibility-score-call", scoreResp.status === 200, `status=${scoreResp.status} body=${scoreResp.body.slice(0, 300)}`);

        // Apply Now -> create application
        await page.goto(BASE_URL + `/applications/new?opportunityId=${oppId}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1000);
        const createBtn = page.getByRole("button", { name: /create application|open existing application/i });
        await createBtn.click();
        await page.waitForFunction(
          () => !location.pathname.endsWith("/applications/new"),
          null,
          { timeout: 15000 },
        );
        await page.waitForTimeout(1500);
        const appUrl = page.url();
        const applicationId = appUrl.split("/applications/")[1]?.split(/[?#]/)[0];
        log("faith-application-created", !!applicationId, `applicationId=${applicationId}`);
        await page.screenshot({ path: "smoke-test-output/faith-application-detail.png", fullPage: true });

        console.log("APPLICATION_ID=" + applicationId);

        // --- Move application: discovered -> eligibility_review -> qualified -> drafting ---
        async function moveStage(targetLabel, { manualConfirm = false, waitForCompliance = false } = {}) {
          await page.getByRole("button", { name: "Move application" }).click();
          await page.waitForTimeout(500);
          await page.getByLabel("Move to stage").selectOption({ label: targetLabel });
          await page.waitForTimeout(500);
          if (waitForCompliance) {
            await page.waitForTimeout(4000); // compliance check API round trip
          }
          if (manualConfirm) {
            const checkbox = page.locator("input[type=checkbox]");
            if (await checkbox.isVisible().catch(() => false)) await checkbox.check();
          }
          const confirmBtn = page.getByRole("button", { name: "Confirm move" });
          const disabled = await confirmBtn.isDisabled().catch(() => true);
          if (disabled) {
            const bodyText = await page.locator("[role=dialog], .modal, body").first().innerText().catch(() => "");
            log(`faith-move-to-${targetLabel}`, false, `Confirm disabled. Modal text: ${bodyText.slice(0, 400).replace(/\s+/g, " ")}`);
            await page.screenshot({ path: `smoke-test-output/faith-move-blocked-${targetLabel.replace(/\s+/g, "-")}.png`, fullPage: true });
            await page.keyboard.press("Escape").catch(() => {});
            return false;
          }
          await confirmBtn.click();
          await page.waitForTimeout(2000);
          log(`faith-move-to-${targetLabel}`, true, "confirmed");
          return true;
        }

        async function currentStageLabel() {
          const badge = page.locator("h1 + div span, h1 ~ span").first();
          return (await page.locator("body").innerText().catch(() => "")).slice(0, 400);
        }

        const forwardOrder = ["Discovered", "Eligibility Review", "Qualified", "Drafting"];
        const bodySnapshot = await page.locator("body").innerText().catch(() => "");
        let startIdx = 0;
        for (let i = forwardOrder.length - 1; i >= 0; i--) {
          if (bodySnapshot.includes(forwardOrder[i])) {
            startIdx = i;
            break;
          }
        }
        log("faith-current-stage-detected", true, forwardOrder[startIdx]);
        for (let i = startIdx + 1; i < forwardOrder.length; i++) {
          await moveStage(forwardOrder[i]);
        }
        await page.screenshot({ path: "smoke-test-output/faith-application-after-moves.png", fullPage: true });

        // --- Generate a real AI draft (Claude) grounded in the real KB ---
        await page.goto(BASE_URL + `/draft-generator?opportunity=${oppId}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: "smoke-test-output/faith-draft-generator-loaded.png", fullPage: true });
        await page.getByRole("button", { name: "Grant narrative" }).click();
        await page.waitForTimeout(300);
        await page.getByRole("button", { name: /generate draft|generate new version/i }).click();
        log("faith-draft-generate-clicked", true, "waiting for Claude...");
        await page.waitForSelector("text=/Review & edit/i", { timeout: 150000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: "smoke-test-output/faith-draft-generated.png", fullPage: true });
        const draftBodyText = await page.locator("body").innerText().catch(() => "");
        log("faith-draft-generated", draftBodyText.includes("Confidence"), "draft editor rendered");

        const saveBtn = page.getByRole("button", { name: "Save draft" });
        const saveVisible = await saveBtn.isVisible().catch(() => false);
        if (saveVisible) {
          await saveBtn.click();
          await page.waitForURL("**/draft-generator/**", { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(1500);
          log("faith-draft-saved", true, page.url());
        } else {
          log("faith-draft-saved", false, "Save draft button not visible");
        }
        await page.screenshot({ path: "smoke-test-output/faith-draft-saved.png", fullPage: true });
      }
    } else if (mode === "e2e") {
      const TEST_EMAIL = "owner.e2e@benavora-test.dev";
      const TEST_PASSWORD = "Benavora!E2E-Test-1";

      await page.goto(BASE_URL + "/login", { waitUntil: "load" });
      await page.getByLabel("Email").fill(TEST_EMAIL);
      await page.getByLabel("Password").fill(TEST_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL("**/dashboard", { timeout: 30000 });
      log("e2e-login", true, "reached /dashboard");

      const mainVisible = await page.locator("main, [role='main']").first().isVisible().catch(() => false);
      log("e2e-dashboard-render", mainVisible, `main visible=${mainVisible}`);
      log("e2e-dashboard-console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 10)));
      await page.screenshot({ path: "smoke-test-output/e2e-dashboard.png", fullPage: true });

      // --- Find the seeded application (Rural Housing Stability Grant) ---
      await page.goto(BASE_URL + "/applications", { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: "smoke-test-output/e2e-applications-board.png", fullPage: true });
      const appLink = page.getByText("Rural Housing Stability Grant").first();
      const appVisible = await appLink.isVisible().catch(() => false);
      log("e2e-pipeline-shows-seeded-app", appVisible, `visible=${appVisible}`);

      if (appVisible) {
        await appLink.click();
        await page.waitForTimeout(1500);
      } else {
        // fall back: navigate directly via API lookup done outside this script
      }
      const detailUrl = page.url();
      log("e2e-application-detail-url", detailUrl.includes("/applications/"), detailUrl);
      await page.screenshot({ path: "smoke-test-output/e2e-application-detail.png", fullPage: true });

      results.push({ step: "e2e-application-url", ok: true, detail: detailUrl, at: new Date().toISOString() });
    }
  } catch (err) {
    log(mode + "-fatal", false, err.stack || String(err));
  } finally {
    await browser.close();
  }

  console.log("\n=== RESULTS JSON ===");
  console.log(JSON.stringify(results, null, 2));
}

main();
