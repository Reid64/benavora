/**
 * Smoke test for the Donor Discovery Prospects pages (DONOR_DISCOVERY_
 * ARCHITECTURE.md §4): the filterable list, the prospect detail view, and the
 * Overview page they're linked from. Logs in as a dedicated beta account
 * (beta1@benavora-test.com, per scripts/seed-beta-users.ts) rather than the
 * shared e2e owner account, per the "critical-paths" project convention of
 * self-login specs supporting PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD.
 *
 * beforeAll bootstraps the account and forces its organization out of the
 * onboarding wizard (mirrors tests/e2e/helpers.ts's ensureTestAccount /
 * ensureOnboardingAccount) so the smoke checks below exercise the Donor
 * Discovery pages rather than the first-login flow.
 */

import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "@playwright/test";

import { adminClient, loadEnv } from "../tests/e2e/helpers";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? "beta1@benavora-test.com";
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? "BetaTest2026";

// A syntactically valid but non-existent prospect id, to smoke-test the
// detail page's not-found path without depending on donor-discovery data
// having been seeded for this account.
const UNKNOWN_PROSPECT_ID = "00000000-0000-4000-8000-000000000000";

test.beforeAll(async () => {
  const env = loadEnv();
  const admin = adminClient(env);

  const { error: createError } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (
    createError &&
    !/already.*registered|already.*exists|been registered/i.test(createError.message)
  ) {
    throw new Error(`Could not create ${TEST_EMAIL}: ${createError.message}`);
  }

  const anon = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (signInError || !signIn.user) {
    throw new Error(`Could not sign in ${TEST_EMAIL}: ${signInError?.message ?? "no user"}`);
  }

  const { data: orgId, error: rpcError } = await anon.rpc("register_organization");
  if (rpcError || !orgId) {
    throw new Error(
      `register_organization failed for ${TEST_EMAIL}: ${rpcError?.message ?? "no org id"}`,
    );
  }

  const { error: updateError } = await admin
    .from("organizations")
    .update({ onboarding_completed: true })
    .eq("id", orgId as string);
  if (updateError) {
    throw new Error(`Could not mark ${TEST_EMAIL}'s org onboarded: ${updateError.message}`);
  }
});

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

async function assertRendersCleanly(page: Page, path: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });

  const status = response?.status() ?? 200;
  expect(status, `${path} responded with status ${status}`).toBeLessThan(400);

  const main = page.locator("main, [role='main']").first();
  await expect(main).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText("500").first()).not.toBeVisible();
  await expect(page.getByRole("heading", { name: /^Error$/i })).not.toBeVisible();
}

test.describe("Donor Discovery — Prospects", () => {
  test("overview page renders", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await assertRendersCleanly(page, "/donor-discovery");
    await expect(page.getByRole("heading", { level: 1, name: "Donor Discovery" })).toBeVisible();
  });

  test("prospects list page renders with filters", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await assertRendersCleanly(page, "/donor-discovery/prospects");
    await expect(page.getByRole("heading", { level: 1, name: "Prospects" })).toBeVisible();
    await expect(page.getByLabel("Filter by taxonomy")).toBeVisible();
    await expect(page.getByLabel("Filter by request")).toBeVisible();
    await expect(page.getByLabel("Filter by stage")).toBeVisible();
  });

  test("prospect detail page renders a graceful not-found for an unknown id", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await assertRendersCleanly(page, `/donor-discovery/prospects/${UNKNOWN_PROSPECT_ID}`);
    await expect(page.getByRole("link", { name: "Back to prospects" })).toBeVisible();
  });
});
