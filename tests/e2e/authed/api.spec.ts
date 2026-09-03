import { test, expect } from "@playwright/test";

/**
 * API integration tests against the real route handlers, run under the
 * "authed" project so `page.request` carries the seeded owner's Supabase
 * auth cookies (STORAGE_STATE in ../helpers.ts) - no manual bearer tokens,
 * since this app authenticates via Supabase session cookies, not a custom
 * /api/auth/login + JWT flow.
 */

test("GET /api/health reports database connectivity", async ({ page }) => {
  const response = await page.request.get("/api/health");
  // Overall status can be 503 ("degraded") if the background worker's
  // heartbeat (worker_status table) is stale in this environment - that
  // doesn't mean the API itself is broken, so only require a well-formed
  // body and an OK database check rather than an unconditional 200.
  expect([200, 503]).toContain(response.status());

  const health = await response.json();
  expect(health.checks.database.status).toBe("ok");
  expect(["ok", "warning", "error"]).toContain(health.checks.worker.status);
  expect(["ok", "warning", "error"]).toContain(health.checks.memory.status);
});

test("GET /api/grants lists the org's opportunities", async ({ page }) => {
  const response = await page.request.get("/api/grants");
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(Array.isArray(body.data)).toBeTruthy();
  expect(typeof body.total).toBe("number");
  expect(body.page).toBe(1);

  // The seeded opportunity (seedOrganization in helpers.ts) should be present.
  expect(body.data.some((g: { name: string }) => g.name === "Rural Housing Stability Grant (E2E Seed)")).toBeTruthy();
});

test("GET /api/grants rejects an invalid filter", async ({ page }) => {
  const response = await page.request.get("/api/grants?status=not-a-real-status");
  expect(response.status()).toBe(400);

  const body = await response.json();
  expect(body.code).toBe("INVALID_FILTER");
});

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("GET /api/grants requires authentication", async ({ page }) => {
    const response = await page.request.get("/api/grants");
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.code).toBe("unauthenticated");
  });
});
