import { test, expect } from "@playwright/test";

/**
 * Phase 2 — Research agent dashboard (BLUEPRINT §3.1 "Research", AGENTS.md
 * Agents 12-15). Backed by the Phase 2-5 seed: one active search profile, two
 * recent agent runs (completed + failed), and one discovered opportunity whose
 * source is the search profile.
 */

const SEED_PROFILE = "Corporate Giving Sweep (E2E Seed)";
const SEED_DISCOVERY = "Acme Corp Community Giving (E2E Seed)";

/** 1. Research dashboard renders with profile cards. */
test("research dashboard renders with profile cards", async ({ page }) => {
  await page.goto("/research");

  await expect(
    page.getByRole("heading", { level: 1, name: "Research" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Search profiles" }),
  ).toBeVisible();

  // The seeded search profile renders as a card with its name and Active badge.
  await expect(
    page.getByRole("heading", { name: SEED_PROFILE }),
  ).toBeVisible();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
});

/** 2. A profile's "Run now" button triggers a research agent run. */
test("search profile Run now triggers an agent run", async ({ page }) => {
  await page.goto("/research");

  // Stub the trigger endpoint so the click exercises the wiring without kicking
  // off a real (slow, network-bound) research agent.
  await page.route(/\/api\/agents\/research$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    }),
  );

  const runNow = page.getByRole("button", { name: "Run now" }).first();
  await expect(runNow).toBeEnabled();

  const triggered = page.waitForRequest(
    (req) => /\/api\/agents\/research$/.test(req.url()) && req.method() === "POST",
  );
  await runNow.click();
  const request = await triggered;

  // The run is triggered with the profile id, never an organization id (§2).
  expect(request.postDataJSON()).toMatchObject({ profileId: expect.any(String) });
});

/** 3. Agent run status updates display correctly in the activity feed. */
test("agent run statuses display in the activity feed", async ({ page }) => {
  await page.goto("/research");

  await expect(
    page.getByRole("heading", { name: "Recent activity" }),
  ).toBeVisible();

  // The seed inserts a completed and a failed research run.
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Failed", { exact: true }).first()).toBeVisible();
});

/** 4. Discovered opportunities appear in the feed with source attribution. */
test("discovered opportunities show their source", async ({ page }) => {
  await page.goto("/research");

  await expect(
    page.getByRole("heading", { name: "Recent discoveries" }),
  ).toBeVisible();

  // The discovery card links to the opportunity and shows its source profile.
  const card = page.locator('a[href^="/opportunities/"]', {
    hasText: SEED_DISCOVERY,
  });
  await expect(card).toBeVisible();
  await expect(card.getByText(SEED_PROFILE)).toBeVisible();
});
