import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateBoardReport } from "@/lib/reports/board-report-generator";

function makeThenable(result: unknown) {
  const builder: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "eq",
    "neq",
    "not",
    "gte",
    "lte",
    "in",
    "order",
    "limit",
  ];
  for (const method of chainMethods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createSupabaseMock(opts: {
  opportunitiesCount: number;
  applicationsCount: number;
  outcomes: { result: string; awarded_amount: number | null }[];
  topFundersRows: Record<string, unknown>[];
  upcomingDeadlineRows: Record<string, unknown>[];
}) {
  // Both "opportunities" and "applications" are queried twice in
  // generateBoardReport — once for a plain count, once for a joined
  // dataset. Resolving to an object carrying both `count` and `data`
  // satisfies whichever shape each call site destructures.
  const opportunitiesBuilder = makeThenable({
    count: opts.opportunitiesCount,
    data: opts.upcomingDeadlineRows,
  });
  const applicationsBuilder = makeThenable({
    count: opts.applicationsCount,
    data: opts.topFundersRows,
  });
  const outcomesBuilder = makeThenable({ data: opts.outcomes });

  return {
    from: vi.fn((table: string) => {
      if (table === "opportunities") return opportunitiesBuilder;
      if (table === "applications") return applicationsBuilder;
      if (table === "outcomes") return outcomesBuilder;
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient;
}

describe("generateBoardReport", () => {
  it("returns all required BoardReportSummary fields", async () => {
    const supabase = createSupabaseMock({
      opportunitiesCount: 3,
      applicationsCount: 2,
      outcomes: [
        { result: "awarded", awarded_amount: 50_000 },
        { result: "denied", awarded_amount: null },
      ],
      topFundersRows: [
        {
          id: "app-1",
          opportunities: {
            funder_id: "f1",
            funders: { id: "f1", name: "Acme Foundation" },
          },
        },
        {
          id: "app-2",
          opportunities: {
            funder_id: "f1",
            funders: { id: "f1", name: "Acme Foundation" },
          },
        },
      ],
      upcomingDeadlineRows: [
        {
          id: "opp-1",
          name: "Housing Grant",
          deadline: "2026-08-01",
          funders: { name: "Acme Foundation" },
        },
      ],
    });

    const result = await generateBoardReport(
      "org-1",
      "2026-01-01",
      "2026-06-30",
      supabase,
    );

    expect(result).toEqual(
      expect.objectContaining({
        dateRange: { from: "2026-01-01", to: "2026-06-30" },
        opportunitiesCreated: 3,
        applicationsSubmitted: 2,
        totalAwarded: 50_000,
        outcomesRecorded: 2,
        outcomesAwarded: 1,
        successRate: 0.5,
      }),
    );
    expect(Array.isArray(result.topFunders)).toBe(true);
    expect(result.topFunders[0]).toEqual(
      expect.objectContaining({
        funderId: "f1",
        funderName: "Acme Foundation",
        applicationCount: 2,
      }),
    );
    expect(Array.isArray(result.upcomingDeadlines)).toBe(true);
    expect(result.upcomingDeadlines[0]).toEqual(
      expect.objectContaining({
        opportunityId: "opp-1",
        name: "Housing Grant",
        funderName: "Acme Foundation",
      }),
    );
    expect(typeof result.narrativeSummary).toBe("string");
    expect(result.narrativeSummary.length).toBeGreaterThan(0);
  });

  it("handles a period with no activity gracefully", async () => {
    const supabase = createSupabaseMock({
      opportunitiesCount: 0,
      applicationsCount: 0,
      outcomes: [],
      topFundersRows: [],
      upcomingDeadlineRows: [],
    });

    const result = await generateBoardReport(
      "org-1",
      "2026-01-01",
      "2026-01-31",
      supabase,
    );

    expect(result.totalAwarded).toBe(0);
    expect(result.successRate).toBe(0);
    expect(result.topFunders).toEqual([]);
    expect(result.upcomingDeadlines).toEqual([]);
    expect(result.narrativeSummary).toContain("No outcomes were recorded");
  });
});
