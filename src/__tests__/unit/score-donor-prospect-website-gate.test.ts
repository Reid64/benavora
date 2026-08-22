// Real defect fixed 2026-08-22 (see score-donor-prospect.ts's doc comment):
// claimNextScoreDonorProspectJob() used to claim ANY never-scored prospect,
// including BMF-sourced ones with no website on file. ScoringEngine has
// nothing to add for those (every signal but foundationLinkageFound needs
// web-enrichment fields that only exist when a website was crawled), so it
// silently overwrote a real, spread-producing deterministic score
// (scoring.ts) with a flat, lower one. This test verifies the claim query
// now excludes prospects whose linked directory record has no website.
import { describe, it, expect, vi } from "vitest";
import { claimNextScoreDonorProspectJob } from "@/worker/jobs/score-donor-prospect";

type CallLog = { select: unknown[][]; or: unknown[][]; not: unknown[][]; order: unknown[][]; limit: unknown[][] };

function makeQueryBuilder(resolved: { data: unknown; error: unknown }) {
  const calls: CallLog = { select: [], or: [], not: [], order: [], limit: [] };
  const q: Record<string, unknown> = {};
  for (const method of ["select", "or", "not", "order", "limit"] as const) {
    q[method] = vi.fn((...args: unknown[]) => {
      calls[method].push(args);
      return q;
    });
  }
  q.maybeSingle = vi.fn().mockResolvedValue(resolved);
  return { query: q, calls };
}

describe("claimNextScoreDonorProspectJob", () => {
  it("excludes prospects whose linked directory record has no website", async () => {
    const { query, calls } = makeQueryBuilder({ data: { id: "prospect-1" }, error: null });
    const fromMock = vi.fn().mockReturnValue(query);
    const supabase = { from: fromMock } as never;

    const job = await claimNextScoreDonorProspectJob(supabase);

    expect(fromMock).toHaveBeenCalledWith("donor_discovery_prospects");
    expect(calls.select[0]?.[0]).toContain("donor_discovery_directory");
    expect(calls.not[0]).toEqual(["donor_discovery_directory.website", "is", null]);
    expect(job).toEqual({ type: "score_donor_prospect", prospectId: "prospect-1" });
  });

  it("returns null when nothing matches (queue empty or all candidates website-less)", async () => {
    const { query } = makeQueryBuilder({ data: null, error: null });
    const supabase = { from: vi.fn().mockReturnValue(query) } as never;

    const job = await claimNextScoreDonorProspectJob(supabase);

    expect(job).toBeNull();
  });
});
