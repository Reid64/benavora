import { test, expect } from "@playwright/test";

/**
 * 6. Opportunity list with filters renders (BLUEPRINT §4.4).
 * The seeded opportunity makes the table — and its full filter set — render.
 */
test("opportunity list with filters renders", async ({ page }) => {
  await page.goto("/opportunities");

  await expect(
    page.getByRole("heading", { level: 1, name: "Opportunities" }),
  ).toBeVisible();

  // The filter controls (keyword, category, status) are present.
  await expect(
    page.getByRole("searchbox", { name: "Search opportunities" }),
  ).toBeVisible();
  await expect(page.getByLabel("Filter by category")).toBeVisible();
  await expect(page.getByLabel("Filter by status")).toBeVisible();

  // The seeded opportunity is listed.
  await expect(
    page.getByText("Rural Housing Stability Grant (E2E Seed)"),
  ).toBeVisible();
});
