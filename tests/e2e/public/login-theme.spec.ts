import { test, expect } from "@playwright/test";

/**
 * 20. The login page pairs a light Soft Stone app shell with a dark brand
 * hero panel (aside, bg-navy-900) — light app + dark hero by design, not a
 * dark page canvas. Runs in the unauthenticated "public" project — no
 * session required.
 */
test("login page uses the dark theme", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // The brand panel's gradient headline is part of the dark hero (bg-navy-900,
  // #2c4e3b) — only visible at lg+ viewport widths, so the desktop project's
  // viewport is required for this locator to render.
  const heroHeading = page.getByRole("heading", { name: /Fund More\./ });
  await expect(heroHeading).toBeVisible();
  const asideBg = await heroHeading.evaluate(
    (el) => getComputedStyle(el.closest("aside")!).backgroundColor,
  );
  expect(asideBg).toBe("rgb(44, 78, 59)");
});
