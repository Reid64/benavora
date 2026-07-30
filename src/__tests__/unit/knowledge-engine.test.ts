import { describe, it, expect, vi } from "vitest";
import {
  queryKnowledgeEngine,
  type KnowledgePattern,
  type KnowledgeProposal,
} from "@/lib/intelligence/knowledge-engine";

function makeQueryBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "or"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createSupabaseMock(opts: {
  patterns?: KnowledgePattern[] | null;
  proposals?: KnowledgeProposal[] | null;
  insertImpl?: () => unknown;
}) {
  const { patterns = [], proposals = [], insertImpl } = opts;
  const patternsBuilder = makeQueryBuilder({ data: patterns });
  const proposalsBuilder = makeQueryBuilder({ data: proposals });
  const insertMock = vi.fn(insertImpl ?? (() => Promise.resolve({ error: null })));

  const from = vi.fn((table: string) => {
    if (table === "knowledge_patterns") return patternsBuilder;
    if (table === "intelligence_funded_proposals") return proposalsBuilder;
    if (table === "knowledge_queries") return { insert: insertMock };
    throw new Error(`Unexpected table: ${table}`);
  });

  return { from, patternsBuilder, proposalsBuilder, insertMock };
}

describe("queryKnowledgeEngine", () => {
  it("queries knowledge_patterns ordered by success_rate desc and limited to 10", async () => {
    const supabase = createSupabaseMock({});

    await queryKnowledgeEngine("housing grants", "org-1", supabase);

    expect(supabase.from).toHaveBeenCalledWith("knowledge_patterns");
    expect(supabase.patternsBuilder.select).toHaveBeenCalledWith(
      "id, pattern_type, category, funder_name, pattern_description, success_rate, sample_count, confidence",
    );
    expect(supabase.patternsBuilder.order).toHaveBeenCalledWith("success_rate", {
      ascending: false,
      nullsFirst: false,
    });
    expect(supabase.patternsBuilder.limit).toHaveBeenCalledWith(10);
  });

  it("filters the patterns query by non-stopword keywords longer than 2 characters", async () => {
    const supabase = createSupabaseMock({});

    await queryKnowledgeEngine("Housing grants for rural Texas nonprofits", "org-1", supabase);

    expect(supabase.patternsBuilder.or).toHaveBeenCalledWith(
      [
        "category.ilike.%housing%,pattern_description.ilike.%housing%,funder_name.ilike.%housing%",
        "category.ilike.%rural%,pattern_description.ilike.%rural%,funder_name.ilike.%rural%",
        "category.ilike.%texas%,pattern_description.ilike.%texas%,funder_name.ilike.%texas%",
        "category.ilike.%nonprofits%,pattern_description.ilike.%nonprofits%,funder_name.ilike.%nonprofits%",
      ].join(","),
    );
  });

  it("does not filter the patterns query when every word is a stopword", async () => {
    const supabase = createSupabaseMock({});

    await queryKnowledgeEngine("the and for", "org-1", supabase);

    expect(supabase.patternsBuilder.or).not.toHaveBeenCalled();
  });

  it("filters the proposals query by the trimmed query with commas/parens/percent stripped", async () => {
    const supabase = createSupabaseMock({});

    await queryKnowledgeEngine("  Robert Wood (Johnson), Foundation 50%  ", "org-1", supabase);

    expect(supabase.proposalsBuilder.or).toHaveBeenCalledWith(
      "grant_program.ilike.%Robert Wood Johnson Foundation 50%,funder_name.ilike.%Robert Wood Johnson Foundation 50%",
    );
  });

  it("does not filter the proposals query when the trimmed query is empty", async () => {
    const supabase = createSupabaseMock({});

    await queryKnowledgeEngine("   ,,,%%%   ", "org-1", supabase);

    expect(supabase.proposalsBuilder.or).not.toHaveBeenCalled();
  });

  it("returns the resolved patterns and proposals", async () => {
    const patterns: KnowledgePattern[] = [
      {
        id: "p1",
        pattern_type: "narrative",
        category: "housing_grant",
        funder_name: "ACME Foundation",
        pattern_description: "Emphasize measurable outcomes",
        success_rate: 62,
        sample_count: 40,
        confidence: "high",
      },
    ];
    const proposals: KnowledgeProposal[] = [
      {
        id: "prop1",
        source: "NIH_REPORTER",
        source_url: "https://example.com/prop1",
        funder_name: "NIH",
        grant_program: "R01",
        award_amount: 500000,
        award_year: 2024,
      },
    ];
    const supabase = createSupabaseMock({ patterns, proposals });

    const result = await queryKnowledgeEngine("housing", "org-1", supabase);

    expect(result.patterns).toEqual(patterns);
    expect(result.proposals).toEqual(proposals);
  });

  it("treats a null data response from either query as an empty array", async () => {
    const supabase = createSupabaseMock({ patterns: null, proposals: null });

    const result = await queryKnowledgeEngine("housing", "org-1", supabase);

    expect(result.patterns).toEqual([]);
    expect(result.proposals).toEqual([]);
  });

  it("builds an insight from the top pattern including its success rate", async () => {
    const patterns: KnowledgePattern[] = [
      {
        id: "p1",
        pattern_type: "narrative",
        category: "housing_grant",
        funder_name: "ACME Foundation",
        pattern_description: "Emphasize measurable outcomes",
        success_rate: 62,
        sample_count: 40,
        confidence: "high",
      },
    ];
    const supabase = createSupabaseMock({ patterns });

    const result = await queryKnowledgeEngine("housing", "org-1", supabase);

    expect(result.insights).toContain(
      'Top matching pattern: "Emphasize measurable outcomes" (62% success rate).',
    );
  });

  it("omits the success rate suffix from the top pattern insight when success_rate is null", async () => {
    const patterns: KnowledgePattern[] = [
      {
        id: "p1",
        pattern_type: "narrative",
        category: "housing_grant",
        funder_name: "ACME Foundation",
        pattern_description: "Emphasize measurable outcomes",
        success_rate: null,
        sample_count: null,
        confidence: "low",
      },
    ];
    const supabase = createSupabaseMock({ patterns });

    const result = await queryKnowledgeEngine("housing", "org-1", supabase);

    expect(result.insights).toContain('Top matching pattern: "Emphasize measurable outcomes".');
  });

  it("builds an insight listing deduplicated funder names from up to 5 proposals", async () => {
    const proposals: KnowledgeProposal[] = [
      { id: "1", source: "s", source_url: null, funder_name: "NIH", grant_program: null, award_amount: null, award_year: null },
      { id: "2", source: "s", source_url: null, funder_name: "NIH", grant_program: null, award_amount: null, award_year: null },
      { id: "3", source: "s", source_url: null, funder_name: "NSF", grant_program: null, award_amount: null, award_year: null },
      { id: "4", source: "s", source_url: null, funder_name: "HRSA", grant_program: null, award_amount: null, award_year: null },
      { id: "5", source: "s", source_url: null, funder_name: "HUD", grant_program: null, award_amount: null, award_year: null },
      { id: "6", source: "s", source_url: null, funder_name: "DOJ", grant_program: null, award_amount: null, award_year: null },
    ];
    const supabase = createSupabaseMock({ proposals });

    const result = await queryKnowledgeEngine("grants", "org-1", supabase);

    expect(result.insights).toContain("Found funded proposals from: NIH, NSF, HRSA, HUD, DOJ.");
  });

  it("returns a fallback insight when no patterns or proposals are found", async () => {
    const supabase = createSupabaseMock({});

    const result = await queryKnowledgeEngine("housing", "org-1", supabase);

    expect(result.insights).toEqual([
      "No matching patterns or funded proposals found for this query yet.",
    ]);
  });

  it("logs the query to knowledge_queries with result counts", async () => {
    const patterns: KnowledgePattern[] = [
      {
        id: "p1",
        pattern_type: "narrative",
        category: null,
        funder_name: null,
        pattern_description: "x",
        success_rate: null,
        sample_count: null,
        confidence: "low",
      },
    ];
    const supabase = createSupabaseMock({ patterns });

    await queryKnowledgeEngine("  housing  ", "org-1", supabase);

    expect(supabase.from).toHaveBeenCalledWith("knowledge_queries");
    expect(supabase.insertMock).toHaveBeenCalledWith({
      organization_id: "org-1",
      query_text: "housing",
      results: { patterns_count: 1, proposals_count: 0 },
    });
  });

  it("does not throw when logging the query fails", async () => {
    const supabase = createSupabaseMock({
      insertImpl: () => {
        throw new Error("insert failed");
      },
    });

    const result = await queryKnowledgeEngine("housing", "org-1", supabase);

    expect(result).toEqual({
      patterns: [],
      proposals: [],
      insights: ["No matching patterns or funded proposals found for this query yet."],
    });
    expect(supabase.insertMock).toHaveBeenCalled();
  });
});
