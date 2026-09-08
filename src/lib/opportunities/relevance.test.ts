import { describe, it, expect, vi, afterEach } from "vitest";

import * as kbRelevance from "@/lib/agents/research/kb-relevance";
import {
  MISSION_RELEVANCE_REJECT_THRESHOLD,
  passesRelevanceFilter,
  scanUnscoredRelevance,
  type RelevanceCandidate,
} from "./relevance";

afterEach(() => {
  vi.restoreAllMocks();
});

// Real, client-reported examples confirmed live in production (FAITH
// Foundation's own `opportunities` table): a housing-mission org whose
// dashboard showed these alongside real housing matches, both with
// eligibility_score = null (never scored by anything).
const AIDS_PREVENTION_OPP: RelevanceCandidate = {
  id: "aids-1",
  name: "Department of Defense HIV/AIDS Prevention Program",
  description: null,
  mission_relevance_score: null,
};

const HOUSING_OPP: RelevanceCandidate = {
  id: "housing-1",
  name: "State Rapid Re-Housing Block Grant (NOFA 26-04)",
  description:
    "Down payment assistance and transitional housing support for veterans and families experiencing homelessness.",
  mission_relevance_score: null,
};

describe("scanUnscoredRelevance", () => {
  it("scores each unscored candidate via the real KB scorer and persists the result", async () => {
    const scoreFn = vi.fn(async (text: string) =>
      /housing|homeless|down payment/i.test(text) ? 74 : 4,
    );
    vi.spyOn(kbRelevance, "buildKbScorer").mockResolvedValue({ score: scoreFn });

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: updateEq }));
    const client = { from: vi.fn(() => ({ update })) } as unknown as Parameters<
      typeof scanUnscoredRelevance
    >[0];

    const result = await scanUnscoredRelevance(client, "org-1", [
      AIDS_PREVENTION_OPP,
      HOUSING_OPP,
    ]);

    expect(result.filterActive).toBe(true);
    expect(result.pendingCount).toBe(0);
    expect(result.scores.get("aids-1")).toBe(4);
    expect(result.scores.get("housing-1")).toBe(74);
    // Every scored row is persisted (never left as a phantom in-memory-only score).
    expect(update).toHaveBeenCalledTimes(2);
    expect(updateEq).toHaveBeenCalledWith("id", "aids-1");
    expect(updateEq).toHaveBeenCalledWith("id", "housing-1");
  });

  it("fails open (filterActive=false) when the org has no scorer to build, without fabricating scores", async () => {
    vi.spyOn(kbRelevance, "buildKbScorer").mockResolvedValue(null);
    const client = { from: vi.fn() } as unknown as Parameters<typeof scanUnscoredRelevance>[0];

    const result = await scanUnscoredRelevance(client, "org-1", [AIDS_PREVENTION_OPP]);

    expect(result.filterActive).toBe(false);
    expect(result.scores.size).toBe(0);
    expect(result.pendingCount).toBe(1);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("already-scored rows are never re-scored or re-persisted", async () => {
    const scoreFn = vi.fn(async () => 50);
    vi.spyOn(kbRelevance, "buildKbScorer").mockResolvedValue({ score: scoreFn });
    const client = { from: vi.fn() } as unknown as Parameters<typeof scanUnscoredRelevance>[0];

    const result = await scanUnscoredRelevance(client, "org-1", [
      { ...HOUSING_OPP, mission_relevance_score: 74 },
    ]);

    expect(scoreFn).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
    expect(result.pendingCount).toBe(0);
  });
});

describe("passesRelevanceFilter — the fixed query's default gate", () => {
  it("excludes an AIDS-prevention-style opportunity scored below the reject threshold", () => {
    expect(passesRelevanceFilter(4, MISSION_RELEVANCE_REJECT_THRESHOLD, false)).toBe(false);
  });

  it("includes a real housing opportunity scored above the reject threshold", () => {
    expect(passesRelevanceFilter(74, MISSION_RELEVANCE_REJECT_THRESHOLD, false)).toBe(true);
  });

  it("hides never-scored rows by default (absence of a score is not evidence of relevance)", () => {
    expect(passesRelevanceFilter(null, MISSION_RELEVANCE_REJECT_THRESHOLD, false)).toBe(false);
  });

  it("the visible 'Show All' safety net surfaces never-scored rows explicitly, not silently", () => {
    expect(passesRelevanceFilter(null, MISSION_RELEVANCE_REJECT_THRESHOLD, true)).toBe(true);
  });

  it("the visible 'Show All' safety net also surfaces low-relevance rows", () => {
    expect(passesRelevanceFilter(4, 0, true)).toBe(true);
  });
});
