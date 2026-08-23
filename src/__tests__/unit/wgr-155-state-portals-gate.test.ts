// WGR-155: GET /api/sources/state-portals previously had zero auth check of
// any kind in the handler itself — the only protection was
// src/middleware.ts's default session requirement, which blocks anonymous
// callers but not any authenticated user of any role in any organization
// triggering an outbound scrape of an arbitrary configured state portal.
// This route is user-triggered (from /settings/state-portals), not one of
// vercel.json's crons[] entries, so the fix is requireRole("viewer") — the
// same gate every other GET route in src/app/api/donor-discovery/ uses for
// its own read-only/preview endpoints — not a CRON_SECRET bearer check.
import { describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/auth/role-gate", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/sources/state-portals/portal-scraper", () => ({
  scrapePortal: vi.fn().mockResolvedValue([{ title: "Test Grant" }]),
}));

describe("GET /api/sources/state-portals auth gate", () => {
  it("returns the requireRole error response (403) for a caller lacking the required role, before any scrape runs", async () => {
    const { requireRole } = await import("@/lib/auth/role-gate");
    const { scrapePortal } = await import("@/lib/sources/state-portals/portal-scraper");
    vi.mocked(requireRole).mockResolvedValue({
      error: NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 }),
    });

    const { GET } = await import("@/app/api/sources/state-portals/route");
    const response = await GET(new Request("http://localhost/api/sources/state-portals?state=TX"));

    expect(response.status).toBe(403);
    expect(scrapePortal).not.toHaveBeenCalled();
  });

  it("calls requireRole('viewer') and proceeds to scrape for an authorized caller", async () => {
    const { requireRole } = await import("@/lib/auth/role-gate");
    const { scrapePortal } = await import("@/lib/sources/state-portals/portal-scraper");
    vi.mocked(requireRole).mockResolvedValue({
      supabase: {} as never,
      userId: "user-1",
      userRole: "viewer",
      organizationId: "org-1",
      restrictedOnboardingEdit: false,
    });

    const { GET } = await import("@/app/api/sources/state-portals/route");
    const response = await GET(new Request("http://localhost/api/sources/state-portals?state=TX"));

    expect(requireRole).toHaveBeenCalledWith("viewer");
    expect(scrapePortal).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});
