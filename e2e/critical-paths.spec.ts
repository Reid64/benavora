/**
 * Critical-path smoke suite: login, opportunities list, application creation,
 * the AutoApply engine page, and the funder Relationship Builder page. Logs in
 * as the dedicated beta account (beta1@benavora-test.com, per
 * scripts/seed-beta-users.ts) rather than the shared e2e owner account, per
 * the "critical-paths" project convention of self-login specs supporting
 * PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD (see
 * e2e/donor-discovery-prospects.spec.ts, e2e/opportunities.spec.ts).
 *
 * beforeAll bootstraps the account (idempotent, same pattern as
 * e2e/opportunities.spec.ts / e2e/dashboard.spec.ts) and seeds a funder +
 * opportunity dedicated to this spec so the applications flow has a stable,
 * predictable opportunity to work from regardless of whether
 * `pnpm seed:beta` has ever been run against this account. Any application
 * left over from a prior run of this spec against that seeded opportunity is
 * deleted first so the "create application" test starts clean every run.
 *
 * Note on item 4 (AutoApply readiness): the real, user-facing "readiness"
 * panel backed by a `getReadinessReport()` call lives at
 * `/autoapply/documents` (DocumentVault.getReadinessReport, wrapping
 * `/api/autoapply/documents/readiness`) - not on `/autoapply` itself.
 * `checkOrgReadiness()` (src/lib/autoapply/submission-validator.ts, the
 * function documented as previously broken - see
 * src/__tests__/unit/regressions.test.ts) is called only from
 * worker/queue-processor.ts on the Railway worker; it has no API route or UI
 * consumer in this repo today, confirmed by repo-wide grep. So this spec
 * verifies what actually renders at `/autoapply` (the real AutoApply Engine
 * page and its queue/mode/analytics panels) loads cleanly with no uncaught
 * client-side error, rather than asserting a "readiness panel" that does not
 * exist at that route.
 */

import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "@playwright/test";

import { adminClient, loadEnv } from "../tests/e2e/helpers";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? "beta1@benavora-test.com";
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? "BetaTest2026";

const SEED_FUNDER = "Critical Paths Spec Funder (E2E Seed)";
const SEED_OPPORTUNITY = "Critical Paths Spec Grant (E2E Seed)";

let organizationId: string;
let seedFunderId: string;
let seedOpportunityId: string;

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
  organizationId = orgId as string;

  const { error: updateError } = await admin
    .from("organizations")
    .update({ onboarding_completed: true })
    .eq("id", organizationId);
  if (updateError) {
    throw new Error(`Could not mark ${TEST_EMAIL}'s org onboarded: ${updateError.message}`);
  }

  // Find-or-create the dedicated funder + opportunity for this spec.
  const { data: existingFunder } = await admin
    .from("funders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", SEED_FUNDER)
    .maybeSingle();

  if (existingFunder) {
    seedFunderId = existingFunder.id as string;
  } else {
    const { data: funder, error: funderError } = await admin
      .from("funders")
      .insert({
        organization_id: organizationId,
        name: SEED_FUNDER,
        category: "private_foundation",
        description: "Seeded funder for the critical-paths e2e spec.",
      })
      .select("id")
      .single();
    if (funderError || !funder) {
      throw new Error(`Seed funder failed: ${funderError?.message}`);
    }
    seedFunderId = funder.id as string;
  }

  const { data: existingOpportunity } = await admin
    .from("opportunities")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", SEED_OPPORTUNITY)
    .maybeSingle();

  if (existingOpportunity) {
    seedOpportunityId = existingOpportunity.id as string;
  } else {
    const { data: opportunity, error: oppError } = await admin
      .from("opportunities")
      .insert({
        organization_id: organizationId,
        funder_id: seedFunderId,
        name: SEED_OPPORTUNITY,
        category: "housing_grant",
        description: "Seeded opportunity for the critical-paths e2e spec.",
        amount_min: 10000,
        amount_max: 50000,
        status: "open",
        source: "manual",
      })
      .select("id")
      .single();
    if (oppError || !opportunity) {
      throw new Error(`Seed opportunity failed: ${oppError?.message}`);
    }
    seedOpportunityId = opportunity.id as string;
  }

  // Idempotency for the "create application" test: delete any application
  // already attached to this dedicated seeded opportunity (and its pipeline
  // history) so every run of this spec starts from a clean, no-existing-
  // application state. Best-effort - fine if there is nothing to delete.
  const { data: priorApps } = await admin
    .from("applications")
    .select("id")
    .eq("opportunity_id", seedOpportunityId);
  for (const app of priorApps ?? []) {
    await admin.from("pipeline_history").delete().eq("application_id", app.id as string);
    await admin.from("applications").delete().eq("id", app.id as string);
  }
});

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

/** Collects uncaught client-side exceptions for the life of the page. */
function watchForClientErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("Critical paths", () => {
  test("1. login redirects to /dashboard", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    await expect(page).toHaveURL(/\/dashboard$/);
    // The dashboard's H1 renders the org name (Dashboard v2), not a literal
    // "Dashboard" heading — assert the main content container instead,
    // matching the pattern e2e/smoke.spec.ts already uses for this page.
    await expect(page.locator("main, [role='main']").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("2. opportunities list renders real, non-empty data", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await page.goto("/opportunities");
    await expect(
      page.getByRole("heading", { level: 1, name: "Opportunities" }),
    ).toBeVisible();
    await expect(page.getByText(SEED_OPPORTUNITY)).toBeVisible();
  });

  test("3. creating an application from an opportunity adds a row to /applications/list", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await login(page);

    await page.goto(`/applications/new?opportunityId=${seedOpportunityId}`);
    await expect(
      page.getByText(`Create an application for "${SEED_OPPORTUNITY}".`),
    ).toBeVisible();

    await page.getByRole("button", { name: "Create application" }).click();
    await page.waitForURL(/\/applications\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    await page.goto("/applications/list");
    await expect(
      page.getByRole("heading", { level: 1, name: "Applications" }),
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: new RegExp(SEED_OPPORTUNITY) }),
    ).toBeVisible();
  });

  test("4. AutoApply engine page renders with no uncaught client-side error", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const clientErrors = watchForClientErrors(page);
    await login(page);

    await page.goto("/autoapply");
    await expect(
      page.getByRole("heading", { level: 1, name: "AUTOAPPLY ENGINE" }),
    ).toBeVisible();
    // Queue and Form Templates sections both settle to either real rows or
    // their own explicit empty state - confirms the data-loading path (the
    // same submission_queue/form_templates reads that previously broke)
    // completed without throwing.
    await expect(
      page.getByText("Queue is empty.").or(page.getByText("Forms Queued")),
    ).toBeVisible();
    await expect(
      page
        .getByText("No templates yet")
        .or(page.getByRole("cell", { name: SEED_FUNDER }))
        .first(),
    ).toBeVisible();

    expect(clientErrors, `Uncaught client-side errors: ${clientErrors.join("; ")}`).toEqual([]);
  });

  test("5. funder Relationship Builder page loads without 404 or 500", async ({ page }) => {
    test.setTimeout(60_000);
    const clientErrors = watchForClientErrors(page);
    await login(page);

    const response = await page.goto(`/funders/${seedFunderId}/relationship`);
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: `${SEED_FUNDER} — Relationship` }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Relationship Score" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Relationship Builder (AG-19)" }),
    ).toBeVisible();

    expect(clientErrors, `Uncaught client-side errors: ${clientErrors.join("; ")}`).toEqual([]);
  });
});
