import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/intelligence/embeddings", () => ({
  generateEmbedding: vi.fn(),
}));
vi.mock("@/lib/agents/research/scheduler", () => ({
  getActiveProfiles: vi.fn(),
  profileQueryTerms: vi.fn(),
}));

import { generateEmbedding } from "@/lib/intelligence/embeddings";
import { getActiveProfiles, profileQueryTerms } from "@/lib/agents/research/scheduler";
import { buildKbScorer, buildOrgFocusText } from "@/lib/agents/research/kb-relevance";

function fakeClient(kbRows: unknown[] = []) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: kbRows, error: null })),
        })),
      })),
    })),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("buildOrgFocusText", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("aggregates active-profile terms and knowledge_base rows into one string", async () => {
    vi.mocked(getActiveProfiles).mockResolvedValue([
      { categories: ["housing_grant"] } as never,
    ]);
    vi.mocked(profileQueryTerms).mockReturnValue(["reentry", "recovery housing"]);

    const client = fakeClient([
      { funder_categories: ["housing_grant"], keywords: ["transitional housing"] },
    ]);

    const text = await buildOrgFocusText({ client, organizationId: "org-1" });

    expect(text).toContain("reentry");
    expect(text).toContain("recovery housing");
    expect(text).toContain("transitional housing");
    expect(text).toContain("Housing Grant");
  });

  it("returns an empty string when there is no active profile and no knowledge_base data", async () => {
    vi.mocked(getActiveProfiles).mockResolvedValue([]);
    vi.mocked(profileQueryTerms).mockReturnValue([]);

    const client = fakeClient([]);
    const text = await buildOrgFocusText({ client, organizationId: "org-1" });

    expect(text).toBe("");
  });
});

describe("buildKbScorer", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns null when OPENAI_API_KEY is unset (fail open)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.mocked(getActiveProfiles).mockResolvedValue([{ categories: [] } as never]);
    vi.mocked(profileQueryTerms).mockReturnValue(["housing"]);

    const scorer = await buildKbScorer({ client: fakeClient(), organizationId: "org-1" });

    expect(scorer).toBeNull();
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it("returns null when there is no focus text to score against (fail open)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.mocked(getActiveProfiles).mockResolvedValue([]);
    vi.mocked(profileQueryTerms).mockReturnValue([]);

    const scorer = await buildKbScorer({ client: fakeClient([]), organizationId: "org-1" });

    expect(scorer).toBeNull();
  });

  it("returns null when the org-focus embedding call fails (fail open)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.mocked(getActiveProfiles).mockResolvedValue([{ categories: [] } as never]);
    vi.mocked(profileQueryTerms).mockReturnValue(["housing"]);
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("rate limited"));

    const scorer = await buildKbScorer({ client: fakeClient([]), organizationId: "org-1" });

    expect(scorer).toBeNull();
  });

  it("scores a close-match candidate higher than an unrelated one", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.mocked(getActiveProfiles).mockResolvedValue([{ categories: [] } as never]);
    vi.mocked(profileQueryTerms).mockReturnValue(["transitional housing", "reentry"]);
    vi.mocked(generateEmbedding).mockImplementation(async (text: string) => {
      // A tiny fake embedding space: "housing"/"reentry" load dim 0, anything
      // else loads dim 1 — a real cosine-similarity computation over it.
      const isHousingRelated = /housing|reentry/i.test(text);
      return isHousingRelated ? [1, 0] : [0, 1];
    });

    const scorer = await buildKbScorer({ client: fakeClient([]), organizationId: "org-1" });
    expect(scorer).not.toBeNull();

    const relatedScore = await scorer!.score("Transitional housing grant for reentry programs");
    const unrelatedScore = await scorer!.score("Deep sea fisheries research funding");

    expect(relatedScore).toBeGreaterThan(unrelatedScore);
    expect(relatedScore).toBe(100);
    expect(unrelatedScore).toBe(0);
  });

  it("fails open (neutral score) when a candidate embedding call fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.mocked(getActiveProfiles).mockResolvedValue([{ categories: [] } as never]);
    vi.mocked(profileQueryTerms).mockReturnValue(["housing"]);
    vi.mocked(generateEmbedding)
      .mockResolvedValueOnce([1, 0]) // org focus embedding succeeds
      .mockRejectedValueOnce(new Error("network error")); // candidate embedding fails

    const scorer = await buildKbScorer({ client: fakeClient([]), organizationId: "org-1" });
    const score = await scorer!.score("some candidate");

    expect(score).toBe(50);
  });
});
