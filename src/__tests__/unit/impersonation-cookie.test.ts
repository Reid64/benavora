// WGR-074: locks in that the impersonation_org_id cookie set by
// POST /api/admin/orgs/[id]/impersonate carries a bounded maxAge (<= 1 hour)
// so an admin's "viewing as" session cannot persist indefinitely.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/role-gate", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/audit/logger", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

function makeAdminClient() {
  const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const fromMock = vi.fn((table: string) => {
    if (table === "organizations") {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: { id: "org-1", name: "Test Org" }, error: null }),
          }),
        }),
      };
    }
    if (table === "impersonation_log") {
      return { insert: insertMock };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { client: { from: fromMock } };
}

describe("impersonation_org_id cookie bounds", () => {
  it("sets maxAge on the impersonation cookie, bounded to 1 hour", async () => {
    const { requireRole } = await import("@/lib/auth/role-gate");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(requireRole).mockResolvedValue({
      supabase: {} as never,
      userId: "owner-1",
      userRole: "owner",
      organizationId: "platform-org",
      restrictedOnboardingEdit: false,
    });
    const { client } = makeAdminClient();
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const { POST } = await import("@/app/api/admin/orgs/[id]/impersonate/route");
    const response = await POST(
      new Request("http://localhost/api/admin/orgs/org-1/impersonate", { method: "POST" }),
      { params: { id: "org-1" } },
    );

    const cookie = response.cookies.get("impersonation_org_id");
    expect(cookie?.maxAge).toBeDefined();
    expect(cookie?.maxAge).toBeLessThanOrEqual(3600);
  });
});
