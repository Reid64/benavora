// Continuation of the Faith Foundation real smoke test: draft generation,
// document assembly, and remaining pipeline moves. Split into its own fresh
// browser session (see smoke-test-workflow.mjs run notes) since one long
// session accumulated enough memory/state to crash headless Chromium.
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
const BASE_URL = "http://localhost:3001";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail, at: new Date().toISOString() });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${detail}`);
}

async function loginAsFaith(context) {
  const email = "info@faithfoundationsf.org";
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email });
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
  const oppId = process.argv[2];
  const step = process.argv[3]; // "draft" | "assemble" | "submit"

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  try {
    if (step === "draft") {
      await page.goto(BASE_URL + `/draft-generator?opportunity=${oppId}`, { waitUntil: "load" });
      await page.waitForTimeout(2500);
      await page.getByRole("radio", { name: "Grant narrative" }).click({ timeout: 15000 });
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: /generate draft|generate new version/i }).click();
      log("faith-draft-generate-clicked", true, "waiting for Claude (up to 150s)...");
      await page.waitForSelector("text=/Review & edit/i", { timeout: 220000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "smoke-test-output/faith-draft-generated.png", fullPage: true });
      log("faith-draft-generated", true, "draft editor rendered");
      log("faith-draft-console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));

      const saveBtn = page.getByRole("button", { name: "Save draft" });
      await saveBtn.click();
      await page.waitForURL("**/draft-generator/**", { timeout: 15000 }).catch((e) => log("faith-draft-save-url-wait", false, String(e)));
      await page.waitForTimeout(1500);
      log("faith-draft-saved", page.url().includes("/draft-generator/"), page.url());
      await page.screenshot({ path: "smoke-test-output/faith-draft-saved.png", fullPage: true });
    } else if (step === "package") {
      const applicationId = process.argv[4];
      await page.goto(BASE_URL + `/applications/${applicationId}`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: "smoke-test-output/faith-package-before-click.png", fullPage: true });
      const packageTab = page.getByRole("button", { name: /proposal package/i });
      const count = await packageTab.count().catch(() => -1);
      log("faith-package-tab-count", true, `count=${count}`);
      const hasTab = count > 0;
      log("faith-package-tab-visible", hasTab, `visible=${hasTab}`);
      if (hasTab) {
        await packageTab.first().click();
        await page.waitForTimeout(1500);
        const genBtn = page.getByRole("button", { name: /generate full package|regenerate full package/i });
        const hasBtn = await genBtn.isVisible().catch(() => false);
        log("faith-package-generate-visible", hasBtn, `visible=${hasBtn}`);
        if (hasBtn) {
          await genBtn.click();
          log("faith-package-generate-clicked", true, "waiting up to 220s for Narrative+Budget+Logic Model+Assembly...");
          await page.waitForFunction(
            () => !document.querySelector("button")?.textContent?.includes("Generating") &&
                  (document.body.innerText.includes("Succeeded") || document.body.innerText.includes("Failed") || document.body.innerText.includes("Regenerate Full Package")),
            null,
            { timeout: 220000 },
          ).catch((e) => log("faith-package-wait", false, String(e)));
          await page.waitForTimeout(2000);
          await page.screenshot({ path: "smoke-test-output/faith-package-result.png", fullPage: true });
          const bodyText = await page.locator("body").innerText().catch(() => "");
          log("faith-package-result", true, bodyText.slice(bodyText.indexOf("One-Click"), bodyText.indexOf("One-Click") + 800).replace(/\s+/g, " "));
        }
      }
    } else if (step === "submit") {
      const applicationId = process.argv[4];
      await page.goto(BASE_URL + `/applications/${applicationId}`, { waitUntil: "load" });
      await page.waitForTimeout(1500);

      async function moveStage(targetLabel, { manualConfirm = false, waitForCompliance = false } = {}) {
        await page.getByRole("button", { name: "Move application" }).click();
        await page.waitForTimeout(500);
        await page.getByLabel("Move to stage").selectOption({ label: targetLabel });
        await page.waitForTimeout(500);
        if (waitForCompliance) {
          await page.waitForSelector("text=/compliance check passed|compliance check failed/i", { timeout: 30000 }).catch(() => {});
        }
        if (manualConfirm) {
          const checkbox = page.locator("input[type=checkbox]");
          if (await checkbox.isVisible().catch(() => false)) await checkbox.check();
        }
        const confirmBtn = page.getByRole("button", { name: "Confirm move" });
        const disabled = await confirmBtn.isDisabled().catch(() => true);
        if (disabled) {
          const modalText = await page.locator("body").innerText().catch(() => "");
          log(`faith-move-to-${targetLabel}`, false, `Confirm disabled. ${modalText.slice(0, 500).replace(/\s+/g, " ")}`);
          await page.screenshot({ path: `smoke-test-output/faith-blocked-${targetLabel.replace(/\s+/g, "-")}.png`, fullPage: true });
          await page.keyboard.press("Escape").catch(() => {});
          return false;
        }
        await confirmBtn.click();
        await page.waitForTimeout(2000);
        log(`faith-move-to-${targetLabel}`, true, "confirmed");
        return true;
      }

      const onlyTarget = process.argv[5]; // optional: skip detection, move straight to this stage
      if (onlyTarget) {
        await moveStage(onlyTarget, { waitForCompliance: onlyTarget === "Submitted" });
      } else {
        await moveStage("Awaiting Documents");
        await moveStage("Ready for Review");
        await moveStage("Submitted", { waitForCompliance: true });
      }
      await page.screenshot({ path: "smoke-test-output/faith-final-state.png", fullPage: true });
    }
  } catch (err) {
    log(step + "-fatal", false, err.stack || String(err));
  } finally {
    await browser.close();
  }

  console.log("\n=== RESULTS JSON ===");
  console.log(JSON.stringify(results, null, 2));
}

main();
