import { test, expect } from "@playwright/test";

/**
 * 7. Pipeline board renders with columns (BLUEPRINT §4.5).
 * The seeded application makes the kanban board render its 4 phase groups.
 */
test("pipeline board renders with columns", async ({ page }) => {
  await page.goto("/applications");

  await expect(
    page.getByRole("heading", { level: 1, name: "Applications" }),
  ).toBeVisible();

  // Switch to kanban view so the phase columns are rendered.
  await page.getByRole("button", { name: "Kanban" }).click();

  // The 4 phase group headings appear regardless of application count.
  for (const group of ["Discovery", "Preparation", "Active", "Outcome"]) {
    await expect(page.getByText(group, { exact: true }).first()).toBeVisible();
  }
});
