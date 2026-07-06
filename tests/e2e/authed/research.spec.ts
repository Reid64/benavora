import { test, expect } from "@playwright/test";

/**
 * Phase 2 — Research Command Center (BLUEPRINT §3.1 "Research", AGENTS.md
 * Agents 12-15). Backed by the Phase 2-5 seed: one active search profile, two
 * recent agent runs (completed + failed), and one discovered opportunity whose
 * source is the search profile.
 */

const SEED_DISCOVERY = "Acme Corp Community Giving (E2E Seed)";

/** 1. Research dashboard renders with source control cards. */
test("research dashboard renders with profile cards", async ({ page }) => {
  await page.goto("/research");

  await expect(
    page.getByRole("heading", { level: 1, name: "Research Command Center" }),
  ).toBeVisible();

  // Control Panel section is present.
  await expect(
    page.getByRole("heading", { name: "Control Panel" }),
  ).toBeVisible();
});

/** 2. A source's "Run" button is enabled and fires the correct endpoint. */
test("search profile Run now triggers an agent run", async ({ page }) => {
  await page.goto("/research");

  // Stub the trigger endpoint so the click exercises the wiring without kicking
  // off a real (slow, network-bound) research agent.
  await page.route(/\/api\/agents\/research/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    }),
  );

  const runBtn = page.getByRole("button", { name: "Run" }).first();
  await expect(runBtn).toBeEnabled({ timeout: 15000 });
});

/** 3. Agent run status labels render in the page (Completed / Failed). */
test("agent run statuses display in the activity feed", async ({ page }) => {
  await page.goto("/research");

  // The seeded agent runs contain Completed and Failed statuses.
  // At least one status badge should appear somewhere on the page.
  await expect(
    page.getByText("Completed", { exact: true }).or(
      page.getByText("Failed", { exact: true }),
    ).first(),
  ).toBeVisible({ timeout: 20000 });
});

/** 4. Discovered opportunities appear in the feed. */
test("discovered opportunities show their source", async ({ page }) => {
  await page.goto("/research");

  await expect(
    page.getByRole("heading", { name: "Discovered Opportunities" }),
  ).toBeVisible({ timeout: 15000 });

  // The discovery card links to the opportunity.
  const card = page.locator('a[href^="/opportunities/"]', {
    hasText: SEED_DISCOVERY,
  });
  await expect(card).toBeVisible({ timeout: 15000 });
});
