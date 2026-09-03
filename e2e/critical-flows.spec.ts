/**
 * Critical user flow suite: login, header tab navigation, creating a
 * knowledge-base narrative, discovering an opportunity from Research and
 * starting an application, and the AutoApply + PIL entry points.
 *
 * Lives under e2e/ (not tests/e2e/) and follows the same self-login
 * convention as e2e/critical-paths.spec.ts, because this spec's first test
 * exercises the real /login form — the tests/e2e/authed/**.spec.ts project
 * starts every test already signed in via storageState, so it can't cover a
 * login test. Logs in as the shared e2e owner account (TEST_USER from
 * tests/e2e/helpers.ts) rather than bootstrapping a fresh account, so it can
 * reuse the Phase 2-5 seed (search profile, discovered opportunity, seeded
 * application) that tests/e2e/auth.setup.ts's "setup" project already
 * guarantees exists — this "critical-paths" project depends on "setup" in
 * playwright.config.ts.
 *
 * Selectors are grounded directly in the current app code:
 *   - Login form: getByLabel("Email")/"Password", button "Sign in"
 *     (src/app/(auth)/login — same pattern as tests/e2e/auth.setup.ts).
 *   - Header tabs: src/components/layout/Header.tsx's TABS list.
 *   - Research page: src/app/(dashboard)/research (heading "Research Command
 *     Center"; tests/e2e/authed/research.spec.ts).
 *   - Knowledge base narratives: src/components/knowledge-base/NarrativeEditor.tsx
 *     ("New narrative" modal; Title/Category/Narrative fields; "Create narrative"
 *     submit button; 50-char minimum content per NARRATIVE_MIN_CONTENT_LENGTH).
 *   - Opportunity detail "Apply Now": src/components/opportunities/OpportunityDetail.tsx's
 *     ApplyAction, which routes to /draft-generator?opportunity={id} (there is
 *     no direct "Apply" -> /applications/* jump — an application isn't created
 *     until the draft generator wizard runs).
 *   - AutoApply: src/app/(dashboard)/autoapply/page.tsx's real h1,
 *     "AUTOAPPLY ENGINE" (not "AutoApply" — the older
 *     tests/e2e/authed/automation.spec.ts heading assertion is stale).
 *   - PIL ("Prospects & Analysis"): src/components/layout/nav-items.ts +
 *     src/lib/feature-flags/pil.ts. Gated per-organization by a LaunchDarkly
 *     rollout flag that fails closed, so the test org may not have it enabled
 *     — asserted conditionally, same pattern as e2e/critical-paths.spec.ts's
 *     AutoApply queue-or-empty check.
 */

import { test, expect, type Page } from "@playwright/test";

import { SEED_DISCOVERY, TEST_USER } from "../tests/e2e/helpers";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

test.describe("Critical User Flows", () => {
  test("Login flow", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await page.getByLabel("Email").fill(TEST_USER.email);
    await page.getByLabel("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    // The dashboard h1 renders the org name, not literal "Dashboard" text
    // (see e2e/critical-paths.spec.ts) — assert the main content landed instead.
    await expect(page.locator("main, [role='main']").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Navigate header tabs to Research", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);

    await page.getByRole("link", { name: "Research" }).click();
    await page.waitForURL("**/research");

    await expect(
      page.getByRole("heading", { level: 1, name: "Research Command Center" }),
    ).toBeVisible();
  });

  test("Create narrative in knowledge base", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);

    await page.goto("/knowledge-base/narratives");
    // Both the header button and (when the list is empty) the EmptyState's own
    // action render "New narrative" simultaneously — .first() picks whichever
    // is present without failing strict mode when both are.
    await page.getByRole("button", { name: "New narrative" }).first().click();

    const title = `Test Mission Statement ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Category").selectOption({ label: "Mission" });
    // The "Narrative" RichTextArea label isn't <label for>-associated with its
    // textarea (src/components/knowledge-base/NarrativeEditor.tsx), so
    // getByLabel won't find it — target it by its real placeholder instead.
    await page
      .getByPlaceholder("Write the narrative block. Supports Markdown for emphasis, lists, and headings.")
      .fill(
        "Housing for homeless families is the core of our mission, and this narrative block exists to describe that work for funders.",
      );

    await page.getByRole("button", { name: "Create narrative" }).click();

    // The modal closes and the new narrative appears in the list.
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
  });

  test("Discover opportunity and start an application", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);

    await page.goto("/research");
    const discoveryCard = page.locator('a[href^="/opportunities/"]', {
      hasText: SEED_DISCOVERY,
    });
    await expect(discoveryCard).toBeVisible({ timeout: 15_000 });
    await discoveryCard.click();

    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);

    // ApplyAction (OpportunityDetail.tsx) renders "Apply Now" -> the draft
    // generator the first time, or "View Application" -> the existing
    // application if an earlier run of this spec already started one for this
    // same seeded opportunity — handle both so re-runs stay green.
    const applyNow = page.getByRole("link", { name: "Apply Now" });
    const viewApplication = page.getByRole("link", { name: "View Application" });
    await expect(applyNow.or(viewApplication)).toBeVisible({ timeout: 15_000 });

    if (await applyNow.isVisible()) {
      await applyNow.click();
      await page.waitForURL(/\/draft-generator\?opportunity=/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Draft Generator" }),
      ).toBeVisible();
    } else {
      await viewApplication.click();
      await page.waitForURL(/\/applications\/[0-9a-f-]{36}$/);
    }
  });

  test("AutoApply engine page loads", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);

    await page.goto("/autoapply");
    await expect(
      page.getByRole("heading", { level: 1, name: "AUTOAPPLY ENGINE" }),
    ).toBeVisible();

    // Queue settles to either real rows or its own empty state.
    await expect(
      page.getByText("Queue is empty.").or(page.getByText("Forms Queued")),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Prospect Intelligence Layer (if enabled for this org)", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);

    // PIL is rolled out per-organization behind a LaunchDarkly flag
    // (pil-prospect-intelligence-layer) that fails closed, so the nav item may
    // not be present for the e2e test org.
    const pilNavLink = page.getByRole("link", { name: "Prospects & Analysis" });
    if (!(await pilNavLink.isVisible().catch(() => false))) {
      test.skip(true, "PIL not enabled for this org");
      return;
    }

    // The nav item's own href goes straight to /intelligence/pil/prospects
    // (nav-items.ts) — go to the PIL hub itself for the "Prospect Intelligence
    // Layer" heading (src/app/(dashboard)/intelligence/pil/page.tsx).
    await page.goto("/intelligence/pil");
    await expect(
      page.getByRole("heading", { level: 1, name: "Prospect Intelligence Layer" }),
    ).toBeVisible();
  });
});
