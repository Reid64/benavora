"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCandidateFoundationNames = buildCandidateFoundationNames;
exports.findLinkedFoundation = findLinkedFoundation;
exports.linkFoundationForDirectoryRecord = linkFoundationForDirectoryRecord;
const admin_1 = require("../../lib/supabase/admin");
const directory_1 = require("../../lib/donor-discovery/directory");
/**
 * Corporate foundation linkage (DONOR_DISCOVERY_ARCHITECTURE.md §2C "Signal
 * layer" — "IRS 990/BMF (already ingested): corporate foundation linkage by
 * name/EIN fuzzy match"). Many corporations give through a dedicated legal
 * entity ("Acme Corp" -> "Acme Corp Foundation" / "Acme Charitable Trust")
 * that shows up in `foundation_directory` (IRS BMF, migration 046) as its
 * own filer with no shared key back to the operating company. This module
 * bridges that gap with name heuristics — never a claim of verified
 * ownership, hence `linkage_confidence` rather than a boolean.
 *
 * Candidate suffix construction is pure TypeScript here (single source of
 * truth, unit-testable without a database). The expensive half — trigram
 * similarity search against `foundation_directory.name`, which holds the
 * full IRS Business Master File — runs in Postgres via the
 * `donor_discovery_match_foundations` RPC (migration 074).
 */
const FOUNDATION_SUFFIXES = [
    "Foundation",
    "Charitable Foundation",
    "Family Foundation",
    "Charitable Trust",
    "Charitable Fund",
    "Fund",
];
// architecture doc §2D: "foundation linkage" as a scoring signal implies a
// match worth trusting; 0.55 is the floor below which two names are treated
// as coincidentally similar rather than plausibly the same corporate family.
const MIN_NAME_SIMILARITY = 0.55;
// Additive, not multiplicative: a shared website domain between the
// operating company and the candidate foundation is strong direct evidence
// (most corporate foundations are hosted on a `/foundation` or `/giving`
// path of the parent's own domain) independent of how the name matched.
const DOMAIN_MATCH_BOOST = 0.35;
const CANDIDATE_LIMIT = 5;
// Strips a trailing corporate suffix (Inc, LLC, Corp, ...) so "Acme Plumbing
// Inc." builds candidates from "Acme Plumbing", not "Acme Plumbing Inc.
// Foundation" — a form corporate foundations essentially never use verbatim.
const CORPORATE_SUFFIX_RE = /[,.]?\s+(incorporated|inc|l\.l\.c|llc|corporation|corp|company|co|limited|ltd|plc|llp|lp)\.?$/i;
function stripCorporateSuffix(name) {
    return name.replace(CORPORATE_SUFFIX_RE, "").trim();
}
/**
 * Builds the "<company> Foundation" / "<company> Charitable Trust" / ...
 * search set a corporate foundation's name is likely to take. Pure, and
 * exported for testing independent of any database.
 */
function buildCandidateFoundationNames(companyLegalName) {
    const base = stripCorporateSuffix(companyLegalName.trim());
    if (!base)
        return [];
    return FOUNDATION_SUFFIXES.map((suffix) => `${base} ${suffix}`);
}
function computeConfidence(nameSimilarity, domainMatches) {
    const boosted = domainMatches ? nameSimilarity + DOMAIN_MATCH_BOOST : nameSimilarity;
    return Math.max(0, Math.min(1, boosted));
}
/**
 * Finds the best-matching corporate foundation for a directory company, if
 * any candidate clears MIN_NAME_SIMILARITY (after the domain-match boost).
 * Returns null on no match — never throws for "no match found", only for a
 * genuine query failure.
 */
async function findLinkedFoundation(input) {
    const candidateNames = buildCandidateFoundationNames(input.legalName);
    if (candidateNames.length === 0)
        return null;
    const supabase = (0, admin_1.createAdminClient)();
    const { data, error } = await supabase.rpc("donor_discovery_match_foundations", {
        p_candidate_names: candidateNames,
        p_min_similarity: MIN_NAME_SIMILARITY,
        p_limit: CANDIDATE_LIMIT,
    });
    if (error) {
        throw new Error(`foundation_match_query_failed: ${error.message}`);
    }
    const rows = (data ?? []);
    if (rows.length === 0)
        return null;
    const companyDomain = (0, directory_1.normalizeDomain)(input.website);
    let best = null;
    for (const row of rows) {
        const domainMatches = companyDomain !== null && companyDomain === (0, directory_1.normalizeDomain)(row.website);
        const confidence = computeConfidence(row.similarity, domainMatches);
        if (!best || confidence > best.confidence) {
            best = { foundationId: row.foundation_id, foundationName: row.foundation_name, confidence };
        }
    }
    return best;
}
/**
 * Runs `findLinkedFoundation` for one directory record and persists a match
 * onto `donor_discovery_directory.linked_foundation_id` / `linkage_confidence`.
 * Returns null (and writes nothing) if no candidate clears the similarity
 * threshold — an existing linkage is never cleared by a subsequent miss.
 */
async function linkFoundationForDirectoryRecord(directoryId, input) {
    const match = await findLinkedFoundation(input);
    if (!match)
        return null;
    const supabase = (0, admin_1.createAdminClient)();
    const { error } = await supabase
        .from("donor_discovery_directory")
        .update({
        linked_foundation_id: match.foundationId,
        linkage_confidence: match.confidence,
    })
        .eq("id", directoryId);
    if (error) {
        throw new Error(`foundation_linkage_update_failed: ${error.message}`);
    }
    return match;
}
