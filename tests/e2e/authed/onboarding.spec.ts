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

  // Wizard header.
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome to Benavora" }),
  ).toBeVisible();

  // Progress indicator renders "Step 1 of 7" and a percentage.
  await expect(page.getByText("Step 1 of 7")).toBeVisible();
  await expect(page.getByText(/% complete/)).toBeVisible();

  // The step indicator shows every step title (hidden on small screens — use
  // hidden:block if needed, but on a 1280px viewport they are visible).
  for (const stepTitle of [
    "Organization Profile",
    "Programs",
    "Knowledge Base",
    "Board Members",
    "Documents",
    "Search Profile",
    "Plan Selection",
  ]) {
    await expect(page.getByText(stepTitle, { exact: true }).first()).toBeVisible();
  }
});
