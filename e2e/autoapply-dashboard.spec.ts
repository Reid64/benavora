import { test, expect, type Page } from "@playwright/test";

import { TEST_USER } from "../tests/e2e/helpers";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? TEST_USER.email;
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? TEST_USER.password;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

test("autoapply dashboard loads with queue panel", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);

  await page.goto("/autoapply");
  await expect(page.getByRole("heading", { name: "AutoApply" })).toBeVisible({
    timeout: 15_000,
  });

  // Queue metrics / stat cards should be present (the QueueMetrics component renders them)
  await expect(
    page.getByText(/Queue Panel|queue panel/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Queue card — either items or an empty state is acceptable
  await expect(
    page.getByText(/Queue is empty|Funder/i).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("autoapply compliance page loads with 41 jurisdictions reference", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page);

  await page.goto("/autoapply/compliance");
  await expect(
    page.getByRole("heading", { name: "Solicitation Registrations" }),
  ).toBeVisible({ timeout: 15_000 });

  // The page describes 41 states (40 + DC) in the card subtitle
  await expect(
    page.getByText(/41 states/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  // The state selection dropdown for the reference section should exist
  await expect(page.locator("#ref-state")).toBeVisible();

  // Active registrations card
  await expect(
    page.getByText("Active Registrations", { exact: true }),
  ).toBeVisible();
});

test("autoapply settings page renders automation settings form", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page);

  await page.goto("/autoapply/settings");

  // Should have a heading or major text anchor
  await expect(
    page.getByText(/Auto-Queue Settings|AutoApply Settings|Automation Settings/i).first(),
  ).toBeVisible({ timeout: 15_000 });

  // The form should have schedule and max-per-batch controls
  // (these come from AutoApplySettingsPage component)
  const formElements = page
    .locator("select, input[type='number'], input[type='text']")
    .first();
  await expect(formElements).toBeVisible({ timeout: 10_000 });

  // No 500 error text
  await expect(page.getByText("500")).not.toBeVisible();
});
