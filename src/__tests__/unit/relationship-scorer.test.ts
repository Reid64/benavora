import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  scoreFromEvents,
  computeRelationshipScore,
  type RelationshipEventRow,
} from "@/lib/intelligence/relationship-scorer";

const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

function makeThenable(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createSupabaseMock(result: { data: RelationshipEventRow[] | null; error?: unknown }) {
  const from = vi.fn((table: string) => {
    if (table !== "funder_relationship_events") throw new Error(`Unexpected table: ${table}`);
    return makeThenable({ data: result.data, error: result.error ?? null });
  });
  return { from } as unknown as SupabaseClient;
}

describe("scoreFromEvents", () => {
  it("returns score 0 and momentum 'stable' for an empty event list", () => {
    expect(scoreFromEvents([])).toEqual({ score: 0, momentum: "stable" });
  });

  it("sums the weight of every known event type", () => {
    const events: RelationshipEventRow[] = [
      { event_type: "award", event_date: daysAgo(1) },
      { event_type: "response", event_date: daysAgo(1) },
      { event_type: "meeting", event_date: daysAgo(1) },
      { event_type: "application", event_date: daysAgo(1) },
      { event_type: "outreach", event_date: daysAgo(1) },
      { event_type: "rejection", event_date: daysAgo(1) },
    ];

    // 30 + 20 + 15 + 10 + 5 - 10 = 70
    expect(scoreFromEvents(events).score).toBe(70);
  });

  it("treats an unrecognized event_type as weight 0", () => {
    const events: RelationshipEventRow[] = [
      { event_type: "award", event_date: daysAgo(1) },
      { event_type: "some_future_event_type", event_date: daysAgo(1) },
    ];

    expect(scoreFromEvents(events).score).toBe(30);
  });

  it("clamps the score at 100 when weighted sum exceeds 100", () => {
    const events: RelationshipEventRow[] = Array.from({ length: 4 }, () => ({
      event_type: "award" as const,
      event_date: daysAgo(1),
    }));

    // 4 * 30 = 120, clamped to 100
    expect(scoreFromEvents(events).score).toBe(100);
  });

  it("floors the score at 0 when weighted sum is negative", () => {
    const events: RelationshipEventRow[] = Array.from({ length: 3 }, () => ({
      event_type: "rejection" as const,
      event_date: daysAgo(1),
    }));

    // 3 * -10 = -30, floored to 0
    expect(scoreFromEvents(events).score).toBe(0);
  });

  it("reports momentum 'rising' when the last-90-day weight exceeds the prior-90-day weight", () => {
    const events: RelationshipEventRow[] = [
      { event_type: "award", event_date: daysAgo(10) }, // last 90 days: +30
      { event_type: "application", event_date: daysAgo(120) }, // prior 90-180 days: +10
    ];

    expect(scoreFromEvents(events).momentum).toBe("rising");
  });

  it("reports momentum 'declining' when the last-90-day weight is less than the prior-90-day weight", () => {
    const events: RelationshipEventRow[] = [
      { event_type: "outreach", event_date: daysAgo(10) }, // last 90 days: +5
      { event_type: "award", event_date: daysAgo(120) }, // prior 90-180 days: +30
    ];

    expect(scoreFromEvents(events).momentum).toBe("declining");
  });

  it("reports momentum 'stable' when the last-90-day weight equals the prior-90-day weight", () => {
    const events: RelationshipEventRow[] = [
      { event_type: "application", event_date: daysAgo(10) }, // last 90 days: +10
      { event_type: "application", event_date: daysAgo(120) }, // prior 90-180 days: +10
    ];

    expect(scoreFromEvents(events).momentum).toBe("stable");
  });

  it("includes events older than 180 days in the total score but excludes them from both momentum windows", () => {
    const events: RelationshipEventRow[] = [
      { event_type: "award", event_date: daysAgo(200) },
    ];

    const result = scoreFromEvents(events);

    expect(result.score).toBe(30);
    expect(result.momentum).toBe("stable");
  });
});

describe("computeRelationshipScore", () => {
  it("fetches funder_relationship_events for the given funder and org, then scores them", async () => {
    const supabase = createSupabaseMock({
      data: [
        { event_type: "award", event_date: daysAgo(1) },
        { event_type: "rejection", event_date: daysAgo(1) },
      ],
    });

    const result = await computeRelationshipScore("funder-1", "org-1", supabase);

    expect(supabase.from).toHaveBeenCalledWith("funder_relationship_events");
    expect(result).toEqual({ score: 20, momentum: "rising" });
  });

  it("treats a null data response as no events", async () => {
    const supabase = createSupabaseMock({ data: null });

    const result = await computeRelationshipScore("funder-1", "org-1", supabase);

    expect(result).toEqual({ score: 0, momentum: "stable" });
  });

  it("throws when the underlying query returns an error", async () => {
    const queryError = { message: "connection refused" };
    const supabase = createSupabaseMock({ data: null, error: queryError });

    await expect(computeRelationshipScore("funder-1", "org-1", supabase)).rejects.toEqual(queryError);
  });
});
