// AR-17.5 incremental testing checkpoint.
//
// AR-17.2 (test-evidence/AGENT_OUTPUT_QUALITY_SCORING.md) found
// `ag-15-probability` DEGENERATE: 478/500 sampled production rows had all
// three non-Digital-Twin factors pinned to hardcoded neutral constants
// simultaneously, so the visible "probability" was a linear echo of one
// unrelated number dressed up as a personalized score. This suite proves the
// fix in src/lib/intelligence/grant-probability-engine.ts against the four
// properties the fix was required to have:
//
//   1. Genuinely different inputs produce genuinely different outputs.
//   2. Missing inputs produce an explicit insufficient-data result, never a
//      default number.
//   3. Every score (or insufficient-data result) carries its evidence.
//   4. No cross-organization leakage — every query this engine issues is
//      scoped by organization_id, so two orgs scoring the "same" opportunity
//      id never see each other's data. (AR-17.2 explicitly checked this
//      scoring family for a tenancy-scoped-cache leak and found none; this
//      test is the regression guard for that finding, not a literal cache
//      check, since no cache exists here to check.)

import { describe, it, expect, vi } from "vitest";
import { addDays } from "date-fns";
import { computeGrantProbability } from "@/lib/intelligence/grant-probability-engine";

interface MockOpportunity {
  id: string;
  category: string | null;
  deadline: string | null;
  eligibility_score: number | null;
}

interface MockTwin {
  twin_completeness_score: number | null;
}

function makeThenable(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

/** A single fake Supabase client whose `opportunities` table is keyed by
 * organization_id -- i.e. it behaves like a real org-isolated multi-tenant
 * table, so a bug that dropped an `.eq("organization_id", ...)` filter
 * anywhere in the engine would surface here as one org receiving another
 * org's twin/outcomes/eligibility data. */
function createMultiOrgSupabaseMock(
  orgs: Record<
    string,
    { opportunity: MockOpportunity; twin: MockTwin | null; outcomes: { result: string }[] | null }
  >,
) {
  const upsertCalls: unknown[] = [];

  return {
    from: vi.fn((table: string) => {
      if (table === "opportunities") {
        return {
          select: vi.fn().mockReturnThis(),
          eq(this: any, col: string, val: string) {
            this.__filters = { ...(this.__filters ?? {}), [col]: val };
            return this;
          },
          maybeSingle(this: any) {
            const orgId = this.__filters?.organization_id;
            const org = orgId ? orgs[orgId] : undefined;
            return Promise.resolve({ data: org?.opportunity ?? null, error: null });
          },
        };
      }
      if (table === "organizational_digital_twins") {
        return {
          select: vi.fn().mockReturnThis(),
          eq(this: any, col: string, val: string) {
            this.__filters = { ...(this.__filters ?? {}), [col]: val };
            return this;
          },
          maybeSingle(this: any) {
            const orgId = this.__filters?.organization_id;
            const org = orgId ? orgs[orgId] : undefined;
            return Promise.resolve({ data: org?.twin ?? null, error: null });
          },
        };
      }
      if (table === "outcomes") {
        // Built lazily per-call so each call's own .eq() chain is captured
        // independently (two concurrent computeGrantProbability calls for
        // two different orgs must not share filter state).
        const filters: Record<string, string> = {};
        const builder: Record<string, unknown> = {
          select: vi.fn(() => builder),
          eq: vi.fn((col: string, val: string) => {
            filters[col] = val;
            return builder;
          }),
        };
        builder.then = (resolve: (v: unknown) => unknown) => {
          const org = filters.organization_id ? orgs[filters.organization_id] : undefined;
          return Promise.resolve({ data: org?.outcomes ?? null }).then(resolve);
        };
        return builder;
      }
      if (table === "opportunity_probability_scores") {
        return {
          upsert: vi.fn((payload: unknown) => {
            upsertCalls.push(payload);
            return Promise.resolve({ error: null });
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    __upsertCalls: upsertCalls,
  };
}

describe("AR-17.5 scoring output quality — computeGrantProbability", () => {
  it("genuinely different inputs produce genuinely different outputs", async () => {
    const strongOrg = {
      opportunity: {
        id: "opp-shared-id",
        category: "housing_grant",
        deadline: addDays(new Date(), 40).toISOString(),
        eligibility_score: 90,
      },
      twin: { twin_completeness_score: 90 },
      outcomes: [{ result: "awarded" }, { result: "awarded" }],
    };
    const weakOrg = {
      opportunity: {
        id: "opp-shared-id",
        category: "housing_grant",
        deadline: addDays(new Date(), 2).toISOString(),
        eligibility_score: 10,
      },
      twin: { twin_completeness_score: 15 },
      outcomes: [{ result: "denied" }, { result: "denied" }],
    };
    const supabase = createMultiOrgSupabaseMock({ "org-strong": strongOrg, "org-weak": weakOrg });

    const strong = await computeGrantProbability("opp-shared-id", "org-strong", supabase as any);
    const weak = await computeGrantProbability("opp-shared-id", "org-weak", supabase as any);

    expect(strong.status).toBe("scored");
    expect(weak.status).toBe("scored");
    expect(strong.score).not.toBe(weak.score);
    expect(strong.score! - weak.score!).toBeGreaterThan(40);
  });

  it("missing inputs produce an explicit insufficient-data result, never a default number", async () => {
    const sparseOrg = {
      opportunity: {
        id: "opp-sparse",
        category: null,
        deadline: null,
        eligibility_score: null,
      },
      twin: null,
      outcomes: null,
    };
    const supabase = createMultiOrgSupabaseMock({ "org-sparse": sparseOrg });

    const result = await computeGrantProbability("opp-sparse", "org-sparse", supabase as any);

    expect(result.status).toBe("insufficient_data");
    expect(result.score).toBeNull(); // not 0, not 50 — explicitly absent
    expect(result.insufficient_data_reasons.length).toBeGreaterThan(0);
    // The exact AR-17.2 mechanism: this must never silently become a
    // plausible-looking number derived from constants.
    expect(result.factors.every((f) => f.isFallback)).toBe(true);
  });

  it("every score (and every insufficient-data result) carries its evidence", async () => {
    const org = {
      opportunity: {
        id: "opp-evidenced",
        category: "education_grant",
        deadline: addDays(new Date(), 10).toISOString(),
        eligibility_score: 65,
      },
      twin: { twin_completeness_score: 55 },
      outcomes: [{ result: "awarded" }],
    };
    const supabase = createMultiOrgSupabaseMock({ "org-a": org });

    const result = await computeGrantProbability("opp-evidenced", "org-a", supabase as any);

    expect(result.evidence).toBeDefined();
    expect(result.evidence.opportunityId).toBe("opp-evidenced");
    expect(result.evidence.organizationId).toBe("org-a");
    expect(typeof result.evidence.realFactorCount).toBe("number");
    expect(result.evidence.inputs).toMatchObject({
      eligibilityScore: 65,
      categoryOutcomesCount: 1,
      deadline: expect.any(String),
      twinCompletenessScore: 55,
    });
    for (const f of result.factors) {
      expect(f.source).toBeTruthy();
      expect(typeof f.isFallback).toBe("boolean");
    }

    const supabaseForUpsert = createMultiOrgSupabaseMock({ "org-a": org });
    await computeGrantProbability("opp-evidenced", "org-a", supabaseForUpsert as any);
    const [persisted] = (supabaseForUpsert as any).__upsertCalls;
    expect(persisted.evidence).toBeDefined();
    expect(persisted.evidence.organizationId).toBe("org-a");
  });

  it("cache/tenancy: scoring the same opportunity id for two different orgs never mixes their data", async () => {
    const orgA = {
      opportunity: { id: "opp-tenancy", category: "arts_grant", deadline: null, eligibility_score: 20 },
      twin: { twin_completeness_score: 20 },
      outcomes: null,
    };
    const orgB = {
      opportunity: { id: "opp-tenancy", category: "arts_grant", deadline: null, eligibility_score: 95 },
      twin: { twin_completeness_score: 95 },
      outcomes: null,
    };
    const supabase = createMultiOrgSupabaseMock({ "org-A": orgA, "org-B": orgB });

    const [resultA, resultB] = await Promise.all([
      computeGrantProbability("opp-tenancy", "org-A", supabase as any),
      computeGrantProbability("opp-tenancy", "org-B", supabase as any),
    ]);

    expect(resultA.evidence.organizationId).toBe("org-A");
    expect(resultB.evidence.organizationId).toBe("org-B");
    expect(resultA.evidence.inputs.eligibilityScore).toBe(20);
    expect(resultB.evidence.inputs.eligibilityScore).toBe(95);
    expect(resultA.score).not.toBe(resultB.score);

    const [persistedA, persistedB] = (supabase as any).__upsertCalls;
    expect(persistedA.organization_id).not.toBe(persistedB.organization_id);
  });
});
