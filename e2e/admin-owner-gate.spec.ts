/**
 * E2E verification for the owner-only Platform admin gate
 * (AUDIT_NAV_CONSOLIDATION.md — RESOLVED). Confirms a non-owner "admin" user
 * hitting an owner-gated admin route directly is redirected server-side, not
 * merely hidden from the sidebar nav.
 */

import { test, expect } from "@playwright/test";

import {
  ADMIN_NON_OWNER_USER,
  ensureAdminNonOwnerAccount,
  loadEnv,
} from "../tests/e2e/helpers";

test.beforeAll(async () => {
  const env = loadEnv();
  await ensureAdminNonOwnerAccount(env);
});

async function loginAsNonOwnerAdmin(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_NON_OWNER_USER.email);
  await page.getByLabel("Password").fill(ADMIN_NON_OWNER_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

test("non-owner admin hitting /admin/orgs directly is redirected server-side", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAsNonOwnerAdmin(page);

  await page.goto("/admin/orgs");

  // The redirect happens before any client JS for this route runs — a purely
  // client-side gate could not produce this URL change.
  await expect(page).toHaveURL(/\/dashboard\?notice=owner_required/, { timeout: 15_000 });
});

test("non-owner admin hitting /admin/sales-outreach directly is redirected server-side", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAsNonOwnerAdmin(page);

  await page.goto("/admin/sales-outreach");

  await expect(page).toHaveURL(/\/dashboard\?notice=owner_required/, { timeout: 15_000 });
});

test("non-owner admin does not see the Platform nav section", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAsNonOwnerAdmin(page);

  // Sidebar's Platform section (Organizations, System Health, Sales Outreach,
  // etc.) is gated to role === "owner" only (src/components/layout/Sidebar.tsx).
  await expect(page.getByRole("link", { name: "Organizations" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sales Outreach" })).toHaveCount(0);
});
