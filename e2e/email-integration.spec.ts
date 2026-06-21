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

test("integrations page shows Gmail and Calendar connection cards", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page);

  await page.goto("/settings/integrations");

  // Wait for the page to finish loading (useProfile + data fetch)
  await expect(
    page.getByText(/Gmail|Google/i).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Gmail connection card
  await expect(page.getByText("Gmail").first()).toBeVisible();

  // Calendar connection card
  await expect(
    page.getByText(/Google Calendar|Calendar/i).first(),
  ).toBeVisible();

  // No server error
  await expect(page.getByText("500")).not.toBeVisible();
});

test("email hub loads (empty state if no Gmail connection)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page);

  await page.goto("/email");

  // Either the inbox loads or an empty / connect state is shown
  await expect(
    page.getByText(
      /Inbox|Email|Connect Gmail|No threads|no messages/i,
    ).first(),
  ).toBeVisible({ timeout: 15_000 });

  // No server error
  await expect(page.getByText("500")).not.toBeVisible();
  await expect(page.getByText("Error")).not.toBeVisible();
});

test("email campaigns list renders", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);

  await page.goto("/email/campaigns");

  // The campaigns list page heading or an empty state
  await expect(
    page.getByText(/Campaigns|campaigns/i).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Either campaign rows or an empty state text is acceptable
  await expect(
    page.getByText(/No campaigns|New campaign|campaign/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  // No server error
  await expect(page.getByText("500")).not.toBeVisible();
});
