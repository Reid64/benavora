// WGR-156: /donor-discovery's Pipeline Funnel showed 133,812 "New" prospects
// for org b1ab7402-dfc2-4712-869f-70ea3566cc1d — exactly the row count of the
// `foundation_directory` reference table. Investigation found the funnel
// query itself (this route) was already correctly organization_id-scoped at
// the DB layer (explicit .eq + RLS); the real cause was scripts/seed-
// foundation-prospects.ts, which deliberately seeded every foundation_
// directory row as a "new"-stage prospect for that one hardcoded org. See
// test-evidence/_register/WIRING_GAP_REGISTER.md WGR-156 for the full
// finding.
//
// This test locks in the org-scoping behavior itself: every stage's count
// query and top-N query must filter on organization_id using the value
// derived from requireRole() (the authenticated caller's session), not a
// hardcoded or omitted value — a regression here would silently make every
// org's funnel show every other org's prospects too.
import { describe, it, expect, vi } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

interface RecordedChain {
  table: string;
  eqCalls: [string, unknown][];
}

function makeChain(table: string, recorded: RecordedChain[], finalResult: { data?: unknown; count?: number | null }) {
  const record: RecordedChain = { table, eqCalls: [] };
  recorded.push(record);
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn((col: string, val: unknown) => {
      record.eqCalls.push([col, val]);
      return chain;
    }),
    not: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(finalResult)),
    range: vi.fn(() => Promise.resolve({ data: [], error: null })),
    then: (resolve: (v: unknown) => void) => Promise.resolve(finalResult).then(resolve),
  };
  return chain;
}

vi.mock("@/lib/auth/role-gate", () => ({ requireRole: vi.fn() }));

describe("GET /api/donor-discovery/pipeline org scoping", () => {
  it("filters every donor_discovery_prospects query by the caller's organization_id, never a different or missing one", async () => {
    const { requireRole } = await import("@/lib/auth/role-gate");
    const recorded: RecordedChain[] = [];

    const fromMock = vi.fn((table: string) => makeChain(table, recorded, { count: 0, data: [] }));

    vi.mocked(requireRole).mockResolvedValue({
      supabase: { from: fromMock } as never,
      userId: "user-1",
      userRole: "viewer",
      organizationId: ORG_ID,
      restrictedOnboardingEdit: false,
    });

    const { GET } = await import("@/app/api/donor-discovery/pipeline/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const prospectChains = recorded.filter((r) => r.table === "donor_discovery_prospects");
    // 7 stages x 2 queries (count + top-N) + 1 scores page query = 15.
    expect(prospectChains.length).toBe(15);

    for (const chain of prospectChains) {
      const orgFilters = chain.eqCalls.filter(([col]) => col === "organization_id");
      expect(orgFilters.length).toBeGreaterThan(0);
      for (const [, value] of orgFilters) {
        expect(value).toBe(ORG_ID);
      }
    }
  });

  it("uses whatever organization_id requireRole derives for this caller — not a fixed value", async () => {
    const { requireRole } = await import("@/lib/auth/role-gate");
    const otherOrgId = "99999999-8888-7777-6666-555555555555";
    const recorded: RecordedChain[] = [];

    const fromMock = vi.fn((table: string) => makeChain(table, recorded, { count: 0, data: [] }));

    vi.mocked(requireRole).mockResolvedValue({
      supabase: { from: fromMock } as never,
      userId: "user-2",
      userRole: "viewer",
      organizationId: otherOrgId,
      restrictedOnboardingEdit: false,
    });

    const { GET } = await import("@/app/api/donor-discovery/pipeline/route");
    await GET();

    const prospectChains = recorded.filter((r) => r.table === "donor_discovery_prospects");
    for (const chain of prospectChains) {
      const orgFilters = chain.eqCalls.filter(([col]) => col === "organization_id");
      for (const [, value] of orgFilters) {
        expect(value).toBe(otherOrgId);
      }
    }
  });
});
