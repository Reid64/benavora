import { test, expect } from "@playwright/test";

/**
 * A signed-in visitor hitting the bare root ("/") should land on their
 * dashboard, not the logged-out marketing pitch (src/middleware.ts). This is
 * the one carve-out from the "public routes never block signed-in users"
 * rule, so it's scoped to exactly "/" - verified here alongside a check that
 * other public marketing routes stay reachable while signed in, guarding
 * against the carve-out accidentally widening to block those too.
 */

test("signed-in visitor to / redirects to /dashboard", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/dashboard(?:$|\?)/);
  expect(new URL(page.url()).pathname).toBe("/dashboard");
});

test("signed-in visitor can still reach other public marketing routes", async ({ page }) => {
  const response = await page.goto("/pricing");
  expect(response?.status()).toBeLessThan(400);
  expect(new URL(page.url()).pathname).toBe("/pricing");
});
