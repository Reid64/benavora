// Thin Grants.gov agent scoped to Department of Education funding and
// related education/workforce-training categories. Reuses the shared
// `grantsgov-client.ts` search2 client (extended with `agencies`/
// `fundingCategories` filters) rather than a second, separate API client —
// this module owns only the DOE/education-workforce filter policy and
// cross-term dedup; persistence stays with callers, same as
// `searchGrantsGovOpportunities` itself.

import {
  searchGrantsGovOpportunities,
  type GrantsGovNormalizedOpportunity,
} from "@/lib/sources/grantsgov-client";

/** Grants.gov agency code for the U.S. Department of Education. */
export const EDUCATION_AGENCY_CODES = ["ED"] as const;

/**
 * Grants.gov funding category codes covering education and workforce
 * training: "ED" (Education) and "ELT" (Employment, Labor and Training).
 */
export const EDUCATION_TRAINING_FUNDING_CATEGORIES = ["ED", "ELT"] as const;

const DEFAULT_SEARCH_TERMS = ["education", "workforce training"] as const;

/**
 * Searches Grants.gov for opportunities from the Department of Education
 * and/or tagged with education or workforce-training funding categories,
 * across one or more keyword terms, deduplicated by `externalId`.
 */
export async function searchEducationTrainingGrants(
  searchTerms: readonly string[] = DEFAULT_SEARCH_TERMS,
): Promise<GrantsGovNormalizedOpportunity[]> {
  const batches = await Promise.all(
    searchTerms.map((term) =>
      searchGrantsGovOpportunities(term, {
        agencies: [...EDUCATION_AGENCY_CODES],
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
