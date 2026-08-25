// Unit tests for the PIL-03 tool infrastructure (src/lib/pil/tools/*).
// Everything is mocked -- no real DB calls or network calls, matching every
// other src/__tests__/unit/* suite in this repo (see pil-sup-agents.test.ts
// for the same convention).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/pil/db", () => ({ getPilClient: vi.fn() }));

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    agentCode: "BEN-DSC-01",
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

/** Generic chainable Supabase-client mock, thenable at any point in the chain. */
function makeClient(responses: Record<string, MockResponse>) {
  const chain = (table: string): Record<string, unknown> => {
    const resolved = () => Promise.resolve(responses[table] ?? { data: null, error: null });
    const c: Record<string, unknown> = {
      select: vi.fn(() => c),
      eq: vi.fn(() => c),
      ilike: vi.fn(() => c),
      limit: vi.fn(() => c),
      maybeSingle: vi.fn(() => resolved()),
      single: vi.fn(() => resolved()),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => resolved().then(resolve, reject),
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

describe("web-crawler tool (web_crawl)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("respects robots.txt disallow", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) {
        return {
          ok: true,
          status: 200,
          text: async () => "User-agent: *\nDisallow: /\n",
        } as Response;
      }
      throw new Error(`unexpected fetch to ${url} -- robots.txt should have blocked the crawl`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { webCrawlTool } = await import("@/lib/pil/tools/web-crawler");
    const context = baseContext({ tools: ["web_crawl"] });

    const result = await webCrawlTool.execute({ url: "https://blocked-example.test/page" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/robots\.txt disallows/i);
    // Only the robots.txt request should have gone out -- the page fetch is
    // never attempted once robots.txt disallows it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("irs-990-tool (irs_990_lookup)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns BMF data for a known EIN", async () => {
    const bmfRow = {
      ein: "12-3456789",
      name: "Example Family Foundation",
      dba: null,
      city: "Austin",
      state: "TX",
      zip: "78701",
      ntee_code: "T30",
      foundation_type: "Private",
      revenue_amount: 500000,
      asset_amount: 12000000,
      giving_total: 300000,
      website: "https://example-foundation.test",
      email: null,
      phone: null,
    };

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(
      makeClient({ foundation_directory: { data: bmfRow, error: null } }) as never,
    );

    // ProPublica lookup fails/returns nothing -- the tool must still succeed
    // and serve the BMF data on its own.
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch;

    const { irs990Tool } = await import("@/lib/pil/tools/irs-990-tool");
    const context = baseContext({ tools: ["irs_990_lookup"] });

    const result = await irs990Tool.execute({ ein: bmfRow.ein }, context);

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.org_name).toBe(bmfRow.name);
    expect(data.total_assets).toBe(bmfRow.asset_amount);
    expect(data.total_grants_paid).toBe(bmfRow.giving_total);
    expect(data.source).toBe("foundation_directory");
  });
});

describe("entity-lookup tool (entity_lookup)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns an empty array, not an error, for an unknown entity", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { getPilClient } = await import("@/lib/pil/db");

    vi.mocked(createAdminClient).mockReturnValue(
      makeClient({ foundation_directory: { data: [], error: null } }) as never,
    );
    vi.mocked(getPilClient).mockReturnValue(
      makeClient({
        pil_prospects: { data: [], error: null },
        pil_graph_nodes: { data: [], error: null },
      }) as never,
    );

    const { entityLookupTool } = await import("@/lib/pil/tools/entity-lookup");
    const context = baseContext({ tools: ["entity_lookup"] });

    const result = await entityLookupTool.execute({ name: "Totally Unknown Nonexistent Entity Zzyx" }, context);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect((result.data as { matches: unknown[] }).matches).toEqual([]);
  });
});
