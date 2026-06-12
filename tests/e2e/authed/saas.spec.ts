import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 5 — Licensable SaaS (BLUEPRINT §Phase 5). Billing, team management,
 * audit log, usage, and role gating. The test account is the organization owner.
 */

/** 12. Billing page renders the plan cards. */
test("billing page renders plan cards", async ({ page }) => {
  await page.goto("/billing");

  await expect(
    page.getByRole("heading", { level: 1, name: "Billing" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();

  for (const plan of ["Free", "Starter", "Professional", "Enterprise"]) {
    await expect(
      page.getByRole("heading", { name: plan, exact: true }),
    ).toBeVisible();
  }
});

/** 16. Usage meters display on the billing page. */
test("billing page shows usage meters", async ({ page }) => {
  await page.goto("/billing");

  await expect(page.getByRole("heading", { name: "Current plan" })).toBeVisible();
  await expect(page.getByText("Agent runs / day")).toBeVisible();
  await expect(page.getByText("Storage", { exact: true })).toBeVisible();
  // exact (case-sensitive) so this doesn't also match the sidebar's
  // "Search Profiles" nav link.
  await expect(page.getByText("Search profiles", { exact: true })).toBeVisible();
});

/** 14. Settings team section shows the user list and an invite button. */
test("settings team section shows users and invite", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite user" })).toBeVisible();

  // The roster lists the current user — the "You" badge appears only there.
  await expect(page.getByText("You", { exact: true })).toBeVisible();
});

/** 15. Audit log page renders with its filters. */
test("audit log page renders with filters", async ({ page }) => {
  await page.goto("/admin/audit-log");

  await expect(
    page.getByRole("heading", { level: 1, name: "Audit Log" }),
  ).toBeVisible();

  for (const label of ["Action", "User", "Entity", "From", "To"]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
});

/**
 * 17. Role gates hide billing from non-owner users.
 *
 * Rather than mutate the shared owner role in the database (which would race the
 * other parallel specs), this downgrades only THIS page's view of the role by
 * rewriting the client's profile fetch to "viewer". The billing page is a client
 * component that self-gates on that fetch via useProfile (a second barrier on
 * top of the owner-only sidebar link and the owner-only /api/billing route).
 */
async function forceViewerRole(page: Page) {
  await page.route(/\/rest\/v1\/profiles/, async (route) => {
    const response = await route.fetch();
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }
    const patched = Array.isArray(data)
      ? data.map((row) => ({ ...(row as object), role: "viewer" }))
      : { ...(data as object), role: "viewer" };
    await route.fulfill({
      status: response.status(),
      contentType: "application/json",
      body: JSON.stringify(patched),
    });
  });
}

test("billing is hidden from non-owner users", async ({ page }) => {
  await forceViewerRole(page);
  await page.goto("/billing");

  // The owner-only gate blocks the billing content for a viewer.
  await expect(page.getByText("Owner access required")).toBeVisible();
  // No plan grid is rendered for a non-owner.
  await expect(
    page.getByRole("heading", { name: "Free", exact: true }),
  ).toHaveCount(0);
});
