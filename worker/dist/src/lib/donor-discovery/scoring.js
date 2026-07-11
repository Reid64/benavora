"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SCORING_WEIGHTS = void 0;
exports.parseScoringWeights = parseScoringWeights;
exports.scoreProspect = scoreProspect;
/** Sums to 100 — architecture doc §2D's point allocation. */
exports.DEFAULT_SCORING_WEIGHTS = {
    givingProgram: 25,
    donationForm: 20,
    inKindSignals: 15,
    linkedFoundation: 15,
    geoMatch: 15,
    sizeAppropriate: 10,
};
/**
 * Merges `organizations.donor_discovery_scoring_weights` (migration 074)
 * onto the defaults. Only finite, non-negative numeric overrides for known
 * weight keys are honored; anything else (missing column, malformed jsonb,
 * a negative or non-numeric override) falls back to the default for that key.
 */
function parseScoringWeights(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ...exports.DEFAULT_SCORING_WEIGHTS };
    }
    const obj = raw;
    const merged = { ...exports.DEFAULT_SCORING_WEIGHTS };
    for (const key of Object.keys(exports.DEFAULT_SCORING_WEIGHTS)) {
        const value = obj[key];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
            merged[key] = value;
        }
    }
    return merged;
}
// ── Signal: giving program / donation form / in-kind ────────────────────────
// giving_focus_areas is free text extracted by Claude (web-extractor.ts); no
// dedicated "in-kind" field exists in the extraction schema, so in-kind
// evidence is detected as a keyword match against the focus-area text —
// the closest concrete signal §2B actually produces today.
const IN_KIND_KEYWORDS = [
    "in-kind",
    "in kind",
    "sponsorship",
    "sponsorships",
    "materials donation",
    "material donations",
    "equipment donation",
    "product donation",
    "donate materials",
    "donate equipment",
    "donated supplies",
];
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((v) => typeof v === "string");
}
function hasGivingProgram(enrichment) {
    return enrichment?.has_giving_program === true;
}
function hasDonationForm(enrichment) {
    return enrichment?.has_donation_form === true;
}
function hasInKindSignals(enrichment) {
    if (!enrichment)
        return false;
    const haystack = asStringArray(enrichment.giving_focus_areas).join(" ").toLowerCase();
    if (!haystack)
        return false;
    return IN_KIND_KEYWORDS.some((keyword) => haystack.includes(keyword));
}
// ── Signal: geo match ────────────────────────────────────────────────────────
const EARTH_RADIUS_KM = 6371;
const KM_PER_MILE = 1.60934;
function haversineKm(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}
// Pulls a two-letter state code from a formatted US address string like
// "123 Main St, Austin, TX 78701".
function extractStateFromAddress(address) {
    if (!address)
        return null;
    const match = address.match(/,\s*([A-Za-z]{2})\s*\d{5}(-\d{4})?\s*$/);
    return match?.[1] ? match[1].toUpperCase() : null;
}
function isGeoMatch(record, geography) {
    if ("national" in geography && geography.national)
        return true;
    if ("center" in geography && "radius_mi" in geography) {
        if (!record.geo)
            return false;
        return haversineKm(record.geo, geography.center) <= geography.radius_mi * KM_PER_MILE;
    }
    if ("states" in geography) {
        const state = extractStateFromAddress(record.hq_address);
        if (!state)
            return false;
        return geography.states.some((s) => s.toUpperCase() === state);
    }
    return false;
}
// ── Signal: size-appropriate ─────────────────────────────────────────────────
// A funder whose total giving is a rounding error next to the org's budget
// isn't a realistic ask; one many orders of magnitude larger is likely an
// institutional grantmaker this generic prospecting pass shouldn't claim
// credit for identifying. Both bounds are deliberately generous — this is a
// coarse plausibility filter, not an eligibility gate.
const SIZE_APPROPRIATE_MIN_RATIO = 0.02;
const SIZE_APPROPRIATE_MAX_RATIO = 200;
function isSizeAppropriate(context) {
    const budget = context.organizationAnnualBudget;
    const capacity = context.linkedFoundationGivingCapacity;
    if (!budget || budget <= 0 || !capacity || capacity <= 0)
        return false;
    const ratio = capacity / budget;
    return ratio >= SIZE_APPROPRIATE_MIN_RATIO && ratio <= SIZE_APPROPRIATE_MAX_RATIO;
}
// ── Rationale ────────────────────────────────────────────────────────────────
function joinWithCommasAnd(parts) {
    if (parts.length <= 1)
        return parts[0] ?? "";
    if (parts.length === 2)
        return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
function buildRationale(signals) {
    const parts = [];
    if (signals.givingProgram)
        parts.push("has an active giving program");
    if (signals.donationForm)
        parts.push("has a donation or sponsorship request form");
    if (signals.inKindSignals)
        parts.push("shows in-kind giving signals");
    if (signals.linkedFoundation) {
        parts.push(`is linked to a corporate foundation (${signals.linkageConfidencePct}% confidence)`);
    }
    if (signals.geoMatch)
        parts.push("is located within the requested geography");
    if (signals.sizeAppropriate)
        parts.push("is sized appropriately for this ask");
    if (parts.length === 0)
        return "No positive signals found for this prospect.";
    return `This prospect ${joinWithCommasAnd(parts)}.`;
}
// ── Public entry point ───────────────────────────────────────────────────────
/**
 * Deterministic 0-100 score for one directory record against one request's
 * context. Same inputs always produce the same output — no randomness, no
 * network/database calls, no dependence on wall-clock time.
 */
function scoreProspect(directoryRecord, requestContext, weights = exports.DEFAULT_SCORING_WEIGHTS) {
    const enrichment = directoryRecord.enrichment;
    const givingProgramFired = hasGivingProgram(enrichment);
    const donationFormFired = hasDonationForm(enrichment);
    const inKindFired = hasInKindSignals(enrichment);
    const linkageConfidence = directoryRecord.linked_foundation_id
        ? Math.max(0, Math.min(1, directoryRecord.linkage_confidence ?? 0))
        : 0;
    const geoMatchFired = isGeoMatch(directoryRecord, requestContext.geography);
    const sizeAppropriateFired = isSizeAppropriate(requestContext);
    const rawScore = (givingProgramFired ? weights.givingProgram : 0) +
        (donationFormFired ? weights.donationForm : 0) +
        (inKindFired ? weights.inKindSignals : 0) +
        weights.linkedFoundation * linkageConfidence +
        (geoMatchFired ? weights.geoMatch : 0) +
        (sizeAppropriateFired ? weights.sizeAppropriate : 0);
    const score = Math.round(Math.max(0, Math.min(100, rawScore)));
    const rationale = buildRationale({
        givingProgram: givingProgramFired,
        donationForm: donationFormFired,
        inKindSignals: inKindFired,
        linkedFoundation: linkageConfidence > 0,
        linkageConfidencePct: Math.round(linkageConfidence * 100),
        geoMatch: geoMatchFired,
        sizeAppropriate: sizeAppropriateFired,
    });
    return { score, rationale };
}
