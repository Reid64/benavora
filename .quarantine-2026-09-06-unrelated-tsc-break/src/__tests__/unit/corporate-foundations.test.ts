// Unit tests for the Corporate Foundations Research Agent
// (src/lib/agents/research/corporate-foundations.ts).
//
// Two groups:
//  1. Pure-function tests for classifyCorporateParentName / deriveParentCompanyCandidate
//     / edgarCorroborationNote, exercised against REAL names this session
//     pulled live from ProPublica's search.json (NTEE major group 7,
//     grantmaking foundations) across DE/AR/OH/TX/NY/GA — not invented
//     fixtures, so the filter's actual precision/recall on real data is
//     checked, not just its intended behavior.
//  2. An orchestration test for CorporateFoundationsResearchAgent, mirroring
//     foundation-grants-orchestration.test.ts's fake-client pattern: no real
//     network calls, no real Claude/OpenAI calls.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/donor-discovery/adapters/propublica-adapter", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/donor-discovery/adapters/propublica-adapter")
  >("@/lib/donor-discovery/adapters/propublica-adapter");
  return { ...actual, searchOrganizations: vi.fn() };
});
vi.mock("@/lib/sources/propublica-990-client", () => ({
  fetchLatestFilingGivingSignal: vi.fn(),
}));
vi.mock("@/lib/agents/eligibility-scorer", () => ({
  EligibilityScorer: vi.fn(),
}));
vi.mock("@/lib/agents/research/kb-relevance", () => ({
  buildKbScorer: vi.fn(),
  buildOrgFocusText: vi.fn(),
}));
vi.mock("@/lib/billing/usage-tracker", () => ({
  trackUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/claude", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/claude")>("@/lib/ai/claude");
  return { ...actual, callClaude: vi.fn() };
});

import {
  classifyCorporateParentName,
  isCorporateParentCandidate,
  deriveParentCompanyCandidate,
  edgarCorroborationNote,
  CorporateFoundationsResearchAgent,
  type EdgarCorroboration,
} from "@/lib/agents/research/corporate-foundations";
import { searchOrganizations } from "@/lib/donor-discovery/adapters/propublica-adapter";
import { fetchLatestFilingGivingSignal } from "@/lib/sources/propublica-990-client";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";
import { buildKbScorer, buildOrgFocusText } from "@/lib/agents/research/kb-relevance";
import { callClaude } from "@/lib/ai/claude";

const CURRENT_YEAR = new Date().getFullYear();

describe("classifyCorporateParentName (against real ProPublica NTEE-7 names, live-collected 2026-09-06)", () => {
  // Confirmed real corporate foundation, live-verified this session (EIN
  // 20-5639919, AR): ProPublica's own record spells it "Wal-mart Foundation".
  // No legal suffix in the common name - the exact "weak" case this filter
  // exists to still catch.
  it("classifies the real Wal-mart Foundation as a corporate candidate (weak - no legal suffix)", () => {
    expect(classifyCorporateParentName("Wal-mart Foundation")).toBe("weak");
    expect(isCorporateParentCandidate("Wal-mart Foundation")).toBe(true);
  });

  it("classifies an explicit legal-entity-suffixed name as strong", () => {
    expect(classifyCorporateParentName("American Online Giving Foundation Inc")).toBe("strong");
  });

  it("classifies a name with the explicit word 'corporate' as strong", () => {
    expect(classifyCorporateParentName("Acme Corporate Foundation")).toBe("strong");
  });

  it.each([
    "Walton Family Foundation Inc",
    "Bloomberg Family Foundation Inc",
    "Rob And Melani Walton Foundation",
    "The Walton Family Charitable Support Foundation Inc",
  ])("excludes family-named foundations even when a legal suffix is present: %s", (name) => {
    expect(classifyCorporateParentName(name)).toBe("none");
  });

  it.each(["Delaware Community Foundation", "The Community Foundation For Greater Atlanta Inc"])(
    "excludes community foundations: %s",
    (name) => {
      expect(classifyCorporateParentName(name)).toBe("none");
    },
  );

  it.each([
    "Michael & Susan Dell Foundation",
    "Alice L Walton Foundation",
    "Jack Joseph And Morton Mandel Foundation",
  ])("excludes multi-token personal-name foundations: %s", (name) => {
    expect(classifyCorporateParentName(name)).toBe("none");
  });

  it.each([
    "Battelle Memorial Institute",
    "Jobsohio Beverage System",
    "Electric Reliability Council Of Texas Inc 10-10-90",
    "Southwest Research Institute",
    "Georgias Own Credit Union",
    "Robins Financial Credit Union",
  ])("excludes non-foundation-shaped organization names: %s", (name) => {
    expect(classifyCorporateParentName(name)).toBe("none");
  });

  it("documents the accepted false-positive: a single-surname family foundation with no legal suffix is indistinguishable from a real corporate one by name alone", () => {
    // "Moody Foundation" (Galveston, TX) is a real family foundation, not a
    // corporate one - but it is pattern-identical to "Wal-mart Foundation".
    // This is why the classification is "weak", not "strong", and why the
    // written description always hedges (see the orchestration test below).
    expect(classifyCorporateParentName("Moody Foundation")).toBe("weak");
  });

  // The next two cases are real ProPublica records this session pulled live
  // from Arkansas's NTEE-7 grantmaking foundations (see
  // scripts/audit/_tmp-smoke-corporate-foundations.mts) - not invented names.
  it("excludes a personal-name-with-conjunction foundation even when it also carries a legal suffix", () => {
    // Real record: "Willard And Pat Walker Charitable Foundation Inc" (AR).
    // Before this file's conjunction-aware fix, the bare "Inc" suffix alone
    // classified this "strong" - a live-verified false positive this session.
    expect(classifyCorporateParentName("Willard And Pat Walker Charitable Foundation Inc")).toBe(
      "none",
    );
  });

  it("documents the accepted false-positive: a plain nonprofit's own 'Inc' cannot be distinguished from real corporate-parent evidence by name alone", () => {
    // Real record: "Northeast Arkansas Clinic Char Foundation Inc" (AR) - a
    // clinic's own charitable foundation, not a corporate one. It has no
    // personal-name conjunction to catch it, so it still classifies "strong"
    // here. Documented and accepted (see the header note above), not hidden -
    // this is exactly why the written opportunity description always hedges
    // regardless of confidence tier.
    expect(classifyCorporateParentName("Northeast Arkansas Clinic Char Foundation Inc")).toBe(
      "strong",
    );
  });

  it("still classifies a real corporate foundation with a generic multi-word name and no conjunction as strong", () => {
    // Real record (DE scan): "American Online Giving Foundation Inc" is AOL's
    // actual corporate foundation. It has no "&"/"and" conjunction, so the
    // personal-name exclusion above must not catch it.
    expect(classifyCorporateParentName("American Online Giving Foundation Inc")).toBe("strong");
  });
});

describe("deriveParentCompanyCandidate", () => {
  it("strips the foundation suffix to guess the parent company name", () => {
    expect(deriveParentCompanyCandidate("Wal-mart Foundation")).toBe("Wal-mart");
  });

  it("strips a trailing legal-entity suffix too", () => {
    expect(deriveParentCompanyCandidate("Acme Corporate Foundation Inc")).toBe("Acme");
  });

  it("returns null when nothing meaningful remains", () => {
    expect(deriveParentCompanyCandidate("Foundation Inc")).toBeNull();
  });
});

describe("edgarCorroborationNote", () => {
  it("returns null when EDGAR did not match", () => {
    const result: EdgarCorroboration = {
      attempted: true,
      matched: false,
      queryTerm: "Wal-mart",
      companyDisplayName: null,
      cik: null,
      hitCount: 0,
    };
    expect(edgarCorroborationNote(result)).toBeNull();
  });

  it("hedges explicitly - never states a confirmed parent-company relationship", () => {
    const result: EdgarCorroboration = {
      attempted: true,
      matched: true,
      queryTerm: "Walmart",
      companyDisplayName: "Walmart Inc.  (WMT)  (CIK 0000104169)",
      cik: "0000104169",
      hitCount: 13,
    };
    const note = edgarCorroborationNote(result);
    expect(note).toContain("non-authoritative");
    expect(note).toContain("does not confirm");
    expect(note).toContain("Walmart Inc.  (WMT)  (CIK 0000104169)");
  });
});

// --- orchestration --------------------------------------------------------

const PROFILE_ROW = {
  id: "profile-1",
  name: "Corporate Foundation Focus",
  keywords: ["reentry housing"],
  categories: [],
  geographic_scope: "Texas",
  min_amount: null,
  max_amount: null,
  recurrence_preference: null,
  is_active: true,
  last_run_at: null,
  results_count: 0,
  geographic_scopes: [],
  source_type_filters: null,
  focus_areas: null,
  eligibility_filters: null,
  populations_served: [],
  excluded_categories: [],
  excluded_funders: [],
  agent_settings: null,
};

const PROPUBLICA_CANDIDATES = [
  { ein: "111111111", name: "Acme Corporate Foundation Inc", city: "Austin", state: "TX", ntee_code: "T20", have_filings: true },
  { ein: "222222222", name: "Moody Foundation", city: "Galveston", state: "TX", ntee_code: "T20", have_filings: true },
  { ein: "333333333", name: "Smith Family Foundation Inc", city: "Waco", state: "TX", ntee_code: "T20", have_filings: true },
  { ein: "444444444", name: "Beacon Corporation Foundation", city: "Houston", state: "TX", ntee_code: "T20", have_filings: true },
];

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
}

function genericBuilder(resolveValue: () => unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "gte", "order", "limit", "ilike", "insert", "update", "delete"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(resolveValue()));
  builder.maybeSingle = vi.fn(() => Promise.resolve(resolveValue()));
  builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue()).then(onFulfilled, onRejected);
  return builder;
}

function makeOpportunitiesTable(store: Map<string, Record<string, unknown>>) {
  let mode: "insert" | "select" | "delete" | null = null;
  let insertRow: Record<string, unknown> | null = null;
  let filterIds: string[] | null = null;

  const builder: Record<string, unknown> = {
    insert: vi.fn((row: Record<string, unknown>) => {
      mode = "insert";
      insertRow = { id: `opp-${slug(String(row.name))}`, ...row };
      return builder;
    }),
    select: vi.fn(() => {
      if (mode !== "insert") mode = "select";
      return builder;
    }),
    delete: vi.fn(() => {
      mode = "delete";
      return builder;
    }),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    in: vi.fn((_col: string, ids: string[]) => {
      filterIds = ids;
      return builder;
    }),
    single: vi.fn(() => {
      if (mode === "insert" && insertRow) {
        store.set(insertRow.id as string, insertRow);
        return Promise.resolve({ data: { id: insertRow.id }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      let result: unknown;
      if (mode === "delete") {
        for (const id of filterIds ?? []) store.delete(id);
        result = { data: null, error: null };
      } else {
        let rows = Array.from(store.values());
        if (filterIds) rows = rows.filter((r) => filterIds!.includes(r.id as string));
        result = { data: rows, error: null };
      }
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function makeFundersTable(store: Map<string, string>) {
  let mode: "insert" | "select" | null = null;
  let ilikeName: string | null = null;
  let insertRow: Record<string, unknown> | null = null;

  const builder: Record<string, unknown> = {
    select: vi.fn(() => {
      mode = mode ?? "select";
      return builder;
    }),
    insert: vi.fn((row: Record<string, unknown>) => {
      mode = "insert";
      insertRow = row;
      return builder;
    }),
    eq: vi.fn(() => builder),
    ilike: vi.fn((_col: string, name: string) => {
      ilikeName = name;
      return builder;
    }),
    limit: vi.fn(() => builder),
    single: vi.fn(() => {
      if (mode === "insert" && insertRow) {
        const id = `funder-${slug(String(insertRow.name))}`;
        store.set(String(insertRow.name).toLowerCase(), id);
        return Promise.resolve({ data: { id }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    maybeSingle: vi.fn(() => {
      const id = ilikeName ? store.get(ilikeName.toLowerCase()) : undefined;
      return Promise.resolve({ data: id ? { id } : null, error: null });
    }),
  };
  return builder;
}

function makeFakeClient() {
  const opportunities = new Map<string, Record<string, unknown>>();
  const funders = new Map<string, string>();

  const from = vi.fn((table: string) => {
    if (table === "search_profiles") return genericBuilder(() => ({ data: PROFILE_ROW, error: null }));
    if (table === "agent_runs") return genericBuilder(() => ({ data: { id: "run-1" }, error: null }));
    if (table === "opportunities") return makeOpportunitiesTable(opportunities);
    if (table === "funders") return makeFundersTable(funders);
    return genericBuilder(() => ({ data: null, error: null }));
  });

  return { from } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("CorporateFoundationsResearchAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // corroborateWithEdgar is real code (not mocked) in these tests - it
    // calls the global `fetch`, which is stubbed here so no real network
    // call happens. Its own try/catch treats a rejected fetch exactly like
    // a real network failure: matched:false, opportunity creation unaffected.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network disabled in test")));

    vi.mocked(searchOrganizations).mockResolvedValue(PROPUBLICA_CANDIDATES as never);

    vi.mocked(fetchLatestFilingGivingSignal).mockImplementation(async (ein: string) => ({
      ein,
      taxYear: CURRENT_YEAR - 1,
      formType: 2,
      contributionsPaidPerBooks: 1_000_000,
      qualifyingDistributions: 900_000,
      totalFunctionalExpenses: 1_200_000,
    }));

    vi.mocked(EligibilityScorer).mockImplementation(
      () => ({ run: vi.fn().mockResolvedValue({ runId: "elig-run", data: {}, tokensUsed: 0, durationMs: 5 }) }) as never,
    );

    vi.mocked(buildKbScorer).mockResolvedValue(null);
    vi.mocked(buildOrgFocusText).mockResolvedValue("");
    vi.mocked(callClaude).mockResolvedValue({
      text: "[]",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters out non-corporate-named candidates before ever fetching their ProPublica filing", async () => {
    const client = makeFakeClient();
    const agent = new CorporateFoundationsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    // Moody Foundation is "weak" (not filtered, real ambiguity documented
    // above) but Smith Family Foundation Inc IS filtered (family marker).
    expect(fetchLatestFilingGivingSignal).not.toHaveBeenCalledWith("333333333");
    expect(outcome.data.nameFiltered).toBe(1);
    expect(outcome.data.candidatesChecked).toBe(3);
  });

  it("creates opportunities only from the corporate-shaped, ProPublica-verified candidates", async () => {
    const client = makeFakeClient();
    const agent = new CorporateFoundationsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.opportunitiesCreated).toBe(3);
    expect(outcome.data.fundersCreated).toBe(3);
  });

  it("skips a candidate with a stale or missing ProPublica filing (never fabricates giving data)", async () => {
    vi.mocked(fetchLatestFilingGivingSignal).mockImplementation(async (ein: string) => {
      if (ein === "111111111") return null; // no ProPublica record at all
      return {
        ein,
        taxYear: CURRENT_YEAR - 1,
        formType: 2,
        contributionsPaidPerBooks: 1_000_000,
        qualifyingDistributions: 900_000,
        totalFunctionalExpenses: 1_200_000,
      };
    });

    const client = makeFakeClient();
    const agent = new CorporateFoundationsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.opportunitiesCreated).toBe(2);
  });

  it("reports a branch error (not a run failure) when the ProPublica search itself throws", async () => {
    vi.mocked(searchOrganizations).mockRejectedValue(new Error("ProPublica is down"));

    const client = makeFakeClient();
    const agent = new CorporateFoundationsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.error).toBe("ProPublica is down");
    expect(outcome.data.opportunitiesCreated).toBe(0);
  });

  it("runs eligibility scoring on every surviving opportunity", async () => {
    const client = makeFakeClient();
    const agent = new CorporateFoundationsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    await agent.run({ profileIds: ["profile-1"] });

    expect(EligibilityScorer).toHaveBeenCalledTimes(3);
  });
});
