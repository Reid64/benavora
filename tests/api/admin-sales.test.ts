/**
 * Unit tests for admin sales API routes and engine behaviors.
 *
 * Routes covered:
 *   POST   /api/admin/domains     (src/app/api/admin/domains/route.ts)
 *   POST   /api/admin/prospects   (src/app/api/admin/prospects/route.ts)
 *   POST   /api/admin/campaigns   (src/app/api/admin/campaigns/route.ts)
 *
 * Engine behaviors covered (via vi.importActual):
 *   SalesCampaignEngine.processQueuedSends — suppression list check
 *   SalesCampaignEngine.processQueuedSends — daily domain budget enforcement
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

vi.mock("server-only", () => ({}));

const {
  mockRequireAdmin,
  mockAddDomain,
  mockImportFromCsv,
  mockCreateCampaign,
  mockGetDailyBudget,
  mockAdminFrom,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockAddDomain: vi.fn(),
  mockImportFromCsv: vi.fn(),
  mockCreateCampaign: vi.fn(),
  mockGetDailyBudget: vi.fn(),
  mockAdminFrom: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

vi.mock("@/lib/admin/domain-manager", () => ({
  DomainManager: vi.fn().mockImplementation(() => ({
    addDomain: mockAddDomain,
  })),
}));

vi.mock("@/lib/admin/prospect-manager", () => ({
  ProspectManager: vi.fn().mockImplementation(() => ({
    importFromCsv: mockImportFromCsv,
  })),
}));

// Mocked for route-level tests. Engine unit tests bypass this via vi.importActual.
vi.mock("@/lib/admin/sales-campaign-engine", () => ({
  SalesCampaignEngine: vi.fn().mockImplementation(() => ({
    createCampaign: mockCreateCampaign,
    scheduleSends: vi.fn(),
  })),
}));

// Shared supabase mock — engine tests override mockAdminFrom per test.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({ from: mockAdminFrom }),
}));

vi.mock("@/lib/admin/warmup-engine", () => ({
  WarmupEngine: vi.fn().mockImplementation(() => ({
    getDailyBudget: mockGetDailyBudget,
  })),
}));

vi.mock("@/lib/admin/compliance", () => ({
  EmailComplianceEngine: vi.fn().mockImplementation(() => ({
    enforceCompliance: vi.fn().mockReturnValue({ compliant: true, violations: [] }),
  })),
}));

vi.mock("@/lib/email/encryption", () => ({
  decryptToken: vi.fn().mockReturnValue("re_test_key"),
}));

// ── Import route handlers AFTER mocks ─────────────────────────────────────────

import { POST as domainsPost } from "@/app/api/admin/domains/route";
import { POST as prospectsPost } from "@/app/api/admin/prospects/route";
import { POST as campaignsPost } from "@/app/api/admin/campaigns/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_CONTEXT = { userId: "admin-user-id" };

function adminForbidden() {
  return new Response(
    JSON.stringify({ error: "Platform admin access required.", code: "not_platform_admin" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formPost(url: string, form: FormData): Request {
  return new Request(url, { method: "POST", body: form });
}

// Build a thenable Supabase chain. Every method returns the chain itself so
// calls can be chained arbitrarily. `await chain` resolves with { data, error }.
function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {
    then: (
      resolve: (v: unknown) => unknown,
      _reject?: (e: unknown) => unknown,
    ) => Promise.resolve(resolve({ data, error })),
  };
  for (const m of [
    "select", "eq", "not", "neq", "lte", "gte", "or", "in", "order",
    "range", "limit", "update", "insert", "single",
  ]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // single() also needs to return a resolved promise so `await chain.single()` works.
  chain["single"] = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

// ── Non-admin 403 tests ───────────────────────────────────────────────────────

describe("admin routes: non-admin access returns 403", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockRejectedValue(adminForbidden());
  });

  it("POST /api/admin/domains returns 403", async () => {
    const res = await domainsPost(
      jsonPost("http://localhost/api/admin/domains", {
        domain: "mail.example.com",
        api_key: "re_key",
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_platform_admin");
  });

  it("POST /api/admin/prospects returns 403", async () => {
    const form = new FormData();
    form.append("file", new File(["org_name\nAcme"], "test.csv", { type: "text/csv" }));
    form.append("list_name", "List");
    const res = await prospectsPost(formPost("http://localhost/api/admin/prospects", form));
    expect(res.status).toBe(403);
  });

  it("POST /api/admin/campaigns returns 403", async () => {
    const res = await campaignsPost(
      jsonPost("http://localhost/api/admin/campaigns", {
        name: "Camp",
        list_id: "list-1",
        sending_domain_ids: [],
        daily_send_target: 10,
        send_window_start: 8,
        send_window_end: 17,
        send_timezone: "America/Chicago",
        steps: [],
      }),
    );
    expect(res.status).toBe(403);
  });
});

// ── POST /api/admin/domains ───────────────────────────────────────────────────

describe("POST /api/admin/domains", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(ADMIN_CONTEXT);
  });

  it("returns 400 when domain is missing", async () => {
    const res = await domainsPost(
      jsonPost("http://localhost/api/admin/domains", { api_key: "re_key" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_fields");
  });

  it("returns 400 when api_key is missing", async () => {
    const res = await domainsPost(
      jsonPost("http://localhost/api/admin/domains", { domain: "mail.example.com" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_fields");
  });

  it("creates domain via DomainManager and returns 201", async () => {
    const domainRecord = {
      id: "dom-1",
      domain: "mail.example.com",
      is_active: true,
      created_at: "2026-06-21T00:00:00Z",
    };
    mockAddDomain.mockResolvedValue(domainRecord);

    const res = await domainsPost(
      jsonPost("http://localhost/api/admin/domains", {
        domain: "mail.example.com",
        api_key: "re_live_key",
        provider: "resend",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { domain: typeof domainRecord };
    expect(body.domain.domain).toBe("mail.example.com");
    expect(mockAddDomain).toHaveBeenCalledWith("mail.example.com", "re_live_key", "resend");
  });

  it("returns 500 when DomainManager throws", async () => {
    mockAddDomain.mockRejectedValue(new Error("DNS conflict detected"));
    const res = await domainsPost(
      jsonPost("http://localhost/api/admin/domains", {
        domain: "bad.example.com",
        api_key: "re_key",
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("add_failed");
    expect(body.error).toContain("DNS conflict");
  });
});

// ── POST /api/admin/prospects (CSV import) ────────────────────────────────────

describe("POST /api/admin/prospects (CSV import)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(ADMIN_CONTEXT);
  });

  it("returns 400 when no file is attached", async () => {
    const form = new FormData();
    form.append("list_name", "My List");
    const res = await prospectsPost(formPost("http://localhost/api/admin/prospects", form));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_file");
  });

  it("returns 400 when list_name is absent", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["org_name,email\nAcme,a@test.com"], "p.csv", { type: "text/csv" }),
    );
    const res = await prospectsPost(formPost("http://localhost/api/admin/prospects", form));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_fields");
  });

  it("imports CSV and returns 201 with result stats", async () => {
    const importResult = { imported: 5, skipped: 1, errors: 0 };
    mockImportFromCsv.mockResolvedValue(importResult);

    const csvContent = "org_name,email\nAcme Corp,acme@test.com\nBeta Inc,beta@test.com";
    const form = new FormData();
    form.append(
      "file",
      new File([csvContent], "prospects.csv", { type: "text/csv" }),
    );
    form.append("list_name", "Summer 2026");
    form.append("source", "manual_upload");

    const res = await prospectsPost(formPost("http://localhost/api/admin/prospects", form));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { result: typeof importResult };
    expect(body.result.imported).toBe(5);
    expect(body.result.skipped).toBe(1);
    expect(mockImportFromCsv).toHaveBeenCalledWith(csvContent, "Summer 2026", "manual_upload");
  });

  it("returns 500 when ProspectManager throws", async () => {
    mockImportFromCsv.mockRejectedValue(new Error("Encoding not supported"));
    const form = new FormData();
    form.append("file", new File(["x"], "bad.csv", { type: "text/csv" }));
    form.append("list_name", "Broken");

    const res = await prospectsPost(formPost("http://localhost/api/admin/prospects", form));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("import_failed");
  });
});

// ── POST /api/admin/campaigns ─────────────────────────────────────────────────

describe("POST /api/admin/campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(ADMIN_CONTEXT);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await campaignsPost(
      jsonPost("http://localhost/api/admin/campaigns", { name: "Incomplete" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_fields");
  });

  it("returns 400 when steps is not an array", async () => {
    const res = await campaignsPost(
      jsonPost("http://localhost/api/admin/campaigns", {
        name: "Camp",
        list_id: "list-1",
        sending_domain_ids: ["dom-1"],
        daily_send_target: 50,
        send_window_start: 8,
        send_window_end: 17,
        send_timezone: "America/Chicago",
        steps: "not-an-array",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates campaign and returns 201 with id", async () => {
    const campaignId = "camp-abc-123";
    mockCreateCampaign.mockResolvedValue(campaignId);

    const res = await campaignsPost(
      jsonPost("http://localhost/api/admin/campaigns", {
        name: "Q3 Outreach",
        description: "Summer push",
        list_id: "list-abc",
        sending_domain_ids: ["dom-1", "dom-2"],
        daily_send_target: 50,
        send_window_start: 8,
        send_window_end: 17,
        send_timezone: "America/Chicago",
        filter_criteria: { states: ["TX", "OK"] },
        steps: [
          {
            subject_template: "Partnering with {org_name}",
            body_template: "Hi {first_name}, reaching out…",
            delay_days: 0,
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(campaignId);
    expect(mockCreateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Q3 Outreach",
        list_id: "list-abc",
        daily_send_target: 50,
      }),
    );
  });

  it("returns 500 when SalesCampaignEngine.createCampaign throws", async () => {
    mockCreateCampaign.mockRejectedValue(new Error("Step insert failed"));
    const res = await campaignsPost(
      jsonPost("http://localhost/api/admin/campaigns", {
        name: "Camp",
        list_id: "list-1",
        sending_domain_ids: ["dom-1"],
        daily_send_target: 25,
        send_window_start: 9,
        send_window_end: 16,
        send_timezone: "America/New_York",
        steps: [{ subject_template: "Hi {org_name}", body_template: "Body", delay_days: 0 }],
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("create_failed");
  });
});

// ── Engine: suppression check prevents sending to suppressed email ────────────
//
// These tests bypass the module-level SalesCampaignEngine mock via vi.importActual
// so the real processQueuedSends logic runs against mocked Supabase + WarmupEngine.

describe("SalesCampaignEngine.processQueuedSends — suppression check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure no RESEND key so sendConfirmationEmail exits early
    delete process.env.RESEND_API_KEY;
  });

  it("marks send as suppressed and increments skipped_suppressed when email is in suppression list", async () => {
    const suppressed_email = "blocked@example.com";
    const queuedSend = {
      id: "send-s1",
      campaign_id: "camp-1",
      step_id: "step-1",
      prospect_id: "prospect-1",
      sending_domain_id: "dom-1",
      to_address: suppressed_email,
      from_address: "outreach@mail.test",
      subject: "Hello",
      body_html: "<p>Hi</p>",
    };

    // Track how many times from("sales_sends") is called
    let salesSendsCallCount = 0;

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "sales_sends") {
        salesSendsCallCount++;
        if (salesSendsCallCount === 1) {
          // Initial select query for queued sends
          return makeChain([queuedSend]);
        }
        // Subsequent calls: update to mark suppressed — just resolve OK
        return makeChain(null);
      }
      if (table === "suppression_list") {
        return makeChain([{ email: suppressed_email }]);
      }
      return makeChain(null);
    });

    // getDailyBudget should not be reached for suppressed emails
    mockGetDailyBudget.mockResolvedValue({ remaining: 100, limit: 200 });

    const { SalesCampaignEngine: Engine } = await vi.importActual<
      typeof import("@/lib/admin/sales-campaign-engine")
    >("@/lib/admin/sales-campaign-engine");

    const engine = new Engine();
    const result = await engine.processQueuedSends();

    expect(result.skipped_suppressed).toBe(1);
    expect(result.sent).toBe(0);
    // Budget check should be bypassed for suppressed emails
    expect(mockGetDailyBudget).not.toHaveBeenCalled();
  });

  it("case-insensitively matches suppressed emails", async () => {
    const queuedSend = {
      id: "send-s2",
      campaign_id: "camp-1",
      step_id: "step-1",
      prospect_id: "prospect-2",
      sending_domain_id: "dom-1",
      to_address: "UPPER@Example.COM",
      from_address: "outreach@mail.test",
      subject: "Hi",
      body_html: "<p>Hi</p>",
    };

    let salesSendsCallCount = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "sales_sends") {
        salesSendsCallCount++;
        return salesSendsCallCount === 1 ? makeChain([queuedSend]) : makeChain(null);
      }
      if (table === "suppression_list") {
        // Stored as lowercase
        return makeChain([{ email: "upper@example.com" }]);
      }
      return makeChain(null);
    });

    const { SalesCampaignEngine: Engine } = await vi.importActual<
      typeof import("@/lib/admin/sales-campaign-engine")
    >("@/lib/admin/sales-campaign-engine");

    const engine = new Engine();
    const result = await engine.processQueuedSends();

    expect(result.skipped_suppressed).toBe(1);
  });

  it("does not suppress when email is not in suppression list", async () => {
    // Email is not blocked — budget is exhausted so it skips via budget path
    const queuedSend = {
      id: "send-s3",
      campaign_id: "camp-1",
      step_id: "step-1",
      prospect_id: "prospect-3",
      sending_domain_id: "dom-1",
      to_address: "allowed@example.com",
      from_address: "outreach@mail.test",
      subject: "Hello",
      body_html: "<p>Hi</p>",
    };

    let salesSendsCallCount = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "sales_sends") {
        salesSendsCallCount++;
        return salesSendsCallCount === 1 ? makeChain([queuedSend]) : makeChain(null);
      }
      if (table === "suppression_list") {
        return makeChain([]); // Empty — no suppressed emails
      }
      return makeChain(null);
    });

    mockGetDailyBudget.mockResolvedValue({ remaining: 0, limit: 100 });

    const { SalesCampaignEngine: Engine } = await vi.importActual<
      typeof import("@/lib/admin/sales-campaign-engine")
    >("@/lib/admin/sales-campaign-engine");

    const engine = new Engine();
    const result = await engine.processQueuedSends();

    expect(result.skipped_suppressed).toBe(0);
    expect(result.skipped_budget).toBe(1);
  });
});

// ── Engine: daily budget enforcement ─────────────────────────────────────────

describe("SalesCampaignEngine.processQueuedSends — daily budget enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RESEND_API_KEY;
  });

  it("skips send and increments skipped_budget when domain remaining is 0", async () => {
    const queuedSend = {
      id: "send-b1",
      campaign_id: "camp-1",
      step_id: "step-1",
      prospect_id: "prospect-4",
      sending_domain_id: "dom-budget",
      to_address: "prospect@example.com",
      from_address: "outreach@mail.test",
      subject: "Hello",
      body_html: "<p>Hi</p>",
    };

    let salesSendsCallCount = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "sales_sends") {
        salesSendsCallCount++;
        return salesSendsCallCount === 1 ? makeChain([queuedSend]) : makeChain(null);
      }
      if (table === "suppression_list") {
        return makeChain([]); // No suppression
      }
      return makeChain(null);
    });

    // Domain budget exhausted
    mockGetDailyBudget.mockResolvedValue({ remaining: 0, limit: 100 });

    const { SalesCampaignEngine: Engine } = await vi.importActual<
      typeof import("@/lib/admin/sales-campaign-engine")
    >("@/lib/admin/sales-campaign-engine");

    const engine = new Engine();
    const result = await engine.processQueuedSends();

    expect(result.skipped_budget).toBe(1);
    expect(result.sent).toBe(0);
    expect(mockGetDailyBudget).toHaveBeenCalledWith("dom-budget");
  });

  it("does not skip send when domain still has budget remaining", async () => {
    const queuedSend = {
      id: "send-b2",
      campaign_id: "camp-1",
      step_id: "step-1",
      prospect_id: "prospect-5",
      sending_domain_id: "dom-ok",
      to_address: "sendme@example.com",
      from_address: "outreach@mail.test",
      subject: "Hi",
      body_html: "<p>Hi</p>",
    };

    let salesSendsCallCount = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "sales_sends") {
        salesSendsCallCount++;
        return salesSendsCallCount === 1 ? makeChain([queuedSend]) : makeChain(null);
      }
      if (table === "suppression_list") {
        return makeChain([]);
      }
      if (table === "sending_domains") {
        return makeChain({ id: "dom-ok", domain: "mail.test", api_key_encrypted: "enc_key" });
      }
      if (table === "prospects") {
        return makeChain({ total_emails_sent: 0 });
      }
      return makeChain(null);
    });

    // Budget still available; send proceeds
    mockGetDailyBudget.mockResolvedValue({ remaining: 42, limit: 100 });

    // Mock global fetch so Resend call doesn't fail
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "resend-msg-1" }), { status: 200 }),
    );

    const { SalesCampaignEngine: Engine } = await vi.importActual<
      typeof import("@/lib/admin/sales-campaign-engine")
    >("@/lib/admin/sales-campaign-engine");

    const engine = new Engine();
    const result = await engine.processQueuedSends();

    expect(result.skipped_budget).toBe(0);
    fetchSpy.mockRestore();
  });
});
