"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const scoring_1 = require("./scoring");
function baseRecord(overrides = {}) {
    return {
        enrichment: null,
        hq_address: null,
        geo: null,
        linked_foundation_id: null,
        linkage_confidence: null,
        ...overrides,
    };
}
function baseContext(overrides = {}) {
    return {
        geography: { national: true },
        ...overrides,
    };
}
(0, vitest_1.describe)("scoreProspect — weight math", () => {
    (0, vitest_1.it)("scores a record with no signals at 0", () => {
        const result = (0, scoring_1.scoreProspect)(baseRecord(), baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.score).toBe(0);
    });
    (0, vitest_1.it)("awards the givingProgram weight when has_giving_program is true", () => {
        const record = baseRecord({ enrichment: { has_giving_program: true } });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.score).toBe(scoring_1.DEFAULT_SCORING_WEIGHTS.givingProgram);
    });
    (0, vitest_1.it)("awards the donationForm weight when has_donation_form is true", () => {
        const record = baseRecord({ enrichment: { has_donation_form: true } });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.score).toBe(scoring_1.DEFAULT_SCORING_WEIGHTS.donationForm);
    });
    (0, vitest_1.it)("awards the inKindSignals weight on a keyword match in giving_focus_areas", () => {
        const record = baseRecord({
            enrichment: { giving_focus_areas: ["community sponsorships", "youth programs"] },
        });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.score).toBe(scoring_1.DEFAULT_SCORING_WEIGHTS.inKindSignals);
    });
    (0, vitest_1.it)("does not fire inKindSignals when giving_focus_areas has no matching keyword", () => {
        const record = baseRecord({ enrichment: { giving_focus_areas: ["youth programs"] } });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.score).toBe(0);
    });
    (0, vitest_1.it)("scales the linkedFoundation weight by linkage_confidence", () => {
        const record = baseRecord({ linked_foundation_id: "f-1", linkage_confidence: 0.6 });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.score).toBe(Math.round(scoring_1.DEFAULT_SCORING_WEIGHTS.linkedFoundation * 0.6));
    });
    (0, vitest_1.it)("does not award linkedFoundation points when linked_foundation_id is null even if linkage_confidence is set", () => {
        const record = baseRecord({ linked_foundation_id: null, linkage_confidence: 0.9 });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.score).toBe(0);
    });
    (0, vitest_1.it)("clamps linkage_confidence into [0, 1]", () => {
        const record = baseRecord({ linked_foundation_id: "f-1", linkage_confidence: 1.5 });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.score).toBe(scoring_1.DEFAULT_SCORING_WEIGHTS.linkedFoundation);
    });
    (0, vitest_1.it)("awards geoMatch for a national geography regardless of location data", () => {
        const result = (0, scoring_1.scoreProspect)(baseRecord(), baseContext({ geography: { national: true } }));
        (0, vitest_1.expect)(result.score).toBe(scoring_1.DEFAULT_SCORING_WEIGHTS.geoMatch);
    });
    (0, vitest_1.it)("awards geoMatch when hq_address state matches the requested states", () => {
        const record = baseRecord({ hq_address: "123 Main St, Austin, TX 78701" });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX", "OK"] } }));
        (0, vitest_1.expect)(result.score).toBe(scoring_1.DEFAULT_SCORING_WEIGHTS.geoMatch);
    });
    (0, vitest_1.it)("does not award geoMatch when hq_address state is outside the requested states", () => {
        const record = baseRecord({ hq_address: "123 Main St, Tulsa, OK 74103" });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.score).toBe(0);
    });
    (0, vitest_1.it)("awards geoMatch when geo is within the requested radius", () => {
        const record = baseRecord({ geo: { lat: 30.2672, lng: -97.7431 } }); // Austin, TX
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { center: { lat: 30.2672, lng: -97.7431 }, radius_mi: 25 } }));
        (0, vitest_1.expect)(result.score).toBe(scoring_1.DEFAULT_SCORING_WEIGHTS.geoMatch);
    });
    (0, vitest_1.it)("does not award geoMatch when geo is outside the requested radius", () => {
        const record = baseRecord({ geo: { lat: 40.7128, lng: -74.006 } }); // New York, NY
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { center: { lat: 30.2672, lng: -97.7431 }, radius_mi: 25 } }));
        (0, vitest_1.expect)(result.score).toBe(0);
    });
    (0, vitest_1.it)("awards sizeAppropriate when the linked foundation's giving capacity is a plausible fraction of the org's budget", () => {
        const record = baseRecord();
        const result = (0, scoring_1.scoreProspect)(record, baseContext({
            geography: { states: ["TX"] },
            organizationAnnualBudget: 500_000,
            linkedFoundationGivingCapacity: 50_000,
        }));
        (0, vitest_1.expect)(result.score).toBe(scoring_1.DEFAULT_SCORING_WEIGHTS.sizeAppropriate);
    });
    (0, vitest_1.it)("does not award sizeAppropriate when the giving capacity is far too small relative to budget", () => {
        const result = (0, scoring_1.scoreProspect)(baseRecord(), baseContext({
            geography: { states: ["TX"] },
            organizationAnnualBudget: 500_000,
            linkedFoundationGivingCapacity: 100,
        }));
        (0, vitest_1.expect)(result.score).toBe(0);
    });
    (0, vitest_1.it)("does not award sizeAppropriate when budget or capacity is missing", () => {
        const result = (0, scoring_1.scoreProspect)(baseRecord(), baseContext({ geography: { states: ["TX"] }, linkedFoundationGivingCapacity: 50_000 }));
        (0, vitest_1.expect)(result.score).toBe(0);
    });
    (0, vitest_1.it)("sums all fired signals and caps at 100", () => {
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
        const result = (0, scoring_1.scoreProspect)(record, baseContext({
            geography: { states: ["TX"] },
            organizationAnnualBudget: 500_000,
            linkedFoundationGivingCapacity: 50_000,
        }));
        (0, vitest_1.expect)(result.score).toBe(100);
    });
    (0, vitest_1.it)("respects org-overridden weights", () => {
        const record = baseRecord({ enrichment: { has_giving_program: true } });
        const weights = (0, scoring_1.parseScoringWeights)({ givingProgram: 40 });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }), weights);
        (0, vitest_1.expect)(result.score).toBe(40);
    });
});
(0, vitest_1.describe)("parseScoringWeights", () => {
    (0, vitest_1.it)("returns the defaults when given null", () => {
        (0, vitest_1.expect)((0, scoring_1.parseScoringWeights)(null)).toEqual(scoring_1.DEFAULT_SCORING_WEIGHTS);
    });
    (0, vitest_1.it)("returns the defaults when given a non-object", () => {
        (0, vitest_1.expect)((0, scoring_1.parseScoringWeights)("nonsense")).toEqual(scoring_1.DEFAULT_SCORING_WEIGHTS);
    });
    (0, vitest_1.it)("merges a partial override onto the defaults", () => {
        const merged = (0, scoring_1.parseScoringWeights)({ geoMatch: 30 });
        (0, vitest_1.expect)(merged).toEqual({ ...scoring_1.DEFAULT_SCORING_WEIGHTS, geoMatch: 30 });
    });
    (0, vitest_1.it)("ignores negative or non-numeric override values", () => {
        const merged = (0, scoring_1.parseScoringWeights)({ geoMatch: -5, donationForm: "lots" });
        (0, vitest_1.expect)(merged).toEqual(scoring_1.DEFAULT_SCORING_WEIGHTS);
    });
    (0, vitest_1.it)("ignores unknown keys", () => {
        const merged = (0, scoring_1.parseScoringWeights)({ notARealWeight: 99 });
        (0, vitest_1.expect)(merged).toEqual(scoring_1.DEFAULT_SCORING_WEIGHTS);
    });
});
(0, vitest_1.describe)("scoreProspect — rationale", () => {
    (0, vitest_1.it)("lists only fired signals", () => {
        const record = baseRecord({ enrichment: { has_giving_program: true } });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.rationale).toContain("has an active giving program");
        (0, vitest_1.expect)(result.rationale).not.toContain("donation");
        (0, vitest_1.expect)(result.rationale).not.toContain("foundation");
    });
    (0, vitest_1.it)("includes the linkage confidence percentage when linked", () => {
        const record = baseRecord({ linked_foundation_id: "f-1", linkage_confidence: 0.72 });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.rationale).toContain("72% confidence");
    });
    (0, vitest_1.it)("returns the no-signals sentence when nothing fires", () => {
        const result = (0, scoring_1.scoreProspect)(baseRecord(), baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.rationale).toBe("No positive signals found for this prospect.");
    });
    (0, vitest_1.it)("joins multiple fired signals with commas and 'and'", () => {
        const record = baseRecord({
            enrichment: { has_giving_program: true, has_donation_form: true },
            hq_address: "1 Main St, Austin, TX 78701",
        });
        const result = (0, scoring_1.scoreProspect)(record, baseContext({ geography: { states: ["TX"] } }));
        (0, vitest_1.expect)(result.rationale).toBe("This prospect has an active giving program, has a donation or sponsorship request form, and is located within the requested geography.");
    });
});
