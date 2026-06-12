import { test, expect } from "@playwright/test";

/**
 * Phase 4 — Email + Calendar (BLUEPRINT §Phase 4, §4.11). This build surfaces
 * the email feature set through the Outreach hub and its drip-campaign manager,
 * and Google Calendar through deadline sync. There is no standalone /emails
 * inbox route in the MVP, so the email-surface check targets the Outreach hub.
 *
 * Backed by the Phase 2-5 seed: one active campaign with two steps, an enrolled
 * outreach contact, and one sent email.
 */

const SEED_CAMPAIGN = "Spring Construction Outreach (E2E Seed)";
const SEED_CONTACT = "Bluebonnet Builders (E2E Seed)";

/** 8. The email-outreach surface renders with its campaigns entry point. */
test("outreach hub renders the email campaigns entry point", async ({
  page,
}) => {
  await page.goto("/outreach");

  await expect(
    page.getByRole("heading", { level: 1, name: "Outreach" }),
  ).toBeVisible();
  // The drip-email campaign manager is reachable from the hub.
  await expect(page.getByRole("button", { name: "Campaigns" })).toBeVisible();
});

/** 9. The calendar sync button reflects the Google connection state. */
test("calendar sync button appears when Google is connected", async ({
  page,
}) => {
  await page.goto("/deadlines");
  await expect(
    page.getByRole("heading", { level: 1, name: "Deadlines" }),
  ).toBeVisible();

  // Not connected by default → the sync control is hidden ("connect first").
  await expect(
    page.getByRole("button", { name: "Sync to Calendar" }),
  ).toHaveCount(0);

  // Simulate a connected Google Calendar account.
  await page.route(/\/api\/integrations\/google\/calendar$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ connected: true }),
      });
    } else {
      await route.continue();
    }
  });
  await page.reload();

  await expect(
    page.getByRole("button", { name: "Sync to Calendar" }),
  ).toBeVisible();
});

/** 10. The campaign builder renders its step editor. */
test("campaign builder renders the step editor", async ({ page }) => {
  await page.goto("/outreach/campaigns");
  await expect(
    page.getByRole("heading", { level: 1, name: "Campaigns" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "New campaign" }).click();

  // The builder modal: name, a first step with subject/body, add-step, save.
  await expect(page.getByLabel("Campaign name")).toBeVisible();
  await expect(page.getByText("Step 1")).toBeVisible();
  await expect(page.getByLabel("Subject")).toBeVisible();
  await expect(page.getByLabel("Body")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add step" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save campaign" })).toBeVisible();
});

/** 11. Campaign detail shows per-contact send status. */
test("campaign detail shows per-contact status", async ({ page }) => {
  await page.goto("/outreach/campaigns");

  await page
    .locator('a[href^="/outreach/campaigns/"]', { hasText: SEED_CAMPAIGN })
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: SEED_CAMPAIGN }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();

  // The enrolled contact appears with its latest send state. The contact name
  // also shows up in the "Send timeline" list below, so scope the assertion to
  // the contacts row (it carries the contact_name) to avoid a strict-mode match
  // on both occurrences.
  const contactRow = page
    .getByRole("listitem")
    .filter({ hasText: SEED_CONTACT })
    .first();
  await expect(contactRow).toBeVisible();
  await expect(contactRow.getByText("Sent", { exact: true })).toBeVisible();
});
