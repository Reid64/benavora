import { test, expect } from "@playwright/test";

/**
 * 10. Draft generator template selection renders (BLUEPRINT §4.8).
 * The seeded opportunity unlocks the generation flow (opportunity + template).
 */
test("draft generator template selection renders", async ({ page }) => {
  await page.goto("/draft-generator");

  await expect(
    page.getByRole("heading", { level: 1, name: "Draft Generator" }),
  ).toBeVisible();

  // The template chooser is a radiogroup of template-type cards.
  const templates = page.getByRole("radiogroup", {
    name: "Draft template type",
  });
  await expect(templates).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Grant narrative" }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Donation request letter" }),
  ).toBeVisible();
});
