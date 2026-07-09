import { describe, it, expect } from "vitest";
import {
  scoreProspect,
  parseScoringWeights,
  DEFAULT_SCORING_WEIGHTS,
  type ScoringDirectoryRecord,
  type ScoringRequestContext,
} from "./scoring";

function baseRecord(overrides: Partial<ScoringDirectoryRecord> = {}): ScoringDirectoryRecord {
  return {
    enrichment: null,
    hq_address: null,
    geo: null,
    linked_foundation_id: null,
    linkage_confidence: null,
    ...overrides,
  };
}

function baseContext(overrides: Partial<ScoringRequestContext> = {}): ScoringRequestContext {
  return {
    geography: { national: true },
    ...overrides,
  };
}

describe("scoreProspect — weight math", () => {
  it("scores a record with no signals at 0", () => {
    const result = scoreProspect(baseRecord(), baseContext({ geography: { states: ["TX"] } }));
    expect(result.score).toBe(0);
  });

  it("awards the givingProgram weight when has_giving_program is true", () => {
    const record = baseRecord({ enrichment: { has_giving_program: true } });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.score).toBe(DEFAULT_SCORING_WEIGHTS.givingProgram);
  });

  it("awards the donationForm weight when has_donation_form is true", () => {
    const record = baseRecord({ enrichment: { has_donation_form: true } });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.score).toBe(DEFAULT_SCORING_WEIGHTS.donationForm);
  });

  it("awards the inKindSignals weight on a keyword match in giving_focus_areas", () => {
    const record = baseRecord({
      enrichment: { giving_focus_areas: ["community sponsorships", "youth programs"] },
    });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.score).toBe(DEFAULT_SCORING_WEIGHTS.inKindSignals);
  });

  it("does not fire inKindSignals when giving_focus_areas has no matching keyword", () => {
    const record = baseRecord({ enrichment: { giving_focus_areas: ["youth programs"] } });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.score).toBe(0);
  });

  it("scales the linkedFoundation weight by linkage_confidence", () => {
    const record = baseRecord({ linked_foundation_id: "f-1", linkage_confidence: 0.6 });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.score).toBe(Math.round(DEFAULT_SCORING_WEIGHTS.linkedFoundation * 0.6));
  });

  it("does not award linkedFoundation points when linked_foundation_id is null even if linkage_confidence is set", () => {
    const record = baseRecord({ linked_foundation_id: null, linkage_confidence: 0.9 });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.score).toBe(0);
  });

  it("clamps linkage_confidence into [0, 1]", () => {
    const record = baseRecord({ linked_foundation_id: "f-1", linkage_confidence: 1.5 });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.score).toBe(DEFAULT_SCORING_WEIGHTS.linkedFoundation);
  });

  it("awards geoMatch for a national geography regardless of location data", () => {
    const result = scoreProspect(baseRecord(), baseContext({ geography: { national: true } }));
    expect(result.score).toBe(DEFAULT_SCORING_WEIGHTS.geoMatch);
  });

  it("awards geoMatch when hq_address state matches the requested states", () => {
    const record = baseRecord({ hq_address: "123 Main St, Austin, TX 78701" });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX", "OK"] } }));
    expect(result.score).toBe(DEFAULT_SCORING_WEIGHTS.geoMatch);
  });

  it("does not award geoMatch when hq_address state is outside the requested states", () => {
    const record = baseRecord({ hq_address: "123 Main St, Tulsa, OK 74103" });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.score).toBe(0);
  });

  it("awards geoMatch when geo is within the requested radius", () => {
    const record = baseRecord({ geo: { lat: 30.2672, lng: -97.7431 } }); // Austin, TX
    const result = scoreProspect(
      record,
      baseContext({ geography: { center: { lat: 30.2672, lng: -97.7431 }, radius_mi: 25 } }),
    );
    expect(result.score).toBe(DEFAULT_SCORING_WEIGHTS.geoMatch);
  });

  it("does not award geoMatch when geo is outside the requested radius", () => {
    const record = baseRecord({ geo: { lat: 40.7128, lng: -74.006 } }); // New York, NY
    const result = scoreProspect(
      record,
      baseContext({ geography: { center: { lat: 30.2672, lng: -97.7431 }, radius_mi: 25 } }),
    );
    expect(result.score).toBe(0);
  });

  it("awards sizeAppropriate when the linked foundation's giving capacity is a plausible fraction of the org's budget", () => {
    const record = baseRecord();
    const result = scoreProspect(
      record,
      baseContext({
        geography: { states: ["TX"] },
        organizationAnnualBudget: 500_000,
        linkedFoundationGivingCapacity: 50_000,
      }),
    );
    expect(result.score).toBe(DEFAULT_SCORING_WEIGHTS.sizeAppropriate);
  });

  it("does not award sizeAppropriate when the giving capacity is far too small relative to budget", () => {
    const result = scoreProspect(
      baseRecord(),
      baseContext({
        geography: { states: ["TX"] },
        organizationAnnualBudget: 500_000,
        linkedFoundationGivingCapacity: 100,
      }),
    );
    expect(result.score).toBe(0);
  });

  it("does not award sizeAppropriate when budget or capacity is missing", () => {
    const result = scoreProspect(
      baseRecord(),
      baseContext({ geography: { states: ["TX"] }, linkedFoundationGivingCapacity: 50_000 }),
    );
    expect(result.score).toBe(0);
  });

  it("sums all fired signals and caps at 100", () => {
    const record = baseRecord({
      enrichment: {
        has_giving_program: true,
        has_donation_form: true,
        giving_focus_areas: ["in-kind material donations"],
      },
      hq_address: "1 Main St, Austin, TX 78701",
      linked_foundation_id: "f-1",
      linkage_confidence: 1,
    });
    const result = scoreProspect(
      record,
      baseContext({
        geography: { states: ["TX"] },
        organizationAnnualBudget: 500_000,
        linkedFoundationGivingCapacity: 50_000,
      }),
    );
    expect(result.score).toBe(100);
  });

  it("respects org-overridden weights", () => {
    const record = baseRecord({ enrichment: { has_giving_program: true } });
    const weights = parseScoringWeights({ givingProgram: 40 });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }), weights);
    expect(result.score).toBe(40);
  });
});

describe("parseScoringWeights", () => {
  it("returns the defaults when given null", () => {
    expect(parseScoringWeights(null)).toEqual(DEFAULT_SCORING_WEIGHTS);
  });

  it("returns the defaults when given a non-object", () => {
    expect(parseScoringWeights("nonsense" as unknown as null)).toEqual(DEFAULT_SCORING_WEIGHTS);
  });

  it("merges a partial override onto the defaults", () => {
    const merged = parseScoringWeights({ geoMatch: 30 });
    expect(merged).toEqual({ ...DEFAULT_SCORING_WEIGHTS, geoMatch: 30 });
  });

  it("ignores negative or non-numeric override values", () => {
    const merged = parseScoringWeights({ geoMatch: -5, donationForm: "lots" as unknown as number });
    expect(merged).toEqual(DEFAULT_SCORING_WEIGHTS);
  });

  it("ignores unknown keys", () => {
    const merged = parseScoringWeights({ notARealWeight: 99 });
    expect(merged).toEqual(DEFAULT_SCORING_WEIGHTS);
  });
});

describe("scoreProspect — rationale", () => {
  it("lists only fired signals", () => {
    const record = baseRecord({ enrichment: { has_giving_program: true } });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.rationale).toContain("has an active giving program");
    expect(result.rationale).not.toContain("donation");
    expect(result.rationale).not.toContain("foundation");
  });

  it("includes the linkage confidence percentage when linked", () => {
    const record = baseRecord({ linked_foundation_id: "f-1", linkage_confidence: 0.72 });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.rationale).toContain("72% confidence");
  });

  it("returns the no-signals sentence when nothing fires", () => {
    const result = scoreProspect(baseRecord(), baseContext({ geography: { states: ["TX"] } }));
    expect(result.rationale).toBe("No positive signals found for this prospect.");
  });

  it("joins multiple fired signals with commas and 'and'", () => {
    const record = baseRecord({
      enrichment: { has_giving_program: true, has_donation_form: true },
      hq_address: "1 Main St, Austin, TX 78701",
    });
    const result = scoreProspect(record, baseContext({ geography: { states: ["TX"] } }));
    expect(result.rationale).toBe(
      "This prospect has an active giving program, has a donation or sponsorship request form, and is located within the requested geography.",
    );
  });
});
