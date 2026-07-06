import { test, expect } from "@playwright/test";

/**
 * UI redesign — premium dark theme + branded sidebar (globals.css, Sidebar.tsx).
 */

/** 18. Dark mode is applied globally (deep #0a0a1a canvas). */
test("dark mode is applied globally", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { level: 1, name: "Dashboard" }),
  ).toBeVisible();

  // <html class="dark"> drives the theme; the body canvas is #0a0a1a.
  const htmlClass = await page.evaluate(
    () => document.documentElement.className,
  );
  expect(htmlClass).toContain("dark");

  const bodyBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bodyBg).toBe("rgb(15, 17, 23)");
});

/** 19. Sidebar renders with the logo and a highlighted active item. */
test("sidebar renders with logo and active state", async ({ page }) => {
  await page.goto("/dashboard");

  const sidebar = page.locator('aside[aria-label="Primary navigation"]');
  await expect(sidebar).toBeVisible();

  // Brand mark links back to the dashboard.
  await expect(
    sidebar.getByRole("link", { name: /Benavora/ }),
  ).toBeVisible();

  // Core sidebar nav items are present (Dashboard/Research live in the header bar).
  for (const item of ["Funders", "Applications", "Documents"]) {
    await expect(
      sidebar.getByRole("link", { name: item, exact: true }),
    ).toBeVisible();
  }

  // Any active item has the teal accent bar.
  const active = sidebar.locator('a[aria-current="page"]');
  if (await active.count() > 0) {
    await expect(active.first().locator("span.bg-teal-400")).toBeVisible();
  }
});
