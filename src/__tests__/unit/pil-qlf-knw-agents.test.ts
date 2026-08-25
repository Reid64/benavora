// Unit tests for BEN-QLF-04 (Opportunity Qualification), BEN-KNW-02 (Entity
// Resolution), and BEN-KNW-03 (Evidence & Provenance Verification).
// Everything is mocked -- no real DB calls, matching pil-sup-agents.test.ts's
// convention. See each agent file's header comment for how these real
// agent_ids reconcile against the task numbering (BEN-QUA-01/BEN-KNW-01/
// BEN-KNW-02) this batch was commissioned under.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

vi.mock("@/lib/pil/db", () => ({ getPilClient: vi.fn() }));
vi.mock("@/lib/pil/evidence", () => ({
  getEvidence: vi.fn(),
  detectContradiction: vi.fn(),
  recordContradiction: vi.fn(),
  getProvenanceHash: vi.fn(() => "fixed-hash"),
}));
vi.mock("@/lib/pil/graph", () => ({ getNodesByProspect: vi.fn() }));
vi.mock("@/lib/pil/monitoring", () => ({ getEvents: vi.fn() }));
vi.mock("@/lib/pil/human-review", () => ({ createReviewItem: vi.fn() }));
vi.mock("@/lib/pil/audit", () => ({ logAction: vi.fn() }));

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    agentCode: "BEN-QLF-04",
    orgId: ORG_ID,
    prospectId: null,
    runId: "run-1",
    goal: "test goal",
    plan: {},
    tools: [] as string[],
    budget: 1000,
    depth: 1,
    ...overrides,
  };
}

type MockResponse = { data: unknown; error: unknown };
type RecordedCall = { table: string; method: "insert" | "update"; payload: unknown };

/** Chainable Supabase-client mock, table-keyed. Records every insert/update payload into `calls` for assertions. Responses can be a single {data,error} (repeats) or an array consumed in call order (last entry repeats). */
function makeClient(responses: Record<string, MockResponse | MockResponse[]>, calls: RecordedCall[] = []) {
  const callCounts: Record<string, number> = {};
  const resolveFor = (table: string): MockResponse => {
    const entry = responses[table];
    if (Array.isArray(entry)) {
      const idx = callCounts[table] ?? 0;
      callCounts[table] = idx + 1;
      return entry[Math.min(idx, entry.length - 1)] ?? { data: null, error: null };
    }
    return entry ?? { data: null, error: null };
  };
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: vi.fn(() => c),
      insert: vi.fn((payload: unknown) => {
        calls.push({ table, method: "insert", payload });
        return c;
      }),
      update: vi.fn((payload: unknown) => {
        calls.push({ table, method: "update", payload });
        return c;
      }),
      eq: vi.fn(() => c),
      in: vi.fn(() => c),
      or: vi.fn(() => c),
      is: vi.fn(() => c),
      order: vi.fn(() => c),
      limit: vi.fn(() => c),
      maybeSingle: vi.fn(() => Promise.resolve(resolveFor(table))),
      single: vi.fn(() => Promise.resolve(resolveFor(table))),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(resolveFor(table)).then(resolve, reject),
    };
    return c;
  };
  return { client: { from: vi.fn((table: string) => chain(table)) }, calls };
}

describe("BEN-QLF-04 Opportunity Qualification Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns DISQUALIFIED when giving capacity score is 0", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { getEvents } = await import("@/lib/pil/monitoring");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never); // no wealth_capacity/capacity_signal evidence at all
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(getEvents).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const prospect = {
      id: "p1",
      organization_id: ORG_ID,
      entity_type: "individual",
      display_name: "Jane Donor",
      canonical_name: "jane donor",
      status: "active",
      merged_into_prospect_id: null,
      source_of_record: "discovery",
      created_by_agent_id: "BEN-DIS-01",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const opportunity = { id: "opp-1", organization_id: ORG_ID, prospect_id: "p1" };

    const { client } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_prospect_opportunities: [
        { data: null, error: null }, // find: none exists yet
        { data: opportunity, error: null }, // insert result
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { OpportunityQualificationAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-04");
    const agent = new OpportunityQualificationAgent();
    const context = baseContext({ agentCode: "BEN-QLF-04", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { decision: string; classification: string; disqualificationReasons: string[] } }).report;
    expect(report.decision).toBe("DISQUALIFIED");
    expect(report.classification).toBe("disqualified");
    expect(report.disqualificationReasons.some((r) => r.toLowerCase().includes("giving capacity"))).toBe(true);
    expect(result.status).toBe("completed");
    expect(vi.mocked(createReviewItem)).not.toHaveBeenCalled();
  });
});

describe("BEN-KNW-02 Entity Resolution Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("auto-merges two prospects with identical EIN", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never); // no giving_history/wealth_capacity -- not an H1 case
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const prospectA = {
      id: "p1",
      organization_id: ORG_ID,
      entity_type: "private_foundation",
      display_name: "Acme Family Foundation",
      canonical_name: "acme family foundation",
      status: "active",
      merged_into_prospect_id: null,
      source_of_record: "discovery",
      created_by_agent_id: "BEN-DIS-03",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const prospectB = {
      ...prospectA,
      id: "p2",
      display_name: "The Acme Foundation",
      canonical_name: "the acme foundation",
      created_at: "2026-01-05T00:00:00Z",
    };

    const aliasA = { id: "a1", organization_id: ORG_ID, prospect_id: "p1", alias_type: "ein", alias_value: "12-3456789", source: "990", confidence: 0.9, created_at: "2026-01-01T00:00:00Z" };
    const aliasB = { id: "a2", organization_id: ORG_ID, prospect_id: "p2", alias_type: "ein", alias_value: "12-3456789", source: "990", confidence: 0.9, created_at: "2026-01-05T00:00:00Z" };

    const { client, calls } = makeClient({
      pil_prospects: [{ data: [prospectA, prospectB], error: null }, { data: null, error: null }],
      pil_entity_aliases: { data: [aliasA, aliasB], error: null },
      pil_graph_nodes: { data: null, error: null },
      pil_identity_resolution_log: { data: null, error: null },
      pil_entity_resolution_candidates: [
        { data: null, error: null }, // find: no existing candidate row
        { data: { id: "cand-1" }, error: null }, // insert result
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { EntityResolutionAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-02");
    const agent = new EntityResolutionAgent();
    const context = baseContext({ agentCode: "BEN-KNW-02", plan: { prospectIds: ["p1", "p2"] } });

    const result = await agent.execute(context as never, {} as never);

    const { results } = result.conclusions as { results: Array<{ merged: boolean; survivingProspectId: string | null; status: string; matchScore: number }> };
    expect(results).toHaveLength(1);
    const pairResult = results[0]!;
    expect(pairResult.status).toBe("match");
    expect(pairResult.merged).toBe(true);
    expect(pairResult.survivingProspectId).toBe("p1"); // earlier created_at survives
    expect(pairResult.matchScore).toBeGreaterThanOrEqual(0.95);

    const prospectsUpdate = calls.find((c) => c.table === "pil_prospects" && c.method === "update");
    expect(prospectsUpdate?.payload).toMatchObject({ merged_into_prospect_id: "p1", status: "merged" });

    const mergeLog = calls.find((c) => c.table === "pil_identity_resolution_log" && c.method === "insert");
    expect(mergeLog?.payload).toMatchObject({ action: "merge", primary_prospect_id: "p1", secondary_prospect_id: "p2" });

    expect(vi.mocked(createReviewItem)).not.toHaveBeenCalled();
  });
});

describe("BEN-KNW-03 Evidence & Provenance Verification Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("flags evidence older than its source's TTL as stale", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence, detectContradiction } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    // open_web TTL is 14 days (336h); retrieved ~2000 hours ago is well past it.
    const oldRetrievedAt = new Date(Date.now() - 2000 * 60 * 60 * 1000).toISOString();
    const staleEvidence = {
      id: "ev-old",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "Works at Acme Corp",
      value: null,
      claim_type: "employment",
      source_url: "https://example.com/bio",
      source_title: "Bio page",
      source_type: "open_web",
      publisher: null,
      retrieved_at: oldRetrievedAt,
      published_at: null,
      last_verified_at: null,
      evidence_excerpt: "Jane works at Acme Corp",
      agent_id: "BEN-INT-02",
      research_run_id: "run-1",
      confidence: 0.8,
      verification_status: "single_source_fact",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: oldRetrievedAt,
    };

    vi.mocked(getEvidence).mockResolvedValue([staleEvidence] as never);
    vi.mocked(detectContradiction).mockResolvedValue(false as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client, calls } = makeClient({
      pil_evidence: [{ data: null, error: null }, { data: null, error: null }],
      pil_prospect_opportunities: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { EvidenceProvenanceAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-03");
    const agent = new EvidenceProvenanceAgent();
    const context = baseContext({ agentCode: "BEN-KNW-03", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { staleFlagged: string[]; evidenceScanned: number } }).report;
    expect(report.evidenceScanned).toBe(1);
    expect(report.staleFlagged).toContain("ev-old");

    const staleUpdate = calls.find(
      (c) => c.table === "pil_evidence" && c.method === "update" && (c.payload as { freshness_status?: string }).freshness_status === "stale",
    );
    expect(staleUpdate).toBeDefined();
  });
});
