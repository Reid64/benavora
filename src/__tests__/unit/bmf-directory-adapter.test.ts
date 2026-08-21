// WGR-158/WGR-159: unit tests for the BMF (foundation_directory) donor
// discovery adapter's filter logic — NTEE major group validation,
// requireBmfGeography() parsing/rejection, and the actual Postgrest query
// construction (state filter, NTEE-prefix OR, asset floor, order, limit)
// for each geography shape, verified against a mocked query builder rather
// than a live database.
import { describe, it, expect, vi, beforeEach } from "vitest";

function makeQueryBuilder(resolved: { data: unknown; error: unknown }) {
  const calls: Record<string, unknown[][]> = { select: [], or: [], in: [], gte: [], order: [], limit: [] };
  const q: Record<string, unknown> = {};
  for (const method of ["select", "or", "in", "gte", "order", "limit"]) {
    q[method] = vi.fn((...args: unknown[]) => {
      calls[method].push(args);
      return q;
    });
  }
  q.then = (resolve: (v: unknown) => void) => resolve(resolved);
  return { query: q, calls };
}

const fromMock = vi.fn();
const updateChain = {
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockResolvedValue({ error: null }),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: fromMock,
  }),
}));

vi.mock("@/lib/donor-discovery/directory", () => ({
  upsertDirectoryRecord: vi.fn().mockResolvedValue({
    id: "dir-1",
    legal_name: "Test Foundation",
    dba_name: null,
    naics_codes: [],
    civic_kind: null,
    website: null,
    hq_address: "Houston, TX",
    geo: null,
    phone: null,
    enrichment: {},
    enriched_at: null,
    source_adapters: ["bmf_directory"],
    created_at: "2026-01-01T00:00:00Z",
  }),
}));

import { enumerate, requireBmfGeography, DEFAULT_LIMIT, MAX_LIMIT } from "@/lib/donor-discovery/adapters/bmf-directory";

describe("bmf-directory adapter: requireBmfGeography", () => {
  it("accepts a states geography", () => {
    expect(requireBmfGeography({ states: ["TX"] })).toEqual({ states: ["TX"], min_assets: undefined, limit: undefined });
  });

  it("accepts a national geography", () => {
    expect(requireBmfGeography({ national: true })).toEqual({ national: true, min_assets: undefined, limit: undefined });
  });

  it("carries min_assets and limit through when present", () => {
    expect(requireBmfGeography({ states: ["TX"], min_assets: 1_000_000, limit: 200 })).toEqual({
      states: ["TX"],
      min_assets: 1_000_000,
      limit: 200,
    });
  });

  it("rejects a radius geography (that stays on the Places adapter)", () => {
    expect(() => requireBmfGeography({ center: { lat: 1, lng: 2 }, radius_mi: 10 })).toThrow(
      /requires a states or national geography/,
    );
  });

  it("rejects a malformed geography", () => {
    expect(() => requireBmfGeography({ foo: "bar" })).toThrow();
    expect(() => requireBmfGeography(null)).toThrow();
  });
});

describe("bmf-directory adapter: enumerate() query construction", () => {
  beforeEach(() => {
    fromMock.mockReset();
    updateChain.eq.mockClear();
    updateChain.is.mockClear();
  });

  it("rejects an empty NTEE major group list", async () => {
    await expect(enumerate({ nteeMajorGroups: [], geography: { states: ["TX"] } })).rejects.toThrow(
      /at least one NTEE major group/,
    );
  });

  it("rejects an invalid (non-single-letter) NTEE code", async () => {
    await expect(
      enumerate({ nteeMajorGroups: ["P20", "x"], geography: { states: ["TX"] } }),
    ).rejects.toThrow(/invalid NTEE major group/);
  });

  it("filters by state, NTEE prefix, orders by assets desc, applies default limit — no asset floor when min_assets omitted", async () => {
    const { query, calls } = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(query);

    await enumerate({ nteeMajorGroups: ["P", "X", "L"], geography: { states: ["TX"] } });

    expect(fromMock).toHaveBeenCalledWith("foundation_directory");
    expect(calls.or[0][0]).toBe("ntee_code.ilike.P%,ntee_code.ilike.X%,ntee_code.ilike.L%");
    expect(calls.in[0]).toEqual(["state", ["TX"]]);
    expect(calls.order[0]).toEqual(["asset_amount", { ascending: false, nullsFirst: false }]);
    expect(calls.limit[0]).toEqual([DEFAULT_LIMIT]);
    expect(calls.gte.length).toBe(0); // no asset floor requested
  });

  it("applies the asset floor via .gte when min_assets is set", async () => {
    const { query, calls } = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(query);

    await enumerate({
      nteeMajorGroups: ["P"],
      geography: { states: ["TX"], min_assets: 1_000_000 },
    });

    expect(calls.gte[0]).toEqual(["asset_amount", 1_000_000]);
  });

  it("does not filter by state for national geography", async () => {
    const { query, calls } = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(query);

    await enumerate({ nteeMajorGroups: ["X"], geography: { national: true } });

    expect(calls.in.length).toBe(0);
  });

  it("honors a caller-specified limit within the max cap", async () => {
    const { query, calls } = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(query);

    await enumerate({ nteeMajorGroups: ["P"], geography: { states: ["TX"], limit: 50 } });

    expect(calls.limit[0]).toEqual([50]);
  });

  it("clamps a limit above MAX_LIMIT down to MAX_LIMIT", async () => {
    const { query, calls } = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(query);

    await enumerate({ nteeMajorGroups: ["P"], geography: { states: ["TX"], limit: 999_999 } });

    expect(calls.limit[0]).toEqual([MAX_LIMIT]);
  });

  it("throws a clear error when the query itself fails", async () => {
    const { query } = makeQueryBuilder({ data: null, error: { message: "boom" } });
    fromMock.mockReturnValue(query);

    await expect(enumerate({ nteeMajorGroups: ["P"], geography: { states: ["TX"] } })).rejects.toThrow(
      /bmf_directory_query_failed: boom/,
    );
  });

  it("upserts each matched row into the shared directory and returns real result counts", async () => {
    const { query } = makeQueryBuilder({
      data: [
        {
          id: "found-1",
          name: "Test Foundation",
          city: "Houston",
          state: "TX",
          ein: "12-3456789",
          website: null,
          phone: null,
          asset_amount: 5_000_000,
          giving_total: null,
          ntee_code: "P20",
        },
      ],
      error: null,
    });
    // Second .from() call (donor_discovery_directory linkage update) needs its own chain.
    const linkQuery = { update: vi.fn().mockReturnValue(updateChain) };
    fromMock.mockReturnValueOnce(query).mockReturnValueOnce(linkQuery);

    const result = await enumerate({ nteeMajorGroups: ["P"], geography: { states: ["TX"] } });

    expect(result.directoryIds).toEqual(["dir-1"]);
    expect(result.prospects).toHaveLength(1);
    expect(result.requestsMade).toBe(0);
    expect(result.estCostUsd).toBe(0);
    expect(linkQuery.update).toHaveBeenCalledWith({ linked_foundation_id: "found-1", linkage_confidence: 1 });
  });
});
