import { test, expect, type Page } from "@playwright/test";

import { TEST_USER, adminClient, loadEnv } from "../tests/e2e/helpers";

/**
 * Critical path: login → create opportunity → create application → advance
 * through pipeline stages → verify final stage on the kanban board.
 *
 * Uses PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD when set, falling back
 * to the shared test owner credentials. The test creates its own opportunity
 * and application so it never collides with the seeded dataset.
 */

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? TEST_USER.email;
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? TEST_USER.password;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

/** Move an application to a new stage via the "Move application" modal. */
async function moveToStage(page: Page, targetLabel: string): Promise<void> {
  await page.getByRole("button", { name: "Move application" }).click();
  await expect(
    page.getByRole("heading", { name: "Move application" }),
  ).toBeVisible();
  await page.getByLabel("Move to stage").selectOption({ label: targetLabel });
  await page.getByRole("button", { name: "Confirm move" }).click();
  // Wait for the modal to close and the badge to update.
  await expect(
    page.getByRole("heading", { name: "Move application" }),
  ).toBeHidden({ timeout: 10_000 });
}

test("creates opportunity and application then advances through pipeline stages", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await login(page);

  const unique = `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
  const oppName = `E2E Pipeline Test Grant (${unique})`;
  let opportunityId = "";
  let applicationId = "";

  // ── Create opportunity ─────────────────────────────────────────────────────
  await page.goto("/opportunities/new");
  await expect(
    page.getByRole("heading", { name: "New opportunity" }),
  ).toBeVisible();

  await page.getByLabel("Opportunity name").fill(oppName);
  await page.getByLabel("Category").selectOption({ label: "Housing Grant" });

  // Set a deadline 30 days out.
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 30);
  await page
    .getByLabel("Deadline")
    .fill(deadline.toISOString().slice(0, 10));

  await page.getByRole("button", { name: "Create opportunity" }).click();

  // Redirect to /opportunities/<id>
  await page.waitForURL(/\/opportunities\/[a-f0-9-]+$/, { timeout: 15_000 });
  opportunityId = page.url().split("/").pop()!;
  expect(opportunityId).toBeTruthy();

  // Verify opportunity appears in list before continuing.
  await page.goto("/opportunities");
  await expect(page.getByText(oppName)).toBeVisible({ timeout: 10_000 });

  // ── Set eligibility score so the eligibility_review → qualified gate passes ─
  // The gate requires opportunity.eligibility_score to be non-null.
  try {
    const env = loadEnv();
    const admin = adminClient(env);
    await admin
      .from("opportunities")
      .update({ eligibility_score: 75, recommendation: "apply" })
      .eq("id", opportunityId);
  } catch {
    // If adminClient can't update, the eligibility_review → qualified move
    // will be blocked; the test will still validate the first two transitions.
  }

  // ── Create application ─────────────────────────────────────────────────────
  await page.goto(`/applications/new?opportunityId=${opportunityId}`);
  await expect(page.getByRole("heading", { name: "Start an application" })).toBeVisible();
  await expect(page.getByText(oppName)).toBeVisible();

  await page.getByRole("button", { name: "Create application" }).click();

  // Redirect to /applications/<id>
  await page.waitForURL(/\/applications\/[a-f0-9-]+$/, { timeout: 15_000 });
  applicationId = page.url().split("/").pop()!;
  expect(applicationId).toBeTruthy();

  // ── Assert initial stage ───────────────────────────────────────────────────
  await expect(page.getByText("Discovered", { exact: true }).first()).toBeVisible();

  // ── discovered → Eligibility Review ───────────────────────────────────────
  await moveToStage(page, "Eligibility Review");
  await expect(
    page.getByText("Eligibility Review", { exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // ── Eligibility Review → Qualified ────────────────────────────────────────
  // This transition requires an eligibility score (set above via adminClient).
  // Reload to pick up the updated score from the DB.
  await page.reload();
  await moveToStage(page, "Qualified");
  await expect(
    page.getByText("Qualified", { exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // ── Qualified → Drafting ───────────────────────────────────────────────────
  await moveToStage(page, "Drafting");
  await expect(
    page.getByText("Drafting", { exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // ── Assert pipeline board shows app in Drafting column ────────────────────
  await page.goto("/applications");
  await expect(
    page.getByRole("heading", { level: 1, name: "Applications" }),
  ).toBeVisible();

  // The kanban board should have a "Drafting" column header.
  const draftingColumn = page.getByText("Drafting", { exact: true }).first();
  await expect(draftingColumn).toBeVisible();

  // The opportunity name should appear somewhere on the board (the created app
  // is now in the Drafting column).
  await expect(page.getByText(oppName)).toBeVisible({ timeout: 10_000 });

  // ── Cleanup ────────────────────────────────────────────────────────────────
  try {
    const env = loadEnv();
    const admin = adminClient(env);
    if (applicationId) {
      await admin.from("applications").delete().eq("id", applicationId);
    }
    if (opportunityId) {
      await admin.from("opportunities").delete().eq("id", opportunityId);
    }
  } catch {
    // Non-fatal: rows are isolated to the test org.
  }
});
