/**
 * Unit tests for src/lib/donor-discovery/directory.ts.
 *
 * Covers:
 *   - normalizeDomain(): protocol/www/path/query/fragment stripping, casing,
 *     and null-safe handling — must mirror the SQL
 *     `donor_discovery_extract_domain` function exactly (see module docblock).
 *   - upsertDirectoryRecord(): thin wrapper around the
 *     `donor_discovery_upsert_directory_record` RPC that does the actual
 *     fuzzy-match dedup/merge in Postgres — asserted here via the RPC args
 *     and the row-shape mapping (geo parsing, array defaults).
 *   - findOrCreateProspect(): idempotent per (organization_id, directory_id)
 *     — reuse, fresh insert, and the unique-violation race-retry path.
 *
 * createAdminClient is mocked so these run without a live Supabase.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc, from: mockFrom }),
}));

import {
  normalizeDomain,
  upsertDirectoryRecord,
  findOrCreateProspect,
} from "@/lib/donor-discovery/directory";

// ── normalizeDomain ───────────────────────────────────────────────────────────

describe("normalizeDomain", () => {
  it("returns null for null, undefined, and empty/whitespace input", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });

  it("strips the http/https protocol", () => {
    expect(normalizeDomain("https://example.com")).toBe("example.com");
    expect(normalizeDomain("http://example.com")).toBe("example.com");
  });

  it("strips a leading www.", () => {
    expect(normalizeDomain("https://www.example.com")).toBe("example.com");
    expect(normalizeDomain("www.example.com")).toBe("example.com");
  });

  it("strips path, query string, and fragment", () => {
    expect(normalizeDomain("https://example.com/about")).toBe("example.com");
    expect(normalizeDomain("https://example.com?utm=1")).toBe("example.com");
    expect(normalizeDomain("https://example.com#section")).toBe("example.com");
    expect(normalizeDomain("https://example.com/about?utm=1#section")).toBe("example.com");
  });

  it("strips a port number", () => {
    expect(normalizeDomain("https://example.com:8080/about")).toBe("example.com");
  });

  it("lowercases the host", () => {
    expect(normalizeDomain("HTTPS://WWW.Example.COM/Path")).toBe("example.com");
  });

  it("handles a bare domain with no protocol or www", () => {
    expect(normalizeDomain("example.com")).toBe("example.com");
  });

  it("trims surrounding whitespace before normalizing", () => {
    expect(normalizeDomain("  https://example.com  ")).toBe("example.com");
  });

  it("treats different paths on the same host as the same domain", () => {
    const a = normalizeDomain("https://example.com/grants");
    const b = normalizeDomain("https://www.example.com/apply?ref=x");
    expect(a).toBe(b);
    expect(a).toBe("example.com");
  });
});

// ── upsertDirectoryRecord ─────────────────────────────────────────────────────

describe("upsertDirectoryRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the merge-upsert RPC with the normalized param shape", async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: "dir-1",
        legal_name: "Acme Inc",
        dba_name: null,
        naics_codes: ["238110"],
        civic_kind: null,
        website: "example.com",
        hq_address: "123 Main St",
        geo: "(-122.4,37.7)",
        phone: "555-1234",
        enrichment: {},
        enriched_at: null,
        source_adapters: ["google_places"],
        created_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });

    await upsertDirectoryRecord({
      legal_name: "Acme Inc",
      website: "https://example.com",
      hq_address: "123 Main St",
      geo: { lat: 37.7, lng: -122.4 },
      phone: "555-1234",
      naics_codes: ["238110"],
      source_adapter: "google_places",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "donor_discovery_upsert_directory_record",
      expect.objectContaining({
        p_legal_name: "Acme Inc",
        p_website: "https://example.com",
        p_hq_address: "123 Main St",
        p_lat: 37.7,
        p_lng: -122.4,
        p_phone: "555-1234",
        p_naics_codes: ["238110"],
        p_source_adapter: "google_places",
      }),
    );
  });

  it("defaults optional fields to null/empty when omitted (merge-friendly no-ops)", async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: "dir-2",
        legal_name: "Bare Co",
        dba_name: null,
        naics_codes: [],
        civic_kind: null,
        website: null,
        hq_address: null,
        geo: null,
        phone: null,
        enrichment: {},
        enriched_at: null,
        source_adapters: ["google_places"],
        created_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });

    await upsertDirectoryRecord({ legal_name: "Bare Co", source_adapter: "google_places" });

    expect(mockRpc).toHaveBeenCalledWith(
      "donor_discovery_upsert_directory_record",
      expect.objectContaining({
        p_website: null,
        p_hq_address: null,
        p_lat: null,
        p_lng: null,
        p_phone: null,
        p_naics_codes: [],
        p_civic_kind: null,
        p_enrichment: null,
      }),
    );
  });

  it("maps the returned row, parsing the Postgres point geo string as {lat, lng}", async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: "dir-1",
        legal_name: "Acme Inc",
        dba_name: "Acme",
        naics_codes: ["238110"],
        civic_kind: null,
        website: "example.com",
        hq_address: "123 Main St",
        geo: "(-122.4,37.7)",
        phone: "555-1234",
        enrichment: { ein: "12-3456789" },
        enriched_at: "2026-02-01T00:00:00.000Z",
        source_adapters: ["google_places", "apollo"],
        created_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });

    const result = await upsertDirectoryRecord({
      legal_name: "Acme Inc",
      source_adapter: "google_places",
    });

    expect(result.id).toBe("dir-1");
    expect(result.geo).toEqual({ lng: -122.4, lat: 37.7 });
    expect(result.source_adapters).toEqual(["google_places", "apollo"]);
    expect(result.enrichment).toEqual({ ein: "12-3456789" });
  });

  it("throws a descriptive error when the RPC returns an error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "constraint violation" } });

    await expect(
      upsertDirectoryRecord({ legal_name: "Acme Inc", source_adapter: "google_places" }),
    ).rejects.toThrow(/directory_upsert_failed.*constraint violation/);
  });

  it("throws when the RPC returns no row and no error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await expect(
      upsertDirectoryRecord({ legal_name: "Acme Inc", source_adapter: "google_places" }),
    ).rejects.toThrow(/directory_upsert_failed/);
  });
});

// ── findOrCreateProspect ───────────────────────────────────────────────────────

const ORG_ID = "org-1";
const REQUEST_ID = "req-1";
const DIRECTORY_ID = "dir-1";

interface ProspectsTableStub {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

function makeProspectsTable(opts: {
  existing?: { id: string } | null;
  insertResult?: { data: { id: string } | null; error: { code?: string; message: string } | null };
  retryResult?: { data: { id: string } | null; error: { message: string } | null };
}): ProspectsTableStub {
  const singleResults = [opts.insertResult, opts.retryResult].filter(
    (r): r is NonNullable<typeof r> => r !== undefined,
  );
  let singleCallIndex = 0;

  const table: ProspectsTableStub = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.existing ?? null, error: null }),
    single: vi.fn(() => Promise.resolve(singleResults[singleCallIndex++])),
  };
  return table;
}

function makeLinkTable(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  return { upsert: vi.fn().mockResolvedValue(result) };
}

describe("findOrCreateProspect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses an existing prospect for the same (organization_id, directory_id) instead of inserting", async () => {
    const prospectsTable = makeProspectsTable({ existing: { id: "prospect-1" } });
    const linkTable = makeLinkTable();
    mockFrom.mockImplementation((table: string) => {
      if (table === "donor_discovery_prospects") return prospectsTable;
      if (table === "dd_prospect_requests") return linkTable;
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await findOrCreateProspect(ORG_ID, REQUEST_ID, DIRECTORY_ID);

    expect(result).toEqual({ id: "prospect-1", created: false });
    expect(prospectsTable.insert).not.toHaveBeenCalled();
    expect(linkTable.upsert).toHaveBeenCalledWith(
      { prospect_id: "prospect-1", request_id: REQUEST_ID },
      { onConflict: "prospect_id,request_id", ignoreDuplicates: true },
    );
  });

  it("inserts a new prospect when none exists for (organization_id, directory_id)", async () => {
    const prospectsTable = makeProspectsTable({
      existing: null,
      insertResult: { data: { id: "prospect-2" }, error: null },
    });
    const linkTable = makeLinkTable();
    mockFrom.mockImplementation((table: string) => {
      if (table === "donor_discovery_prospects") return prospectsTable;
      if (table === "dd_prospect_requests") return linkTable;
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await findOrCreateProspect(ORG_ID, REQUEST_ID, DIRECTORY_ID);

    expect(result).toEqual({ id: "prospect-2", created: true });
    expect(prospectsTable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: ORG_ID,
        directory_id: DIRECTORY_ID,
        request_id: REQUEST_ID,
        pipeline_stage: "new",
      }),
    );
  });

  it("falls back to the winner's row on a unique-violation race instead of failing", async () => {
    const prospectsTable = makeProspectsTable({
      existing: null,
      insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
      retryResult: { data: { id: "prospect-3" }, error: null },
    });
    const linkTable = makeLinkTable();
    mockFrom.mockImplementation((table: string) => {
      if (table === "donor_discovery_prospects") return prospectsTable;
      if (table === "dd_prospect_requests") return linkTable;
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await findOrCreateProspect(ORG_ID, REQUEST_ID, DIRECTORY_ID);

    expect(result).toEqual({ id: "prospect-3", created: false });
  });

  it("throws (does not swallow) a non-race insert error", async () => {
    const prospectsTable = makeProspectsTable({
      existing: null,
      insertResult: { data: null, error: { code: "23502", message: "not null violation" } },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "donor_discovery_prospects") return prospectsTable;
      throw new Error(`unexpected table: ${table}`);
    });

    await expect(findOrCreateProspect(ORG_ID, REQUEST_ID, DIRECTORY_ID)).rejects.toThrow(
      /prospect_insert_failed/,
    );
  });
});
