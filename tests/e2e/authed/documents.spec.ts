import { test, expect } from "@playwright/test";

/**
 * 8. Document upload page renders (BLUEPRINT §4.6).
 */
test("document upload page renders", async ({ page }) => {
  await page.goto("/documents");

  await expect(
    page.getByRole("heading", { level: 1, name: "Documents" }),
  ).toBeVisible();

  // The owner is an editor, so the upload drop-zone is rendered.
  await expect(
    page.getByText("Drag & drop or click to browse"),
  ).toBeVisible();
});
