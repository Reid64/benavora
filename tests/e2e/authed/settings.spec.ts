import { test, expect } from "@playwright/test";

/**
 * 12. Settings page loads (BLUEPRINT §3.2 / PRD US-03).
 */
test("settings page loads", async ({ page }) => {
  await page.goto("/settings");

  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();

  // Owner sees the organization, team, and feature-flag sections.
  await expect(
    page.getByRole("heading", { name: "Organization", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
  await expect(page.getByLabel("Organization name")).toBeVisible();
});
