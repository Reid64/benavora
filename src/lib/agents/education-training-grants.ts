// Thin Grants.gov agent scoped to Department of Education funding and
// related education/workforce-training categories. Reuses the shared
// `grantsgov-client.ts` search2 client (extended with `agencies`/
// `fundingCategories` filters) rather than a second, separate API client —
// this module owns only the DOE/education-workforce filter policy and
// cross-term dedup; persistence stays with callers, same as
// `searchGrantsGovOpportunities` itself.
//
// Unlike HHS (see `health-grants.ts`), the bare "ED" parent code IS directly
// queryable on its own — verified live against api.grants.gov/v1/api/search2
// 2026-09-07 (`{agencies:"ED"}` -> nonzero hitCount), and the live agency
// facet shows "Department of Education" with an empty `subAgencyOptions`
// list, i.e. Grants.gov does not currently subdivide it. Even so, the
// agency code is discovered live at call time via
// `getAgencyCodesWithFallback` rather than hardcoded, so this agent stays
// correct if ED is ever subdivided or renamed without a code deploy — same
// mechanism as the HHS-family agent, for consistency and because Grants.gov
// exposes no dedicated agency-lookup endpoint to hardcode against instead.

import {
  searchGrantsGovOpportunities,
  getAgencyCodesWithFallback,
  type GrantsGovNormalizedOpportunity,
} from "@/lib/sources/grantsgov-client";

/** Grants.gov parent agency code for the U.S. Department of Education. */
export const EDUCATION_PARENT_AGENCY_CODE = "ED";

/**
 * Dated (2026-09-07) snapshot fallback, used only when live discovery
 * (`getAgencyCodesWithFallback`) fails. See file header — the live facet is
 * authoritative, not this constant.
 */
export const EDUCATION_AGENCY_CODES_FALLBACK = ["ED"] as const;

/**
 * Grants.gov funding category codes covering education and workforce
 * training: "ED" (Education) and "ELT" (Employment, Labor and Training).
 */
export const EDUCATION_TRAINING_FUNDING_CATEGORIES = ["ED", "ELT"] as const;

const DEFAULT_SEARCH_TERMS = ["education", "workforce training"] as const;

/**
 * Searches Grants.gov for opportunities from the Department of Education
 * and/or tagged with education or workforce-training funding categories,
 * across one or more keyword terms, deduplicated by `externalId`. The
 * agency code used is discovered live (with a dated fallback) — see file
 * header.
 */
export async function searchEducationTrainingGrants(
  searchTerms: readonly string[] = DEFAULT_SEARCH_TERMS,
): Promise<GrantsGovNormalizedOpportunity[]> {
  const agencyCodes = await getAgencyCodesWithFallback(
    EDUCATION_PARENT_AGENCY_CODE,
    EDUCATION_AGENCY_CODES_FALLBACK,
  );

  const batches = await Promise.all(
    searchTerms.map((term) =>
      searchGrantsGovOpportunities(term, {
        agencies: agencyCodes,
        fundingCategories: [...EDUCATION_TRAINING_FUNDING_CATEGORIES],
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
