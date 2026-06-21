/**
 * Tenant isolation: verifies that org A's data is invisible to org B.
 *
 * Strategy:
 *   1. Log in as org A (TEST_USER), create a funder, record its ID, then sign
 *      out using the Supabase client (no UI logout needed).
 *   2. Log in as org B (ONBOARDING_USER).
 *   3. Navigate directly to /funders/<orgAFunderId> — expect 404 or a redirect
 *      (the funder detail page must not render org A's data).
 *   4. Call GET /api/funders and verify that org A's funder ID is absent from
 *      the response payload.
 */

import { test, expect, type Page } from "@playwright/test";

import {
  TEST_USER,
  ONBOARDING_USER,
  adminClient,
  loadEnv,
} from "../tests/e2e/helpers";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? TEST_USER.email;
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? TEST_USER.password;

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

test("org B cannot access org A funder via direct URL or API", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // ── Ensure the ONBOARDING_USER exists so org B login works ─────────────────
  try {
    const env = loadEnv();
    const admin = adminClient(env);

    // Create org B user if absent (idempotent — ignore "already exists" errors)
    await admin.auth.admin.createUser({
      email: ONBOARDING_USER.email,
      password: ONBOARDING_USER.password,
      email_confirm: true,
      user_metadata: {
        organization_name: ONBOARDING_USER.organizationName,
        full_name: ONBOARDING_USER.fullName,
      },
    });
  } catch {
    // Non-fatal — if org B already exists the test continues
  }

  // ── Step 1: Log in as org A, create a funder ───────────────────────────────
  await loginAs(page, TEST_EMAIL, TEST_PASSWORD);

  const unique = `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
  const funderName = `Isolation Test Funder (${unique})`;

  await page.goto("/funders/new");
  await expect(
    page.getByRole("heading", { name: /New funder|Add funder/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByLabel(/Funder name|Organization name|Name/i).first().fill(funderName);

  await page.getByRole("button", { name: /Create|Save|Add/i }).first().click();

  // Wait for redirect to the funder detail page at /funders/<id>
  await page.waitForURL(/\/funders\/[a-f0-9-]+$/, { timeout: 20_000 });
  const orgAFunderId = page.url().split("/").pop()!;
  expect(orgAFunderId).toBeTruthy();

  // ── Step 2: Log out org A, log in as org B ─────────────────────────────────
  // Navigate to the login page to clear the session (cookies reset on new goto)
  await page.goto("/login");

  // Ensure org B can log in; if the ONBOARDING org hasn't completed setup,
  // ensureOnboardingAccount from helpers handles that, but here we just need
  // the browser session — the API call above created the user.
  await loginAs(
    page,
    ONBOARDING_USER.email,
    ONBOARDING_USER.password,
  );

  // ── Step 3: Direct URL access — must not render org A's funder ─────────────
  await page.goto(`/funders/${orgAFunderId}`);

  // The page must show a 404 message or redirect away, NOT the funder name
  const funderNameLocator = page.getByText(funderName);
  await expect(funderNameLocator).not.toBeVisible({ timeout: 10_000 });

  // Acceptable outcomes: 404 text, "not found", or a redirect to /funders
  const notFoundIndicator = page.getByText(
    /404|Not found|not found|Funder not found/i,
  );
  const landedOnFundersList =
    page.url().includes("/funders") && !page.url().includes(orgAFunderId);

  const showed404 = await notFoundIndicator
    .isVisible({ timeout: 5_000 })
    .catch(() => false);

  if (!showed404 && !landedOnFundersList) {
    // Check URL again after potential redirect
    const currentUrl = page.url();
    expect(
      currentUrl.includes("/funders") && !currentUrl.includes(orgAFunderId),
      `Expected redirect away from org A's funder. Current URL: ${currentUrl}`,
    ).toBeTruthy();
  }

  // ── Step 4: API call — org A's funder must not appear ─────────────────────
  // The /api/funders endpoint is RLS-scoped so org B's session should only
  // return org B's funders.
  const apiResponse = await page.request.get("/api/funders");
  expect(apiResponse.status()).toBe(200);

  const body = (await apiResponse.json()) as unknown;
  const bodyStr = JSON.stringify(body);

  // org A's funder ID must not be in the response
  expect(bodyStr).not.toContain(orgAFunderId);
  // org A's funder name must not be in the response
  expect(bodyStr).not.toContain(funderName);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  try {
    const env = loadEnv();
    const admin = adminClient(env);
    await admin.from("funders").delete().eq("id", orgAFunderId);
  } catch {
    // Non-fatal
  }
});
