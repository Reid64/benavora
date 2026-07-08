/**
 * Unit tests for the Donor Discovery requests API routes.
 *
 * Routes covered:
 *   POST /api/donor-discovery/requests      (src/app/api/donor-discovery/requests/route.ts)
 *   GET  /api/donor-discovery/requests      (src/app/api/donor-discovery/requests/route.ts)
 *   GET  /api/donor-discovery/requests/[id] (src/app/api/donor-discovery/requests/[id]/route.ts)
 *
 * Auth/tenant-scoping is handled by requireRole(), which derives
 * organization_id from the session (never the request body). It's mocked
 * here so we can control the returned RoleContext (or error response) per
 * test without a live Supabase, matching tests/api/grants.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ── module mocks (hoisted) ────────────────────────────────────────────────────

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role-gate", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

// ── import route handlers AFTER mocks ────────────────────────────────────────

import { POST, GET as listRequests } from "@/app/api/donor-discovery/requests/route";
import { GET as getRequestById } from "@/app/api/donor-discovery/requests/[id]/route";

// ── mock builders ─────────────────────────────────────────────────────────────

/** Build a chainable query builder that resolves to `result` on `await` or `.single()`. */
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn((resolve: (v: typeof result) => unknown) => Promise.resolve(resolve(result))),
  };
  return chain;
}

const ORG_ID = "org-abc";
const OTHER_ORG_ID = "org-xyz";
const REQUEST_ID = "11111111-1111-1111-1111-111111111111";

const mockDdRequest = {
  id: REQUEST_ID,
  organization_id: ORG_ID,
  name: "Q1 concrete contractors",
  taxonomy_ids: ["naics-238110"],
  geography: { center: { lat: 30, lng: -90 }, radius_mi: 25 },
  status: "queued",
  counts: {},
  created_by: "user-1",
  created_at: "2026-01-01T00:00:00.000Z",
};

const unauthenticatedGate = {
  error: NextResponse.json({ error: "Authentication required.", code: "unauthenticated" }, { status: 401 }),
};

const forbiddenGate = {
  error: NextResponse.json(
    { error: "You do not have permission to perform this action.", code: "forbidden" },
    { status: 403 },
  ),
};

function grantedGate(supabase: unknown, userRole: "viewer" | "writer" = "viewer", organizationId = ORG_ID) {
  return { supabase, userId: "user-1", userRole, organizationId };
}

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

// ── POST /api/donor-discovery/requests ────────────────────────────────────────

describe("POST /api/donor-discovery/requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBody = {
    name: "Q1 concrete contractors",
    taxonomy_ids: ["naics-238110"],
    geography: { center: { lat: 30, lng: -90 }, radius_mi: 25 },
  };

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthenticatedGate);

    const req = makeRequest("http://localhost/api/donor-discovery/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unauthenticated");
  });

  it("returns 403 for a viewer role (writer required)", async () => {
    mockRequireRole.mockResolvedValue(forbiddenGate);

    const req = makeRequest("http://localhost/api/donor-discovery/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("forbidden");
  });

  it("creates the request scoped to the caller's organization_id from the session, not the body", async () => {
    const chain = makeChain({ data: mockDdRequest, error: null });
    const supabase = { from: vi.fn(() => chain) };
    mockRequireRole.mockResolvedValue(grantedGate(supabase, "writer", ORG_ID));

    const req = makeRequest("http://localhost/api/donor-discovery/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Even if a caller tried to smuggle a different org in the body, the
      // route must ignore it — it isn't a recognized field.
      body: JSON.stringify({ ...validBody, organization_id: OTHER_ORG_ID }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const insertFn = chain.insert as ReturnType<typeof vi.fn>;
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: ORG_ID }),
    );
  });

  it("returns 400 when taxonomy_ids is missing/empty", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: null, error: null })) };
    mockRequireRole.mockResolvedValue(grantedGate(supabase, "writer"));

    const req = makeRequest("http://localhost/api/donor-discovery/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, taxonomy_ids: [] }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid geography shape", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: null, error: null })) };
    mockRequireRole.mockResolvedValue(grantedGate(supabase, "writer"));

    const req = makeRequest("http://localhost/api/donor-discovery/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, geography: { foo: "bar" } }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});

// ── GET /api/donor-discovery/requests ─────────────────────────────────────────

describe("GET /api/donor-discovery/requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthenticatedGate);

    const res = await listRequests();

    expect(res.status).toBe(401);
  });

  it("scopes the list query to the caller's organization_id", async () => {
    const requestsChain = makeChain({ data: [mockDdRequest], error: null });
    const linksChain = makeChain({ data: [], error: null });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "donor_discovery_requests") return requestsChain;
        if (table === "dd_prospect_requests") return linksChain;
        throw new Error(`unexpected table: ${table}`);
      }),
    };
    mockRequireRole.mockResolvedValue(grantedGate(supabase, "viewer", ORG_ID));

    const res = await listRequests();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { requests: unknown[] };
    expect(body.requests).toHaveLength(1);
    expect(requestsChain.eq).toHaveBeenCalledWith("organization_id", ORG_ID);
  });
});

// ── GET /api/donor-discovery/requests/[id] ────────────────────────────────────

describe("GET /api/donor-discovery/requests/[id]", () => {
  const routeContext = { params: { id: REQUEST_ID } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthenticatedGate);

    const req = makeRequest(`http://localhost/api/donor-discovery/requests/${REQUEST_ID}`);
    const res = await getRequestById(req, routeContext);

    expect(res.status).toBe(401);
  });

  it("returns the request detail with progress when it belongs to the caller's org", async () => {
    const requestChain = makeChain({ data: mockDdRequest, error: null });
    const linksChain = makeChain({ data: [], error: null });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "donor_discovery_requests") return requestChain;
        if (table === "dd_prospect_requests") return linksChain;
        throw new Error(`unexpected table: ${table}`);
      }),
    };
    mockRequireRole.mockResolvedValue(grantedGate(supabase, "viewer", ORG_ID));

    const req = makeRequest(`http://localhost/api/donor-discovery/requests/${REQUEST_ID}`);
    const res = await getRequestById(req, routeContext);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { request: { id: string }; progress: { prospect_count: number } };
    expect(body.request.id).toBe(REQUEST_ID);
    expect(body.progress.prospect_count).toBe(0);
    // The lookup must filter by the caller's org, not just the id.
    expect(requestChain.eq).toHaveBeenCalledWith("organization_id", ORG_ID);
  });

  it("returns 404 when the request belongs to a different organization (cross-org access)", async () => {
    // The route filters .eq("id", id).eq("organization_id", callerOrgId).single() —
    // a request that exists but belongs to another org never matches, so
    // Supabase reports it the same way as "not found".
    const requestChain = makeChain({
      data: null,
      error: { message: "JSON object requested, multiple (or no) rows returned" },
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "donor_discovery_requests") return requestChain;
        throw new Error(`unexpected table: ${table}`);
      }),
    };
    mockRequireRole.mockResolvedValue(grantedGate(supabase, "viewer", ORG_ID));

    const req = makeRequest(`http://localhost/api/donor-discovery/requests/${REQUEST_ID}`);
    const res = await getRequestById(req, routeContext);

    expect(res.status).toBe(404);
    expect(requestChain.eq).toHaveBeenCalledWith("organization_id", ORG_ID);
    // Never leaks the other org's row even though `id` alone would have matched.
    expect(requestChain.eq).not.toHaveBeenCalledWith("organization_id", OTHER_ORG_ID);
  });

  it("returns 404 when the request id does not exist at all", async () => {
    const requestChain = makeChain({ data: null, error: { message: "no rows" } });
    const supabase = { from: vi.fn(() => requestChain) };
    mockRequireRole.mockResolvedValue(grantedGate(supabase, "viewer", ORG_ID));

    const req = makeRequest("http://localhost/api/donor-discovery/requests/does-not-exist");
    const res = await getRequestById(req, { params: { id: "does-not-exist" } });

    expect(res.status).toBe(404);
  });
});
