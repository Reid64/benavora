// AR-17.6 incremental testing checkpoint.
//
// test-evidence/AGENT_OUTPUT_QUALITY_RESEARCH.md (AR-17.3) found 0.0% of
// 6,309 enriched `opportunities` fields carry a stored source -- 98.4% carry
// only a bare `url` pointer, and 39 rows carried no source at all. This
// suite proves migration 203's DB-level provenance trigger actually rejects
// a source-less enriched write, and that agents record real `null` rather
// than a guess when a fact can't be determined.
//
// test-evidence/AGENT_OUTPUT_QUALITY_DRAFTING.md (AR-17.4) found three
// independently-confirmed fabrication instances: a phone number invented on
// every twin-powered draft, a wrong-organization submission sent to a real
// funder, and an empty organization profile scoring the platform's
// second-highest confidence (82) on a fully-invented operating history. This
// suite proves the fixes in src/lib/drafts/generator.ts and
// src/lib/drafts/fact-guard.ts against the properties those fixes were
// required to have:
//
//   1. An enriched `opportunities` field cannot be written without a stored
//      source (migration 203's trigger) -- live-DB-guarded.
//   2. An agent that could not determine a fact writes real `null`, never a
//      placeholder or guess (corporate-enrichment-shared.ts).
//   3. A draft for an organization with no substantive profile/knowledge-base
//      data returns an explicit incomplete result, not generic prose that
//      reads finished.
//   4. Two different organizations produce materially different drafts from
//      the same funder -- the context-assembly pipeline is genuinely
//      org-specific, not boilerplate with names swapped in.
//   5. A fabricated figure Claude returns cannot survive into the saved
//      draft.

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

vi.mock("@/lib/ai/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/claude")>();
  return {
    ...actual,
    // Echoes a slice of the prompt back as the "generated" draft so tests can
    // assert the context assembly (not model creativity) is what's under
    // test: whichever org-specific facts made it into the prompt are the
    // only thing that can appear in this mock's output.
    callClaude: vi.fn(async ({ prompt }: { prompt: string; system?: string }) => ({
      text: `GENERATED DRAFT\n${prompt.slice(0, 6000)}`,
      stopReason: "end_turn" as const,
      usage: { totalTokens: 500, inputTokens: 400, outputTokens: 100 },
    })),
  };
});

import { generateDraft } from "@/lib/drafts/generator";
import { extractFigureClaims, scrubUnverifiedFigures, buildFactCorpus } from "@/lib/drafts/fact-guard";
import { mergeEnrichmentPatch, type CorporateProspectRow } from "@/lib/agents/corporate-enrichment-shared";

// --- Generic chainable Supabase table mock ----------------------------------

function chainable(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const methods = [
    "select", "eq", "in", "order", "limit", "or", "gte", "lte", "ilike",
    "contains", "update", "delete", "maybeSingle", "single", "insert", "upsert",
  ];
  for (const m of methods) builder[m] = vi.fn(() => builder);
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function buildSupabaseMock(tables: Record<string, { data: unknown; error?: unknown }>) {
  return {
    from: vi.fn((table: string) => {
      const cfg = tables[table];
      return chainable(cfg ? { data: cfg.data, error: cfg.error ?? null } : { data: null, error: null });
    }),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  } as unknown as SupabaseClient<any>;
}

const FAKE_DRAFT_VERSION_ROW = {
  id: "draft-version-fake-id",
  version_number: 1,
  humanization_status: "not_humanized",
  created_at: "2026-09-19T00:00:00Z",
};

const SHARED_OPPORTUNITY = {
  id: "opp-shared-funder",
  organization_id: "org-placeholder",
  name: "Community Housing Stability Grant",
  category: "housing_grant",
  description: "Funding for organizations providing housing stability services.",
  amount_min: 25000,
  amount_max: 100000,
  amount_available: null,
  deadline: "2026-12-01",
  eligibility_requirements: "501(c)(3) nonprofits serving housing needs.",
  funder_id: "funder-cascade",
  source_type: "government_state",
  url: "https://example.gov/opportunities/housing-stability",
};

describe("AR-17.6 research & drafting output quality", () => {
  // -----------------------------------------------------------------------
  // 1. Provenance: an enriched opportunities field cannot be written without
  //    a stored source (migration 203's DB trigger). Live-DB-guarded, like
  //    the other suites in this directory.
  // -----------------------------------------------------------------------
  function loadLocalEnv(): Record<string, string> {
    const envPath = path.resolve(process.cwd(), ".env.local");
    if (!fs.existsSync(envPath)) return {};
    return dotenv.parse(fs.readFileSync(envPath));
  }
  const localEnv = loadLocalEnv();
  const SUPABASE_URL = localEnv.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = localEnv.SUPABASE_SERVICE_ROLE_KEY;
  const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

  function createLiveClient(): SupabaseClient {
    return createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: ws as any },
    }) as unknown as SupabaseClient;
  }

  (CREDS_AVAILABLE ? describe : describe.skip)("provenance trigger (migration 203, live DB)", () => {
    it("rejects an enriched field written with no url and no opportunity_documents", async () => {
      const service = createLiveClient();
      const { data: anyOrg } = await service.from("organizations").select("id").limit(1).single();
      expect(anyOrg?.id).toBeTruthy();

      const { error } = await service.from("opportunities").insert({
        organization_id: anyOrg!.id as string,
        name: "AR-17.6 provenance test (must fail)",
        category: "government_grant",
        source: "ar176_test",
        source_type: "government_federal",
        status: "open",
        description: "This write has no url and no opportunity_documents.",
      });

      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/no stored source/i);
    }, 30000);

    it("accepts the same write once a url is included", async () => {
      const service = createLiveClient();
      const { data: anyOrg } = await service.from("organizations").select("id").limit(1).single();

      const { data, error } = await service
        .from("opportunities")
        .insert({
          organization_id: anyOrg!.id as string,
          name: "AR-17.6 provenance test (should succeed)",
          category: "government_grant",
          source: "ar176_test",
          source_type: "government_federal",
          status: "open",
          description: "This write has a url and should be accepted.",
          url: "https://example.gov/ar176-test",
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();

      if (data?.id) {
        await service.from("opportunities").delete().eq("id", data.id as string);
      }
    }, 30000);
  });

  // -----------------------------------------------------------------------
  // 2. Undeterminable field stays real null, never a guess or placeholder.
  // -----------------------------------------------------------------------
  it("mergeEnrichmentPatch writes real null for an undetermined field, and records no source for it", async () => {
    const updateSpy = vi.fn((_payload: Record<string, unknown>) => ({
      eq: vi.fn(() => Promise.resolve({ error: null })),
    }));
    const supabase = { from: vi.fn(() => ({ update: updateSpy })) } as unknown as SupabaseClient;

    const prospect: CorporateProspectRow = {
      id: "prospect-1",
      legal_name: "Acme Corp",
      website: null,
      ein: null,
      address_street: null,
      address_city: null,
      address_state: null,
      address_zip: null,
      enrichment: {},
      enrichment_version: 0,
    };

    // Mirrors ea-04-foundation-detector.ts's no-match case: it did not
    // determine a foundation affiliation, so it writes null, not a guess,
    // and passes no source (there is nothing to cite for a fact it doesn't
    // have).
    await mergeEnrichmentPatch(
      supabase,
      prospect,
      { foundation_affiliation: null, foundation_ein: null },
      null,
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const payload = updateSpy.mock.calls[0]![0] as unknown as Record<string, unknown>;
    const enrichment = payload.enrichment as Record<string, unknown>;

    expect(enrichment.foundation_affiliation).toBeNull();
    expect(enrichment.foundation_ein).toBeNull();
    // No source was supplied because nothing was determined -- the merge
    // must not invent one, and must not tag these null fields as sourced.
    expect(enrichment._sources).toBeUndefined();
  });

  it("mergeEnrichmentPatch records the real source when a positive claim is written", async () => {
    const updateSpy = vi.fn((_payload: Record<string, unknown>) => ({
      eq: vi.fn(() => Promise.resolve({ error: null })),
    }));
    const supabase = { from: vi.fn(() => ({ update: updateSpy })) } as unknown as SupabaseClient;

    const prospect: CorporateProspectRow = {
      id: "prospect-2",
      legal_name: "Beta Corp",
      website: "https://beta-corp.example.com",
      ein: null,
      address_street: null,
      address_city: null,
      address_state: null,
      address_zip: null,
      enrichment: {},
      enrichment_version: 0,
    };

    await mergeEnrichmentPatch(
      supabase,
      prospect,
      { has_giving_program: true, giving_portal_url: "https://beta-corp.example.com/giving" },
      "https://beta-corp.example.com/giving",
    );

    const payload = updateSpy.mock.calls[0]![0] as unknown as Record<string, unknown>;
    const enrichment = payload.enrichment as Record<string, unknown>;
    const sources = enrichment._sources as Record<string, string>;
    expect(sources.has_giving_program).toBe("https://beta-corp.example.com/giving");
    expect(sources.giving_portal_url).toBe("https://beta-corp.example.com/giving");
  });

  // -----------------------------------------------------------------------
  // 3. Sparse-profile org -> explicit incomplete result, not generic prose.
  // -----------------------------------------------------------------------
  it("returns an explicit incomplete-draft result for an org with no substantive data, without calling Claude", async () => {
    const { callClaude } = await import("@/lib/ai/claude");
    (callClaude as ReturnType<typeof vi.fn>).mockClear();

    const supabase = buildSupabaseMock({
      platform_config: { data: [] },
      opportunities: { data: SHARED_OPPORTUNITY },
      organizations: {
        data: {
          name: "Beta Org 1",
          dba: null,
          ein: null,
          tax_status: null,
          mission_statement: null,
          vision_statement: null,
          service_area: null,
          target_population: null,
          founder_name: null,
          annual_budget: null,
        },
      },
      knowledge_base: { data: [] },
      proven_narratives: { data: [] },
      funders: { data: { name: "Cascade Foundation" } },
      draft_versions: { data: FAKE_DRAFT_VERSION_ROW },
      applications: { data: null },
    });

    const result = await generateDraft({
      supabase,
      organizationId: "org-sparse",
      opportunityId: SHARED_OPPORTUNITY.id,
      templateType: "grant_narrative",
    });

    expect(result.incomplete).toBe(true);
    expect(result.missingFacts.length).toBeGreaterThan(0);
    expect(result.confidenceScore).toBe(0);
    // The AR-17.4 failure mode: a zero-data org getting confident, specific-
    // sounding invented numbers. None of that vocabulary may appear here.
    expect(result.content).not.toMatch(/\d+%/);
    expect(result.content).not.toMatch(/\btwelve\b|\b12\b.{0,10}years?/i);
    expect(result.content).toMatch(/incomplete/i);
    expect(callClaude).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 4. Two different orgs, same funder -> materially different drafts.
  // -----------------------------------------------------------------------
  it("produces materially different, org-specific drafts for two organizations against the same funder", async () => {
    const orgAId = "org-alpha";
    const orgBId = "org-beta";

    const supabaseA = buildSupabaseMock({
      platform_config: { data: [] },
      opportunities: { data: SHARED_OPPORTUNITY },
      organizations: {
        data: {
          name: "AlphaHousing Corp",
          dba: null,
          ein: "11-1111111",
          tax_status: "501c3",
          mission_statement: "AlphaHousing Corp provides transitional housing across rural Ohio.",
          vision_statement: "A stable home for every Ohio family.",
          service_area: "Rural Ohio",
          target_population: "Families exiting homelessness",
          founder_name: "Jordan Alpha",
          annual_budget: 500000,
        },
      },
      knowledge_base: {
        data: [
          {
            id: "kb-alpha-1",
            title: "Sunrise Villages",
            category: "program_description",
            content: "AlphaHousing Corp runs the Sunrise Villages program serving 200 families in Ohio.",
            is_proven: true,
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
      proven_narratives: { data: [] },
      funders: { data: { name: "Cascade Foundation" } },
      draft_versions: { data: FAKE_DRAFT_VERSION_ROW },
      applications: { data: null },
    });

    const supabaseB = buildSupabaseMock({
      platform_config: { data: [] },
      opportunities: { data: SHARED_OPPORTUNITY },
      organizations: {
        data: {
          name: "BetaShelter Network",
          dba: null,
          ein: "22-2222222",
          tax_status: "501c3",
          mission_statement: "BetaShelter Network supports homeless veterans across coastal Oregon.",
          vision_statement: "No veteran without shelter.",
          service_area: "Coastal Oregon",
          target_population: "Homeless veterans",
          founder_name: "Sam Beta",
          annual_budget: 300000,
        },
      },
      knowledge_base: {
        data: [
          {
            id: "kb-beta-1",
            title: "Harbor Lights",
            category: "program_description",
            content: "BetaShelter Network runs the Harbor Lights program serving 75 veterans in Oregon.",
            is_proven: true,
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
      proven_narratives: { data: [] },
      funders: { data: { name: "Cascade Foundation" } },
      draft_versions: { data: FAKE_DRAFT_VERSION_ROW },
      applications: { data: null },
    });

    const [draftA, draftB] = await Promise.all([
      generateDraft({
        supabase: supabaseA,
        organizationId: orgAId,
        opportunityId: SHARED_OPPORTUNITY.id,
        templateType: "grant_narrative",
      }),
      generateDraft({
        supabase: supabaseB,
        organizationId: orgBId,
        opportunityId: SHARED_OPPORTUNITY.id,
        templateType: "grant_narrative",
      }),
    ]);

    expect(draftA.incomplete).toBe(false);
    expect(draftB.incomplete).toBe(false);
    expect(draftA.content).not.toBe(draftB.content);
    // Each draft must be built from its own org's facts, not the other's.
    expect(draftA.content).toContain("Sunrise Villages");
    expect(draftA.content).not.toContain("Harbor Lights");
    expect(draftB.content).toContain("Harbor Lights");
    expect(draftB.content).not.toContain("Sunrise Villages");
  });

  // -----------------------------------------------------------------------
  // 5. A fabricated figure is caught and cannot survive into a saved draft.
  // -----------------------------------------------------------------------
  it("fact-guard removes a figure that does not trace to any stored source", () => {
    const corpus = buildFactCorpus([
      "FAITH Foundation provides transitional housing.",
      "Annual budget: 75000",
    ]);
    const draftWithFabrication =
      "Our organization has achieved a 94% housing retention rate over twelve years, " +
      "operating a 340-unit portfolio with 28 FTE staff.";

    const claims = extractFigureClaims(draftWithFabrication);
    expect(claims.length).toBeGreaterThanOrEqual(4);

    const { text, removed } = scrubUnverifiedFigures(draftWithFabrication, corpus);

    expect(removed.length).toBeGreaterThanOrEqual(4);
    expect(text).not.toMatch(/94%/);
    expect(text).not.toMatch(/twelve years/i);
    expect(text).not.toMatch(/340-unit/);
    expect(text).not.toMatch(/28 FTE/);
    expect(text).toMatch(/\[NEEDS INPUT/);
  });

  it("fact-guard leaves a figure alone when it genuinely traces to stored data", () => {
    const corpus = buildFactCorpus(["Annual budget: 75000", "FAITH Foundation"]);
    const draft = "FAITH Foundation's annual budget is $75,000.";

    const { text, removed } = scrubUnverifiedFigures(draft, corpus);

    expect(removed).toEqual([]);
    expect(text).toBe(draft);
  });

  it("end-to-end: a fabricated figure Claude returns is scrubbed before the draft is saved", async () => {
    const { callClaude } = await import("@/lib/ai/claude");
    (callClaude as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      text:
        "AlphaHousing Corp has achieved a 94% housing retention rate over twelve years, " +
        "operating a 340-unit portfolio with 28 FTE staff, serving the Sunrise Villages program.",
      stopReason: "end_turn" as const,
      usage: { totalTokens: 200, inputTokens: 150, outputTokens: 50 },
    }));

    const supabase = buildSupabaseMock({
      platform_config: { data: [] },
      opportunities: { data: SHARED_OPPORTUNITY },
      organizations: {
        data: {
          name: "AlphaHousing Corp",
          dba: null,
          ein: null,
          tax_status: null,
          mission_statement: "AlphaHousing Corp provides transitional housing across rural Ohio.",
          vision_statement: null,
          service_area: "Rural Ohio",
          target_population: "Families exiting homelessness",
          founder_name: null,
          annual_budget: null,
        },
      },
      knowledge_base: {
        data: [
          {
            id: "kb-alpha-1",
            title: "Sunrise Villages",
            category: "program_description",
            content: "AlphaHousing Corp runs the Sunrise Villages program in Ohio.",
            is_proven: true,
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
      proven_narratives: { data: [] },
      funders: { data: { name: "Cascade Foundation" } },
      draft_versions: { data: FAKE_DRAFT_VERSION_ROW },
      applications: { data: null },
    });

    const result = await generateDraft({
      supabase,
      organizationId: "org-alpha-fabrication-check",
      opportunityId: SHARED_OPPORTUNITY.id,
      templateType: "grant_narrative",
    });

    expect(result.scrubbedFigures.length).toBeGreaterThan(0);
    expect(result.content).not.toMatch(/94%/);
    expect(result.content).not.toMatch(/twelve years/i);
    expect(result.content).not.toMatch(/340-unit/);
    expect(result.content).not.toMatch(/28 FTE/);
    // The genuinely-sourced fact (the program name, present in the org's own
    // KB) survives -- this guard removes what's unverified, not everything.
    expect(result.content).toContain("Sunrise Villages");
  });
});
