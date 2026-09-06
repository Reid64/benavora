// E2E-style orchestration test for the upgraded FoundationGrantsResearchAgent
// (AGENTS.md Agent 13). Exercises the NEW parallel-branch orchestration (web
// search + ProPublica 990-PF), KB semantic filtering, and Claude reflection
// pass end-to-end against a fake, stateful in-memory Supabase client and
// mocked network clients/sub-agents — no real network calls, no real
// Claude/OpenAI calls. The pre-existing profile-driven web-search branch's
// internals are untouched by this change (only extracted into a method) and
// are kept inert here (mocked `search` returns no candidates) so this test
// focuses on what actually changed.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agents/research/search-engine", () => ({
  search: vi.fn().mockResolvedValue([]),
}));
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

import { FoundationGrantsResearchAgent, resolveStateCode } from "@/lib/agents/research/foundation-grants";
import { searchOrganizations } from "@/lib/donor-discovery/adapters/propublica-adapter";
import { fetchLatestFilingGivingSignal } from "@/lib/sources/propublica-990-client";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";
import { buildKbScorer, buildOrgFocusText } from "@/lib/agents/research/kb-relevance";
import { callClaude } from "@/lib/ai/claude";

const CURRENT_YEAR = new Date().getFullYear();

const PROFILE_ROW = {
  id: "profile-1",
  name: "Housing Focus",
  keywords: ["transitional housing"],
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

// 5 ProPublica candidates covering every branch of the giving-verification
// gate: one real recent-and-giving foundation that should survive end to
// end, one with a stale filing, one with no ProPublica filing at all, one
// that gets removed by KB relevance, and one that gets removed by the
// Claude reflection pass.
const PROPUBLICA_CANDIDATES = [
  { ein: "111111111", name: "Real Giving Foundation", city: "Austin", state: "TX", ntee_code: "T20", have_filings: true },
  { ein: "222222222", name: "Stale Foundation", city: "Dallas", state: "TX", ntee_code: "T20", have_filings: true },
  { ein: "333333333", name: "No Filing Foundation", city: "Waco", state: "TX", ntee_code: "T20", have_filings: false },
  { ein: "444444444", name: "Irrelevant Foundation", city: "Houston", state: "TX", ntee_code: "T20", have_filings: true },
  { ein: "555555555", name: "Adjacent Foundation", city: "Plano", state: "TX", ntee_code: "T20", have_filings: true },
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

/** A real, stateful in-memory `opportunities` table so insert → select → delete round-trips faithfully. */
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

/** A real, stateful in-memory `funders` table (lookup-by-name, then create-on-miss). */
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

describe("FoundationGrantsResearchAgent (parallel orchestration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(searchOrganizations).mockResolvedValue(PROPUBLICA_CANDIDATES as never);

    vi.mocked(fetchLatestFilingGivingSignal).mockImplementation(async (ein: string) => {
      if (ein === "222222222") {
        // Stale filing (well outside the freshness window) - must be skipped.
        return {
          ein,
          taxYear: CURRENT_YEAR - 20,
          formType: 2,
          contributionsPaidPerBooks: 100_000,
          qualifyingDistributions: 90_000,
          totalFunctionalExpenses: 120_000,
        };
      }
      if (ein === "333333333") {
        // No ProPublica filing at all for this candidate.
        return null;
      }
      // 111111111 / 444444444 / 555555555: recent, real, positive giving.
      return {
        ein,
        taxYear: CURRENT_YEAR - 1,
        formType: 2,
        contributionsPaidPerBooks: 500_000,
        qualifyingDistributions: 450_000,
        totalFunctionalExpenses: 600_000,
      };
    });

    vi.mocked(EligibilityScorer).mockImplementation(
      () => ({ run: vi.fn().mockResolvedValue({ runId: "elig-run", data: {}, tokensUsed: 0, durationMs: 5 }) }) as never,
    );

    // KB filter rejects the "Irrelevant Foundation" candidate by name; every
    // other candidate scores comfortably above the reject threshold.
    vi.mocked(buildKbScorer).mockResolvedValue({
      score: vi.fn(async (text: string) => (text.includes("Irrelevant Foundation") ? 5 : 60)),
    });
    vi.mocked(buildOrgFocusText).mockResolvedValue("housing, reentry, recovery");

    // Reflection keeps the real survivor, rejects "Adjacent Foundation" as a
    // domain mismatch. (Irrelevant Foundation never reaches this stage - it
    // was already removed by the KB filter.)
    vi.mocked(callClaude).mockResolvedValue({
      text: JSON.stringify([
        { id: "opp-real-giving-foundation", keep: true, reason: "fits the org's housing/reentry mission" },
        { id: "opp-adjacent-foundation", keep: false, reason: "sounds related but is a domain mismatch" },
      ]),
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    } as never);
  });

  it("runs the web-search and ProPublica branches in parallel and reports the per-source outcome", async () => {
    const client = makeFakeClient();
    const agent = new FoundationGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(searchOrganizations).toHaveBeenCalledWith(
      expect.objectContaining({ state: "TX", nteeId: 7 }),
    );
    // 3 of the 5 candidates pass the recency+giving gate and get inserted
    // (stale-filing and no-filing candidates never reach an insert).
    expect(outcome.data.sources).toEqual([
      expect.objectContaining({ source: "propublica_990pf", ok: true, created: 3, candidatesChecked: 5 }),
    ]);
  });

  it("skips candidates with a stale filing or no ProPublica record at all", async () => {
    const client = makeFakeClient();
    const agent = new FoundationGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    await agent.run({ profileIds: ["profile-1"] });

    expect(fetchLatestFilingGivingSignal).toHaveBeenCalledWith("222222222");
    expect(fetchLatestFilingGivingSignal).toHaveBeenCalledWith("333333333");
    // Neither Stale Foundation nor No Filing Foundation ever reach checkDuplicate
    // twice or an insert - verified indirectly via the created count above.
  });

  it("removes the KB-irrelevant discovery and the reflection-rejected discovery, keeping only the real match", async () => {
    const client = makeFakeClient();
    const agent = new FoundationGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.kbFiltered).toBe(1);
    expect(outcome.data.reflectionFiltered).toBe(1);
    // 3 created by the branch - 1 (KB) - 1 (reflection) = 1 survivor.
    expect(outcome.data.opportunitiesCreated).toBe(1);
  });

  it("runs eligibility scoring only on the surviving opportunity", async () => {
    const client = makeFakeClient();
    const agent = new FoundationGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    await agent.run({ profileIds: ["profile-1"] });

    expect(EligibilityScorer).toHaveBeenCalledTimes(1);
    const scorerInstance = vi.mocked(EligibilityScorer).mock.results[0]?.value as { run: ReturnType<typeof vi.fn> };
    expect(scorerInstance.run).toHaveBeenCalledWith({ opportunityId: "opp-real-giving-foundation" });
  });

  it("fails open on KB filtering when there is nothing to score against (buildKbScorer returns null)", async () => {
    vi.mocked(buildKbScorer).mockResolvedValue(null);
    // With KB filtering skipped, "Irrelevant Foundation" now reaches
    // reflection too - keep it there so only the true mismatch is removed.
    vi.mocked(callClaude).mockResolvedValue({
      text: JSON.stringify([
        { id: "opp-real-giving-foundation", keep: true, reason: "fits mission" },
        { id: "opp-irrelevant-foundation", keep: true, reason: "uncertain, keep" },
        { id: "opp-adjacent-foundation", keep: false, reason: "domain mismatch" },
      ]),
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    } as never);

    const client = makeFakeClient();
    const agent = new FoundationGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.kbFiltered).toBe(0);
    expect(outcome.data.reflectionFiltered).toBe(1);
  });

  it("fails open on the reflection pass when Claude errors", async () => {
    vi.mocked(callClaude).mockRejectedValue(new Error("Claude unavailable"));

    const client = makeFakeClient();
    const agent = new FoundationGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.reflectionFiltered).toBe(0);
  });

  it("reports a failed source (not a run failure) when the ProPublica search itself throws", async () => {
    vi.mocked(searchOrganizations).mockRejectedValue(new Error("ProPublica is down"));

    const client = makeFakeClient();
    const agent = new FoundationGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.sources).toEqual([
      expect.objectContaining({ source: "propublica_990pf", ok: false, error: "ProPublica is down" }),
    ]);
    expect(outcome.data.opportunitiesCreated).toBe(0);
  });
});

describe("resolveStateCode", () => {
  it("resolves a full state name to its USPS code", () => {
    expect(resolveStateCode([{ geographicScope: "Texas" } as never])).toBe("TX");
  });

  it("passes through an already-2-letter code", () => {
    expect(resolveStateCode([{ geographicScope: "ca" } as never])).toBe("CA");
  });

  it("falls back to the default state when no profile states a recognizable scope", () => {
    expect(resolveStateCode([{ geographicScope: null } as never])).toBe("TX");
  });
});
