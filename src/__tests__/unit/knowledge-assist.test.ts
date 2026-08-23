// Unit tests for Benavora Assist's pure helper functions
// (src/lib/knowledge/assist.ts) and client-key derivation
// (src/lib/knowledge/client-key.ts). Anthropic and Supabase/Postgres calls
// are mocked - these tests never touch the network.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/ai/claude", () => ({
  callClaudeConversation: vi.fn(),
  callClaude: vi.fn(),
  DEFAULT_MODEL: "claude-sonnet-4-6",
}));

vi.mock("@/lib/knowledge/db", () => ({
  searchKnowledge: vi.fn(),
  rateCount: vi.fn(),
  insertQuery: vi.fn(),
  knowledgeDb: vi.fn(),
}));

vi.mock("@/lib/intelligence/embeddings", () => ({
  generateEmbedding: vi.fn(),
}));

import { formatContext, extractCitations, shouldOfferDemo } from "@/lib/knowledge/assist";
import { computeClientKey } from "@/lib/knowledge/client-key";
import type { SearchHit } from "@/lib/knowledge/db";

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    chunk_id: "chunk-1",
    document_id: "doc-1",
    title: "Form 990-PF Overview",
    canonical_url: "https://www.irs.gov/990-pf",
    publisher: "IRS",
    rights: "index",
    content: "Form 990-PF is filed by private foundations.",
    score: 0.9,
    ...overrides,
  };
}

describe("formatContext", () => {
  it("numbers hits starting at [1] in order", () => {
    const hits = [
      makeHit({ title: "First Source", canonical_url: "https://a.example/1" }),
      makeHit({ title: "Second Source", canonical_url: "https://a.example/2" }),
    ];
    const block = formatContext(hits);
    expect(block).toContain("[1] First Source (IRS) https://a.example/1");
    expect(block).toContain("[2] Second Source (IRS) https://a.example/2");
    expect(block.indexOf("[1]")).toBeLessThan(block.indexOf("[2]"));
  });

  it("truncates content to 1200 characters", () => {
    const longContent = "x".repeat(2000);
    const hits = [makeHit({ content: longContent })];
    const block = formatContext(hits);
    const [, contentLine] = block.split("\n");
    expect(contentLine!.length).toBe(1200);
  });

  it("does not truncate content at or under 1200 characters", () => {
    const shortContent = "y".repeat(500);
    const hits = [makeHit({ content: shortContent })];
    const block = formatContext(hits);
    expect(block).toContain(shortContent);
  });
});

describe("extractCitations", () => {
  const hits = [
    makeHit({ title: "Source One", canonical_url: "https://a.example/1" }),
    makeHit({ title: "Source Two", canonical_url: "https://a.example/2" }),
    makeHit({ title: "Source Three", canonical_url: "https://a.example/3" }),
  ];

  it("returns hits in order of first appearance in the answer", () => {
    const answer = "Some claim [2]. Another claim [1].";
    const citations = extractCitations(answer, hits);
    expect(citations.map((c) => c.n)).toEqual([2, 1]);
    expect(citations[0]!.title).toBe("Source Two");
    expect(citations[1]!.title).toBe("Source One");
  });

  it("de-duplicates repeated markers", () => {
    const answer = "Claim [1]. Restated claim [1] again. New claim [3].";
    const citations = extractCitations(answer, hits);
    expect(citations.map((c) => c.n)).toEqual([1, 3]);
  });

  it("ignores markers with no corresponding hit", () => {
    const answer = "Claim [1]. Bad reference [9].";
    const citations = extractCitations(answer, hits);
    expect(citations.map((c) => c.n)).toEqual([1]);
  });

  it("returns an empty array when the answer has no markers", () => {
    expect(extractCitations("No citations here.", hits)).toEqual([]);
  });
});

describe("shouldOfferDemo", () => {
  it("is false when there are fewer than 3 prior user turns, even with a keyword", () => {
    const history = [
      { role: "user", content: "What is a 990-PF?" },
      { role: "assistant", content: "It is a tax form." },
    ];
    expect(shouldOfferDemo("Does your platform automate this?", history)).toBe(false);
  });

  it("is false with 3+ user turns when the question has no demo keyword", () => {
    const history = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "q3" },
      { role: "assistant", content: "a3" },
    ];
    expect(shouldOfferDemo("What is a fiscal sponsor?", history)).toBe(false);
  });

  it("is true with 3+ user turns and a demo keyword in the question", () => {
    const history = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "q3" },
      { role: "assistant", content: "a3" },
    ];
    expect(shouldOfferDemo("Does Benavora have a CRM?", history)).toBe(true);
  });

  it("matches keywords case-insensitively", () => {
    const history = [
      { role: "user", content: "q1" },
      { role: "user", content: "q2" },
      { role: "user", content: "q3" },
    ];
    expect(shouldOfferDemo("Can I see a DEMO of AutoApply?", history)).toBe(true);
  });
});

describe("computeClientKey", () => {
  it("is stable for the same ip and sessionId", () => {
    const a = computeClientKey("203.0.113.5", "11111111-1111-1111-1111-111111111111");
    const b = computeClientKey("203.0.113.5", "11111111-1111-1111-1111-111111111111");
    expect(a).toBe(b);
  });

  it("differs across sessionIds for the same ip", () => {
    const a = computeClientKey("203.0.113.5", "11111111-1111-1111-1111-111111111111");
    const b = computeClientKey("203.0.113.5", "22222222-2222-2222-2222-222222222222");
    expect(a).not.toBe(b);
  });

  it("differs across ips for the same sessionId", () => {
    const a = computeClientKey("203.0.113.5", "11111111-1111-1111-1111-111111111111");
    const b = computeClientKey("198.51.100.7", "11111111-1111-1111-1111-111111111111");
    expect(a).not.toBe(b);
  });
});
