/**
 * Unit tests for the research agent trigger route.
 *
 * Route covered:
 *   POST /api/agents/research  (src/app/api/agents/research/route.ts)
 *
 * Notes from reading the actual route file:
 *
 *   - There is NO GET handler and no /runs sub-route on this path.
 *     Run history lives at /api/agents/research/status.
 *
 *   - There is NO "in-progress" 409. Concurrent requests are guarded by an
 *     in-memory rate limiter (20 req/min per org) returning 429.
 *
 *   - The agentType flow requires a feature flag: platform_config row where
 *     key = "feature.research_agents" and value = "true". Without it → 403.
 *
 *   - The multi-source flow (sources array) does NOT require the feature flag.
 *
 *   - Valid agentTypes: "corporate_research" | "foundation_research" |
 *     "government_research" | "local_sponsorship" | "all".
 *
 *   - Valid sources: "grants_gov" | "sam_gov" | "simpler_grants" | "hud" |
 *     "tdhca" | "corporate" | "all".
 *
 * Auth is gated by requireRole("writer"). Viewers receive a 403.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ── module mocks (hoisted) ────────────────────────────────────────────────────

// Role gate — controlled per-test.
const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role-gate", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

// Supabase server client — controlled per-test via mockCreateClient.
const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

// Billing / tier gates — allow by default.
vi.mock("@/lib/billing/tier-enforcer", () => ({
  enforceLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/services/tier-gate", () => ({
  checkTierGate: vi.fn().mockResolvedValue({ allowed: true, limit: 200 }),
}));

// AI config constants.
vi.mock("@/lib/ai/claude", () => ({
  DEFAULT_MAX_TOKENS: 8192,
  DEFAULT_MODEL: "claude-sonnet-4-6",
}));

// Audit logger.
vi.mock("@/lib/audit/logger", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// All agent classes used by the research route — stub run() to resolve cleanly.
const mockAgentRun = vi.fn().mockResolvedValue({ runId: "r1", data: { found: 0, created: 0 } });

vi.mock("@/lib/agents/research/corporate-giving", () => ({
  CorporateGivingResearchAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/research/foundation-grants", () => ({
  FoundationGrantsResearchAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/research/government-grants", () => ({
  GovernmentGrantsResearchAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/research/local-sponsorship", () => ({
  LocalSponsorshipResearchAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/research/orchestrator", () => ({
  runResearchAgentsInParallel: vi.fn().mockResolvedValue({
    lanes: [],
    totalFound: 0,
    totalCreated: 0,
    duplicatesRemoved: 0,
    opportunitiesValidated: 0,
    opportunitiesVerified: 0,
    durationMs: 0,
  }),
}));
vi.mock("@/lib/agents/corporate-scraper", () => ({
  CorporateScraperAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/grants-gov", () => ({
  GrantsGovResearchAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/hud-monitor", () => ({
  HudMonitorAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/sam-gov", () => ({
  SamGovResearchAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/simpler-grants", () => ({
  SimplerGrantsResearchAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/tdhca-scraper", () => ({
  TdhcaScraperAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/grant-summary", () => ({
  GrantSummaryAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/eligibility-scorer", () => ({
  EligibilityScorer: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));
vi.mock("@/lib/agents/base-agent", () => ({
  AgentError: class AgentError extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

// ── import route handler AFTER mocks ─────────────────────────────────────────

import { POST } from "@/app/api/agents/research/route";

// ── constants & helpers ───────────────────────────────────────────────────────

const ORG_ID = "org-research-test";
const USER_ID = "user-research-test";
const PROFILE_ID = "profile-research-test";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/agents/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Build a chainable Supabase query mock that resolves to `result`. */
function makeChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: vi.fn((resolve: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(resolve(result))
    ),
  };
}

/**
 * Build a mock Supabase client for the agentType flow.
 *
 * table calls during the agentType path:
 *   1. profiles    → returns the current user's profile
 *   2. platform_config (feature flag) → controlled by featureEnabled
 *   3. platform_config (ai config)    → returns empty (uses defaults)
 *   4. search_profiles                → keywords
 */
function makeResearchClient({
  featureEnabled = true,
}: { featureEnabled?: boolean } = {}) {
  const callCounts: Record<string, number> = {};

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      callCounts[table] = (callCounts[table] ?? 0) + 1;

      if (table === "profiles") {
        return makeChain({
          data: { id: PROFILE_ID, organization_id: ORG_ID },
          error: null,
        });
      }
      if (table === "platform_config") {
        // First call: feature flag (maybeSingle). Second call: ai config (then).
        const count = callCounts[table] ?? 1;
        if (count === 1) {
          return makeChain({
            data: featureEnabled ? { value: "true" } : null,
            error: null,
          });
        }
        // ai.model / ai.max_tokens config query — returns empty array
        return makeChain({ data: [], error: null });
      }
      if (table === "search_profiles") {
        return makeChain({ data: [], error: null });
      }
      if (table === "opportunities") {
        return makeChain({ data: [], error: null });
      }
      return makeChain({ data: null, error: null });
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

/** Gate that passes (writer role). */
function writerGate() {
  return {
    supabase: makeResearchClient(),
    userId: USER_ID,
    userRole: "writer" as const,
    organizationId: ORG_ID,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/agents/research", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentRun.mockResolvedValue({ runId: "r1", data: { found: 0, created: 0 } });
  });

  // ── authentication ──────────────────────────────────────────────────────────

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue({
      error: NextResponse.json(
        { error: "Authentication required.", code: "unauthenticated" },
        { status: 401 },
      ),
    });

    const res = await POST(makeRequest({ agentType: "corporate_research" }));

    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("unauthenticated");
  });

  it("returns 403 for viewer role (writer required)", async () => {
    mockRequireRole.mockResolvedValue({
      error: NextResponse.json(
        {
          error: "You do not have permission to perform this action.",
          code: "forbidden",
        },
        { status: 403 },
      ),
    });

    const res = await POST(makeRequest({ agentType: "corporate_research" }));

    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("forbidden");
  });

  // ── input validation ────────────────────────────────────────────────────────

  it("returns 400 for an invalid agentType", async () => {
    mockRequireRole.mockResolvedValue(writerGate());
    mockCreateClient.mockReturnValue(makeResearchClient());

    const res = await POST(makeRequest({ agentType: "invalid_agent_type" }));

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("invalid_input");
  });

  it("returns 400 for a missing agentType (no body field)", async () => {
    mockRequireRole.mockResolvedValue(writerGate());
    mockCreateClient.mockReturnValue(makeResearchClient());

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("invalid_input");
  });

  it("returns 400 for sources array with no valid source keys", async () => {
    mockRequireRole.mockResolvedValue(writerGate());
    mockCreateClient.mockReturnValue(makeResearchClient());

    const res = await POST(makeRequest({ sources: ["not_a_source", "fake"] }));

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("invalid_input");
  });

  it("returns 400 for malformed JSON body", async () => {
    mockRequireRole.mockResolvedValue(writerGate());
    mockCreateClient.mockReturnValue(makeResearchClient());

    const req = new Request("http://localhost/api/agents/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("invalid_body");
  });

  // ── feature flag ────────────────────────────────────────────────────────────

  it("returns 403 when research_agents feature flag is disabled (agentType flow)", async () => {
    mockRequireRole.mockResolvedValue(writerGate());
    mockCreateClient.mockReturnValue(makeResearchClient({ featureEnabled: false }));

    const res = await POST(makeRequest({ agentType: "corporate_research" }));

    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("feature_disabled");
  });

  // ── success paths ───────────────────────────────────────────────────────────

  it("succeeds and returns runId + status for a valid agentType", async () => {
    mockRequireRole.mockResolvedValue(writerGate());
    mockCreateClient.mockReturnValue(makeResearchClient({ featureEnabled: true }));

    const res = await POST(makeRequest({ agentType: "corporate_research" }));

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; runId: string };
    expect(body.status).toBe("started");
    expect(body.runId).toBeDefined();
  });

  it("succeeds for agentType=all (parallel mode)", async () => {
    mockRequireRole.mockResolvedValue(writerGate());
    mockCreateClient.mockReturnValue(makeResearchClient({ featureEnabled: true }));

    const res = await POST(makeRequest({ agentType: "all" }));

    expect(res.status).toBe(200);
    const body = await res.json() as { mode: string };
    expect(body.mode).toBe("parallel");
  });

  it("succeeds for multi-source flow (sources array — no feature flag required)", async () => {
    mockRequireRole.mockResolvedValue(writerGate());
    // Multi-source flow creates its OWN createClient() call.
    const multiClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return makeChain({
            data: { id: PROFILE_ID, organization_id: ORG_ID },
            error: null,
          });
        }
        if (table === "search_profiles") return makeChain({ data: [], error: null });
        if (table === "platform_config") return makeChain({ data: [], error: null });
        if (table === "opportunities") return makeChain({ data: [], error: null });
        return makeChain({ data: null, error: null });
      }),
    };
    mockCreateClient.mockReturnValue(multiClient);

    const res = await POST(makeRequest({ sources: ["grants_gov"] }));

    expect(res.status).toBe(200);
    const body = await res.json() as { results: unknown[] };
    expect(Array.isArray(body.results)).toBe(true);
  });

  // ── rate limiting ───────────────────────────────────────────────────────────

  /**
   * The rate limiter is an in-memory Map keyed by org id. Running > 20 requests
   * in < 60 s for the same org triggers 429. This test uses a distinct org id so
   * it doesn't interact with state left by other tests.
   *
   * Note: vitest runs tests sequentially within a file, so module-level state
   * (the `hits` map in the route) persists across tests in the same run. Using
   * a unique ORG_ID here keeps this test isolated.
   */
  it("returns 429 when the per-org rate limit is exceeded", async () => {
    const RATE_ORG = "rate-limited-org-" + Math.random().toString(36).slice(2);
    const rateClient = makeResearchClient({ featureEnabled: false });

    mockRequireRole.mockResolvedValue({
      supabase: rateClient,
      userId: USER_ID,
      userRole: "writer" as const,
      organizationId: RATE_ORG,
    });
    mockCreateClient.mockReturnValue(rateClient);

    let lastResponse: Response | null = null;
    // Fire 21 requests — the 21st should be rate limited.
    for (let i = 0; i < 21; i++) {
      // Use agentType flow so each request hits the rate checker (before
      // feature-flag check, which returns 403 after the rate check). We want
      // to count hits but stop once we see 429.
      if (lastResponse?.status === 429) break;

      mockRequireRole.mockResolvedValue({
        supabase: rateClient,
        userId: USER_ID,
        userRole: "writer" as const,
        organizationId: RATE_ORG,
      });
      mockCreateClient.mockReturnValue(rateClient);

      lastResponse = await POST(makeRequest({ agentType: "corporate_research" }));
    }

    expect(lastResponse?.status).toBe(429);
    const body = await lastResponse?.json() as { code: string };
    expect(body.code).toBe("rate_limited");
  });
});
