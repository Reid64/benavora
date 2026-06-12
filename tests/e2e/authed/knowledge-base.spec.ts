import { test, expect } from "@playwright/test";

/**
 * 9. Knowledge base profile editor loads (BLUEPRINT §4.7).
 */
test("knowledge base profile editor loads", async ({ page }) => {
  await page.goto("/knowledge-base/profile");

  await expect(
    page.getByRole("heading", { level: 1, name: "Organization Profile" }),
  ).toBeVisible();

  // The editor loads the org record and renders its fields.
  await expect(page.getByLabel(/Legal name/)).toBeVisible();
  await expect(page.getByLabel(/Mission statement/)).toBeVisible();
});
