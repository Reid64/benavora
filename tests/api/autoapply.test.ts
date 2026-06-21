/**
 * Unit tests for autoapply API routes.
 *
 * Routes covered:
 *   POST   /api/autoapply/queue     (src/app/api/autoapply/queue/route.ts)
 *   GET    /api/autoapply/controls  (src/app/api/autoapply/controls/route.ts)
 *   POST   /api/autoapply/controls  (src/app/api/autoapply/controls/route.ts)
 *   DELETE /api/autoapply/controls  (src/app/api/autoapply/controls/route.ts)
 *
 * The queue route uses gate.supabase (from requireRole) for all DB calls,
 * and resolveTier() to enforce per-tier batch caps.
 *
 * The controls route uses QueueControlPlane (module-level singleton) for
 * pause/resume operations. auth role is determined by control_type.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ── module mocks (hoisted before imports) ─────────────────────────────────────

// vi.hoisted ensures these refs are available inside vi.mock factory closures,
// which are hoisted to the top of the module before any const declarations.
const {
  mockRequireRole,
  mockResolveTier,
  mockGetStatus,
  mockPausePlatform,
  mockPauseTenant,
  mockPauseFunder,
  mockPauseDomain,
  mockResumePlatform,
  mockResumeTenant,
  mockResumeFunder,
  mockResumeDomain,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockResolveTier: vi.fn().mockResolvedValue("professional"),
  mockGetStatus: vi.fn().mockResolvedValue([]),
  mockPausePlatform: vi.fn().mockResolvedValue(undefined),
  mockPauseTenant: vi.fn().mockResolvedValue(undefined),
  mockPauseFunder: vi.fn().mockResolvedValue(undefined),
  mockPauseDomain: vi.fn().mockResolvedValue(undefined),
  mockResumePlatform: vi.fn().mockResolvedValue(undefined),
  mockResumeTenant: vi.fn().mockResolvedValue(undefined),
  mockResumeFunder: vi.fn().mockResolvedValue(undefined),
  mockResumeDomain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/role-gate", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

vi.mock("@/lib/billing/usage-tracker", () => ({
  resolveTier: (...args: unknown[]) => mockResolveTier(...args),
}));

vi.mock("@/lib/autoapply/queue-controls", () => ({
  QueueControlPlane: vi.fn().mockImplementation(() => ({
    getStatus: mockGetStatus,
    pausePlatform: mockPausePlatform,
    pauseTenant: mockPauseTenant,
    pauseFunder: mockPauseFunder,
    pauseDomain: mockPauseDomain,
    resumePlatform: mockResumePlatform,
    resumeTenant: mockResumeTenant,
    resumeFunder: mockResumeFunder,
    resumeDomain: mockResumeDomain,
  })),
}));

// ── import route handlers AFTER mocks ─────────────────────────────────────────

import { POST as queuePost } from "@/app/api/autoapply/queue/route";
import {
  GET as controlsGet,
  POST as controlsPost,
  DELETE as controlsDelete,
} from "@/app/api/autoapply/controls/route";

// ── constants & helpers ───────────────────────────────────────────────────────

const ORG_ID = "org-autoapply-test";
const USER_ID = "user-autoapply-test";

function unauthError() {
  return {
    error: NextResponse.json(
      { error: "Authentication required.", code: "unauthenticated" },
      { status: 401 },
    ),
  };
}

function forbiddenError() {
  return {
    error: NextResponse.json(
      { error: "You do not have permission to perform this action.", code: "forbidden" },
      { status: 403 },
    ),
  };
}

/**
 * Build a mock Supabase client for the queue route. All calls go through
 * the submission_queue table. existingItems controls what "already queued"
 * lookup returns; insertError lets individual tests simulate a DB failure.
 */
function makeQueueSupabase({
  existingItems = [] as unknown[],
  insertError = null as unknown,
} = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: null, error: insertError }),
    then: (
      resolve: (v: unknown) => unknown,
      _reject?: (e: unknown) => unknown,
    ) => Promise.resolve(resolve({ data: existingItems, error: null })),
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

function makeQueueGate(supabase: ReturnType<typeof makeQueueSupabase>) {
  return {
    supabase,
    userId: USER_ID,
    userRole: "writer" as const,
    organizationId: ORG_ID,
  };
}

function makeControlsGate(role: "owner" | "admin" = "owner") {
  return {
    supabase: {},
    userId: USER_ID,
    userRole: role,
    organizationId: ORG_ID,
  };
}

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonDelete(url: string, body: unknown): Request {
  return new Request(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── POST /api/autoapply/queue ─────────────────────────────────────────────────

describe("POST /api/autoapply/queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTier.mockResolvedValue("professional"); // cap=50
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthError());
    const res = await queuePost(
      jsonPost("http://localhost/api/autoapply/queue", { funder_ids: ["f1"] }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when funder_ids is absent", async () => {
    const supabase = makeQueueSupabase();
    mockRequireRole.mockResolvedValue(makeQueueGate(supabase));
    const res = await queuePost(
      jsonPost("http://localhost/api/autoapply/queue", {}),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when funder_ids is an empty array", async () => {
    const supabase = makeQueueSupabase();
    mockRequireRole.mockResolvedValue(makeQueueGate(supabase));
    const res = await queuePost(
      jsonPost("http://localhost/api/autoapply/queue", { funder_ids: [] }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 422 when batch size exceeds the tier cap (free tier: cap=5)", async () => {
    const supabase = makeQueueSupabase();
    mockRequireRole.mockResolvedValue(makeQueueGate(supabase));
    mockResolveTier.mockResolvedValue("free"); // cap=5
    const ids = ["f1", "f2", "f3", "f4", "f5", "f6"];
    const res = await queuePost(
      jsonPost("http://localhost/api/autoapply/queue", { funder_ids: ids }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; cap: number; requested: number };
    expect(body.code).toBe("batch_cap_exceeded");
    expect(body.cap).toBe(5);
    expect(body.requested).toBe(6);
  });

  it("queues new funders and returns queued count", async () => {
    const supabase = makeQueueSupabase({ existingItems: [] });
    mockRequireRole.mockResolvedValue(makeQueueGate(supabase));
    const res = await queuePost(
      jsonPost("http://localhost/api/autoapply/queue", {
        funder_ids: ["f1", "f2", "f3"],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number; skipped: number };
    expect(body.queued).toBe(3);
    expect(body.skipped).toBe(0);
  });

  it("skips funders that are already pending or processing", async () => {
    const supabase = makeQueueSupabase({
      existingItems: [{ funder_id: "f1" }, { funder_id: "f2" }],
    });
    mockRequireRole.mockResolvedValue(makeQueueGate(supabase));
    const res = await queuePost(
      jsonPost("http://localhost/api/autoapply/queue", {
        funder_ids: ["f1", "f2", "f3"],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number; skipped: number };
    expect(body.queued).toBe(1);
    expect(body.skipped).toBe(2);
  });

  it("consultant tier has no batch cap (null)", async () => {
    const supabase = makeQueueSupabase({ existingItems: [] });
    mockRequireRole.mockResolvedValue(makeQueueGate(supabase));
    mockResolveTier.mockResolvedValue("consultant");
    // 10 funders — well above any cap, but consultant is unlimited
    const ids = Array.from({ length: 10 }, (_, i) => `f${i}`);
    const res = await queuePost(
      jsonPost("http://localhost/api/autoapply/queue", { funder_ids: ids }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number };
    expect(body.queued).toBe(10);
  });
});

// ── GET /api/autoapply/controls ───────────────────────────────────────────────

describe("GET /api/autoapply/controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthError());
    const res = await controlsGet();
    expect(res.status).toBe(401);
  });

  it("returns 200 with controls list", async () => {
    mockRequireRole.mockResolvedValue(makeControlsGate());
    mockGetStatus.mockResolvedValue([{ control_type: "tenant", paused: true }]);
    const res = await controlsGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { controls: unknown[] };
    expect(Array.isArray(body.controls)).toBe(true);
    expect(body.controls).toHaveLength(1);
  });
});

// ── POST /api/autoapply/controls ──────────────────────────────────────────────

describe("POST /api/autoapply/controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when control_type is absent", async () => {
    // Body parsing and validation happen before requireRole — no auth needed.
    const res = await controlsPost(
      jsonPost("http://localhost/api/autoapply/controls", { reason: "test" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when reason is absent", async () => {
    const res = await controlsPost(
      jsonPost("http://localhost/api/autoapply/controls", { control_type: "tenant" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated (owner-level tenant control)", async () => {
    mockRequireRole.mockResolvedValue(unauthError());
    const res = await controlsPost(
      jsonPost("http://localhost/api/autoapply/controls", {
        control_type: "tenant",
        target_id: ORG_ID,
        reason: "testing",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller lacks admin role for platform control", async () => {
    mockRequireRole.mockResolvedValue(forbiddenError());
    const res = await controlsPost(
      jsonPost("http://localhost/api/autoapply/controls", {
        control_type: "platform",
        reason: "maintenance",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when control_type is unknown", async () => {
    mockRequireRole.mockResolvedValue(makeControlsGate());
    const res = await controlsPost(
      jsonPost("http://localhost/api/autoapply/controls", {
        control_type: "not_a_type",
        reason: "test",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when tenant control is missing target_id", async () => {
    mockRequireRole.mockResolvedValue(makeControlsGate());
    const res = await controlsPost(
      jsonPost("http://localhost/api/autoapply/controls", {
        control_type: "tenant",
        reason: "test",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("pauses a tenant queue and returns ok=true", async () => {
    mockRequireRole.mockResolvedValue(makeControlsGate());
    const res = await controlsPost(
      jsonPost("http://localhost/api/autoapply/controls", {
        control_type: "tenant",
        target_id: ORG_ID,
        reason: "rate limit hit",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; control_type: string };
    expect(body.ok).toBe(true);
    expect(body.control_type).toBe("tenant");
    expect(mockPauseTenant).toHaveBeenCalledWith(ORG_ID, "rate limit hit", USER_ID, expect.anything());
  });

  it("pauses a funder and returns ok=true", async () => {
    mockRequireRole.mockResolvedValue(makeControlsGate());
    const res = await controlsPost(
      jsonPost("http://localhost/api/autoapply/controls", {
        control_type: "funder",
        target_id: "funder-123",
        reason: "portal changed",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockPauseFunder).toHaveBeenCalled();
  });
});

// ── DELETE /api/autoapply/controls ────────────────────────────────────────────

describe("DELETE /api/autoapply/controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when control_type is absent", async () => {
    const res = await controlsDelete(
      jsonDelete("http://localhost/api/autoapply/controls", {}),
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthError());
    const res = await controlsDelete(
      jsonDelete("http://localhost/api/autoapply/controls", {
        control_type: "tenant",
        target_id: ORG_ID,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("resumes a tenant queue and returns ok=true", async () => {
    mockRequireRole.mockResolvedValue(makeControlsGate());
    const res = await controlsDelete(
      jsonDelete("http://localhost/api/autoapply/controls", {
        control_type: "tenant",
        target_id: ORG_ID,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(mockResumeTenant).toHaveBeenCalledWith(ORG_ID, expect.anything());
  });

  it("resumes the platform queue and returns ok=true", async () => {
    mockRequireRole.mockResolvedValue(makeControlsGate("admin"));
    const res = await controlsDelete(
      jsonDelete("http://localhost/api/autoapply/controls", {
        control_type: "platform",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockResumePlatform).toHaveBeenCalled();
  });
});
