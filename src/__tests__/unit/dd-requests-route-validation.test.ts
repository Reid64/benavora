// WGR-159: POST /api/donor-discovery/requests must reject a taxonomy/
// geography combination the worker can never process — e.g. NAICS
// taxonomy with states/national geography, or NTEE taxonomy with radius
// geography — with a clear 400 at creation time, never a silent 201 that
// only fails once the worker claims it seconds later (this row's own
// original finding).
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireRoleMock = vi.fn();
vi.mock("@/lib/auth/role-gate", () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}));

import { POST } from "@/app/api/donor-discovery/requests/route";

function makeSupabase(taxonomyRows: Array<{ kind: string }>, insertResult: { data: unknown; error: unknown }) {
  return {
    from: vi.fn((table: string) => {
      if (table === "donor_discovery_taxonomy") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: taxonomyRows, error: null }),
        };
      }
      if (table === "donor_discovery_requests") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(insertResult),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

function makeRequest(body: unknown) {
  return new Request("https://www.benavora.com/api/donor-discovery/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/donor-discovery/requests (WGR-159 taxonomy/geography validation)", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
  });

  it("rejects (400) a radius geography paired only with NTEE-kind taxonomy", async () => {
    requireRoleMock.mockResolvedValue({
      supabase: makeSupabase([{ kind: "ntee" }], { data: null, error: null }),
      organizationId: "org-1",
      userId: "user-1",
    });

    const res = await POST(
      makeRequest({
        name: "test",
        taxonomy_ids: ["ntee-id-1"],
        geography: { center: { lat: 1, lng: 2 }, radius_mi: 10 },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("taxonomy_geography_mismatch");
  });

  it("rejects (400) a states geography paired only with NAICS-kind taxonomy", async () => {
    requireRoleMock.mockResolvedValue({
      supabase: makeSupabase([{ kind: "naics" }], { data: null, error: null }),
      organizationId: "org-1",
      userId: "user-1",
    });

    const res = await POST(
      makeRequest({
        name: "test",
        taxonomy_ids: ["naics-id-1"],
        geography: { states: ["TX"] },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("taxonomy_geography_mismatch");
  });

  it("accepts (201) a states geography paired with NTEE-kind taxonomy", async () => {
    requireRoleMock.mockResolvedValue({
      supabase: makeSupabase([{ kind: "ntee" }], {
        data: { id: "req-1", status: "queued" },
        error: null,
      }),
      organizationId: "org-1",
      userId: "user-1",
    });

    const res = await POST(
      makeRequest({
        name: "test",
        taxonomy_ids: ["ntee-id-1"],
        geography: { states: ["TX"], min_assets: 1_000_000, limit: 200 },
      }),
    );

    expect(res.status).toBe(201);
  });

  it("accepts (201) a radius geography paired with NAICS-kind taxonomy (unchanged happy path)", async () => {
    requireRoleMock.mockResolvedValue({
      supabase: makeSupabase([{ kind: "naics" }], {
        data: { id: "req-2", status: "queued" },
        error: null,
      }),
      organizationId: "org-1",
      userId: "user-1",
    });

    const res = await POST(
      makeRequest({
        name: "test",
        taxonomy_ids: ["naics-id-1"],
        geography: { center: { lat: 29.76, lng: -95.37 }, radius_mi: 30 },
      }),
    );

    expect(res.status).toBe(201);
  });

  it("rejects (400) an empty states array", async () => {
    requireRoleMock.mockResolvedValue({
      supabase: makeSupabase([{ kind: "ntee" }], { data: null, error: null }),
      organizationId: "org-1",
      userId: "user-1",
    });

    const res = await POST(
      makeRequest({ name: "test", taxonomy_ids: ["ntee-id-1"], geography: { states: [] } }),
    );

    expect(res.status).toBe(400);
  });

  it("rejects (400) a negative min_assets", async () => {
    requireRoleMock.mockResolvedValue({
      supabase: makeSupabase([{ kind: "ntee" }], { data: null, error: null }),
      organizationId: "org-1",
      userId: "user-1",
    });

    const res = await POST(
      makeRequest({
        name: "test",
        taxonomy_ids: ["ntee-id-1"],
        geography: { states: ["TX"], min_assets: -5 },
      }),
    );

    expect(res.status).toBe(400);
  });

  it("rejects (400) a non-integer limit", async () => {
    requireRoleMock.mockResolvedValue({
      supabase: makeSupabase([{ kind: "ntee" }], { data: null, error: null }),
      organizationId: "org-1",
      userId: "user-1",
    });

    const res = await POST(
      makeRequest({
        name: "test",
        taxonomy_ids: ["ntee-id-1"],
        geography: { states: ["TX"], limit: 12.5 },
      }),
    );

    expect(res.status).toBe(400);
  });
});
