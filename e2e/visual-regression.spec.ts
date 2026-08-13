/**
 * Visual regression suite (Playwright's built-in `toHaveScreenshot()`),
 * per build task t4-e2e-002 (follows t4-e2e-001's e2e/critical-paths.spec.ts).
 * Covers five authenticated pages: /dashboard, /opportunities,
 * /applications/list, /autoapply, /funders. Logs in as the same dedicated
 * beta account used by e2e/critical-paths.spec.ts (beta1@benavora-test.com,
 * per scripts/seed-beta-users.ts), supporting the same
 * PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD overrides, and runs under
 * the "critical-paths" Playwright project (playwright.config.ts) alongside
 * it.
 *
 * Every page here renders at least one live value that changes from run to
 * run even with no UI change at all - a clock ("Live · 2:45 PM"), a "today's
 * date" header, relative-age text on agent/queue activity ("3 days ago",
 * "Just now"), etc. `timestampMasks()` below covers those generically
 * (native <time> elements, common timestamp data-attributes, relative-age
 * phrases, clock times, and absolute month/day/year dates) so a screenshot
 * taken today and one taken next week diff as identical everywhere except
 * that data.
 *
 * BASELINES: the committed PNGs under
 * e2e/visual-regression.spec.ts-snapshots/ are the source of truth for
 * `pnpm test:visual`, which only *compares* against them - it never
 * regenerates. Baselines must be regenerated DELIBERATELY, with an explicit
 * command and a reviewed diff, any time an intentional UI change is made:
 *
 *     npx playwright test e2e/visual-regression.spec.ts --update-snapshots
 *
 * Never let a baseline update happen silently as a side effect of a normal
 * `pnpm test:visual` / `pnpm test` / CI run.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? "beta1@benavora-test.com";
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? "BetaTest2026";

/** Text patterns that indicate a live timestamp or relative/absolute date, not stable UI copy. */
const TIME_TEXT_PATTERNS: RegExp[] = [
  // "3 days ago", "1 hour ago", "just now", "today", "yesterday", "tomorrow"
  /\b\d+\s*(second|minute|hour|day|week|month|year)s?\s+ago\b/i,
  /\b(just now|today|yesterday|tomorrow)\b/i,
  // clock times: "2:45 PM", "14:05"
  /\b\d{1,2}:\d{2}\s?(AM|PM)?\b/i,
  // absolute dates: "August 13, 2026", "Aug 13", "2026-08-13"
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}(,\s*\d{4})?\b/i,
  /\b\d{4}-\d{2}-\d{2}\b/,
];

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

/**
 * Locators for anything on the current page that could render a live
 * timestamp or relative/absolute date, meant to be passed straight into
 * `toHaveScreenshot`'s `mask` option. A locator that matches nothing on a
 * given page is a harmless no-op, so this same broad set is reused across
 * every page in this file rather than hand-tuned per page.
 */
function timestampMasks(page: Page): Locator[] {
  const masks: Locator[] = [
    page.locator("time"),
    page.locator("[data-testid*='timestamp' i]"),
    page.locator("[data-testid*='updated' i]"),
    page.locator("[data-testid*='last-run' i]"),
    page.locator("[data-timestamp]"),
  ];
  for (const pattern of TIME_TEXT_PATTERNS) {
    masks.push(page.getByText(pattern));
  }
  return masks;
}

async function captureScreenshot(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    mask: timestampMasks(page),
  });
}

test.describe("Visual regression", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("dashboard", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/dashboard");
    await expect(page.locator("h1").first()).toBeVisible();
    await captureScreenshot(page, "dashboard.png");
  });

  test("opportunities", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/opportunities");
    await expect(
      page.getByRole("heading", { level: 1, name: "Opportunities" }),
    ).toBeVisible();
    await captureScreenshot(page, "opportunities.png");
  });

  test("applications list", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/applications/list");
    await expect(
      page.getByRole("heading", { level: 1, name: "Applications" }),
    ).toBeVisible();
    await captureScreenshot(page, "applications-list.png");
  });

  test("autoapply", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/autoapply");
    await expect(
      page.getByRole("heading", { level: 1, name: "AUTOAPPLY ENGINE" }),
    ).toBeVisible();
    await captureScreenshot(page, "autoapply.png");
  });

  test("funders", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/funders");
    await expect(
      page.getByRole("heading", { level: 1, name: "Funders" }),
    ).toBeVisible();
    await captureScreenshot(page, "funders.png");
  });
});
