/**
 * E2E tests for the Sales Outreach admin page (/admin/sales-outreach).
 *
 * Covers:
 *   - Dashboard loads with tab navigation
 *   - Domains tab renders domain management UI
 *   - Prospects tab renders prospect table
 *   - Suppression List tab renders suppression list
 *   - Unauthenticated users are redirected to /login
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

// ── Dashboard shell ───────────────────────────────────────────────────────────

test("sales outreach dashboard loads with heading and tab navigation", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.goto("/admin/sales-outreach");

  await expect(
    page.getByRole("heading", { name: "Sales Outreach" }),
  ).toBeVisible({ timeout: 15_000 });

  // All primary tabs present
  for (const label of ["Campaigns", "Domains", "Prospects", "Suppression List"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  // Default tab is Campaigns
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible({ timeout: 10_000 });
});

// ── Domains tab ───────────────────────────────────────────────────────────────

test("Domains tab renders domain management UI with Add Domain button", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.goto("/admin/sales-outreach");

  await page.waitForSelector("text=Sales Outreach", { timeout: 15_000 });
  await page.getByRole("button", { name: "Domains" }).click();

  await expect(
    page.getByRole("heading", { name: "Sending Domains" }),
  ).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole("button", { name: /Add Domain/i })).toBeVisible();
});

// ── Prospects tab ─────────────────────────────────────────────────────────────

test("Prospects tab renders prospect table with Import CSV button", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.goto("/admin/sales-outreach");

  await page.waitForSelector("text=Sales Outreach", { timeout: 15_000 });
  await page.getByRole("button", { name: "Prospects" }).click();

  await expect(
    page.getByRole("heading", { name: "Prospects" }),
  ).toBeVisible({ timeout: 10_000 });

  // Import CSV button is visible in the toolbar
  await expect(page.getByRole("button", { name: /Import CSV/i })).toBeVisible();
});

// ── Suppression List tab ──────────────────────────────────────────────────────

test("Suppression List tab renders with Add Email button", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.goto("/admin/sales-outreach");

  await page.waitForSelector("text=Sales Outreach", { timeout: 15_000 });
  await page.getByRole("button", { name: "Suppression List" }).click();

  await expect(
    page.getByRole("heading", { name: "Suppression List" }),
  ).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole("button", { name: /Add Email/i })).toBeVisible();
});

// ── Access control ────────────────────────────────────────────────────────────

test("unauthenticated user is redirected to /login when accessing /admin/sales-outreach", async ({
  browser,
}) => {
  test.setTimeout(30_000);

  // Open a fresh context with no auth cookies
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto("/admin/sales-outreach");

  // Middleware should redirect unauthenticated requests to /login
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  await ctx.close();
});
