import { expect, test } from "@playwright/test";

/**
 * Smoke test — verifies the app boots and the landing page renders.
 * This is the baseline E2E gate; feature suites are added alongside their
 * routes. Without at least one spec, `playwright test` exits non-zero
 * ("No tests found"), which fails the quality gate.
 */
test("landing page renders the Benavora hero", async ({ page }) => {
  await page.goto("/");
  // The redesigned hero leads with the tagline as the page's H1; "Benavora" is
  // the brand wordmark beside the logo mark.
  await expect(
    page.getByRole("heading", { level: 1, name: /Fund More/ }),
  ).toBeVisible();
  await expect(page.getByText("Benavora", { exact: true })).toBeVisible();
});
