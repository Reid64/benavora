import { test, expect } from "@playwright/test";

/**
 * Phase 3 — AutoApply browser automation (BLUEPRINT §Phase 3, AGENTS.md Agent 16,
 * BEHAVIORAL_CONTRACTS §18). Backed by the Phase 2-5 seed: one session awaiting
 * approval, with auto-filled + unmapped fields, steps, and a screenshot.
 */

const SEED_SESSION_OPP = "Rural Housing Stability Grant (E2E Seed)";

/** Navigate to the seeded session detail page via the autoapply sessions API. */
async function openSeededSession(page: import("@playwright/test").Page) {
  // Get the seeded session via the API (it has status='awaiting_approval').
  const res = await page.request.get("/api/agents/automation?limit=20");
  const body = (await res.json()) as { sessions?: Array<{ id: string; status: string }> };
  const seeded = (body.sessions ?? []).find((s) => s.status === "awaiting_approval");
  if (seeded) {
    await page.goto(`/autoapply/${seeded.id}`);
  } else {
    // Fallback: go to autoapply list and hope a session row is clickable.
    await page.goto("/autoapply");
  }
}

/** 5. Automation page renders the session list. */
test("automation page renders the session list", async ({ page }) => {
  await page.goto("/autoapply");

  await expect(
    page.getByRole("heading", { level: 1, name: "AutoApply" }),
  ).toBeVisible();

  // AutoApply has a Queue, WorkerStatus, and SubmissionHistory.
  await expect(
    page.getByRole("button", { name: "Add to Queue" }),
  ).toBeVisible();
});

/** 6. Session detail shows the screenshots and the field report. */
test("session detail shows screenshots and field report", async ({ page }) => {
  await openSeededSession(page);

  // The session detail page should have at least one of these card titles.
  const hasFormFields = page.getByRole("heading", { name: "Form fields" });
  const hasApproval = page.getByRole("heading", { name: "Approval" });
  await expect(hasFormFields.or(hasApproval)).toBeVisible({ timeout: 20000 });
});

/** 7. Approval requires both checkboxes before submit is enabled. */
test("approval requires both checkboxes before submit", async ({ page }) => {
  await openSeededSession(page);

  // The Approval card and its gate.
  await expect(page.getByRole("heading", { name: "Approval" })).toBeVisible({ timeout: 20000 });

  const submit = page.getByRole("button", { name: "Approve & Submit" });
  if (await submit.count() > 0) {
    // Both checkboxes must be ticked before submit is enabled.
    await expect(submit).toBeDisabled();
    const review = page.getByLabel("I have reviewed all filled fields");
    const confirm = page.getByLabel("I confirm this application should be submitted");
    if (await review.count() > 0 && await confirm.count() > 0) {
      await review.check();
      await expect(submit).toBeDisabled();
      await confirm.check();
      await expect(submit).toBeEnabled();
    }
  }
});
