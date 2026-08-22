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

  it("sums all fired legacy (web-enrichment) signals", () => {
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
    const expected =
      DEFAULT_SCORING_WEIGHTS.givingProgram +
      DEFAULT_SCORING_WEIGHTS.donationForm +
      DEFAULT_SCORING_WEIGHTS.inKindSignals +
      DEFAULT_SCORING_WEIGHTS.linkedFoundation +
      DEFAULT_SCORING_WEIGHTS.geoMatch +
      DEFAULT_SCORING_WEIGHTS.sizeAppropriate;
    expect(result.score).toBe(expected);
  });

  it("sums every signal (legacy + grantmaker-mode) and caps at 100", () => {
    const record = baseRecord({
      enrichment: {
        has_giving_program: true,
        has_donation_form: true,
        giving_focus_areas: ["in-kind material donations"],
        asset_amount: 100_000_000,
        is_grantmaker_ntee: true,
        match_basis: "ntee_code_direct",
      },
      hq_address: "1 Main St, Burnet, TX 78611",
      linked_foundation_id: "f-1",
      linkage_confidence: 1,
    });
    const result = scoreProspect(
      record,
      baseContext({
        geography: { states: ["TX"] },
        organizationAnnualBudget: 500_000,
        linkedFoundationGivingCapacity: 50_000,
        organizationCity: "Burnet",
        organizationState: "TX",
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

describe("scoreProspect — grantmaker-mode signals (fire from BMF data alone, no web enrichment)", () => {
  it("assetSize: tiers score higher for a bigger asset base", () => {
    const small = scoreProspect(
      baseRecord({ enrichment: { asset_amount: 1_500_000 } }),
      baseContext({ geography: { national: true } }),
    );
    const medium = scoreProspect(
      baseRecord({ enrichment: { asset_amount: 5_000_000 } }),
      baseContext({ geography: { national: true } }),
    );
    const large = scoreProspect(
      baseRecord({ enrichment: { asset_amount: 75_000_000 } }),
      baseContext({ geography: { national: true } }),
    );
    expect(small.score).toBeLessThan(medium.score);
    expect(medium.score).toBeLessThan(large.score);
  });

  it("assetSize: does not fire when asset_amount is missing or non-positive", () => {
    const result = scoreProspect(
      baseRecord({ enrichment: { asset_amount: 0 } }),
      baseContext({ geography: { national: true } }),
    );
    expect(result.score).toBe(DEFAULT_SCORING_WEIGHTS.geoMatch); // only national geoMatch fires
  });

  it("grantmakerType: full credit for NTEE-confirmed grantmaker, half for foundation_type-only", () => {
    const nteeConfirmed = scoreProspect(
      baseRecord({ enrichment: { is_grantmaker_ntee: true } }),
      baseContext({ geography: { states: ["TX"] } }),
    );
    const typeOnly = scoreProspect(
      baseRecord({ enrichment: { is_grantmaker_foundation_type: true } }),
      baseContext({ geography: { states: ["TX"] } }),
    );
    expect(nteeConfirmed.score).toBe(DEFAULT_SCORING_WEIGHTS.grantmakerType);
    expect(typeOnly.score).toBe(Math.round(DEFAULT_SCORING_WEIGHTS.grantmakerType * 0.5));
  });

  it("geoProximityToOrg: full credit for same city, half for same state, zero otherwise", () => {
    const sameCity = scoreProspect(
      baseRecord({ hq_address: "1 Main St, Burnet, TX 78611" }),
      baseContext({ geography: { national: true }, organizationCity: "Burnet", organizationState: "TX" }),
    );
    const sameState = scoreProspect(
      baseRecord({ hq_address: "1 Main St, Austin, TX 78701" }),
      baseContext({ geography: { national: true }, organizationCity: "Burnet", organizationState: "TX" }),
    );
    const otherState = scoreProspect(
      baseRecord({ hq_address: "1 Main St, Tulsa, OK 74103" }),
      baseContext({ geography: { national: true }, organizationCity: "Burnet", organizationState: "TX" }),
    );
    const nationalBase = DEFAULT_SCORING_WEIGHTS.geoMatch;
    expect(sameCity.score).toBe(nationalBase + DEFAULT_SCORING_WEIGHTS.geoProximityToOrg);
    expect(sameState.score).toBe(nationalBase + Math.round(DEFAULT_SCORING_WEIGHTS.geoProximityToOrg * 0.5));
    expect(otherState.score).toBe(nationalBase);
  });

  it("matchBasisQuality: full credit for ntee_code_direct, half for name_keyword_match, zero for operating_nonprofit_mode", () => {
    const direct = scoreProspect(
      baseRecord({ enrichment: { match_basis: "ntee_code_direct" } }),
      baseContext({ geography: { states: ["TX"] } }),
    );
    const keyword = scoreProspect(
      baseRecord({ enrichment: { match_basis: "name_keyword_match" } }),
      baseContext({ geography: { states: ["TX"] } }),
    );
    const operatingMode = scoreProspect(
      baseRecord({ enrichment: { match_basis: "operating_nonprofit_mode" } }),
      baseContext({ geography: { states: ["TX"] } }),
    );
    expect(direct.score).toBe(DEFAULT_SCORING_WEIGHTS.matchBasisQuality);
    expect(keyword.score).toBe(Math.round(DEFAULT_SCORING_WEIGHTS.matchBasisQuality * 0.5));
    expect(operatingMode.score).toBe(0);
  });

  it("produces real score spread across zero-web-enrichment BMF prospects that previously all scored identically", () => {
    // Reproduces the real defect found in request f4870e28-... (2026-08-21):
    // 59 grantmaker-mode BMF prospects, zero web enrichment (no website on
    // file for any of them), all scored to a single flat value because only
    // linkedFoundation ever fired. With the four new BMF-native signals,
    // differing assets/ntee-type/match-basis/proximity must produce
    // different scores even though `enrichment.has_giving_program` etc. stay
    // null for every one of them.
    const orgContext = baseContext({
      geography: { states: ["TX"] },
      organizationCity: "Burnet",
      organizationState: "TX",
    });

    const smallDistantFoundation = scoreProspect(
      baseRecord({
        hq_address: "1 Main St, Dallas, TX 75201",
        linked_foundation_id: "f-1",
        linkage_confidence: 1,
        enrichment: {
          asset_amount: 1_100_000,
          is_grantmaker_foundation_type: true,
          match_basis: "name_keyword_match",
        },
      }),
      orgContext,
    );

    const largeLocalConfirmedGrantmaker = scoreProspect(
      baseRecord({
        hq_address: "1 Main St, Burnet, TX 78611",
        linked_foundation_id: "f-2",
        linkage_confidence: 1,
        enrichment: {
          asset_amount: 200_000_000,
          is_grantmaker_ntee: true,
          match_basis: "ntee_code_direct",
        },
      }),
      orgContext,
    );

    expect(largeLocalConfirmedGrantmaker.score).toBeGreaterThan(smallDistantFoundation.score);
    // Neither is a degenerate 0 or 100 — both carry real, distinguishable signal.
    expect(smallDistantFoundation.score).toBeGreaterThan(0);
    expect(largeLocalConfirmedGrantmaker.score).toBeLessThan(100);
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
