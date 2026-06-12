import { test, expect } from "@playwright/test";

/**
 * Phase 3 — Browser automation (BLUEPRINT §Phase 3, AGENTS.md Agent 16,
 * BEHAVIORAL_CONTRACTS §18). Backed by the Phase 2-5 seed: one session awaiting
 * approval, with auto-filled + unmapped fields, steps, and a screenshot.
 */

const SEED_SESSION_OPP = "Rural Housing Stability Grant (E2E Seed)";

/** Open the seeded session's detail view from the list. */
async function openSeededSession(page: import("@playwright/test").Page) {
  await page.goto("/automation");
  await expect(
    page.getByRole("heading", { level: 1, name: "Automation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View" }).first().click();
  await expect(page.getByRole("heading", { name: "Form fields" })).toBeVisible();
}

/** 5. Automation page renders the session list. */
test("automation page renders the session list", async ({ page }) => {
  await page.goto("/automation");

  await expect(
    page.getByRole("heading", { level: 1, name: "Automation" }),
  ).toBeVisible();

  // The Sessions card with its status filter always renders.
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.getByLabel("Filter by status")).toBeVisible();

  // The seeded session shows up with its status. Target the table cell so the
  // assertion does not match the (hidden) "Awaiting Approval" filter <option>.
  await expect(page.getByText(SEED_SESSION_OPP)).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Awaiting Approval" }).first(),
  ).toBeVisible();
});

/** 6. Session detail shows the screenshots and the field report. */
test("session detail shows screenshots and field report", async ({ page }) => {
  await openSeededSession(page);

  // Field report table with its four columns.
  for (const header of [
    "Field",
    "Detected type",
    "Auto-filled value",
    "Status",
  ]) {
    await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
  }

  // An auto-filled field (from org data) and an unmapped field needing input.
  // Each label renders inside its own <span> as the field name plus a required
  // "*" marker, nested in the <td>. Match the label text exactly (including the
  // asterisk) so the assertion resolves the single label span, not also the
  // enclosing cell whose text appends the field key (strict-mode would fail).
  await expect(page.getByText("Organization Name*", { exact: true })).toBeVisible();
  await expect(page.getByText("Project Title*", { exact: true })).toBeVisible();

  // Screenshots section with the seeded capture. Match the section heading
  // exactly so it does not also resolve the "No screenshots captured" empty-state
  // heading (strict-mode would otherwise fail on two matches).
  await expect(
    page.getByRole("heading", { name: "Screenshots", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Landing page")).toBeVisible();
});

/** 7. Approval requires both checkboxes before submit is enabled. */
test("approval requires both checkboxes before submit", async ({ page }) => {
  await openSeededSession(page);

  await expect(page.getByRole("heading", { name: "Approval" })).toBeVisible();

  const review = page.getByLabel("I have reviewed all filled fields");
  const confirm = page.getByLabel(
    "I confirm this application should be submitted",
  );
  const submit = page.getByRole("button", { name: "Approve & Submit" });

  // Gated until both boxes are ticked (the human submission gate, §18).
  await expect(submit).toBeDisabled();
  await review.check();
  await expect(submit).toBeDisabled();
  await confirm.check();
  await expect(submit).toBeEnabled();
  // Do not click — that would submit the application.
});
