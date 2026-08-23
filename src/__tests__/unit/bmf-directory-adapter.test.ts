// WGR-158/WGR-159 + 2026-08-22 grantmaker-mode fix: unit tests for the BMF
// (foundation_directory) donor discovery adapter's filter logic — NTEE major
// group validation, requireBmfGeography() parsing/rejection, grantmaker-mode
// vs operating_nonprofits-mode query construction, cause-match tiering
// (ntee_code_direct / name_keyword_match), match_basis recording, and the
// zip-aware hqAddress fix — verified against a mocked query builder rather
// than a live database.
import { describe, it, expect, vi, beforeEach } from "vitest";

type CallLog = { select: unknown[][]; or: unknown[][]; in: unknown[][]; gte: unknown[][]; order: unknown[][]; limit: unknown[][] };

function makeQueryBuilder(resolved: { data: unknown; error: unknown }) {
  const calls: CallLog = { select: [], or: [], in: [], gte: [], order: [], limit: [] };
  const q: Record<string, unknown> = {};
  for (const method of ["select", "or", "in", "gte", "order", "limit"] as const) {
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

let lastUpsertedEnrichment: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: fromMock,
  }),
}));

vi.mock("@/lib/donor-discovery/directory", () => ({
  upsertDirectoryRecord: vi.fn((record: { enrichment?: Record<string, unknown> | null; hq_address?: string | null }) => {
    lastUpsertedEnrichment = record.enrichment ?? null;
    return Promise.resolve({
      id: "dir-1",
      legal_name: "Test Foundation",
      dba_name: null,
      naics_codes: [],
      civic_kind: null,
      website: null,
      hq_address: record.hq_address ?? "Houston, TX",
      geo: null,
      phone: null,
      enrichment: {},
      enriched_at: null,
      source_adapters: ["bmf_directory"],
      created_at: "2026-01-01T00:00:00Z",
    });
  }),
}));

import { enumerate, requireBmfGeography, DEFAULT_LIMIT, MAX_LIMIT } from "@/lib/donor-discovery/adapters/bmf-directory";

function foundationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "found-1",
    name: "Test Foundation",
    city: "Houston",
    state: "TX",
    zip: "77002",
    ein: "12-3456789",
    website: null,
    phone: null,
    asset_amount: 5_000_000,
    giving_total: null,
    ntee_code: "T22",
    foundation_type: "04",
    ...overrides,
  };
}

describe("bmf-directory adapter: requireBmfGeography", () => {
  it("accepts a states geography, defaulting operating_nonprofits to false (grantmaker mode)", () => {
    expect(requireBmfGeography({ states: ["TX"] })).toEqual({
      states: ["TX"],
      min_assets: undefined,
      limit: undefined,
      operating_nonprofits: false,
    });
  });

  it("accepts a national geography", () => {
    expect(requireBmfGeography({ national: true })).toEqual({
      national: true,
      min_assets: undefined,
      limit: undefined,
      operating_nonprofits: false,
    });
  });

  it("carries min_assets, limit, and operating_nonprofits through when present", () => {
    expect(
      requireBmfGeography({ states: ["TX"], min_assets: 1_000_000, limit: 200, operating_nonprofits: true }),
    ).toEqual({
      states: ["TX"],
      min_assets: 1_000_000,
      limit: 200,
      operating_nonprofits: true,
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

describe("bmf-directory adapter: enumerate() input validation", () => {
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
});

describe("bmf-directory adapter: grantmaker mode (default) query construction", () => {
  beforeEach(() => {
    fromMock.mockReset();
    updateChain.eq.mockClear();
    updateChain.is.mockClear();
    lastUpsertedEnrichment = null;
  });

  it("filters structurally on foundation_type(02,03,04) OR ntee T2%/T3% — never the requested cause codes directly", async () => {
    const { query, calls } = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(query);

    await enumerate({ nteeMajorGroups: ["P", "X", "L"], geography: { states: ["TX"] } });

    expect(fromMock).toHaveBeenCalledWith("foundation_directory");
    expect(calls.or[0]?.[0]).toBe("foundation_type.in.(03,04),ntee_code.ilike.T2%,ntee_code.ilike.T3%");
    expect(calls.in[0]).toEqual(["state", ["TX"]]);
    expect(calls.order[0]).toEqual(["asset_amount", { ascending: false, nullsFirst: false }]);
  });

  it("over-fetches beyond `limit` so cause-match filtering (applied in app code) doesn't starve results", async () => {
    const { query, calls } = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(query);

    await enumerate({ nteeMajorGroups: ["P"], geography: { states: ["TX"], limit: 50 } });

    expect(calls.limit[0]?.[0]).toBeGreaterThan(50);
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

  it("throws a clear error when the query itself fails", async () => {
    const { query } = makeQueryBuilder({ data: null, error: { message: "boom" } });
    fromMock.mockReturnValue(query);

    await expect(enumerate({ nteeMajorGroups: ["P"], geography: { states: ["TX"] } })).rejects.toThrow(
      /bmf_directory_query_failed: boom/,
    );
  });

  it("match_basis=ntee_code_direct when the foundation's own ntee_code already starts with a requested cause letter", async () => {
    const { query } = makeQueryBuilder({
      data: [foundationRow({ ntee_code: "L20" })], // requested cause "L" (housing)
      error: null,
    });
    const linkQuery = { update: vi.fn().mockReturnValue(updateChain) };
    fromMock.mockReturnValueOnce(query).mockReturnValueOnce(linkQuery);

    const result = await enumerate({ nteeMajorGroups: ["L"], geography: { states: ["TX"] } });

    expect(result.directoryIds).toEqual(["dir-1"]);
    expect(lastUpsertedEnrichment?.match_basis).toBe("ntee_code_direct");
    expect(lastUpsertedEnrichment?.grantmaker_mode).toBe(true);
  });

  it("match_basis=name_keyword_match when a T-coded (pure-philanthropy) foundation's name matches a cause keyword", async () => {
    const { query } = makeQueryBuilder({
      data: [foundationRow({ ntee_code: "T20", name: "Grace Community Church Foundation" })], // requested cause "X" (religion)
      error: null,
    });
    const linkQuery = { update: vi.fn().mockReturnValue(updateChain) };
    fromMock.mockReturnValueOnce(query).mockReturnValueOnce(linkQuery);

    const result = await enumerate({ nteeMajorGroups: ["X"], geography: { states: ["TX"] } });

    expect(result.directoryIds).toEqual(["dir-1"]);
    expect(lastUpsertedEnrichment?.match_basis).toBe("name_keyword_match");
  });

  it("drops a structurally-grantmaker row that matches no requested cause by either tier", async () => {
    const { query } = makeQueryBuilder({
      data: [foundationRow({ ntee_code: "T20", name: "Generic Family Foundation" })], // no L/housing signal anywhere
      error: null,
    });
    fromMock.mockReturnValueOnce(query);

    const result = await enumerate({ nteeMajorGroups: ["L"], geography: { states: ["TX"] } });

    expect(result.directoryIds).toEqual([]);
    expect(result.prospects).toEqual([]);
  });

  it("does not treat foundation_type='02' (private OPERATING foundation) as a grantmaker type", async () => {
    // Real defect found live 2026-08-22: HENDRICK HOME FOR CHILDREN
    // (foundation_type='02') is a residential children's home that directly
    // operates its own programs -- not a grantmaker -- and was a false
    // positive before '02' was removed from GRANTMAKER_FOUNDATION_TYPES.
    const { query } = makeQueryBuilder({
      data: [foundationRow({ ntee_code: "P20", foundation_type: "02" })],
      error: null,
    });
    const linkQuery = { update: vi.fn().mockReturnValue(updateChain) };
    fromMock.mockReturnValueOnce(query).mockReturnValueOnce(linkQuery);

    await enumerate({ nteeMajorGroups: ["P"], geography: { states: ["TX"] } });

    expect(lastUpsertedEnrichment?.is_grantmaker_foundation_type).toBe(false);
  });

  it("caps the post-cause-match result set at the requested limit", async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      foundationRow({ id: `found-${i}`, ntee_code: "L20", asset_amount: 5_000_000 - i }),
    );
    const { query } = makeQueryBuilder({ data: rows, error: null });
    const linkQuery = { update: vi.fn().mockReturnValue(updateChain) };
    fromMock.mockReturnValueOnce(query).mockReturnValue(linkQuery);

    const result = await enumerate({ nteeMajorGroups: ["L"], geography: { states: ["TX"], limit: 2 } });

    expect(result.directoryIds).toHaveLength(2);
  });

  it("builds hq_address with zip so the scoring layer's state-extraction regex can match", async () => {
    const { query } = makeQueryBuilder({
      data: [foundationRow({ ntee_code: "L20", city: "Austin", state: "TX", zip: "78701" })],
      error: null,
    });
    const linkQuery = { update: vi.fn().mockReturnValue(updateChain) };
    fromMock.mockReturnValueOnce(query).mockReturnValueOnce(linkQuery);

    const { upsertDirectoryRecord } = await import("@/lib/donor-discovery/directory");
    await enumerate({ nteeMajorGroups: ["L"], geography: { states: ["TX"] } });

    expect(upsertDirectoryRecord).toHaveBeenCalledWith(
      expect.objectContaining({ hq_address: "Austin, TX 78701" }),
    );
  });

  it("records is_grantmaker_ntee / is_grantmaker_foundation_type flags on enrichment", async () => {
    const { query } = makeQueryBuilder({
      data: [foundationRow({ ntee_code: "T22", foundation_type: "04" })],
      error: null,
    });
    const linkQuery = { update: vi.fn().mockReturnValue(updateChain) };
    fromMock.mockReturnValueOnce(query).mockReturnValueOnce(linkQuery);

    await enumerate({ nteeMajorGroups: ["T"], geography: { states: ["TX"] } });

    expect(lastUpsertedEnrichment?.is_grantmaker_ntee).toBe(true);
    expect(lastUpsertedEnrichment?.is_grantmaker_foundation_type).toBe(true);
  });

  it("upserts each matched row into the shared directory and returns real result counts", async () => {
    const { query } = makeQueryBuilder({
      data: [foundationRow({ ntee_code: "P20" })],
      error: null,
    });
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

describe("bmf-directory adapter: operating_nonprofits mode (pre-2026-08-22 behavior, explicit opt-in)", () => {
  beforeEach(() => {
    fromMock.mockReset();
    updateChain.eq.mockClear();
    updateChain.is.mockClear();
    lastUpsertedEnrichment = null;
  });

  it("filters directly by requested NTEE prefixes (no grantmaker structural filter), applies the exact requested limit", async () => {
    const { query, calls } = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(query);

    await enumerate({
      nteeMajorGroups: ["P", "X", "L"],
      geography: { states: ["TX"], operating_nonprofits: true },
    });

    expect(calls.or[0]?.[0]).toBe("ntee_code.ilike.P%,ntee_code.ilike.X%,ntee_code.ilike.L%");
    expect(calls.limit[0]).toEqual([DEFAULT_LIMIT]);
  });

  it("honors a caller-specified limit within the max cap", async () => {
    const { query, calls } = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(query);

    await enumerate({
      nteeMajorGroups: ["P"],
      geography: { states: ["TX"], limit: 50, operating_nonprofits: true },
    });

    expect(calls.limit[0]).toEqual([50]);
  });

  it("clamps a limit above MAX_LIMIT down to MAX_LIMIT", async () => {
    const { query, calls } = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(query);

    await enumerate({
      nteeMajorGroups: ["P"],
      geography: { states: ["TX"], limit: 999_999, operating_nonprofits: true },
    });

    expect(calls.limit[0]).toEqual([MAX_LIMIT]);
  });

  it("stamps match_basis=operating_nonprofit_mode, not a cause-match tier", async () => {
    const { query } = makeQueryBuilder({
      data: [foundationRow({ ntee_code: "P20" })],
      error: null,
    });
    const linkQuery = { update: vi.fn().mockReturnValue(updateChain) };
    fromMock.mockReturnValueOnce(query).mockReturnValueOnce(linkQuery);

    await enumerate({
      nteeMajorGroups: ["P"],
      geography: { states: ["TX"], operating_nonprofits: true },
    });

    expect(lastUpsertedEnrichment?.match_basis).toBe("operating_nonprofit_mode");
    expect(lastUpsertedEnrichment?.grantmaker_mode).toBe(false);
  });
});
