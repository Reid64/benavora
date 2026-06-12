import { test as setup, expect } from "@playwright/test";

import {
  ONBOARDING_STORAGE_STATE,
  ONBOARDING_USER,
  STORAGE_STATE,
  TEST_USER,
  adminClient,
  ensureOnboardingAccount,
  ensureTestAccount,
  loadEnv,
  seedOrganization,
  seedPhase2to5,
} from "./helpers";

/**
 * Authentication + seed setup. Runs once before the authenticated specs:
 *   1. Ensures the confirmed test owner and their organization exist.
 *   2. Seeds a minimal real dataset (Phase 1 + Phases 2-5) so data-dependent UI
 *      renders against live rows.
 *   3. Signs in through the real login UI and saves the browser storage state,
 *      which the "authed" project reuses for every test.
 */
setup("authenticate and seed the test organization", async ({ page }) => {
  const env = loadEnv();

  const { userId, organizationId } = await ensureTestAccount(env);
  await seedOrganization(env, organizationId);
  await seedPhase2to5(env, organizationId, userId);

  // The owner org must be fully onboarded so the dashboard never bounces these
  // specs to the wizard (a brand-new org defaults to onboarding_completed=false).
  const { error: onboardingError } = await adminClient(env)
    .from("organizations")
    .update({ onboarding_completed: true })
    .eq("id", organizationId);
  if (onboardingError) {
    throw new Error(
      `Could not mark owner org onboarded: ${onboardingError.message}`,
    );
  }

  // Sign in via the real UI so the Supabase auth cookies are set exactly as the
  // app expects, then persist them for the authenticated specs.
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/dashboard", { timeout: 30000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Dashboard" }),
  ).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});

/**
 * A second account whose organization is deliberately mid-onboarding, so the
 * onboarding-wizard spec has a session that lands on /onboarding. Isolated in
 * its own organization — it shares no data with the owner account above.
 */
setup("authenticate the mid-onboarding account", async ({ page }) => {
  const env = loadEnv();

  await ensureOnboardingAccount(env);

  await page.goto("/login");
  await page.getByLabel("Email").fill(ONBOARDING_USER.email);
  await page.getByLabel("Password").fill(ONBOARDING_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // An org that has not completed onboarding is routed to the wizard by the
  // dashboard layout, so the post-login redirect lands on /onboarding.
  await page.waitForURL("**/onboarding", { timeout: 30000 });

  await page.context().storageState({ path: ONBOARDING_STORAGE_STATE });
});
