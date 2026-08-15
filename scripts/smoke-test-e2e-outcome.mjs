// Disposable-org portion of the real smoke test: move the seeded application
// through the pipeline to "submitted", then record a real outcome. Uses the
// dedicated Benavora E2E Test Org (owner.e2e@benavora-test.dev) specifically
// because recording an outcome triggers Recursive Learning / relationship
// scoring / Grant DNA - writes that must not pollute Faith Foundation's real
// production analytics.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3001";
const TEST_EMAIL = "owner.e2e@benavora-test.dev";
const TEST_PASSWORD = "Benavora!E2E-Test-1";
const APPLICATION_ID = "49d5f326-5526-49e9-9d4e-fa403d7a96ff";

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail, at: new Date().toISOString() });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${detail}`);
}

async function main() {
  const step = process.argv[2]; // "pipeline" | "outcome"
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  try {
    await page.goto(BASE_URL + "/login", { waitUntil: "load" });
    await page.getByLabel("Email").fill(TEST_EMAIL);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard", { timeout: 30000 });
    log("e2e-login", true, "reached /dashboard");

    if (step === "pipeline") {
      await page.goto(BASE_URL + `/applications/${APPLICATION_ID}`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: "smoke-test-output/e2e-app-before-moves.png", fullPage: true });

      async function moveStage(targetLabel, { waitForCompliance = false } = {}) {
        await page.getByRole("button", { name: "Move application" }).click();
        await page.waitForTimeout(500);
        await page.getByLabel("Move to stage").selectOption({ label: targetLabel });
        await page.waitForTimeout(500);
        if (waitForCompliance) {
          await page.waitForSelector("text=/compliance check passed|compliance check failed/i", { timeout: 30000 }).catch(() => {});
        }
        const confirmBtn = page.getByRole("button", { name: "Confirm move" });
        const disabled = await confirmBtn.isDisabled().catch(() => true);
        if (disabled) {
          const bodyText = await page.locator("body").innerText().catch(() => "");
          log(`e2e-move-to-${targetLabel}`, false, bodyText.slice(bodyText.indexOf("Move to stage"), bodyText.indexOf("Move to stage") + 600).replace(/\s+/g, " "));
          await page.screenshot({ path: `smoke-test-output/e2e-blocked-${targetLabel.replace(/\s+/g, "-")}.png`, fullPage: true });
          await page.keyboard.press("Escape").catch(() => {});
          return false;
        }
        await confirmBtn.click();
        await page.waitForTimeout(2000);
        log(`e2e-move-to-${targetLabel}`, true, "confirmed");
        return true;
      }

      const onlyTarget = process.argv[3];
      if (onlyTarget) {
        await moveStage(onlyTarget, { waitForCompliance: onlyTarget === "Submitted" });
      } else {
        await moveStage("Awaiting Documents");
        await moveStage("Ready for Review");
        await moveStage("Submitted", { waitForCompliance: true });
      }
      await page.screenshot({ path: "smoke-test-output/e2e-app-after-moves.png", fullPage: true });
      log("e2e-pipeline-console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 10)));
    } else if (step === "outcome") {
      await page.goto(BASE_URL + "/outcomes", { waitUntil: "load" });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "smoke-test-output/e2e-outcomes-page.png", fullPage: true });

      const recordBtn = page.getByRole("button", { name: /^record$/i }).first();
      const hasBtn = await recordBtn.isVisible().catch(() => false);
      log("e2e-outcomes-record-button-visible", hasBtn, `visible=${hasBtn}`);
      if (hasBtn) {
        await recordBtn.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: "smoke-test-output/e2e-outcome-form.png", fullPage: true });

        // Default result is "awarded" already selected; fill amount if needed.
        const amountInput = page.getByLabel(/amount awarded/i);
        if (await amountInput.isVisible().catch(() => false)) {
          const val = await amountInput.inputValue();
          if (!val) await amountInput.fill("35000");
        }
        await page.getByLabel(/funder feedback/i).fill("Smoke test: real award recorded end-to-end via automated UI walkthrough.");

        await page.getByRole("button", { name: "Record outcome" }).click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: "smoke-test-output/e2e-outcome-recorded.png", fullPage: true });
        const bodyText = await page.locator("body").innerText().catch(() => "");
        log("e2e-outcome-recorded", true, bodyText.slice(0, 500).replace(/\s+/g, " "));
      }
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
