import { test, expect, type Page } from "@playwright/test";
import { PLATFORM, SOLUTIONS, RESOURCES, type NavGroup } from "@/lib/marketing/nav";

/**
 * MarketingNav dropdown visibility (src/components/marketing/MarketingNav.tsx).
 *
 * Distinct from tests/e2e/authed/nav-dropdown-visibility.spec.ts, which covers
 * Header.tsx's dashboard org-avatar/notification menus - a different
 * component. Do not assume that result applies here.
 *
 * Locates items by href, not accessible name: PLATFORM items render a blurb
 * <div> inside the same <Link>, which folds into the link's accessible name
 * (e.g. "Funding IntelligenceReads the NOFO..."), so name-based queries
 * silently match zero elements for every blurbed item.
 *
 * Asserts the opened panel is close to the nav's own width, not just
 * toBeInViewport(): a menu whose containing block collapsed to the trigger
 * button's width (the actual bug found here) still renders on-screen and
 * still passes a viewport-intersection check - it's just squeezed into a
 * sliver a few dozen pixels wide with badly wrapped text instead of the
 * intended full-width layout. Width is the signal that actually catches that.
 */

const GROUPS: NavGroup[] = [PLATFORM, SOLUTIONS, RESOURCES];
const MIN_DESKTOP_MENU_WIDTH = 600;

async function openDesktopGroup(page: Page, group: NavGroup) {
  const nav = page.locator(".mk-desktop-nav");
  const trigger = nav.getByRole("button", { name: group.label, exact: true });
  await expect(trigger).toBeVisible();
  await trigger.hover();
  await expect(page.locator(`a[href="${group.items[0].href}"]`).first()).toBeVisible();
}

test.describe("MarketingNav desktop mega menus", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const group of GROUPS) {
    test(`${group.label} dropdown is fully visible, not clipped`, async ({ page }) => {
      await page.goto("/");
      await openDesktopGroup(page, group);

      const panel = page
        .locator('div[style*="position: absolute"]')
        .filter({ has: page.locator(`a[href="${group.items[0].href}"]`) })
        .first();
      const panelBox = await panel.boundingBox();
      expect(panelBox, "mega menu panel should have a bounding box").not.toBeNull();
      expect(
        panelBox!.width,
        "mega menu panel should span close to the full nav width, not collapse to the trigger button's width",
      ).toBeGreaterThan(MIN_DESKTOP_MENU_WIDTH);

      for (const item of group.items) {
        const link = page.locator(`a[href="${item.href}"]`).first();
        await expect(link, `${group.label} > ${item.label} should be visible`).toBeVisible();
        await expect(
          link,
          `${group.label} > ${item.label} bounding box should not be clipped`,
        ).toBeInViewport({ ratio: 0.98 });
      }
    });
  }
});

test.describe("MarketingNav mobile menu", () => {
  test.use({ viewport: { width: 390, height: 667 } });

  for (const group of GROUPS) {
    test(`${group.label} mobile accordion is fully visible, not clipped`, async ({ page }) => {
      await page.goto("/");

      const toggle = page.getByRole("button", { name: "Toggle menu" });
      await expect(toggle).toBeVisible();
      await toggle.click();

      const panel = page.locator(".mk-mobile-panel");
      const groupButton = panel.getByRole("button", { name: group.label, exact: true });
      await expect(groupButton).toBeVisible();
      await groupButton.click();

      for (const item of group.items) {
        const link = panel.locator(`a[href="${item.href}"]`).first();
        await expect(link, `${group.label} > ${item.label} should be visible`).toBeVisible();
        // The panel is an independently scrollable overlay (.mk-mobile-panel,
        // position: fixed + overflowY: auto) - with Solutions now at 21 items,
        // it can no longer all fit on one phone screen at once, same as any
        // native mobile menu. Scrolling within the panel is the point, not a
        // bug; scroll each item into view before asserting it isn't clipped,
        // rather than requiring the whole list to be simultaneously visible.
        await link.scrollIntoViewIfNeeded();
        await expect(
          link,
          `${group.label} > ${item.label} bounding box should not be clipped`,
        ).toBeInViewport({ ratio: 0.98 });
      }
    });
  }
});

test.describe("MarketingNav sign-in link", () => {
  test("desktop nav has a Sign in link to /login", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const link = page.locator(".mk-desktop-actions").getByRole("link", { name: "Sign in", exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/login");
    await link.click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("mobile nav has a Sign in link to /login", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 667 });
    await page.goto("/");
    await page.getByRole("button", { name: "Toggle menu" }).click();
    const link = page.locator(".mk-mobile-panel").getByRole("link", { name: "Sign in", exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/login");
    await link.click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
