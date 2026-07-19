/**
 * Smoke test for the Opportunities list: page load, the source-type filter
 * pills (SourceTypeTabs), navigating from a row to its detail page, and the
 * Grant Probability Engine badge. Logs in as a dedicated beta account
 * (beta1@benavora-test.com, per scripts/seed-beta-users.ts) rather than the
 * shared e2e owner account, per the "critical-paths" project convention of
 * self-login specs supporting PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD
 * (see e2e/donor-discovery-prospects.spec.ts).
 *
 * beforeAll bootstraps the account, forces its organization out of the
 * onboarding wizard, and seeds two opportunities with distinct source_type
 * values so the filter pill strip renders more than just "All" and a row
 * exists to click into its detail page.
 */

import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "@playwright/test";

import { adminClient, loadEnv } from "../tests/e2e/helpers";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? "beta1@benavora-test.com";
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? "BetaTest2026";

const SEED_FUNDER = "Opportunities Spec Funder (E2E Seed)";
const SEED_OPPORTUNITY_A = "Opportunities Spec Grant A (E2E Seed)";
const SEED_OPPORTUNITY_B = "Opportunities Spec Grant B (E2E Seed)";

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
  const organizationId = orgId as string;

  const { error: updateError } = await admin
    .from("organizations")
    .update({ onboarding_completed: true })
    .eq("id", organizationId);
  if (updateError) {
    throw new Error(`Could not mark ${TEST_EMAIL}'s org onboarded: ${updateError.message}`);
  }

  // Idempotent: skip the seed if a prior run already inserted it.
  const { data: existing } = await admin
    .from("opportunities")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", SEED_OPPORTUNITY_A)
    .limit(1);
  if (existing && existing.length > 0) return;

  const { data: funder, error: funderError } = await admin
    .from("funders")
    .insert({
      organization_id: organizationId,
      name: SEED_FUNDER,
      category: "private_foundation",
      description: "Seeded funder for the opportunities e2e spec.",
    })
    .select("id")
    .single();
  if (funderError || !funder) {
    throw new Error(`Seed funder failed: ${funderError?.message}`);
  }

  const { error: oppAError } = await admin.from("opportunities").insert({
    organization_id: organizationId,
    funder_id: funder.id,
    name: SEED_OPPORTUNITY_A,
    category: "housing_grant",
    description: "Seeded opportunity A for the opportunities e2e spec.",
    amount_min: 10000,
    amount_max: 50000,
    status: "open",
    source: "manual",
    source_type: "private_foundation",
  });
  if (oppAError) {
    throw new Error(`Seed opportunity A failed: ${oppAError.message}`);
  }

  const { error: oppBError } = await admin.from("opportunities").insert({
    organization_id: organizationId,
    funder_id: funder.id,
    name: SEED_OPPORTUNITY_B,
    category: "corporate_donation",
    description: "Seeded opportunity B for the opportunities e2e spec.",
    amount_min: 5000,
    amount_max: 25000,
    status: "open",
    source: "manual",
    source_type: "corporate_giving",
  });
  if (oppBError) {
    throw new Error(`Seed opportunity B failed: ${oppBError.message}`);
  }
});

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

test.describe("Opportunities", () => {
  test("opportunities page loads", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await page.goto("/opportunities");
    await expect(
      page.getByRole("heading", { level: 1, name: "Opportunities" }),
    ).toBeVisible();
    await expect(page.getByText(SEED_OPPORTUNITY_A)).toBeVisible();
  });

  test("source-type filter pills work", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await page.goto("/opportunities");

    const tablist = page.getByRole("tablist", {
      name: "Filter opportunities by source type",
    });
    await expect(tablist).toBeVisible();

    const allTab = tablist.getByRole("tab", { name: /^All/ });
    await expect(allTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(SEED_OPPORTUNITY_A)).toBeVisible();
    await expect(page.getByText(SEED_OPPORTUNITY_B)).toBeVisible();

    // Selecting the seeded "Private Foundation" tab narrows the list to
    // Opportunity A and hides Opportunity B (source_type=corporate_giving).
    const foundationTab = tablist.getByRole("tab", { name: /^Private Foundation/ });
    await foundationTab.click();
    await expect(foundationTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(SEED_OPPORTUNITY_A)).toBeVisible();
    await expect(page.getByText(SEED_OPPORTUNITY_B)).not.toBeVisible();
  });

  test("probability badge renders", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await page.goto("/opportunities");

    const row = page.getByRole("row", { name: new RegExp(SEED_OPPORTUNITY_A) });
    await expect(row).toBeVisible();
    // Unscored seeded rows render the gray "Not scored" Grant Probability
    // Engine badge (ProbabilityBadge in OpportunityTable.tsx).
    await expect(row.getByText("Not scored")).toBeVisible();
  });

  test("opportunity links to its detail page", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await page.goto("/opportunities");

    await page.getByText(SEED_OPPORTUNITY_A).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    await expect(
      page.getByRole("link", { name: "Back to opportunities" }),
    ).toBeVisible();
  });
});
