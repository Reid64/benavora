import { describe, it, expect, vi } from "vitest";
import { buildDigitalTwin } from "@/lib/intelligence/digital-twin-builder";

interface MockOrg {
  id: string;
  mission_statement: string | null;
  service_area: string | null;
  city: string | null;
  state: string | null;
  annual_budget: number | null;
  total_staff: number | null;
  total_volunteers: number | null;
}

interface MockKbRow {
  id: string;
  category: string;
  title: string;
  content: string;
  is_proven: boolean | null;
  funder_categories: string[] | null;
}

interface MockBoardRow {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  email: string | null;
}

interface MockOutcomeRow {
  result: string;
  funder_category: string | null;
  opportunity_category: string | null;
  awarded_amount: number | null;
}

interface MockApplicationRow {
  id: string;
  stage: string;
  opportunities: { category: string | null } | null;
}

const EMPTY_ORG: MockOrg = {
  id: "org-1",
  mission_statement: null,
  service_area: null,
  city: null,
  state: null,
  annual_budget: null,
  total_staff: null,
  total_volunteers: null,
};

function makeThenable(result: unknown) {
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "eq", "order", "limit"];
  for (const method of chainMethods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createSupabaseMock(opts: {
  org: MockOrg | null;
  orgError?: unknown;
  kbEntries?: MockKbRow[];
  boardMembers?: MockBoardRow[];
  outcomes?: MockOutcomeRow[];
  applications?: MockApplicationRow[];
  upsertError?: unknown;
}) {
  const {
    org,
    orgError = null,
    kbEntries = [],
    boardMembers = [],
    outcomes = [],
    applications = [],
    upsertError = null,
  } = opts;

  const orgBuilder: Record<string, unknown> = {
    select: vi.fn(() => orgBuilder),
    eq: vi.fn(() => orgBuilder),
    maybeSingle: vi.fn().mockResolvedValue({ data: org, error: orgError }),
  };

  const kbBuilder = makeThenable({ data: kbEntries });
  const boardBuilder = makeThenable({ data: boardMembers });
  const outcomesBuilder = makeThenable({ data: outcomes });
  const applicationsBuilder = makeThenable({ data: applications });

  const upsert = vi.fn().mockResolvedValue({ error: upsertError });
  const twinsBuilder = { upsert };

  return {
    from: vi.fn((table: string) => {
      if (table === "organizations") return orgBuilder;
      if (table === "knowledge_base") return kbBuilder;
      if (table === "board_members") return boardBuilder;
      if (table === "outcomes") return outcomesBuilder;
      if (table === "applications") return applicationsBuilder;
      if (table === "organizational_digital_twins") return twinsBuilder;
      throw new Error(`Unexpected table: ${table}`);
    }),
    __upsert: upsert,
  };
}

describe("buildDigitalTwin", () => {
  it("returns a twin object with all required top-level fields", async () => {
    const supabase = createSupabaseMock({
      org: {
        ...EMPTY_ORG,
        mission_statement: "We house rural Texas families.",
        service_area: "Rural Texas",
        annual_budget: 250_000,
      },
      kbEntries: [
        {
          id: "kb-1",
          category: "program_description",
          title: "Transitional Housing",
          content: "A 12-month transitional housing program.",
          is_proven: false,
          funder_categories: null,
        },
      ],
      boardMembers: [
        { id: "b-1", name: "Jane Doe", title: "Chair", bio: null, email: null },
      ],
    });

    const twin = await buildDigitalTwin("org-1", supabase);

    expect(twin.organization_id).toBe("org-1");
    expect(twin.mission).toBe("We house rural Texas families.");
    expect(twin.service_areas).toEqual(["Rural Texas"]);
    expect(twin.programs).toEqual([
      { title: "Transitional Housing", description: "A 12-month transitional housing program." },
    ]);
    expect(twin.financial_profile).toEqual({ annual_budget: 250_000 });
    expect(twin.board_composition).toEqual([
      { name: "Jane Doe", title: "Chair", bio: null, email: null },
    ]);
    expect(Array.isArray(twin.proven_narrative_patterns)).toBe(true);
    expect(Array.isArray(twin.key_strengths)).toBe(true);
    expect(typeof twin.twin_completeness_score).toBe("number");
    expect(typeof twin.last_rebuilt_at).toBe("string");
    expect(twin.stats).toEqual(
      expect.objectContaining({
        outcomes_count: 0,
        kb_entries_count: 1,
        applications_count: 0,
      }),
    );
  });

  it("throws when the organization is not found", async () => {
    const supabase = createSupabaseMock({ org: null });

    await expect(buildDigitalTwin("missing-org", supabase)).rejects.toThrow(
      "Organization not found.",
    );
  });

  it("computes a twin_completeness_score of 0 when the org has no data at all", async () => {
    const supabase = createSupabaseMock({ org: EMPTY_ORG });

    const twin = await buildDigitalTwin("org-1", supabase);

    expect(twin.twin_completeness_score).toBe(0);
    expect(twin.mission).toBeNull();
    expect(twin.service_areas).toEqual([]);
    expect(twin.programs).toEqual([]);
    expect(twin.proven_narrative_patterns).toEqual([]);
    expect(twin.key_strengths).toEqual([]);
  });

  it("computes a twin_completeness_score of 100 when all ten completeness factors are present", async () => {
    const kbEntries: MockKbRow[] = [
      {
        id: "kb-program",
        category: "program_description",
        title: "Transitional Housing",
        content: "A 12-month transitional housing program.",
        is_proven: false,
        funder_categories: null,
      },
      {
        id: "kb-proven",
        category: "impact",
        title: "Proven Impact Story",
        content: "This narrative won a housing grant.",
        is_proven: true,
        funder_categories: ["housing_grant"],
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `kb-filler-${i}`,
        category: "custom",
        title: `Filler ${i}`,
        content: "Filler content.",
        is_proven: false,
        funder_categories: null,
      })),
    ];

    const outcomes: MockOutcomeRow[] = [
      { result: "awarded", funder_category: "housing_grant", opportunity_category: null, awarded_amount: 5000 },
      { result: "denied", funder_category: "housing_grant", opportunity_category: null, awarded_amount: null },
      { result: "denied", funder_category: "housing_grant", opportunity_category: null, awarded_amount: null },
      { result: "denied", funder_category: "housing_grant", opportunity_category: null, awarded_amount: null },
      { result: "denied", funder_category: "housing_grant", opportunity_category: null, awarded_amount: null },
      { result: "denied", funder_category: "housing_grant", opportunity_category: null, awarded_amount: null },
    ];

    const applications: MockApplicationRow[] = Array.from({ length: 6 }, (_, i) => ({
      id: `app-${i}`,
      stage: "submitted",
      opportunities: { category: "housing_grant" },
    }));

    const supabase = createSupabaseMock({
      org: {
        ...EMPTY_ORG,
        mission_statement: "We house rural Texas families.",
        service_area: "Rural Texas, Central Texas",
        annual_budget: 250_000,
      },
      kbEntries,
      boardMembers: [
        { id: "b-1", name: "Jane Doe", title: "Chair", bio: null, email: null },
      ],
      outcomes,
      applications,
    });

    const twin = await buildDigitalTwin("org-1", supabase);

    expect(twin.twin_completeness_score).toBe(100);
    expect(twin.proven_narrative_patterns).toEqual(["impact: Proven Impact Story"]);
    expect(twin.key_strengths.length).toBeGreaterThan(0);
  });

  it("falls back to city + state for service_areas when org.service_area is not set", async () => {
    const supabase = createSupabaseMock({
      org: { ...EMPTY_ORG, city: "Dallas", state: "TX" },
    });

    const twin = await buildDigitalTwin("org-1", supabase);

    expect(twin.service_areas).toEqual(["Dallas, TX"]);
  });

  it("splits org.service_area on commas when it is set", async () => {
    const supabase = createSupabaseMock({
      org: { ...EMPTY_ORG, service_area: "Dallas, Fort Worth, Austin" },
    });

    const twin = await buildDigitalTwin("org-1", supabase);

    expect(twin.service_areas).toEqual(["Dallas", "Fort Worth", "Austin"]);
  });

  it("only includes proven_narrative_patterns for is_proven KB entries whose funder_categories overlap an awarded outcome's category", async () => {
    const supabase = createSupabaseMock({
      org: EMPTY_ORG,
      kbEntries: [
        {
          id: "kb-proven-match",
          category: "impact",
          title: "Matching Story",
          content: "...",
          is_proven: true,
          funder_categories: ["housing_grant"],
        },
        {
          id: "kb-proven-no-match",
          category: "impact",
          title: "Non-Matching Story",
          content: "...",
          is_proven: true,
          funder_categories: ["education_grant"],
        },
        {
          id: "kb-not-proven",
          category: "impact",
          title: "Unproven Story",
          content: "...",
          is_proven: false,
          funder_categories: ["housing_grant"],
        },
      ],
      outcomes: [
        { result: "awarded", funder_category: "housing_grant", opportunity_category: null, awarded_amount: 1000 },
        { result: "denied", funder_category: "education_grant", opportunity_category: null, awarded_amount: null },
      ],
    });

    const twin = await buildDigitalTwin("org-1", supabase);

    expect(twin.proven_narrative_patterns).toEqual(["impact: Matching Story"]);
  });

  it("returns an empty proven_narrative_patterns array when there are no awarded outcomes", async () => {
    const supabase = createSupabaseMock({
      org: EMPTY_ORG,
      kbEntries: [
        {
          id: "kb-proven",
          category: "impact",
          title: "Some Story",
          content: "...",
          is_proven: true,
          funder_categories: ["housing_grant"],
        },
      ],
      outcomes: [
        { result: "denied", funder_category: "housing_grant", opportunity_category: null, awarded_amount: null },
      ],
    });

    const twin = await buildDigitalTwin("org-1", supabase);

    expect(twin.proven_narrative_patterns).toEqual([]);
  });

  it("persists the twin to organizational_digital_twins via upsert", async () => {
    const supabase = createSupabaseMock({
      org: { ...EMPTY_ORG, mission_statement: "Test mission" },
    });

    const twin = await buildDigitalTwin("org-1", supabase);

    expect(supabase.__upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        mission: twin.mission,
        twin_completeness_score: twin.twin_completeness_score,
      }),
      { onConflict: "organization_id" },
    );
  });

  it("throws when persisting the twin fails", async () => {
    const supabase = createSupabaseMock({
      org: EMPTY_ORG,
      upsertError: { message: "connection refused" },
    });

    await expect(buildDigitalTwin("org-1", supabase)).rejects.toThrow(
      "Failed to persist digital twin: connection refused",
    );
  });
});
