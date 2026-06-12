import { test, expect } from "@playwright/test";

/**
 * 11. Deadlines page renders the calendar view (BLUEPRINT §4.9).
 * Calendar is the default view; the seeded deadline populates the month grid.
 */
test("deadlines page renders calendar view", async ({ page }) => {
  await page.goto("/deadlines");

  await expect(
    page.getByRole("heading", { level: 1, name: "Deadlines" }),
  ).toBeVisible();

  // Calendar is selected by default.
  await expect(
    page.getByRole("button", { name: "Calendar" }),
  ).toHaveAttribute("aria-pressed", "true");

  // The monthly grid renders weekday headers and day cells.
  await expect(page.getByText("Sun", { exact: true })).toBeVisible();
  await expect(page.getByText("Mon", { exact: true })).toBeVisible();
  await expect(page.getByText("Sat", { exact: true })).toBeVisible();
});
