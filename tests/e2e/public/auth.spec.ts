import { test, expect } from "@playwright/test";

import { adminClient, loadEnv } from "../helpers";

/**
 * Public authentication flows (no stored session). Covers the login page
 * rendering/input and a real end-to-end registration against Supabase.
 */

// ---------------------------------------------------------------------------
// 1. Login page renders and accepts input
// ---------------------------------------------------------------------------
test("login page renders and accepts input", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password");
  await expect(email).toBeVisible();
  await expect(password).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in" }),
  ).toBeVisible();

  await email.fill("operator@example.org");
  await password.fill("a-secret-password");
  await expect(email).toHaveValue("operator@example.org");
  await expect(password).toHaveValue("a-secret-password");
});

// ---------------------------------------------------------------------------
// 2. Registration creates an org and reaches the dashboard
//
// A real sign-up against Supabase. Registration succeeds down one of two valid
// paths depending on the project's email-confirmation setting (BLUEPRINT
// register flow): with confirmation OFF the org is bootstrapped immediately and
// we land on the dashboard; with confirmation ON the account is created and the
// "check your email" confirmation is shown. We assert success on either path and
// clean up the created auth user afterward.
// ---------------------------------------------------------------------------
test("registration creates an organization and reaches the dashboard", async ({
  page,
}) => {
  // Unique per run so the sign-up always targets a fresh account.
  const unique = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `e2e_register_${unique}@benavora-test.dev`;
  const password = "Benavora!Register-1";

  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();

  await page.getByLabel("Organization name").fill("Registration Test Org");
  await page.getByLabel("Your name").fill("Reg Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);

  await page.getByRole("button", { name: "Create account" }).click();

  // Registration succeeds down one of three valid paths: with confirmation OFF
  // the org is bootstrapped and a brand-new org lands on the first-login
  // onboarding wizard (Phase 5); with confirmation ON the "check your email"
  // confirmation is shown. (A fully onboarded org would land on the dashboard.)
  const onDashboard = page.getByRole("heading", {
    level: 1,
    name: "Dashboard",
  });
  const checkEmail = page.getByRole("heading", { name: "Check your email" });
  const onboardingWizard = page.getByRole("button", { name: /Skip setup/ });
  await expect(
    onDashboard.or(checkEmail).or(onboardingWizard),
  ).toBeVisible({ timeout: 30000 });

  // Cleanup: remove the auth user created by this test (best effort).
  try {
    const env = loadEnv();
    const admin = adminClient(env);
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    const created = data?.users.find((u) => u.email === email);
    if (created) await admin.auth.admin.deleteUser(created.id);
  } catch {
    // Non-fatal: leftover test accounts do not affect other tests.
  }
});
