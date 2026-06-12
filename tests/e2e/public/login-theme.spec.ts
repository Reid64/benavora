import { test, expect } from "@playwright/test";

/**
 * 20. The login page uses the dark theme (globals.css, login/page.tsx). Runs in
 * the unauthenticated "public" project — no session required.
 */
test("login page uses the dark theme", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // The deep #0a0a1a canvas applies on the public login route too.
  const bodyBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bodyBg).toBe("rgb(10, 10, 26)");

  // The brand panel's gradient headline is part of the dark hero.
  await expect(page.getByText("Fund More.").first()).toBeVisible();
});
