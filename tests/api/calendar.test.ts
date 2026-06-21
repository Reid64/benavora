/**
 * Unit tests for the calendar sync API route.
 *
 * Route covered:
 *   POST /api/calendar/sync  (src/app/api/calendar/sync/route.ts)
 *
 * The route looks up an active calendar_connections row via the admin client,
 * then delegates to GCalSyncEngine.syncDeadlinesOut(). Both are stubbed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ── module mocks (hoisted before imports) ─────────────────────────────────────

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role-gate", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockSyncDeadlinesOut = vi
  .fn()
  .mockResolvedValue({ synced: 3, created: 2, updated: 1 });
vi.mock("@/lib/calendar/gcal-sync", () => ({
  GCalSyncEngine: vi.fn().mockImplementation(() => ({
    syncDeadlinesOut: mockSyncDeadlinesOut,
  })),
}));

const mockAdminFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

// ── import route handler AFTER mocks ─────────────────────────────────────────

import { POST } from "@/app/api/calendar/sync/route";

// ── constants & helpers ───────────────────────────────────────────────────────

const ORG_ID = "org-calendar-test";
const USER_ID = "user-calendar-test";

function makeGate() {
  return { supabase: {}, userId: USER_ID, userRole: "viewer" as const, organizationId: ORG_ID };
}

function unauthError() {
  return {
    error: NextResponse.json(
      { error: "Authentication required.", code: "unauthenticated" },
      { status: 401 },
    ),
  };
}

/**
 * Thenable Supabase query chain. `maybeSingle()` is the terminal method used
 * by the calendar/sync route to look up the connection row.
 */
function makeChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (
      resolve: (v: unknown) => unknown,
      _reject?: (e: unknown) => unknown,
    ) => Promise.resolve(resolve(result)),
  };
}

// ── POST /api/calendar/sync ───────────────────────────────────────────────────

describe("POST /api/calendar/sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthError());
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("returns 404 when no active calendar connection exists", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    mockAdminFrom.mockReturnValue(makeChain({ data: null, error: null }));
    const res = await POST();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("no_connection");
  });

  it("returns 500 when the calendar_connections lookup returns a DB error", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    mockAdminFrom.mockReturnValue(
      makeChain({ data: null, error: { message: "connection failed" } }),
    );
    const res = await POST();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("db_error");
  });

  it("calls GCalSyncEngine.syncDeadlinesOut and returns 200 on success", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    mockAdminFrom.mockReturnValue(
      makeChain({ data: { id: "cal-conn-1" }, error: null }),
    );
    const res = await POST();
    expect(res.status).toBe(200);
    expect(mockSyncDeadlinesOut).toHaveBeenCalledWith(ORG_ID, "cal-conn-1");
    const body = (await res.json()) as { synced: number };
    expect(body.synced).toBe(3);
  });
});
