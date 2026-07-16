import { test, expect } from "@playwright/test";

/**
 * UI redesign — premium light theme + branded sidebar (globals.css, Sidebar.tsx).
 *
 * The canvas has flip-flopped between light and dark across sessions (see
 * benavora-design-history-dark-vs-light memory). Confirmed 2026-07-15: light
 * theme, no dark canvas, no <html class="dark">. Don't reintroduce dark mode
 * without explicit direction — check that memory first.
 */

/** 18. Light theme is applied globally (page canvas, not a dark mode). */
test("light theme is applied globally, not dark mode", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { level: 1, name: "Dashboard" }),
  ).toBeVisible();

  const htmlClass = await page.evaluate(
    () => document.documentElement.className,
  );
  expect(htmlClass).not.toContain("dark");

  const bodyBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bodyBg).toBe("rgb(228, 233, 240)");
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
