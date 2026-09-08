/**
 * Regression coverage for the mission-relevance fix on the Opportunities
 * dashboard (src/app/(dashboard)/opportunities/page.tsx +
 * src/app/api/opportunities/route.ts + src/lib/opportunities/relevance.ts).
 *
 * Root cause: the page used to read every row of an org's `opportunities`
 * table with zero relevance filtering, so opportunities entirely unrelated to
 * an org's mission (confirmed live for a real housing-focused client: HIV/AIDS
 * prevention, global health security, tribal assistance, criminal history
 * programs) rendered next to real matches. This spec seeds a housing-mission
 * org with a real search profile plus one relevant and one irrelevant
 * opportunity (both never scored, matching the real production data shape),
 * then asserts the fixed default view excludes the irrelevant one and the
 * visible "Show All" safety net still surfaces it on demand.
 *
 * Uses a dedicated self-login account (own org) rather than the shared owner
 * seed, so it never collides with other specs' opportunity rows.
 */

import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "@playwright/test";

import { adminClient, loadEnv } from "../tests/e2e/helpers";

const TEST_EMAIL = "relevance-filter.e2e@benavora-test.dev";
const TEST_PASSWORD = "Benavora!E2E-Relevance-1";

const RELEVANT_OPPORTUNITY = "State Rapid Re-Housing Block Grant (E2E Relevance Seed)";
const IRRELEVANT_OPPORTUNITY = "Department of Defense HIV/AIDS Prevention Program (E2E Relevance Seed)";
const SEARCH_PROFILE_NAME = "Housing Mission Focus (E2E Relevance Seed)";

test.beforeAll(async () => {
  test.setTimeout(60_000);
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
    .update({
      onboarding_completed: true,
      mission_statement:
        "To help economically disadvantaged individuals achieve sustainable homeownership through down payment assistance vouchers, financial literacy education, and access to affordable housing.",
      target_population: "Single mothers, veterans, individuals in recovery and re-entry",
      service_area: "Central Texas",
    })
    .eq("id", organizationId);
  if (updateError) {
    throw new Error(`Could not configure ${TEST_EMAIL}'s org: ${updateError.message}`);
  }

  // Idempotent: skip the rest if a prior run already seeded this org.
  const { data: existing } = await admin
    .from("opportunities")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", RELEVANT_OPPORTUNITY)
    .limit(1);
  if (existing && existing.length > 0) return;

  // A real, active search profile with real housing keywords - the same
  // mechanism (buildOrgFocusText) the relevance scorer builds its focus text
  // from. Without this (or knowledge_base rows), the scorer fails open and
  // this test's whole premise (automatic filtering) can't be exercised.
  const { error: profileError } = await admin.from("search_profiles").insert({
    organization_id: organizationId,
    name: SEARCH_PROFILE_NAME,
    keywords: [
      "affordable housing",
      "homeownership assistance",
      "down payment assistance",
      "transitional housing",
      "homelessness prevention",
      "veteran housing",
      "reentry housing",
    ],
    categories: ["housing_grant"],
    is_active: true,
  });
  if (profileError) {
    throw new Error(`Seed search profile failed: ${profileError.message}`);
  }

  // Both opportunities are inserted with no mission_relevance_score - exactly
  // the real production shape (a never-scored row is not evidence of
  // irrelevance, but also must not default to visible).
  const { error: relevantError } = await admin.from("opportunities").insert({
    organization_id: organizationId,
    name: RELEVANT_OPPORTUNITY,
    category: "government_grant",
    description:
      "Down payment assistance and transitional housing support for veterans and families experiencing homelessness.",
    status: "open",
    source: "manual",
  });
  if (relevantError) {
    throw new Error(`Seed relevant opportunity failed: ${relevantError.message}`);
  }

  // The exact real-world example the client reported.
  const { error: irrelevantError } = await admin.from("opportunities").insert({
    organization_id: organizationId,
    name: IRRELEVANT_OPPORTUNITY,
    category: "government_grant",
    description:
      "Funds HIV/AIDS prevention and treatment research initiatives across Department of Defense health programs.",
    status: "open",
    source: "manual",
  });
  if (irrelevantError) {
    throw new Error(`Seed irrelevant opportunity failed: ${irrelevantError.message}`);
  }
});

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

test.describe("Opportunities — mission relevance filter", () => {
  test("default view shows the real housing match and hides the AIDS-prevention-style mismatch", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto("/opportunities");

    // The relevance scorer runs real OpenAI embedding calls on first load for
    // these two never-scored seed rows - give it real time, not a UI-only wait.
    await expect(page.getByText(RELEVANT_OPPORTUNITY)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(IRRELEVANT_OPPORTUNITY)).not.toBeVisible();

    await page.screenshot({
      path: "test-evidence/opportunities-relevance-filter/default-relevant-only.png",
      fullPage: true,
    });
  });

  test("the visible 'Show All' safety net surfaces the excluded opportunity on demand", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto("/opportunities");
    await expect(page.getByText(RELEVANT_OPPORTUNITY)).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Show All" }).click();
    await expect(page.getByText(IRRELEVANT_OPPORTUNITY)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(RELEVANT_OPPORTUNITY)).toBeVisible();

    await page.screenshot({
      path: "test-evidence/opportunities-relevance-filter/show-all-toggle.png",
      fullPage: true,
    });
  });
});
