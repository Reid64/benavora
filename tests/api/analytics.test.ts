/**
 * Analytics API tests.
 *
 * NOTE: The analytics routes described in the task specification do not exist
 * in the codebase. The directory src/app/api/analytics/ was not found. All
 * tests below are marked as .todo and will activate once those routes are built.
 *
 * Expected routes (per task spec):
 *   GET /api/analytics/summary   — overall metrics object
 *   GET /api/analytics/funnel    — pipeline stage counts
 *   GET /api/analytics/financials — award/requested amounts (handles NULL)
 *
 * When implementing, consult BEHAVIORAL_CONTRACTS.md §29 (Financial
 * Reconciliation) and the grant_financials table (SCHEMA_REGISTRY.md §54).
 * All routes must scope data to the caller's org_id (Six Laws Law 2).
 */

import { describe, it } from "vitest";

describe("GET /api/analytics/summary", () => {
  it.todo("returns a metrics object with counts for authenticated viewer");
  it.todo("returns 401 when unauthenticated");
  it.todo("returns zero-value metrics (not errors) for an org with no data");
  it.todo("respects from/to date range query params");
});

describe("GET /api/analytics/funnel", () => {
  it.todo("returns stage counts keyed by pipeline stage");
  it.todo("returns 401 when unauthenticated");
  it.todo("returns zero counts (not errors) for an org with no applications");
  it.todo("respects date range filtering");
});

describe("GET /api/analytics/financials", () => {
  it.todo("returns financial summary with amount_awarded and amount_requested");
  it.todo("handles NULL amount values without throwing (returns 0 or null)");
  it.todo("returns 401 when unauthenticated");
  it.todo("scopes results to the caller's org_id");
  it.todo("returns zero-value response for an org with no grant_financials rows");
});
