import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/claude", () => ({
  DEFAULT_MODEL: "claude-sonnet-4-6",
  callClaude: vi.fn(async () => ({
    text: "This is a complete grant narrative draft with no missing fields.",
    usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    model: "claude-sonnet-4-6",
    stopReason: "end_turn",
  })),
}));

import { DraftGenerationAgent } from "@/lib/agents/draft-generation-agent";
import { callClaude } from "@/lib/ai/claude";

interface MockOpts {
  orgConfig?: Record<string, unknown> | null;
  draftsToday?: number;
  queuePayload?: Record<string, unknown> | null;
  opportunity?: Record<string, unknown> | null;
  funder?: Record<string, unknown> | null;
  orgProfile?: Record<string, unknown> | null;
  kbRows?: Record<string, unknown>[];
  provenRows?: Record<string, unknown>[];
  patternRows?: Record<string, unknown>[];
  twinRow?: Record<string, unknown> | null;
  libraryRows?: Record<string, unknown>[];
  adminProfiles?: Record<string, unknown>[];
}

function createSupabaseMock(opts: MockOpts) {
  const insertedApplications: Record<string, unknown>[] = [];
  const agentDecisions: Record<string, unknown>[] = [];
  const agentRunUpdates: Record<string, unknown>[] = [];
  const touchedTables: string[] = [];

  const client = {
    from: vi.fn((table: string) => {
      touchedTables.push(table);

      switch (table) {
        case "org_autonomous_config": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.maybeSingle = vi.fn(async () => ({
            data: opts.orgConfig ?? null,
            error: null,
          }));
          return b;
        }

        case "applications": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn((_cols: string, sopts?: { count?: string }) => {
            if (sopts?.count) {
              const countBuilder: Record<string, unknown> = {};
              countBuilder.eq = vi.fn(() => countBuilder);
              countBuilder.gte = vi.fn(() => countBuilder);
              countBuilder.then = (resolve: (v: unknown) => unknown) =>
                Promise.resolve({
                  count: opts.draftsToday ?? 0,
                  error: null,
                }).then(resolve);
              return countBuilder;
            }
            return b;
          });
          b.insert = vi.fn((data: Record<string, unknown>) => {
            insertedApplications.push(data);
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: "app-new-1" },
                  error: null,
                })),
              })),
            };
          });
          return b;
        }

        case "agent_queue": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.order = vi.fn(() => b);
          b.limit = vi.fn(() => b);
          b.maybeSingle = vi.fn(async () => ({
            data:
              opts.queuePayload !== undefined
                ? { input_payload: opts.queuePayload }
                : null,
            error: null,
          }));
          return b;
        }

        case "opportunities": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.single = vi.fn(async () => ({
            data: opts.opportunity ?? null,
            error: opts.opportunity ? null : { message: "not found" },
          }));
          return b;
        }

        case "funders": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.maybeSingle = vi.fn(async () => ({
            data: opts.funder ?? null,
            error: null,
          }));
          return b;
        }

        case "organizations": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.single = vi.fn(async () => ({
            data: opts.orgProfile ?? null,
            error: null,
          }));
          return b;
        }

        case "knowledge_base": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.in = vi.fn(() => b);
          b.order = vi.fn(() => b);
          b.then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: opts.kbRows ?? [], error: null }).then(
              resolve,
            );
          return b;
        }

        case "proven_narratives": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.order = vi.fn(() => b);
          b.limit = vi.fn(() => b);
          b.then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve({
              data: opts.provenRows ?? [],
              error: null,
            }).then(resolve);
          return b;
        }

        case "organizational_digital_twins": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.maybeSingle = vi.fn(async () => ({
            data: opts.twinRow ?? null,
            error: null,
          }));
          return b;
        }

        case "intelligence_funded_proposals": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.not = vi.fn(() => b);
          b.order = vi.fn(() => b);
          b.limit = vi.fn(() => b);
          b.then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve({
              data: opts.libraryRows ?? [],
              error: null,
            }).then(resolve);
          return b;
        }

        case "profiles": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.in = vi.fn(() => b);
          b.limit = vi.fn(() => b);
          b.then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve({
              data: opts.adminProfiles ?? [],
              error: null,
            }).then(resolve);
          return b;
        }

        case "platform_learning_patterns": {
          const b: Record<string, unknown> = {};
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.is = vi.fn(() => b);
          b.order = vi.fn(() => b);
          b.limit = vi.fn(() => b);
          b.then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve({
              data: opts.patternRows ?? [],
              error: null,
            }).then(resolve);
          return b;
        }

        case "agent_runs": {
          const b: Record<string, unknown> = {};
          b.insert = vi.fn(() => b);
          b.update = vi.fn((data: Record<string, unknown>) => {
            agentRunUpdates.push(data);
            return b;
          });
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.single = vi.fn(async () => ({ data: { id: "run-1" }, error: null }));
          b.then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve);
          return b;
        }

        case "agent_decisions": {
          const b: Record<string, unknown> = {};
          b.insert = vi.fn((data: Record<string, unknown>) => {
            agentDecisions.push(data);
            return b;
          });
          b.select = vi.fn(() => b);
          b.single = vi.fn(async () => ({ data: { id: "dec-1" }, error: null }));
          return b;
        }

        case "alerts": {
          const b: Record<string, unknown> = {};
          b.insert = vi.fn(() => Promise.resolve({ data: null, error: null }));
          // Also used for the twin-completeness-low dedup check
          // (select().eq().like().gte().limit().maybeSingle()) --
          // draft-generation-agent.ts queries `alerts` both ways.
          b.select = vi.fn(() => b);
          b.eq = vi.fn(() => b);
          b.like = vi.fn(() => b);
          b.gte = vi.fn(() => b);
          b.limit = vi.fn(() => b);
          b.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
          return b;
        }

        default:
          throw new Error(`Unexpected table in test mock: ${table}`);
      }
    }),
  };

  return {
    client,
    insertedApplications,
    agentDecisions,
    agentRunUpdates,
    touchedTables,
  };
}

const BASE_OPPORTUNITY = {
  id: "opp-1",
  name: "Rural Housing Grant",
  category: "housing",
  description: "Funding for transitional housing.",
  amount_min: 10000,
  amount_max: 50000,
  deadline: "2026-09-01",
  eligibility_requirements: "501(c)(3) status required.",
  funder_id: "funder-1",
};

const BASE_ORG_PROFILE = {
  name: "Faith Foundation",
  mission_statement: "Serve rural Texas families in housing crisis.",
  vision_statement: "A community where no one goes without shelter.",
  service_area: "Rural Texas",
  target_population: "Families experiencing homelessness",
  founder_name: "Reid Whitesides",
  annual_budget: 500000,
};

describe("DraftGenerationAgent — hard limits", () => {
  beforeEach(() => {
    vi.mocked(callClaude).mockClear();
  });

  it("never sets submitted_at on the created application", async () => {
    const mock = createSupabaseMock({
      orgConfig: { max_auto_drafts_per_night: 10 },
      draftsToday: 0,
      queuePayload: {
        opportunityId: "opp-1",
        score: 82,
        title: "Rural Housing Grant",
        funderId: "funder-1",
      },
      opportunity: BASE_OPPORTUNITY,
      funder: { name: "Test Funder" },
      orgProfile: BASE_ORG_PROFILE,
      kbRows: [{ title: "Mission", category: "mission", content: "..." }],
      provenRows: [],
      patternRows: [],
    });

    const agent = new DraftGenerationAgent("org-1", mock.client as never);
    const result = await agent.run("chain");

    expect(result.success).toBe(true);
    expect(mock.insertedApplications).toHaveLength(1);
    const app = mock.insertedApplications[0];
    expect("submitted_at" in app).toBe(false);
    expect(app.submitted_at).toBeUndefined();
  });

  it("always sets pending_review=true and auto_generated=true on created applications", async () => {
    const mock = createSupabaseMock({
      orgConfig: { max_auto_drafts_per_night: 10 },
      draftsToday: 0,
      queuePayload: {
        opportunityId: "opp-1",
        score: 91,
        title: "Rural Housing Grant",
        funderId: "funder-1",
      },
      opportunity: BASE_OPPORTUNITY,
      funder: { name: "Test Funder" },
      orgProfile: BASE_ORG_PROFILE,
      kbRows: [],
      provenRows: [],
      patternRows: [],
    });

    const agent = new DraftGenerationAgent("org-1", mock.client as never);
    const result = await agent.run("chain");

    expect(result.success).toBe(true);
    const app = mock.insertedApplications[0];
    expect(app.pending_review).toBe(true);
    expect(app.auto_generated).toBe(true);
    expect(app.draft_source).toBe("autonomous");
    expect(app.stage).toBe("drafting");
    // The agent runs a five-phase pipeline (narrative strategy + one call
    // per section, plus the humanizer's own Claude passes) rather than a
    // single-shot generation call -- see this file's header comment on the
    // "FULL AGENTIC UPGRADE" that replaced the old single-call design.
    // Asserting an exact count here would pin this test to that internal
    // call fan-out instead of the behavior that matters: Claude was used to
    // generate the draft at all.
    expect(callClaude).toHaveBeenCalled();
  });

  it("stops at max_auto_drafts_per_night and creates no draft", async () => {
    const mock = createSupabaseMock({
      orgConfig: { max_auto_drafts_per_night: 3 },
      draftsToday: 3,
      // Deliberately no queuePayload/opportunity/orgProfile — if the agent
      // reads past the daily-limit check it will hit an unmocked table and
      // this test fails loudly instead of silently passing.
    });

    const agent = new DraftGenerationAgent("org-1", mock.client as never);
    const result = await agent.run("chain");

    expect(result.success).toBe(true);
    expect(result.itemsProcessed).toBe(0);
    expect(mock.insertedApplications).toHaveLength(0);
    expect(mock.touchedTables).not.toContain("agent_queue");
    expect(mock.touchedTables).not.toContain("opportunities");

    const decision = mock.agentDecisions[0];
    expect(decision?.decision_type).toBe("draft_generation_skipped");
    expect(decision?.action_taken).toBe("skipped_daily_limit_reached");

    const runUpdate = mock.agentRunUpdates[0];
    expect(runUpdate?.status).toBe("completed");
    expect(JSON.parse(runUpdate?.output_summary as string)).toEqual({
      skipped: true,
      reason: "daily_limit_reached",
    });
  });
});
