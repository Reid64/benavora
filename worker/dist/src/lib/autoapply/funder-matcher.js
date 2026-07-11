"use strict";
// Funder-to-RequestProfile capability matching engine.
// Scores each (funder, profile) pair 0.0-1.0 across four factors and returns
// ranked results filtered to >= 0.3 (meaningful alignment threshold).
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchFunderToProfiles = matchFunderToProfiles;
exports.getBestProfile = getBestProfile;
// Groups of funder_category values that are considered "related" to each other.
// A funder whose category appears in the same group as a profile's target category
// earns a partial match (+0.2 instead of +0.4).
const CATEGORY_GROUPS = [
    ["corporate_donation", "corporate_sponsorship", "corporate_foundation"],
    ["private_foundation", "corporate_foundation"],
    [
        "government_grant",
        "local_community_grant",
        "housing_grant",
        "education_grant",
        "faith_compatible_grant",
    ],
    ["in_kind_donation", "materials_donation"],
];
// Maps funder type keys to the request_type values they can naturally serve.
// Multiple entries for the same funder type mean it maps to multiple request types.
const TYPE_CAPABILITY_MAP = {
    real_estate: ["land", "facility"],
    land_trust: ["land", "facility"],
    construction: ["land", "in_kind", "volunteer"],
    building_supply: ["in_kind"],
    hardware: ["in_kind"],
    law_firm: ["service"],
    accounting: ["service"],
    consulting: ["service"],
    foundation: ["monetary"],
    corporate_giving: ["monetary"],
    community_foundation: ["monetary"],
    retail: ["in_kind"],
    wholesale: ["in_kind"],
    manufacturing: ["in_kind"],
    church: ["volunteer", "monetary"],
    community_group: ["volunteer", "monetary"],
    civic: ["volunteer", "monetary"],
};
function areCategoriesRelated(a, b) {
    return CATEGORY_GROUPS.some((group) => group.includes(a) && group.includes(b));
}
function scoreCategory(funderCategory, targetCategories, reasons) {
    if (!funderCategory || !targetCategories || targetCategories.length === 0) {
        return 0;
    }
    if (targetCategories.includes(funderCategory)) {
        reasons.push(`Category exact match: ${funderCategory}`);
        return 0.4;
    }
    const related = targetCategories.some((tc) => areCategoriesRelated(funderCategory, tc));
    if (related) {
        reasons.push(`Category partial match: ${funderCategory} related to profile targets`);
        return 0.2;
    }
    return 0;
}
function scoreTypeAlignment(funderType, requestType, targetFunderTypes, reasons) {
    // Explicit type targeting takes precedence
    if (targetFunderTypes && funderType && targetFunderTypes.includes(funderType)) {
        reasons.push(`Funder type explicitly targeted: ${funderType}`);
        return 0.3;
    }
    // Capability map lookup
    if (funderType) {
        const capableTypes = TYPE_CAPABILITY_MAP[funderType] ?? [];
        if (capableTypes.includes(requestType)) {
            reasons.push(`Type capability match: ${funderType} → ${requestType}`);
            return 0.3;
        }
    }
    // Any funder can sponsor something; sponsorship is a softer match
    if (requestType === "sponsorship") {
        reasons.push("Sponsorship is broadly applicable");
        return 0.2;
    }
    return 0;
}
function scoreGeographic(funderState, funderCity, geoRequirements, reasons) {
    if (!geoRequirements || Object.keys(geoRequirements).length === 0) {
        // No restriction means any geography is fine — neutral credit
        reasons.push("No geographic restriction");
        return 0.1;
    }
    const req = geoRequirements;
    const stateMatch = !req.states ||
        req.states.length === 0 ||
        (funderState !== null && req.states.includes(funderState));
    const cityMatch = !req.cities ||
        req.cities.length === 0 ||
        (funderCity !== null && req.cities.includes(funderCity));
    if (stateMatch && cityMatch) {
        reasons.push("Geographic match confirmed");
        return 0.2;
    }
    return 0;
}
function scoreHistoricalSuccess(_funderId, requestType, previousSuccessTypes, reasons) {
    if (previousSuccessTypes?.includes(requestType)) {
        reasons.push(`Prior successful ${requestType} submission to this funder`);
        return 0.1;
    }
    return 0;
}
/**
 * Score each (funder, profile) pair from 0.0 to 1.0.
 * Results with score < 0.3 are excluded (no meaningful alignment).
 * Returns results sorted by score descending.
 */
function matchFunderToProfiles(funder, profiles) {
    const results = [];
    for (const profile of profiles) {
        if (!profile.active)
            continue;
        const reasons = [];
        let score = 0;
        score += scoreCategory(funder.category, profile.target_funder_categories, reasons);
        score += scoreTypeAlignment(funder.type, profile.request_type, profile.target_funder_types, reasons);
        score += scoreGeographic(funder.state, funder.city, profile.geographic_requirements, reasons);
        score += scoreHistoricalSuccess(funder.id, profile.request_type, funder.previousSuccessfulRequestTypes, reasons);
        // Cap at 1.0 in case multiple factors overlap at maximum
        score = Math.min(1.0, score);
        if (score >= 0.3) {
            results.push({
                profileId: profile.id,
                profileName: profile.name,
                requestType: profile.request_type,
                score,
                matchReasons: reasons,
            });
        }
    }
    return results.sort((a, b) => b.score - a.score);
}
/**
 * Returns the single highest-scoring profile for a funder, or null if no
 * profile meets the 0.3 threshold.
 */
function getBestProfile(funder, profiles) {
    const matches = matchFunderToProfiles(funder, profiles);
    return matches[0] ?? null;
}
