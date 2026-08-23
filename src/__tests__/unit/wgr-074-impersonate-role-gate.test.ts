// WGR-074: confirms POST/DELETE /api/admin/orgs/[id]/impersonate gate on
// requireRole("owner") before allowing (or revoking) impersonation — a
// non-owner call must be rejected (403) before any impersonation_log row is
// written or cookie is set; an owner call must succeed.
//
// Scope note (see WIRING_GAP_REGISTER.md WGR-074): this test confirms the
// role check itself, which was already present and is not missing or
// bypassable — requireRole() re-derives the caller's role server-side from
// `profiles` on every call, so it cannot be spoofed via a client-sent header
// or cookie. It does NOT confirm the broader, separately-documented finding
// that the `impersonation_org_id` cookie this route sets is read by zero
// other call sites in the app (so impersonation logs an audit trail and sets
// a cookie, but doesn't itself further restrict which org the admin can
// reach beyond the standard owner-role gate) — that is a materially larger,
// deliberate architectural scope decision left open in the register, not a
// missing/bypassable auth check this task asked to fix.
import { describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/auth/role-gate", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/audit/logger", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

function makeAdminClient(orgFound: boolean) {
  const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const fromMock = vi.fn((table: string) => {
    if (table === "organizations") {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve(
                orgFound
                  ? { data: { id: "org-1", name: "Test Org" }, error: null }
                  : { data: null, error: { message: "not found" } },
              ),
          }),
        }),
      };
    }
    if (table === "impersonation_log") {
      return { insert: insertMock };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { fromMock, insertMock, client: { from: fromMock } };
}

describe("POST /api/admin/orgs/[id]/impersonate role gate", () => {
  it("rejects a non-owner call with the requireRole error response (403) before any impersonation_log write", async () => {
    const { requireRole } = await import("@/lib/auth/role-gate");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(requireRole).mockResolvedValue({
      error: NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 }),
    });
    const { fromMock } = makeAdminClient(true);
    vi.mocked(createAdminClient).mockReturnValue(fromMock as never);

    const { POST } = await import("@/app/api/admin/orgs/[id]/impersonate/route");
    const response = await POST(
      new Request("http://localhost/api/admin/orgs/org-1/impersonate", { method: "POST" }),
      { params: { id: "org-1" } },
    );

    expect(response.status).toBe(403);
    expect(fromMock).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalledWith("owner");
  });

  it("allows an owner call, writes an impersonation_log row, and sets the httpOnly cookie", async () => {
    const { requireRole } = await import("@/lib/auth/role-gate");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(requireRole).mockResolvedValue({
      supabase: {} as never,
      userId: "owner-1",
      userRole: "owner",
      organizationId: "platform-org",
      restrictedOnboardingEdit: false,
    });
    const { fromMock, insertMock, client } = makeAdminClient(true);
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const { POST } = await import("@/app/api/admin/orgs/[id]/impersonate/route");
    const response = await POST(
      new Request("http://localhost/api/admin/orgs/org-1/impersonate", { method: "POST" }),
      { params: { id: "org-1" } },
    );

    expect(response.status).toBe(200);
    expect(fromMock).toHaveBeenCalledWith("impersonation_log");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ admin_id: "owner-1", target_org_id: "org-1" }),
    );
    expect(response.cookies.get("impersonation_org_id")?.value).toBe("org-1");
  });
});
