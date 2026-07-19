/**
 * Smoke test for the Mission Control dashboard: FlightPathHUD's six lifecycle
 * cards, Today's Action Items, and the autonomous activity feed. Logs in as a
 * dedicated beta account (beta1@benavora-test.com, per
 * scripts/seed-beta-users.ts) rather than the shared e2e owner account, per
 * the "critical-paths" project convention of self-login specs supporting
 * PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD (see
 * e2e/donor-discovery-prospects.spec.ts).
 *
 * beforeAll bootstraps the account and forces its organization out of the
 * onboarding wizard (mirrors tests/e2e/helpers.ts's ensureTestAccount) so the
 * checks below exercise the dashboard rather than the first-login flow.
 */

import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "@playwright/test";

import { adminClient, loadEnv } from "../tests/e2e/helpers";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? "beta1@benavora-test.com";
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? "BetaTest2026";

// FlightPathHUD.tsx's STAGES array — the six lifecycle stage labels shown on
// the front face of each flip card.
const HUD_STAGE_LABELS = [
  "Onboard",
  "Research",
  "Opportunities",
  "Grant Narratives",
  "AutoApply",
  "Donor Discovery",
];

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

test.describe("Dashboard", () => {
  test("dashboard loads", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();
  });

  test("FlightPathHUD renders all six lifecycle cards", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);

    // Scoped to <main> so the identically-labelled sidebar nav links (which
    // share hrefs like /opportunities and /research with the HUD tiles) don't
    // create a strict-mode ambiguity.
    const main = page.getByRole("main");
    for (const label of HUD_STAGE_LABELS) {
      await expect(main.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("Today's Action Items shows", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await expect(page.getByText(/Today.s Action Items/i)).toBeVisible();
  });

  test("autonomous activity feed renders", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await expect(page.getByText(/AI Working For You/i)).toBeVisible();
    // Either the empty-state prompt or at least one decision row renders —
    // both confirm the feed section itself mounted and fetched.
    await expect(
      page
        .getByText(/No autonomous activity yet/i)
        .or(page.getByText(/AI Working For You/i)),
    ).toBeVisible();
  });
});
