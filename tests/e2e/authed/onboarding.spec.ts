import { test, expect } from "@playwright/test";

import { ONBOARDING_STORAGE_STATE } from "../helpers";

/**
 * Phase 5 — First-login onboarding wizard (BLUEPRINT onboarding flow). Uses the
 * dedicated mid-onboarding account (its own organization, onboarding_completed =
 * false) so the wizard actually renders instead of redirecting to the dashboard.
 */
test.use({ storageState: ONBOARDING_STORAGE_STATE });

/** 13. Onboarding wizard renders all of its steps. */
test("onboarding wizard renders all steps", async ({ page }) => {
  await page.goto("/onboarding");

  // Wizard chrome: brand header, skip control, and the progress indicator.
  await expect(page.getByText("Benavora setup")).toBeVisible();
  await expect(page.getByRole("button", { name: /Skip setup/ })).toBeVisible();
  await expect(page.getByText("Step 1 of 7")).toBeVisible();
  await expect(page.getByText(/% complete/)).toBeVisible();

  // Every step title is present in the step indicator (BLUEPRINT onboarding).
  for (const stepTitle of [
    "Welcome",
    "Organization",
    "Programs",
    "Board",
    "Documents",
    "First funder",
    "Grant search",
  ]) {
    await expect(page.getByText(stepTitle, { exact: true }).first()).toBeVisible();
  }
});
