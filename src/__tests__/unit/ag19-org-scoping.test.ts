/**
 * Mock-level unit replacement for the org-isolation invariant previously
 * covered only by
 * src/__tests__/integration-live/ag19-faith-foundation-isolation.test.ts
 * (moved there, WGR-157, because it read a real, shared production org's
 * live state — a genuine external-system dependency, since any unrelated
 * live investigation/demo session touching that org's platform_config rows
 * changes this test's outcome).
 *
 * This verifies the underlying invariant directly instead: every agent
 * worker/autonomous-orchestrator.ts's routeQueueItem() 'funder_relationship'
 * case constructs (Gen-1 FunderRelationshipAgent and Gen-2
 * RelationshipBuilderAgent alike) is instantiated with the org id
 * routeQueueItem() was actually called with — never a hardcoded one (e.g.
 * Faith Foundation's real production org id) — via fully mocked agent
 * classes and a mocked Supabase client, no live database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const FAITH_FOUNDATION_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const TEST_ORG_ID = "test-org-scoping-probe";
const TEST_FUNDER_ID = "test-funder-scoping-probe";

const mockGen2Run = vi.fn().mockResolvedValue({ itemsFound: 0, itemsProcessed: 0 });
const MockRelationshipBuilderAgent = vi.fn().mockImplementation(() => ({ run: mockGen2Run }));
vi.mock("@/lib/agents/relationship-builder-agent", () => ({
  RelationshipBuilderAgent: MockRelationshipBuilderAgent,
}));

const mockGen1Run = vi.fn().mockResolvedValue({ tokensUsed: 0 });
const MockFunderRelationshipAgent = vi.fn().mockImplementation(() => ({ run: mockGen1Run }));
vi.mock("@/lib/agents/funder-relationship", () => ({
  FunderRelationshipAgent: MockFunderRelationshipAgent,
}));

import { routeQueueItem, type AgentQueueRow } from "../../../worker/autonomous-orchestrator";

function makePlatformConfigSupabase(flagValue: string | null) {
  const eqCalls: Array<[string, unknown]> = [];
  return {
    from: vi.fn((table: string) => {
      if (table !== "platform_config") throw new Error(`unexpected table: ${table}`);
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((col2: string, val2: unknown) => {
              eqCalls.push([col2, val2]);
              return {
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: flagValue ? { value: flagValue } : null, error: null }),
              };
            }),
          };
        }),
      };
    }),
    __eqCalls: eqCalls,
  };
}

describe("routeQueueItem 'funder_relationship' case — org scoping (mocked, no live database)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseItem: Omit<AgentQueueRow, "org_id"> = {
    id: "queue-item-scoping-probe",
    agent_id: "funder_relationship",
    input_payload: { funderId: TEST_FUNDER_ID, event: "note_added" },
    retry_count: 0,
    max_retries: 3,
  };

  it("flag=false (Gen-1): FunderRelationshipAgent is constructed with the caller's org id, never a hardcoded one", async () => {
    const supabase = makePlatformConfigSupabase(null);
    const item: AgentQueueRow = { ...baseItem, org_id: TEST_ORG_ID };

    await routeQueueItem(supabase as never, item);

    expect(MockFunderRelationshipAgent).toHaveBeenCalledTimes(1);
    const ctorArgs = MockFunderRelationshipAgent.mock.calls[0]![0] as { organizationId: string };
    expect(ctorArgs.organizationId).toBe(TEST_ORG_ID);
    expect(ctorArgs.organizationId).not.toBe(FAITH_FOUNDATION_ORG_ID);

    // The flag lookup itself must also be scoped to the caller's org.
    expect(supabase.__eqCalls).toContainEqual(["organization_id", TEST_ORG_ID]);
    expect(supabase.__eqCalls).not.toContainEqual(["organization_id", FAITH_FOUNDATION_ORG_ID]);
  });

  it("flag=true (Gen-2): RelationshipBuilderAgent is constructed with the caller's org id, never a hardcoded one", async () => {
    const supabase = makePlatformConfigSupabase("true");
    const item: AgentQueueRow = { ...baseItem, org_id: TEST_ORG_ID };

    await routeQueueItem(supabase as never, item);

    expect(MockRelationshipBuilderAgent).toHaveBeenCalledTimes(1);
    const [orgIdArg] = MockRelationshipBuilderAgent.mock.calls[0]!;
    expect(orgIdArg).toBe(TEST_ORG_ID);
    expect(orgIdArg).not.toBe(FAITH_FOUNDATION_ORG_ID);

    expect(supabase.__eqCalls).toContainEqual(["organization_id", TEST_ORG_ID]);
    expect(supabase.__eqCalls).not.toContainEqual(["organization_id", FAITH_FOUNDATION_ORG_ID]);
  });
});
