// E2E-style orchestration test for the upgraded GovernmentGrantsResearchAgent
// (AGENTS.md Agent 14 - see that file's header for the Agent-12-vs-14 naming
// note). Exercises the NEW parallel-branch orchestration, KB semantic
// filtering, and Claude reflection pass end-to-end against a fake Supabase
// client and mocked sub-agents/API clients — no real network calls, no real
// Claude/OpenAI calls. The pre-existing profile-driven web-search branch's
// internals are untouched by this change (only extracted into a method) and
// are kept inert here (mocked `search` returns no candidates) so this test
// focuses on what actually changed.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agents/research/search-engine", () => ({
  search: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/sources/grantsgov-sync", () => ({
  syncGrantsGovForOrg: vi.fn(),
}));
vi.mock("@/lib/agents/sam-gov", () => ({
  SamGovResearchAgent: vi.fn(),
}));
vi.mock("@/lib/agents/hud-monitor", () => ({
  HudMonitorAgent: vi.fn(),
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

import { GovernmentGrantsResearchAgent } from "@/lib/agents/research/government-grants";
import { syncGrantsGovForOrg } from "@/lib/sources/grantsgov-sync";
import { SamGovResearchAgent } from "@/lib/agents/sam-gov";
import { HudMonitorAgent } from "@/lib/agents/hud-monitor";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";
import { buildKbScorer, buildOrgFocusText } from "@/lib/agents/research/kb-relevance";
import { callClaude } from "@/lib/ai/claude";

const PROFILE_ROW = {
  id: "profile-1",
  name: "Housing Focus",
  keywords: ["transitional housing"],
  categories: [],
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
};

const SWEPT_ROWS = [
  { id: "opp-keep", name: "Reentry Housing Grant", description: "supports reentry housing" },
  { id: "opp-kb-reject", name: "Unrelated Grant", description: "KB_REJECT marker: deep sea research" },
  { id: "opp-reflect-reject", name: "Housing-Adjacent Grant", description: "sounds housing-related but isn't" },
];

function makeChainable(resolveValue: () => unknown) {
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

function makeFakeClient() {
  let opportunitiesSelectCall = 0;

  const from = vi.fn((table: string) => {
    if (table === "search_profiles") {
      return makeChainable(() => ({ data: PROFILE_ROW, error: null }));
    }
    if (table === "agent_runs") {
      return makeChainable(() => ({ data: { id: "run-1" }, error: null }));
    }
    if (table === "opportunities") {
      return makeChainable(() => {
        opportunitiesSelectCall++;
        // Call 1: sweepNewOpportunityIds. Call 2: applyKbFilter lookup.
        // Call 3: applyReflectionFilter lookup. Deletes don't read this value.
        if (opportunitiesSelectCall === 1) {
          return { data: SWEPT_ROWS.map((r) => ({ id: r.id })), error: null };
        }
        if (opportunitiesSelectCall === 2) {
          return { data: SWEPT_ROWS, error: null };
        }
        return {
          data: SWEPT_ROWS.filter((r) => r.id !== "opp-kb-reject").map((r) => ({
            ...r,
            category: "housing_grant",
          })),
          error: null,
        };
      });
    }
    return makeChainable(() => ({ data: null, error: null }));
  });

  return { from } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("GovernmentGrantsResearchAgent (parallel orchestration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    vi.mocked(syncGrantsGovForOrg).mockResolvedValue({
      newCount: 2,
      updatedCount: 0,
      keywordsSearched: 1,
    });

    vi.mocked(HudMonitorAgent).mockImplementation(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            runId: "hud-run",
            data: { opportunities: [], count: 0, opportunitiesCreated: 1 },
            tokensUsed: 0,
            durationMs: 10,
          }),
        }) as never,
    );

    vi.mocked(EligibilityScorer).mockImplementation(
      () => ({ run: vi.fn().mockResolvedValue({ runId: "elig-run", data: {}, tokensUsed: 0, durationMs: 5 }) }) as never,
    );

    vi.mocked(buildKbScorer).mockResolvedValue({
      score: vi.fn(async (text: string) => (text.includes("KB_REJECT") ? 5 : 60)),
    });
    vi.mocked(buildOrgFocusText).mockResolvedValue("housing, reentry, recovery");

    vi.mocked(callClaude).mockResolvedValue({
      text: JSON.stringify([
        { id: "opp-keep", keep: true, reason: "fits the org's housing/reentry mission" },
        { id: "opp-reflect-reject", keep: false, reason: "sounds related but is a domain mismatch" },
      ]),
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    } as never);
  });

  it("runs all 3 dedicated-API branches in parallel and reports per-source outcomes", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "");

    const client = makeFakeClient();
    const agent = new GovernmentGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "grants_gov", ok: true, created: 2 }),
        expect.objectContaining({ source: "sam_gov", ok: true, created: 0, skipped: expect.any(String) }),
        expect.objectContaining({ source: "hud", ok: true, created: 1 }),
      ]),
    );
    expect(syncGrantsGovForOrg).toHaveBeenCalledTimes(1);
    expect(SamGovResearchAgent).not.toHaveBeenCalled();
    expect(HudMonitorAgent).toHaveBeenCalledTimes(1);
  });

  it("removes the KB-irrelevant discovery and the reflection-rejected discovery, keeping only the real match", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "");

    const client = makeFakeClient();
    const agent = new GovernmentGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.kbFiltered).toBe(1);
    expect(outcome.data.reflectionFiltered).toBe(1);
    // 2 (grants_gov) + 0 (sam_gov, skipped) + 1 (hud) - 1 (kb) - 1 (reflection) = 1 survivor.
    expect(outcome.data.opportunitiesCreated).toBe(1);
  });

  it("runs eligibility scoring only on the surviving opportunity", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "");

    const client = makeFakeClient();
    const agent = new GovernmentGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    await agent.run({ profileIds: ["profile-1"] });

    expect(EligibilityScorer).toHaveBeenCalledTimes(1);
    const scorerInstance = vi.mocked(EligibilityScorer).mock.results[0]?.value as { run: ReturnType<typeof vi.fn> };
    expect(scorerInstance.run).toHaveBeenCalledWith({ opportunityId: "opp-keep" });
  });

  it("runs SAM.gov when SAM_GOV_API_KEY is configured", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "test-key");
    vi.mocked(SamGovResearchAgent).mockImplementation(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            runId: "sam-run",
            data: { opportunities: [], count: 0, opportunitiesCreated: 3 },
            tokensUsed: 0,
            durationMs: 10,
          }),
        }) as never,
    );

    const client = makeFakeClient();
    const agent = new GovernmentGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(SamGovResearchAgent).toHaveBeenCalledTimes(1);
    expect(outcome.data.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "sam_gov", ok: true, created: 3 })]),
    );
  });

  it("fails open on a branch error: a failed source is reported but does not sink the run", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "");
    vi.mocked(syncGrantsGovForOrg).mockRejectedValue(new Error("Grants.gov is down"));

    const client = makeFakeClient();
    const agent = new GovernmentGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "grants_gov", ok: false, error: "Grants.gov is down" }),
      ]),
    );
    // hud still ran and its outcome still counts, despite grants_gov failing.
    expect(outcome.data.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "hud", ok: true, created: 1 })]),
    );
  });

  it("fails open on KB filtering when there is nothing to score against (buildKbScorer returns null)", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "");
    vi.mocked(buildKbScorer).mockResolvedValue(null);

    const client = makeFakeClient();
    const agent = new GovernmentGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    // Nothing removed by KB filtering; reflection still removes its one pick.
    expect(outcome.data.kbFiltered).toBe(0);
    expect(outcome.data.reflectionFiltered).toBe(1);
  });

  it("fails open on the reflection pass when Claude errors", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "");
    vi.mocked(callClaude).mockRejectedValue(new Error("Claude unavailable"));

    const client = makeFakeClient();
    const agent = new GovernmentGrantsResearchAgent({
      client,
      organizationId: "org-1",
      triggeredBy: "user-1",
    });

    const outcome = await agent.run({ profileIds: ["profile-1"] });

    expect(outcome.data.reflectionFiltered).toBe(0);
  });
});
