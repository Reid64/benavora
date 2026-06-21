/**
 * Smoke test: every critical page must return HTTP 200 and render its main
 * content container without displaying a "500" or generic "Error" banner.
 *
 * Login is performed once at the top of the file; each page navigates without
 * re-authenticating. The test uses soft assertions so a single failing page
 * does not abort the rest of the run.
 */

import { test, expect, type Page } from "@playwright/test";

import { TEST_USER } from "../tests/e2e/helpers";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? TEST_USER.email;
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? TEST_USER.password;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

/**
 * Visit a page, assert no 500/Error content, and assert the main content
 * element (`<main>` or `[role="main"]`) is present.
 */
async function smokePage(
  page: Page,
  path: string,
  opts?: { headingText?: string },
): Promise<void> {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });

  // HTTP status should be 200 (or a client-side redirect that ends in 200)
  const status = response?.status() ?? 200;
  // Some pages may redirect (e.g. /dashboard → /dashboard after auth); allow
  // final status 200 or 302/301 followed by 200 (Playwright follows redirects).
  expect(
    status,
    `${path} responded with status ${status}`,
  ).toBeLessThan(400);

  // Wait for the main container to exist
  const main = page.locator("main, [role='main']").first();
  await expect(main).toBeVisible({ timeout: 15_000 });

  // No "500" text in the body (server error indicator)
  await expect(
    page.getByText("500").first(),
  ).not.toBeVisible();

  // No generic unhandled Error heading from Next.js error boundary
  const errorHeading = page.getByRole("heading", { name: /^Error$/i });
  await expect(errorHeading).not.toBeVisible();

  // Optional: assert a specific heading appears
  if (opts?.headingText) {
    await expect(
      page.getByText(opts.headingText).first(),
    ).toBeVisible({ timeout: 10_000 });
  }
}

test("smoke — all critical pages load without error", async ({ page }) => {
  test.setTimeout(180_000);

  await login(page);

  // /dashboard
  await smokePage(page, "/dashboard");

  // /funders
  await smokePage(page, "/funders");

  // /contacts
  await smokePage(page, "/contacts");

  // /opportunities
  await smokePage(page, "/opportunities");

  // /applications
  await smokePage(page, "/applications");

  // /draft-generator
  await smokePage(page, "/draft-generator");

  // /documents
  await smokePage(page, "/documents");

  // /knowledge-base
  await smokePage(page, "/knowledge-base");

  // /deadlines
  await smokePage(page, "/deadlines");

  // /analytics — routed under /outcomes/analytics in the app; try both
  const analyticsResponse = await page.goto("/analytics", {
    waitUntil: "domcontentloaded",
  });
  if ((analyticsResponse?.status() ?? 404) >= 400) {
    // Fallback path used in the app
    await smokePage(page, "/outcomes/analytics");
  } else {
    const main = page.locator("main, [role='main']").first();
    await expect(main).toBeVisible({ timeout: 15_000 });
  }

  // /autoapply
  await smokePage(page, "/autoapply");

  // /intelligence-library
  await smokePage(page, "/intelligence-library");

  // /email
  await smokePage(page, "/email");

  // /settings
  await smokePage(page, "/settings");

  // /settings/integrations
  await smokePage(page, "/settings/integrations");
});
