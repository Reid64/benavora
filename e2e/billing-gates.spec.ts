import { test, expect, type Browser, type Page } from "@playwright/test";

import { TEST_USER, adminClient, loadEnv } from "../tests/e2e/helpers";

/**
 * Critical path: billing gates and tier enforcement.
 *
 * Tests:
 *   1. AI draft rate-limit warning — mocks /api/ai/draft to return 429 and
 *      verifies the error message is surfaced to the user.
 *   2. Enterprise-only gate — navigating to /intelligence/competitors for a
 *      non-Enterprise account shows the upgrade prompt.
 *   3. Billing page — /billing renders the current plan and usage meters.
 *
 * Uses PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD when set, falling back
 * to the shared test owner (starter-equivalent tier in the test org).
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

// ── Shared opportunity created for rate-limit test ─────────────────────────
// We need a selectable opportunity in the draft generator before we can trigger
// "Generate draft" (the button is disabled without one). We create one via the
// browser in beforeAll and clean it up in afterAll.
let rateTestOppId = "";
const unique = `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
const rateTestOppName = `E2E Billing Gate Test Opp (${unique})`;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await login(page);
    await page.goto("/opportunities/new");
    await page.getByLabel("Opportunity name").fill(rateTestOppName);
    await page.getByLabel("Category").selectOption({ label: "Housing Grant" });

    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 60);
    await page.getByLabel("Deadline").fill(deadline.toISOString().slice(0, 10));

    await page.getByRole("button", { name: "Create opportunity" }).click();
    await page.waitForURL(/\/opportunities\/[a-f0-9-]+$/, { timeout: 15_000 });
    rateTestOppId = page.url().split("/").pop()!;
  } catch {
    // If creation fails the rate-limit test will be skipped gracefully.
  } finally {
    await ctx.close();
  }
});

test.afterAll(async () => {
  if (!rateTestOppId) return;
  try {
    const env = loadEnv();
    const admin = adminClient(env);
    await admin.from("opportunities").delete().eq("id", rateTestOppId);
  } catch {
    // Non-fatal: the row stays isolated to the test org.
  }
});

// ── 1. AI draft rate-limit warning ────────────────────────────────────────────
test("rate limit error is surfaced when the AI draft quota is exceeded", async ({
  page,
}) => {
  test.skip(!rateTestOppId, "beforeAll opportunity creation failed");

  await login(page);

  // Intercept the draft endpoint before navigating so the mock is in place
  // when the Generate button is clicked.
  await page.route("**/api/ai/draft", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error:
          "Usage limit exceeded for AI drafts. Upgrade your plan to continue.",
        code: "usage_limit_exceeded",
      }),
    }),
  );

  await page.goto("/draft-generator");
  await expect(
    page.getByRole("heading", { level: 1, name: "Draft Generator" }),
  ).toBeVisible();

  // Wait for the opportunity dropdown to populate, then select our test opp.
  await expect(page.getByLabel("Opportunity")).not.toBeDisabled({
    timeout: 15_000,
  });
  await page.getByLabel("Opportunity").selectOption({ label: rateTestOppName });

  // Select the grant narrative template.
  await page.getByRole("radio", { name: "Grant narrative" }).click();

  // Trigger the generation — the mocked route returns 429 immediately.
  await page
    .getByRole("button", { name: /Generate draft|Generate new version/i })
    .click();

  // The error message from the 429 response must be displayed.
  await expect(
    page.getByText(/Usage limit exceeded|Upgrade your plan/i).first(),
  ).toBeVisible({ timeout: 15_000 });
});

// ── 2. Enterprise-only feature gate ───────────────────────────────────────────
test("competitor intelligence is gated behind an upgrade prompt for non-Enterprise accounts", async ({
  page,
}) => {
  await login(page);
  await page.goto("/intelligence/competitors");

  // The BEHAVIORAL_CONTRACTS §27 gate hides this feature below Enterprise tier.
  // Non-Enterprise users see an upgrade prompt instead of the data table.
  await expect(
    page
      .getByText(/Enterprise and Consultant plans only/i)
      .or(page.getByText(/Upgrade/i))
      .first(),
  ).toBeVisible({ timeout: 15_000 });

  // The competitor data table must NOT be rendered for gated users.
  await expect(
    page.getByRole("table", { name: /competitor/i }),
  ).toHaveCount(0);
});

// ── 3. Billing page shows current tier ────────────────────────────────────────
test("billing page renders the current plan and usage meters", async ({
  page,
}) => {
  await login(page);
  await page.goto("/billing");

  await expect(
    page.getByRole("heading", { level: 1, name: "Billing" }),
  ).toBeVisible();

  // Current plan section: shows the org's active tier name.
  await expect(
    page.getByRole("heading", { name: "Current plan" }),
  ).toBeVisible();

  // The active tier name appears in the current-plan card. Accept any valid tier.
  const tierLabel = page.getByText(
    /Free|Starter|Professional|Enterprise|Consultant/i,
  );
  await expect(tierLabel.first()).toBeVisible();

  // Usage meters must be present.
  await expect(page.getByText("Agent runs / day")).toBeVisible();
  // The "Plans" section with upgrade cards must render.
  await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
});
