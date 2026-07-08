/**
 * Unit tests for the Google Places adapter's budget guard
 * (src/lib/donor-discovery/adapters/google-places.ts).
 *
 * enumerate() must hard-stop with DdBudgetExceededError the instant the next
 * request would exceed DD_PLACES_MONTHLY_BUDGET_USD, tracked per calendar
 * month (UTC) in dd_api_spend. These tests fake the system clock to assert
 * the cap resets on a new month.
 *
 * Uses a mapped NAICS code ("238110") so resolveSearchTerms() never falls
 * back to the donor_discovery_taxonomy lookup — keeps the supabase mock
 * scoped to just the dd_api_spend table used by the budget guard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

vi.mock("@/lib/donor-discovery/directory", () => ({
  upsertDirectoryRecord: vi.fn(),
}));

import { enumerate, DdBudgetExceededError } from "@/lib/donor-discovery/adapters/google-places";

const NAICS_CODE = "238110"; // mapped in NAICS_PLACES_MAP — no taxonomy DB lookup needed
const GEOGRAPHY = { center: { lat: 30, lng: -90 }, radius_mi: 10 };
const COST_PER_REQUEST_USD = 0.032;

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function makeSpendChain(spendByMonth: Record<string, number>) {
  let capturedMonth = "";
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn((col: string, val: string) => {
      if (col === "month") capturedMonth = val;
      return chain;
    }),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: capturedMonth in spendByMonth ? { est_cost_usd: spendByMonth[capturedMonth] } : null,
        error: null,
      }),
    ),
  };
  return chain;
}

function mockSpendByMonth(spendByMonth: Record<string, number>) {
  const chain = makeSpendChain(spendByMonth);
  mockFrom.mockImplementation((table: string) => {
    if (table === "dd_api_spend") return chain;
    throw new Error(`unexpected table: ${table}`);
  });
  return chain;
}

describe("google-places enumerate() budget guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [] }),
    });
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.DD_PLACES_MONTHLY_BUDGET_USD;
    vi.useRealTimers();
  });

  it("proceeds and records spend when well under the monthly budget", async () => {
    process.env.DD_PLACES_MONTHLY_BUDGET_USD = "200";
    mockSpendByMonth({ [currentMonthKey()]: 0 });

    const result = await enumerate({ naicsCodes: [NAICS_CODE], geography: GEOGRAPHY });

    expect(result.requestsMade).toBe(1);
    expect(result.estCostUsd).toBeCloseTo(COST_PER_REQUEST_USD);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      "donor_discovery_increment_api_spend",
      expect.objectContaining({ p_provider: "google_places", p_requests: 1 }),
    );
  });

  it("hard-stops with DdBudgetExceededError before making a request once spend is at the cap", async () => {
    process.env.DD_PLACES_MONTHLY_BUDGET_USD = "200";
    mockSpendByMonth({ [currentMonthKey()]: 200 });

    await expect(
      enumerate({ naicsCodes: [NAICS_CODE], geography: GEOGRAPHY }),
    ).rejects.toBeInstanceOf(DdBudgetExceededError);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("hard-stops when spend is close enough to the cap that one more request would exceed it", async () => {
    process.env.DD_PLACES_MONTHLY_BUDGET_USD = "200";
    // 200 - spend < COST_PER_REQUEST_USD, so the next request would tip it over.
    mockSpendByMonth({ [currentMonthKey()]: 199.99 });

    await expect(
      enumerate({ naicsCodes: [NAICS_CODE], geography: GEOGRAPHY }),
    ).rejects.toBeInstanceOf(DdBudgetExceededError);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("resets the budget on a new calendar month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T12:00:00Z"));
    process.env.DD_PLACES_MONTHLY_BUDGET_USD = "200";

    mockSpendByMonth({ "2026-01": 200, "2026-02": 0 });

    await expect(
      enumerate({ naicsCodes: [NAICS_CODE], geography: GEOGRAPHY }),
    ).rejects.toBeInstanceOf(DdBudgetExceededError);
    expect(global.fetch).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    const result = await enumerate({ naicsCodes: [NAICS_CODE], geography: GEOGRAPHY });

    expect(result.requestsMade).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the $200 default budget when DD_PLACES_MONTHLY_BUDGET_USD is unset", async () => {
    delete process.env.DD_PLACES_MONTHLY_BUDGET_USD;
    mockSpendByMonth({ [currentMonthKey()]: 200 });

    await expect(
      enumerate({ naicsCodes: [NAICS_CODE], geography: GEOGRAPHY }),
    ).rejects.toThrow(/\$200\.00 monthly cap/);
  });
});
