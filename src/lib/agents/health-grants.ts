// Thin Grants.gov agent scoped to HHS-family agencies and the Health
// funding category. Reuses the shared `grantsgov-client.ts` search2 client
// (extended with `agencies`/`fundingCategories` filters) rather than a
// second, separate API client — this module owns only the HHS/health
// filter policy and cross-term dedup; persistence stays with callers, same
// as `searchGrantsGovOpportunities` itself.
//
// NIH RePORTER is deliberately NOT used as a source here: it is a database
// of already-awarded projects and investigators (see
// RESEARCH_AGENTS_TRUTH.md and scripts/ingest-nih-reporter.ts, which feeds
// it into the Grant Intelligence narrative library, not the opportunities
// pipeline), not a feed of open opportunities an organization can apply to.
// Presenting RePORTER records as applyable grants would misrepresent the
// data, so open HHS/health opportunities come from the real Grants.gov
// search2 API exclusively, same as the sibling
// `education-training-grants.ts` agent.
//
// Agency codes verified live against api.grants.gov/v1/api/search2
// 2026-09-06 (re-verified 2026-09-07): the parent "HHS" code alone matches
// zero opportunities (confirmed: `{agencies:"HHS"}` -> hitCount 0) — every
// live-posted HHS opportunity is tagged with a specific operating-division
// sub-agency code instead, so the parent code cannot be used as a shorthand
// for "all of HHS".
//
// Grants.gov has no dedicated agency-lookup endpoint (see
// `discoverAgencySubCodes` in `grantsgov-client.ts` for the live
// verification of that), so the actual sub-agency codes used for each
// search are discovered at call time from `search2`'s own live agency
// facet via `getAgencyCodesWithFallback`, cached for
// `AGENCY_CODE_CACHE_TTL_MS`. This keeps the agent correct if HHS renames or
// adds an operating division without a code deploy.
//
// `HHS_FAMILY_AGENCY_CODES_FALLBACK` below is a dated snapshot of every HHS
// sub-agency code observed in the live "posted" opportunity facets at
// verification time. It is used ONLY when live discovery fails (API outage,
// or transiently zero current HHS postings) — it is not a permanent source
// of truth and WILL go stale; re-verify it against
// api.grants.gov/v1/api/search2 (see file header) if the fallback-used
// warning starts appearing in logs.

import {
  searchGrantsGovOpportunities,
  getAgencyCodesWithFallback,
  type GrantsGovNormalizedOpportunity,
} from "@/lib/sources/grantsgov-client";

/** Grants.gov parent agency code for the U.S. Department of Health and Human Services. */
export const HHS_PARENT_AGENCY_CODE = "HHS";

/**
 * Dated (2026-09-06) snapshot of HHS sub-agency codes, used as a fallback
 * only when live discovery (`getAgencyCodesWithFallback`) fails. Do not treat
 * this as authoritative — the live facet is. See file header.
 */
export const HHS_FAMILY_AGENCY_CODES_FALLBACK = [
  "HHS-ACF",
  "HHS-ACF-OCS",
  "HHS-ACF-OFVPS",
  "HHS-ACF-ORR",
  "HHS-OS-ASPR",
  "HHS-CDC-NCBDDD",
  "HHS-CDC-NCCDPHP",
  "HHS-CDC-NCEZID",
  "HHS-CDC-OPHPR",
  "HHS-CDC-HHSCDCERA",
  "HHS-CDC-GHC",
  "HHS-FDA",
  "HHS-HRSA",
  "HHS-NIH11",
  "HHS-OPHS",
] as const;

/** Grants.gov funding category code covering Health. */
export const HEALTH_FUNDING_CATEGORIES = ["HL"] as const;

const DEFAULT_SEARCH_TERMS = ["health", "public health"] as const;

/**
 * Searches Grants.gov for opportunities from HHS-family agencies and/or
 * tagged with the Health funding category, across one or more keyword
 * terms, deduplicated by `externalId`. The HHS sub-agency codes used are
 * discovered live (with a dated fallback) — see file header.
 */
export async function searchHealthGrants(
  searchTerms: readonly string[] = DEFAULT_SEARCH_TERMS,
): Promise<GrantsGovNormalizedOpportunity[]> {
  const agencyCodes = await getAgencyCodesWithFallback(
    HHS_PARENT_AGENCY_CODE,
    HHS_FAMILY_AGENCY_CODES_FALLBACK,
  );

  const batches = await Promise.all(
    searchTerms.map((term) =>
      searchGrantsGovOpportunities(term, {
        agencies: agencyCodes,
        fundingCategories: [...HEALTH_FUNDING_CATEGORIES],
      }),
    ),
  );

  const seen = new Set<string>();
  const deduped: GrantsGovNormalizedOpportunity[] = [];
  for (const opp of batches.flat()) {
    if (seen.has(opp.externalId)) continue;
    seen.add(opp.externalId);
    deduped.push(opp);
  }
  return deduped;
}
