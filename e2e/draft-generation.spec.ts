import { test, expect, type Browser, type Page } from "@playwright/test";

import { TEST_USER, adminClient, loadEnv } from "../tests/e2e/helpers";

/**
 * Critical path: login → draft generator → select opportunity + template →
 * generate draft → assert draft content, confidence score, and sources panel.
 *
 * AI generation can take up to 60 s, so this test carries a 120 s timeout.
 * An opportunity is created via the browser in beforeAll and cleaned up in
 * afterAll — the test is fully self-contained and works regardless of whether
 * any seed data exists.
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

let testOpportunityId = "";
const unique = `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
const oppName = `E2E Draft Gen Test Opp (${unique})`;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await login(page);

    await page.goto("/opportunities/new");
    await page.getByLabel("Opportunity name").fill(oppName);
    await page.getByLabel("Category").selectOption({ label: "Housing Grant" });

    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 45);
    await page.getByLabel("Deadline").fill(deadline.toISOString().slice(0, 10));

    await page.getByRole("button", { name: "Create opportunity" }).click();
    await page.waitForURL(/\/opportunities\/[a-f0-9-]+$/, { timeout: 15_000 });
    testOpportunityId = page.url().split("/").pop()!;
  } finally {
    await ctx.close();
  }
});

test.afterAll(async () => {
  if (!testOpportunityId) return;
  try {
    const env = loadEnv();
    const admin = adminClient(env);
    await admin.from("opportunities").delete().eq("id", testOpportunityId);
  } catch {
    // Non-fatal: the row stays isolated to the test org.
  }
});

test("selects opportunity, generates draft, and asserts draft, confidence, and sources", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await login(page);

  // ── Navigate to draft generator ────────────────────────────────────────────
  await page.goto("/draft-generator");
  await expect(
    page.getByRole("heading", { level: 1, name: "Draft Generator" }),
  ).toBeVisible();

  // Wait for opportunities to load (the select is populated asynchronously).
  await expect(page.getByLabel("Opportunity")).not.toBeDisabled({
    timeout: 15_000,
  });

  // ── Select the opportunity created in beforeAll ────────────────────────────
  // The select shows opportunity names; we match by the name we created.
  await page.getByLabel("Opportunity").selectOption({ label: oppName });

  // ── Select the "Grant narrative" template ─────────────────────────────────
  await page.getByRole("radio", { name: "Grant narrative" }).click();
  await expect(
    page.getByRole("radio", { name: "Grant narrative" }),
  ).toBeChecked();

  // ── Generate draft ─────────────────────────────────────────────────────────
  const generateBtn = page.getByRole("button", {
    name: /Generate draft|Generate new version/i,
  });
  await expect(generateBtn).toBeEnabled({ timeout: 5_000 });
  await generateBtn.click();

  // The button changes to "Generating..." while the AI call runs.
  await expect(
    page.getByRole("button", { name: "Generating..." }),
  ).toBeVisible({ timeout: 10_000 });

  // ── Wait for draft content ─────────────────────────────────────────────────
  // The DraftEditor has label="Generated draft"; wait up to 60 s for content.
  const draftEditor = page.getByLabel("Generated draft");
  await expect(draftEditor).toBeVisible({ timeout: 70_000 });
  // Content must be non-empty (AI has written something into the editor).
  await expect(draftEditor).not.toBeEmpty({ timeout: 70_000 });

  // ── Assert confidence score displayed ─────────────────────────────────────
  // The "Confidence" card is always rendered alongside a generated draft.
  await expect(
    page.getByRole("heading", { name: "Confidence" }).first(),
  ).toBeVisible();
  // ConfidenceIndicator renders the numeric score — assert a % sign appears.
  await expect(page.getByText(/%/).first()).toBeVisible();

  // ── Assert "Sources used" panel ────────────────────────────────────────────
  // The "Sources used" card (KnowledgePreview component) always renders after
  // generation, showing either KB entries or an empty-state message.
  await expect(
    page.getByRole("heading", { name: "Sources used" }).first(),
  ).toBeVisible();
  // The panel body shows either "Knowledge Base (N)" or the empty-state copy.
  await expect(
    page.getByText(/Knowledge Base|No Knowledge Base entries/i).first(),
  ).toBeVisible();
});
