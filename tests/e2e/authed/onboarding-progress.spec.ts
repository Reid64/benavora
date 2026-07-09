import { test, expect } from "@playwright/test";

import {
  ONBOARDING_STORAGE_STATE,
  adminClient,
  ensureOnboardingAccount,
  loadEnv,
} from "../helpers";

/**
 * Onboarding progress checklist (migration 073): the "Explore the platform
 * first" skip link, the dashboard resume banner, and the Settings >
 * Organization Setup checklist. Uses the dedicated mid-onboarding account
 * (its own organization, onboarding_completed = false) so the gate and the
 * banner both actually render.
 */
test.use({ storageState: ONBOARDING_STORAGE_STATE });

/** Seeds the mid-onboarding org with 3 of 7 steps done, resuming at step 4. */
async function seedPartialProgress() {
  const env = loadEnv();
  const { organizationId } = await ensureOnboardingAccount(env);
  const { error } = await adminClient(env)
    .from("organizations")
    .update({
      onboarding_step: 4,
      onboarding_progress: { completed_steps: ["1", "2", "3"], last_step: "4" },
    })
    .eq("id", organizationId);
  if (error) throw new Error(`Could not seed onboarding progress: ${error.message}`);
}

test("skip link explores the dashboard without completing setup", async ({ page }) => {
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Explore the platform first" }).click();

  await page.waitForURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Dashboard" }),
  ).toBeVisible();

  // The skip is session-scoped (cookie), not a one-time navigation - a reload
  // of the same session must not bounce back to /onboarding.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("dashboard resume banner reflects progress and deep-links to the next step", async ({ page }) => {
  await seedPartialProgress();

  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Explore the platform first" }).click();
  await page.waitForURL(/\/dashboard$/);

  await expect(
    page.getByText("Organization setup is 3 of 7 steps complete"),
  ).toBeVisible();

  await page.getByRole("link", { name: "Resume setup" }).click();
  await page.waitForURL(/\/onboarding\?step=4$/);
  await expect(page.getByText("Step 4 of 7")).toBeVisible();
});

test("Settings > Organization Setup reflects progress", async ({ page }) => {
  await seedPartialProgress();

  // Reach the dashboard via the skip link so the gate doesn't bounce the
  // direct /settings navigation back to /onboarding.
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Explore the platform first" }).click();
  await page.waitForURL(/\/dashboard$/);

  await page.goto("/settings/organization-setup");
  await expect(
    page.getByRole("heading", { level: 1, name: "Organization Setup" }),
  ).toBeVisible();
  await expect(page.getByText("3 of 7 steps complete")).toBeVisible();

  // completed_steps = ["1","2","3"] -> Knowledge Base (step 3) done; last_step
  // = "4" -> Board Members (step 4) is next; Documents (step 5) not started.
  const knowledgeBaseRow = page.locator("li").filter({ hasText: "Knowledge Base" });
  await expect(knowledgeBaseRow.getByText("Complete")).toBeVisible();
  const boardMembersRow = page.locator("li").filter({ hasText: "Board Members" });
  await expect(boardMembersRow.getByText("Next up")).toBeVisible();
  const documentsRow = page.locator("li").filter({ hasText: "Documents" });
  await expect(documentsRow.getByText("Not started")).toBeVisible();

  await page.getByRole("button", { name: "Resume setup" }).click();
  await page.waitForURL(/\/onboarding\?step=4$/);
});
