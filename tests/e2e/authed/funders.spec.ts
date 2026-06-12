import { test, expect } from "@playwright/test";

/**
 * 4. Funder list page loads (BLUEPRINT §4.2).
 * 5. Create-funder form submits successfully.
 */

test("funder list page loads", async ({ page }) => {
  await page.goto("/funders");

  await expect(
    page.getByRole("heading", { level: 1, name: "Funders" }),
  ).toBeVisible();

  // The owner can create funders, so the action is present.
  await expect(
    page.getByRole("link", { name: "New funder" }).first(),
  ).toBeVisible();

  // The seeded funder appears in the list (real data, real table).
  await expect(
    page.getByText("Lone Star Community Foundation (E2E Seed)"),
  ).toBeVisible();
});

test("create funder form submits successfully", async ({ page }) => {
  const name = `Acme Giving ${Date.now()}`;

  await page.goto("/funders/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "New funder" }),
  ).toBeVisible();

  await page.getByLabel(/Funder name/).fill(name);
  // Category is required; pick a valid funder_category option.
  await page.getByLabel(/Category/).selectOption("corporate_donation");

  await page.getByRole("button", { name: "Create funder" }).click();

  // On success the form navigates to the new funder's detail page.
  await page.waitForURL(/\/funders\/[0-9a-f-]{36}$/, { timeout: 20000 });
  await expect(page.getByText(name)).toBeVisible();
});
