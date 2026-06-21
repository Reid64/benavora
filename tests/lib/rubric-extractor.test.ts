import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import {
  extractRubricFromText,
  extractRubricFromOpportunity,
} from "@/lib/intelligence/rubric-extractor";

const SAMPLE_RUBRIC = {
  dimensions: [
    {
      name: "Need",
      max_points: 25,
      weight_percentage: 25,
      description: "Demonstrates a clear, data-supported need",
      common_deductions: ["Lacks supporting data"],
    },
    {
      name: "Approach",
      max_points: 75,
      weight_percentage: 75,
      description: "Evidence-based plan with clear milestones",
      common_deductions: ["Vague timeline"],
    },
  ],
  total_points: 100,
  review_type: "peer_review",
  notes: "Submit via online portal only",
};

const LONG_TEXT = "A ".repeat(60); // 120 chars, above the 100-char threshold

describe("extractRubricFromText", () => {
  beforeEach(() => mockCreate.mockReset());

  it("parses Claude response correctly", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(SAMPLE_RUBRIC) }],
    });

    const result = await extractRubricFromText(LONG_TEXT);
    expect(result.total_points).toBe(100);
    expect(result.review_type).toBe("peer_review");
    expect(result.dimensions).toHaveLength(2);
    expect(result.dimensions[0]?.name).toBe("Need");
    expect(result.notes).toBe("Submit via online portal only");
  });

  it("handles markdown-wrapped JSON from Claude", async () => {
    const wrapped = "```json\n" + JSON.stringify(SAMPLE_RUBRIC) + "\n```";
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: wrapped }],
    });

    const result = await extractRubricFromText(LONG_TEXT);
    expect(result.total_points).toBe(100);
    expect(result.dimensions).toHaveLength(2);
  });

  it("throws when Claude returns a non-text block", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "x", name: "fn", input: {} }],
    });

    await expect(extractRubricFromText(LONG_TEXT)).rejects.toThrow(
      "No text response from Claude",
    );
  });
});

describe("extractRubricFromOpportunity", () => {
  it("returns null for combined text under 100 chars", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            requirements: "Short.",
            eligibility_text: null,
            description: null,
            raw_content: null,
            funder_name: "Funder",
            title: "Program",
          },
          error: null,
        }),
      }),
    };

    const result = await extractRubricFromOpportunity("opp-1", mockSupabase);
    expect(result).toBeNull();
  });

  it("returns null when Supabase returns no data", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
      }),
    };

    const result = await extractRubricFromOpportunity("opp-missing", mockSupabase);
    expect(result).toBeNull();
  });
});
