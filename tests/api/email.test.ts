/**
 * Unit tests for email API routes.
 *
 * Routes covered:
 *   GET  /api/email/auth   (src/app/api/email/auth/route.ts)
 *   POST /api/email/sync   (src/app/api/email/sync/route.ts)
 *   POST /api/email/link   (src/app/api/email/link/route.ts)
 *   POST /api/email/send   (src/app/api/email/send/route.ts)
 *
 * All routes use requireRole() as the auth gate. Admin client is used for
 * DB lookups in sync, link, and send. The GmailAuthManager, GmailSyncEngine,
 * ThreadLinker, and emailSender are all stubbed out.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ── module mocks (hoisted before imports) ─────────────────────────────────────

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role-gate", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockGenerateAuthUrl = vi
  .fn()
  .mockReturnValue("https://accounts.google.com/o/oauth2/auth?state=mock");
vi.mock("@/lib/email/gmail-auth", () => ({
  GmailAuthManager: vi.fn().mockImplementation(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
  })),
}));

const mockSyncThreads = vi.fn().mockResolvedValue({ synced: 5, threads: [] });
const mockIncrementalSync = vi.fn().mockResolvedValue({ synced: 2, threads: [] });
vi.mock("@/lib/email/gmail-sync", () => ({
  GmailSyncEngine: vi.fn().mockImplementation(() => ({
    syncThreads: mockSyncThreads,
    incrementalSync: mockIncrementalSync,
  })),
}));

const mockBulkAutoLink = vi.fn().mockResolvedValue({ linked: 3, skipped: 0 });
vi.mock("@/lib/email/thread-linker", () => ({
  ThreadLinker: vi.fn().mockImplementation(() => ({
    bulkAutoLink: mockBulkAutoLink,
  })),
}));

const mockEmailSend = vi
  .fn()
  .mockResolvedValue({ success: true, messageId: "msg-1" });
vi.mock("@/lib/email/sender", () => ({
  emailSender: { send: (...args: unknown[]) => mockEmailSend(...args) },
}));

const mockAdminFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

// ── import route handlers AFTER mocks ─────────────────────────────────────────

import { GET as emailAuthGet } from "@/app/api/email/auth/route";
import { POST as emailSyncPost } from "@/app/api/email/sync/route";
import { POST as emailLinkPost } from "@/app/api/email/link/route";
import { POST as emailSendPost } from "@/app/api/email/send/route";

// ── constants & helpers ───────────────────────────────────────────────────────

const ORG_ID = "org-email-test";
const USER_ID = "user-email-test";

function makeGate(role: "viewer" | "writer" = "viewer") {
  return { supabase: {}, userId: USER_ID, userRole: role, organizationId: ORG_ID };
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
 * Chainable Supabase query stub. Thenable so `await chain.select()...eq()`
 * resolves to `result`. Terminal methods (.single, .maybeSingle, .insert)
 * return proper Promises independently.
 */
function makeChain(result: { data: unknown; error: unknown; count?: number | null }) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockResolvedValue(result),
    then: (
      resolve: (v: unknown) => unknown,
      _reject?: (e: unknown) => unknown,
    ) => Promise.resolve(resolve(result)),
  };
  return chain;
}

// ── GET /api/email/auth ───────────────────────────────────────────────────────

describe("GET /api/email/auth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthError());
    const req = new Request(
      "http://localhost/api/email/auth?redirect_uri=http://localhost/cb",
    );
    const res = await emailAuthGet(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when redirect_uri query param is absent", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    const req = new Request("http://localhost/api/email/auth");
    const res = await emailAuthGet(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_redirect_uri");
  });

  it("returns OAuth URL when authenticated with a redirect_uri", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    const req = new Request(
      "http://localhost/api/email/auth?redirect_uri=http://localhost/cb",
    );
    const res = await emailAuthGet(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(typeof body.url).toBe("string");
    expect(body.url.length).toBeGreaterThan(0);
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      ORG_ID,
      USER_ID,
      "http://localhost/cb",
    );
  });
});

// ── POST /api/email/sync ──────────────────────────────────────────────────────

describe("POST /api/email/sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthError());
    const req = new Request("http://localhost/api/email/sync", {
      method: "POST",
      body: "{}",
    });
    const res = await emailSyncPost(req);
    expect(res.status).toBe(401);
  });

  it("returns 404 when no active email connection exists", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    mockAdminFrom.mockReturnValue(makeChain({ data: null, error: null }));
    const req = new Request("http://localhost/api/email/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await emailSyncPost(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("no_connection");
  });

  it("runs full sync when connection has no cursor", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    mockAdminFrom.mockReturnValue(
      makeChain({ data: { id: "conn-1", sync_cursor: null }, error: null }),
    );
    const req = new Request("http://localhost/api/email/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await emailSyncPost(req);
    expect(res.status).toBe(200);
    expect(mockSyncThreads).toHaveBeenCalled();
    expect(mockIncrementalSync).not.toHaveBeenCalled();
  });

  it("runs incremental sync when a cursor is present", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    mockAdminFrom.mockReturnValue(
      makeChain({ data: { id: "conn-1", sync_cursor: "cursor-abc" }, error: null }),
    );
    const req = new Request("http://localhost/api/email/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await emailSyncPost(req);
    expect(res.status).toBe(200);
    expect(mockIncrementalSync).toHaveBeenCalled();
    expect(mockSyncThreads).not.toHaveBeenCalled();
  });

  it("forces full sync when full_sync=true even if cursor exists", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    mockAdminFrom.mockReturnValue(
      makeChain({ data: { id: "conn-1", sync_cursor: "cursor-abc" }, error: null }),
    );
    const req = new Request("http://localhost/api/email/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_sync: true }),
    });
    const res = await emailSyncPost(req);
    expect(res.status).toBe(200);
    expect(mockSyncThreads).toHaveBeenCalled();
    expect(mockIncrementalSync).not.toHaveBeenCalled();
  });
});

// ── POST /api/email/link ──────────────────────────────────────────────────────

describe("POST /api/email/link", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthError());
    const req = new Request("http://localhost/api/email/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: "t1", funder_id: "f1" }),
    });
    const res = await emailLinkPost(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when thread_id is missing", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    const req = new Request("http://localhost/api/email/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ funder_id: "f1" }),
    });
    const res = await emailLinkPost(req);
    expect(res.status).toBe(400);
  });

  it("runs bulk auto-link when thread_id=auto", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    const req = new Request("http://localhost/api/email/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: "auto" }),
    });
    const res = await emailLinkPost(req);
    expect(res.status).toBe(200);
    expect(mockBulkAutoLink).toHaveBeenCalledWith(ORG_ID);
  });

  it("links thread to funder manually and returns linked=true with method=manual", async () => {
    mockRequireRole.mockResolvedValue(makeGate());
    // One shared chain handles both the delete and insert calls on email_thread_links.
    mockAdminFrom.mockReturnValue(makeChain({ data: null, error: null }));
    const req = new Request("http://localhost/api/email/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: "thread-1", funder_id: "funder-1" }),
    });
    const res = await emailLinkPost(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { linked: boolean; method: string };
    expect(body.linked).toBe(true);
    expect(body.method).toBe("manual");
  });
});

// ── POST /api/email/send ──────────────────────────────────────────────────────

describe("POST /api/email/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: count=0 (well under the 20/minute limit).
    mockAdminFrom.mockReturnValue(makeChain({ data: [], error: null, count: 0 }));
    mockEmailSend.mockResolvedValue({ success: true, messageId: "msg-1" });
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue(unauthError());
    const req = new Request("http://localhost/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ["a@b.com"], subject: "Hi", body: "Hello" }),
    });
    const res = await emailSendPost(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when to array is absent", async () => {
    mockRequireRole.mockResolvedValue(makeGate("writer"));
    const req = new Request("http://localhost/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Hi", body: "Hello" }),
    });
    const res = await emailSendPost(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_input");
  });

  it("returns 400 when subject is absent", async () => {
    mockRequireRole.mockResolvedValue(makeGate("writer"));
    const req = new Request("http://localhost/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ["a@b.com"], body: "Hello" }),
    });
    const res = await emailSendPost(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is absent", async () => {
    mockRequireRole.mockResolvedValue(makeGate("writer"));
    const req = new Request("http://localhost/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ["a@b.com"], subject: "Hi" }),
    });
    const res = await emailSendPost(req);
    expect(res.status).toBe(400);
  });

  it("returns 429 when the 20-sends-per-minute rate limit is reached", async () => {
    mockRequireRole.mockResolvedValue(makeGate("writer"));
    // count=20 hits the >= threshold in the route.
    mockAdminFrom.mockReturnValue(makeChain({ data: [], error: null, count: 20 }));
    const req = new Request("http://localhost/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ["a@b.com"], subject: "Hi", body: "Hello" }),
    });
    const res = await emailSendPost(req);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("rate_limited");
  });

  it("returns 200 with success=true when email sends successfully", async () => {
    mockRequireRole.mockResolvedValue(makeGate("writer"));
    const req = new Request("http://localhost/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["a@b.com"],
        subject: "Grant Update",
        body: "Hello there",
      }),
    });
    const res = await emailSendPost(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(mockEmailSend).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ to: ["a@b.com"], subject: "Grant Update" }),
    );
  });
});
