// State Portal Research Agent (AGENTS.md Agent 18) — profile-driven mode.
//
// Proves the extension made 2026-09-06: the agent now reads each org's REAL
// configured geographic scope (search_profiles.geographic_scopes / legacy
// geographic_scope — the actual organization knowledge-base config written by
// the Search Profile Configuration page) rather than organizations.state or a
// caller-supplied `state` param, and scopes its portal search accordingly.
//
// Only Texas is a real, live-verified registered portal (portal-registry.ts).
// So "for at least two different states" is proven honestly, without
// fabricating a second portal this session hasn't verified is reachable:
//   - Texas: a profile whose configured scope names it gets a REAL portal
//     fetch + Claude extraction + insert.
//   - California (or any other state): a profile whose configured scope names
//     it is read correctly (its geographic_scope IS inspected) but produces
//     NO fetch and NO fabricated result, because no portal is registered for
//     it — proving the agent never invents coverage for an unverified state.
// A third test runs both profiles through ONE sweep to prove the agent
// correctly separates per-profile scopes within a single run, and a fourth
// proves the pre-existing explicit-state contract (settings-page "Run Now")
// is unchanged (zero regressions for that caller).
//
// No real network calls, no real Claude calls: fetch and callClaude are both
// mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agents/research/government-grants", () => ({
  // Stubbed so this test doesn't have to satisfy government-grants.ts's own
  // (unrelated) transitive dependency graph — GOVERNMENT_CATEGORIES is a
  // plain exported const the real module also just exports verbatim.
  GOVERNMENT_CATEGORIES: ["government_grant", "housing_grant", "education_grant"],
}));
vi.mock("@/lib/billing/usage-tracker", () => ({
  trackUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/claude", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/claude")>("@/lib/ai/claude");
  return { ...actual, callClaude: vi.fn() };
});

import { StatePortalResearchAgent } from "@/lib/agents/state-portal";
import { callClaude } from "@/lib/ai/claude";
import { PORTAL_REGISTRY } from "@/lib/sources/state-portals/portal-registry";

// The one real, live-verified portal in the registry (portal-registry.ts).
const TEXAS_PORTAL_URL = "https://egrants.gov.texas.gov/fundingopp";

function baseProfileRow(overrides: Record<string, unknown>) {
  return {
    id: "profile-id",
    name: "Profile",
    keywords: ["housing"],
    categories: ["government_grant"],
    geographic_scope: null,
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
    ...overrides,
  };
}

const PROFILE_TEXAS = baseProfileRow({
  id: "profile-tx",
  name: "Texas Housing Focus",
  geographic_scope: "Texas",
  geographic_scopes: ["Texas"],
});

const PROFILE_CALIFORNIA = baseProfileRow({
  id: "profile-ca",
  name: "California Housing Focus",
  geographic_scope: "California",
  geographic_scopes: ["California"],
});

const PROFILE_MULTI_SCOPE = baseProfileRow({
  id: "profile-multi",
  name: "Multi-scope Focus",
  geographic_scope: "Nationwide",
  geographic_scopes: ["Nationwide", "Texas"],
});

/** A minimal, table-aware fake Supabase client covering exactly what the agent touches. */
function makeFakeClient(profileRows: Array<Record<string, unknown>>) {
  const searchProfileUpdates: string[] = [];
  const insertedOpportunities: Array<Record<string, unknown>> = [];

  const from = vi.fn((table: string) => {
    if (table === "search_profiles") {
      let idFilter: string | undefined;
      let mode: "select" | "update" = "select";
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        update: vi.fn(() => {
          mode = "update";
          return builder;
        }),
        eq: vi.fn((col: string, val: string) => {
          if (col === "id") idFilter = val;
          return builder;
        }),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: profileRows.find((r) => r.id === idFilter) ?? null,
            error: null,
          }),
        ),
        then: (onFulfilled: (v: unknown) => unknown) => {
          if (mode === "update" && idFilter) searchProfileUpdates.push(idFilter);
          return Promise.resolve({ error: null }).then(onFulfilled);
        },
      };
      return builder;
    }

    if (table === "opportunities") {
      let mode: "select" | "insert" = "select";
      let insertRow: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        insert: vi.fn((row: Record<string, unknown>) => {
          mode = "insert";
          insertRow = row;
          return builder;
        }),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })), // never a pre-existing dup
        then: (onFulfilled: (v: unknown) => unknown) => {
          if (mode === "insert" && insertRow) insertedOpportunities.push(insertRow);
          return Promise.resolve({ error: null }).then(onFulfilled);
        },
      };
      return builder;
    }

    if (table === "agent_runs") {
      const builder: Record<string, unknown> = {
        insert: vi.fn(() => builder),
        update: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        select: vi.fn(() => builder),
        single: vi.fn(() => Promise.resolve({ data: { id: "run-1" }, error: null })),
        then: (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(onFulfilled),
      };
      return builder;
    }

    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      insert: vi.fn(() => builder),
      update: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled),
    };
    return builder;
  });

  return {
    client: { from } as unknown as import("@supabase/supabase-js").SupabaseClient,
    searchProfileUpdates,
    insertedOpportunities,
  };
}

const CLAUDE_EXTRACTION = {
  text: JSON.stringify([
    {
      title: "Texas Rural Water Assistance Grant",
      agency: "TX Water Development Board",
      deadline: "2026-11-01",
      amount: "Up to $75,000",
      eligibility: "Rural municipalities",
      url: "https://egrants.gov.texas.gov/opp/123",
    },
  ]),
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
};

describe("StatePortalResearchAgent — geographic_scope-driven mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("registers exactly one real portal (Texas) — the fixture this whole suite relies on", () => {
    // Guards against the test suite silently going stale if the registry changes.
    expect(PORTAL_REGISTRY.map((p) => p.stateCode)).toEqual(["TX"]);
  });

  it("reads a profile's configured geographic_scope 'Texas' and fetches the REAL Texas portal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<html>Texas grant listings</html>"),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(callClaude).mockResolvedValue(CLAUDE_EXTRACTION as never);

    const { client, insertedOpportunities } = makeFakeClient([PROFILE_TEXAS]);
    const agent = new StatePortalResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: null,
    });

    const outcome = await agent.run({ profileIds: ["profile-tx"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(TEXAS_PORTAL_URL);
    expect(outcome.data.results).toEqual([
      expect.objectContaining({ state: "Texas", count: 1, opportunitiesCreated: 1 }),
    ]);
    expect(outcome.data.opportunitiesCreated).toBe(1);
    expect(insertedOpportunities).toHaveLength(1);
    expect(insertedOpportunities[0]).toMatchObject({
      source: "texas",
      source_type: "government_state",
      category: "government_grant",
    });
  });

  it("reads a profile's configured geographic_scope 'California' but fetches NOTHING — no portal is registered, so no coverage is fabricated", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { client } = makeFakeClient([PROFILE_CALIFORNIA]);
    const agent = new StatePortalResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: null,
    });

    const outcome = await agent.run({ profileIds: ["profile-ca"] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(callClaude).not.toHaveBeenCalled();
    expect(outcome.data.results).toEqual([]);
    expect(outcome.data.count).toBe(0);
    expect(outcome.data.opportunitiesCreated).toBe(0);
  });

  it("in one sweep, correctly separates two profiles by their own distinct geographic_scope: Texas is queried, California is not", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<html>Texas grant listings</html>"),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(callClaude).mockResolvedValue(CLAUDE_EXTRACTION as never);

    const { client, searchProfileUpdates } = makeFakeClient([
      PROFILE_TEXAS,
      PROFILE_CALIFORNIA,
    ]);
    const agent = new StatePortalResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: null,
    });

    const outcome = await agent.run({ profileIds: ["profile-tx", "profile-ca"] });

    // Exactly one portal fetch (Texas) despite two active, in-scope profiles.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(TEXAS_PORTAL_URL);
    expect(outcome.data.results.map((r) => r.state)).toEqual(["Texas"]);
    // Both profiles were real inputs this sweep considered — both get their
    // last_run_at stamped, even though only one produced a portal hit.
    expect(searchProfileUpdates).toEqual(
      expect.arrayContaining(["profile-tx", "profile-ca"]),
    );
  });

  it("resolves the real match out of a profile's several configured scopes ('Nationwide', 'Texas') rather than fabricating coverage for the unmatched one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<html>Texas grant listings</html>"),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(callClaude).mockResolvedValue(CLAUDE_EXTRACTION as never);

    const { client } = makeFakeClient([PROFILE_MULTI_SCOPE]);
    const agent = new StatePortalResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: null,
    });

    const outcome = await agent.run({ profileIds: ["profile-multi"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.data.results).toEqual([
      expect.objectContaining({ state: "Texas" }),
    ]);
  });

  it("leaves the pre-existing explicit-state contract (settings-page 'Run Now') unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<html>Texas grant listings</html>"),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(callClaude).mockResolvedValue(CLAUDE_EXTRACTION as never);

    const { client } = makeFakeClient([]);
    const agent = new StatePortalResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ state: "TX", keywords: ["housing"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(TEXAS_PORTAL_URL);
    expect(outcome.data.state).toBe("Texas");
    expect(outcome.data.opportunitiesCreated).toBe(1);
  });
});
