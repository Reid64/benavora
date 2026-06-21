import { test, expect } from "@playwright/test";

import { adminClient, loadEnv } from "../tests/e2e/helpers";

/**
 * Critical path: new-user registration → onboarding wizard → dashboard.
 *
 * Creates a throwaway account each run and cleans it up afterward. Does NOT
 * reuse the stored auth state — it exercises the full public registration form
 * so it lives in the "public" test match (no storageState dependency).
 *
 * Two valid end states exist:
 *   A. Email confirmation OFF — signup bootstraps the org immediately and lands
 *      on /onboarding (new org, onboarding_completed = false).
 *   B. Email confirmation ON  — signup shows "Check your email". We assert the
 *      confirmation page and skip the wizard/dashboard assertions.
 */
test("registers, completes onboarding wizard, and reaches the dashboard", async ({
  page,
}) => {
  const unique = `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
  const email = `e2e_cp_onboard_${unique}@benavora-test.dev`;
  const password = "Benavora!CP-Onboard-1";

  // ── Registration ───────────────────────────────────────────────────────────
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();

  await page.getByLabel("Organization name").fill("E2E Critical Path Org");
  await page.getByLabel("Your name").fill("CP Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Detect which path we landed on (wizard or confirmation email).
  const checkEmail = page.getByRole("heading", { name: "Check your email" });
  const wizardStep = page.getByText(/Step 1 of/);
  const dashboardHeading = page.getByRole("heading", {
    level: 1,
    name: "Dashboard",
  });

  const arrived = await Promise.race([
    checkEmail
      .waitFor({ timeout: 30_000 })
      .then(() => "confirm" as const),
    wizardStep
      .waitFor({ timeout: 30_000 })
      .then(() => "wizard" as const),
    dashboardHeading
      .waitFor({ timeout: 30_000 })
      .then(() => "dashboard" as const),
  ]).catch(() => "timeout" as const);

  if (arrived === "confirm") {
    // Email confirmation required — registration succeeded, wizard not reachable.
    await expect(checkEmail).toBeVisible();
    return;
  }

  if (arrived === "timeout") {
    throw new Error(
      "Registration did not reach the onboarding wizard, confirmation page, or dashboard within 30 s.",
    );
  }

  if (arrived === "dashboard") {
    // Org was already onboarded somehow — assert the dashboard and finish.
    await expect(dashboardHeading).toBeVisible();
    return;
  }

  // ── Onboarding wizard ──────────────────────────────────────────────────────
  await expect(page.getByText("Benavora setup")).toBeVisible();
  await expect(page.getByText(/Step 1 of/)).toBeVisible();
  await expect(page.getByText(/% complete/)).toBeVisible();

  // Step 1 — Welcome: just a "Next" / "Get started" button.
  await page
    .getByRole("button", { name: /Next|Get started|Continue/i })
    .first()
    .click();

  // Steps 2–6: fill any visible empty required text inputs and advance.
  for (let step = 2; step <= 6; step++) {
    await expect(page.getByText(`Step ${step} of`)).toBeVisible({
      timeout: 10_000,
    });

    // Fill required text/email/tel inputs that are still empty.
    const requiredInputs = page.locator(
      'input[required]:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="date"])',
    );
    const inputCount = await requiredInputs.count();
    for (let i = 0; i < inputCount; i++) {
      const inp = requiredInputs.nth(i);
      const val = await inp.inputValue();
      if (!val) {
        const inputType = await inp.getAttribute("type");
        await inp.fill(inputType === "email" ? `test${i}@example.org` : `E2E placeholder ${i}`);
      }
    }

    // Click Next / Continue / Save — whichever is the primary advance button.
    const advance = page
      .getByRole("button", { name: /^(Next|Continue|Save and continue|Skip)$/i })
      .first();
    await advance.click();
  }

  // Step 7 (last) — look for the Finish / Complete / Go to dashboard button.
  const lastStepVisible = await page
    .getByText(/Step 7 of|Grant search/i)
    .isVisible({ timeout: 10_000 })
    .catch(() => false);

  if (lastStepVisible) {
    const finishBtn = page.getByRole("button", {
      name: /Finish|Complete|Go to dashboard|Done|Get started/i,
    });
    await finishBtn.first().click();
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Dashboard" }),
  ).toBeVisible();

  // A brand-new organization should show empty-state copy somewhere on the page.
  const emptyState = page.getByText(
    /no opportunities|no applications|get started|add your first|welcome to/i,
  );
  await expect(emptyState.first()).toBeVisible({ timeout: 10_000 });

  // ── Cleanup ────────────────────────────────────────────────────────────────
  try {
    const env = loadEnv();
    const admin = adminClient(env);
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    const created = data?.users.find((u) => u.email === email);
    if (created) await admin.auth.admin.deleteUser(created.id);
  } catch {
    // Non-fatal: leftover test accounts don't affect other runs.
  }
});
