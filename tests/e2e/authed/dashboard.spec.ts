import { test, expect } from "@playwright/test";

/**
 * 3. Dashboard renders with metric cards (BLUEPRINT §4.1).
 */
test("dashboard renders with metric cards", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { level: 1, name: "Dashboard" }),
  ).toBeVisible();

  // The seven metric cards from the blueprint.
  for (const label of [
    "Total Opportunities",
    "Applications Submitted",
    "Drafts Pending Review",
    "Deadlines This Week",
    "Total Dollars Requested",
    "Total Dollars Awarded",
    "Overall Success Rate",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  // Supporting widgets are present.
  await expect(
    page.getByRole("heading", { name: "Pipeline summary" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent opportunities" }),
  ).toBeVisible();
});
