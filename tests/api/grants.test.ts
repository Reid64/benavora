/**
 * Unit tests for the grants API routes.
 *
 * Routes covered:
 *   GET   /api/grants        (src/app/api/grants/route.ts)
 *   PATCH /api/grants/[id]   (src/app/api/grants/[id]/route.ts)
 *
 * "Grant" maps to the live `opportunities` table (see MEMORY: grants-api-maps-
 * to-opportunities). source_type in the API maps to the `category` column.
 *
 * Auth is handled by requireRole(), which is mocked so we can control the
 * returned RoleContext (or error response) per-test without a live Supabase.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ── module mocks (hoisted) ────────────────────────────────────────────────────

vi.mock("@/lib/audit/logger", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role-gate", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockAdminFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

// ── import route handlers AFTER mocks ────────────────────────────────────────

import { GET } from "@/app/api/grants/route";
import { GET as getById, PATCH } from "@/app/api/grants/[id]/route";

// ── mock builders ─────────────────────────────────────────────────────────────

/** Build a chainable query builder that resolves to `result` on `await`. */
function makeChain(result: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn((resolve: (v: { data: unknown; error: unknown; count?: number }) => unknown) =>
      Promise.resolve(resolve(result))
    ),
  };
  return chain;
}

const ORG_ID = "org-abc";
const GRANT_ID = "11111111-1111-1111-1111-111111111111";

/** A minimal serializable opportunity row (only fields tested here). */
const mockOpportunity = {
  id: GRANT_ID,
  organization_id: ORG_ID,
  funder_id: null,
  name: "Community Grant",
  category: "private_foundation",
  description: "Test grant",
  amount_available: 50000,
  amount_min: 10000,
  amount_max: 50000,
  deadline: "2026-12-31",
  url: null,
  eligibility_requirements: null,
  required_documents: null,
  application_method: "online",
  recurrence: null,
  geographic_restrictions: null,
  eligibility_score: 85,
  recommendation: "apply",
  recommendation_reasoning: "Good fit.",
  match_percentage: 85,
  is_high_priority: true,
  match_mismatch_reasons: null,
  status: "open",
  source: "foundation website",
  discovered_at: "2026-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

/** Successful viewer gate returning a mock supabase client. */
function grantedViewerGate(supabase: unknown) {
  return {
    supabase,
    userId: "user-1",
    userRole: "viewer" as const,
    organizationId: ORG_ID,
  };
}

/** Successful writer gate returning a mock supabase client. */
function grantedWriterGate(supabase: unknown) {
  return {
    supabase,
    userId: "user-1",
    userRole: "writer" as const,
    organizationId: ORG_ID,
  };
}

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

// ── GET /api/grants ───────────────────────────────────────────────────────────

describe("GET /api/grants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue({
      error: NextResponse.json(
        { error: "Authentication required.", code: "unauthenticated" },
        { status: 401 },
      ),
    });

    const req = makeRequest("http://localhost/api/grants");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("unauthenticated");
  });

  it("returns grants scoped to the org_id", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: [mockOpportunity], error: null, count: 1 })) };
    mockRequireRole.mockResolvedValue(grantedViewerGate(supabase));

    const req = makeRequest(`http://localhost/api/grants`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; total: number };
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
    // Confirm org-scoped .eq() was called on the query chain
    const chain = supabase.from.mock.results[0]?.value as Record<string, ReturnType<typeof vi.fn>>;
    expect(chain.eq).toHaveBeenCalledWith("organization_id", ORG_ID);
  });

  it("returns 400 for invalid source_type enum value", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: [], error: null, count: 0 })) };
    mockRequireRole.mockResolvedValue(grantedViewerGate(supabase));

    const req = makeRequest(
      "http://localhost/api/grants?source_type=not_a_real_category",
    );
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("INVALID_FILTER");
  });

  it("returns 400 for invalid eligibility_flag", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: [], error: null, count: 0 })) };
    mockRequireRole.mockResolvedValue(grantedViewerGate(supabase));

    const req = makeRequest(
      "http://localhost/api/grants?eligibility_flag=super_high",
    );
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("INVALID_FILTER");
  });

  it("applies source_type filter as category .in() query", async () => {
    const chain = makeChain({ data: [mockOpportunity], error: null, count: 1 });
    const supabase = { from: vi.fn(() => chain) };
    mockRequireRole.mockResolvedValue(grantedViewerGate(supabase));

    const req = makeRequest(
      "http://localhost/api/grants?source_type=private_foundation",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const inFn = chain.in as ReturnType<typeof vi.fn>;
    expect(inFn).toHaveBeenCalledWith("category", ["private_foundation"]);
  });

  it("respects page and limit query params", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: [], error: null, count: 0 })) };
    mockRequireRole.mockResolvedValue(grantedViewerGate(supabase));

    const req = makeRequest("http://localhost/api/grants?page=2&limit=10");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json() as { page: number; limit: number };
    expect(body.page).toBe(2);
    expect(body.limit).toBe(10);
  });

  it("caps limit at 100", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: [], error: null, count: 0 })) };
    mockRequireRole.mockResolvedValue(grantedViewerGate(supabase));

    const req = makeRequest("http://localhost/api/grants?limit=999");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json() as { limit: number };
    expect(body.limit).toBe(100);
  });

  it("returns empty data with zero total for an org with no grants", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: [], error: null, count: 0 })) };
    mockRequireRole.mockResolvedValue(grantedViewerGate(supabase));

    const req = makeRequest("http://localhost/api/grants");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; total: number };
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});

// ── PATCH /api/grants/[id] ────────────────────────────────────────────────────

describe("PATCH /api/grants/[id]", () => {
  const routeContext = { params: { id: GRANT_ID } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue({
      error: NextResponse.json(
        { error: "Authentication required.", code: "unauthenticated" },
        { status: 401 },
      ),
    });

    const req = makeRequest(`http://localhost/api/grants/${GRANT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    const res = await PATCH(req, routeContext);

    expect(res.status).toBe(401);
  });

  it("returns 403 for viewer role (writer required)", async () => {
    mockRequireRole.mockResolvedValue({
      error: NextResponse.json(
        {
          error: "You do not have permission to perform this action.",
          code: "forbidden",
        },
        { status: 403 },
      ),
    });

    const req = makeRequest(`http://localhost/api/grants/${GRANT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    const res = await PATCH(req, routeContext);

    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("forbidden");
  });

  it("returns 400 when no updatable fields are provided", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: null, error: null })) };
    mockRequireRole.mockResolvedValue(grantedWriterGate(supabase));
    // Ownership: admin client ownership check not needed since validation fires first
    mockAdminFrom.mockReturnValue(makeChain({ data: { organization_id: ORG_ID }, error: null }));

    const req = makeRequest(`http://localhost/api/grants/${GRANT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await PATCH(req, routeContext);

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid source_type enum", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: null, error: null })) };
    mockRequireRole.mockResolvedValue(grantedWriterGate(supabase));

    const req = makeRequest(`http://localhost/api/grants/${GRANT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type: "not_valid_category" }),
    });
    const res = await PATCH(req, routeContext);

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("INVALID_SOURCE_TYPE");
  });

  it("returns 400 for invalid status enum", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: null, error: null })) };
    mockRequireRole.mockResolvedValue(grantedWriterGate(supabase));

    const req = makeRequest(`http://localhost/api/grants/${GRANT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "maybe" }),
    });
    const res = await PATCH(req, routeContext);

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a non-uuid grant id", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: null, error: null })) };
    mockRequireRole.mockResolvedValue(grantedWriterGate(supabase));

    const req = makeRequest("http://localhost/api/grants/not-a-uuid", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    const res = await PATCH(req, { params: { id: "not-a-uuid" } });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });

  it("updates grant fields and returns the updated grant", async () => {
    const updatedRow = {
      ...mockOpportunity,
      status: "closed",
      updated_at: "2026-06-21T12:00:00.000Z",
    };
    // Session client chain (used for the actual .update() call)
    const updateChain = makeChain({ data: updatedRow, error: null });
    const supabase = { from: vi.fn(() => updateChain) };
    mockRequireRole.mockResolvedValue(grantedWriterGate(supabase));

    // Admin client chain (used by resolveGrantOwnership)
    mockAdminFrom.mockReturnValue(
      makeChain({ data: { organization_id: ORG_ID }, error: null }),
    );

    const req = makeRequest(`http://localhost/api/grants/${GRANT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    const res = await PATCH(req, routeContext);

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe("closed");
  });
});

// ── GET /api/grants/[id] ──────────────────────────────────────────────────────

describe("GET /api/grants/[id]", () => {
  const routeContext = { params: { id: GRANT_ID } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue({
      error: NextResponse.json(
        { error: "Authentication required.", code: "unauthenticated" },
        { status: 401 },
      ),
    });

    const req = makeRequest(`http://localhost/api/grants/${GRANT_ID}`);
    const res = await getById(req, routeContext);

    expect(res.status).toBe(401);
  });

  it("returns the grant when found in the org", async () => {
    const chain = makeChain({ data: mockOpportunity, error: null });
    const supabase = { from: vi.fn(() => chain) };
    mockRequireRole.mockResolvedValue(grantedViewerGate(supabase));

    const req = makeRequest(`http://localhost/api/grants/${GRANT_ID}`);
    const res = await getById(req, routeContext);

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe(GRANT_ID);
  });

  it("returns 404 for a non-uuid id", async () => {
    const supabase = { from: vi.fn(() => makeChain({ data: null, error: null })) };
    mockRequireRole.mockResolvedValue(grantedViewerGate(supabase));

    const req = makeRequest("http://localhost/api/grants/bad-id");
    const res = await getById(req, { params: { id: "bad-id" } });

    expect(res.status).toBe(404);
  });
});
