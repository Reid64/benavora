import { test, type Page } from "@playwright/test";

import { TEST_USER } from "../tests/e2e/helpers";

// Temporary verification spec for the pricing-lock task. Not part of the
// permanent suite — captures screenshots proving /pricing and /billing show
// matching numbers for shared tier names (Starter/Professional/Enterprise).
// Safe to delete after the task's evidence is collected.

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

test("capture /pricing screenshot", async ({ page }) => {
  await page.goto("/pricing");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "AUDIT_SCREENSHOTS/pricing-lock-marketing-pricing.png", fullPage: true });
});

test("capture /billing screenshot", async ({ page }) => {
  await login(page);
  await page.goto("/billing");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "AUDIT_SCREENSHOTS/pricing-lock-real-billing.png", fullPage: true });
});
