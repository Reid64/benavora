/**
 * Unit tests for auth API routes.
 *
 * Routes covered:
 *   GET  /api/auth/callback   (src/app/api/auth/callback/route.ts)
 *   POST /api/auth/log-event  (src/app/api/auth/log-event/route.ts)
 *
 * Both routes use createClient() from @/lib/supabase/server directly (no
 * requireRole wrapper), so we mock that module to control per-test behaviour.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── module mocks (hoisted before imports) ────────────────────────────────────

vi.mock("@/lib/audit/logger", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// Capture a ref so individual tests can reconfigure it.
const mockGetUser = vi.fn();
const mockExchangeCode = vi.fn();
const mockRegisterOrg = vi.fn();
const mockProfileSingle = vi.fn();
const mockProfileUpdate = vi.fn();

function buildMockClient() {
  const profileUpdateChain = {
    eq: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (v: { data: null; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: null, error: null }))
    ),
  };
  mockProfileUpdate.mockReturnValue(profileUpdateChain);

  const profileChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: mockProfileSingle,
  };

  return {
    auth: {
      getUser: mockGetUser,
      exchangeCodeForSession: mockExchangeCode,
    },
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          ...profileChain,
          update: mockProfileUpdate,
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    }),
    rpc: mockRegisterOrg,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => buildMockClient()),
}));

// ── import route handlers AFTER mocks ────────────────────────────────────────

import { GET as callbackGet } from "@/app/api/auth/callback/route";
import { POST as logEventPost } from "@/app/api/auth/log-event/route";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

// ── GET /api/auth/callback ────────────────────────────────────────────────────

describe("GET /api/auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when no code query param", async () => {
    const req = makeRequest("http://localhost/api/auth/callback");
    const res = await callbackGet(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/login/);
  });

  it("redirects to /login when code exchange fails", async () => {
    mockExchangeCode.mockResolvedValue({
      data: {},
      error: { message: "Invalid code" },
    });

    const req = makeRequest(
      "http://localhost/api/auth/callback?code=bad-code",
    );
    const res = await callbackGet(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/login/);
  });

  it("redirects to /login when register_organization RPC fails", async () => {
    mockExchangeCode.mockResolvedValue({ data: {}, error: null });
    mockRegisterOrg.mockResolvedValue({
      data: null,
      error: { message: "RPC failed" },
    });

    const req = makeRequest(
      "http://localhost/api/auth/callback?code=valid-code",
    );
    const res = await callbackGet(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/login/);
  });

  it("redirects to /dashboard on successful code exchange and RPC", async () => {
    mockExchangeCode.mockResolvedValue({ data: {}, error: null });
    mockRegisterOrg.mockResolvedValue({ data: null, error: null });

    const req = makeRequest(
      "http://localhost/api/auth/callback?code=valid-code",
    );
    const res = await callbackGet(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/dashboard/);
  });
});

// ── POST /api/auth/log-event ──────────────────────────────────────────────────

describe("POST /api/auth/log-event", () => {
  const PROFILE = {
    id: "user-1",
    organization_id: "org-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated user with a valid profile.
    mockGetUser.mockResolvedValue({
      data: { user: { id: PROFILE.id } },
      error: null,
    });
    mockProfileSingle.mockResolvedValue({ data: PROFILE, error: null });
  });

  it("returns 401 when no authenticated session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const req = makeRequest("http://localhost/api/auth/log-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "login" }),
    });
    const res = await logEventPost(req);

    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("unauthenticated");
  });

  it("returns 400 for invalid event value", async () => {
    const req = makeRequest("http://localhost/api/auth/log-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "signup" }),
    });
    const res = await logEventPost(req);

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("invalid_input");
  });

  it("returns 400 for malformed JSON body", async () => {
    const req = makeRequest("http://localhost/api/auth/log-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await logEventPost(req);

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("invalid_body");
  });

  it("returns 403 when profile cannot be resolved", async () => {
    mockProfileSingle.mockResolvedValue({
      data: null,
      error: { message: "No rows" },
    });

    const req = makeRequest("http://localhost/api/auth/log-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "login" }),
    });
    const res = await logEventPost(req);

    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("no_profile");
  });

  it("returns 204 for a valid login event", async () => {
    const req = makeRequest("http://localhost/api/auth/log-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "login" }),
    });
    const res = await logEventPost(req);

    expect(res.status).toBe(204);
  });

  it("returns 204 for a valid logout event", async () => {
    const req = makeRequest("http://localhost/api/auth/log-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "logout" }),
    });
    const res = await logEventPost(req);

    expect(res.status).toBe(204);
  });
});
