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
// 2026-09-06: the parent "HHS" code alone matches zero opportunities
// (confirmed: `{agencies:"HHS"}` -> hitCount 0) — every live-posted HHS
// opportunity is tagged with a specific operating-division sub-agency code
// instead, so the parent code cannot be used as a shorthand for "all of
// HHS". `HHS_FAMILY_AGENCY_CODES` below is every HHS sub-agency code
// observed in the live "posted" opportunity facets at verification time.

import {
  searchGrantsGovOpportunities,
  type GrantsGovNormalizedOpportunity,
} from "@/lib/sources/grantsgov-client";

/**
 * Grants.gov sub-agency codes for the U.S. Department of Health and Human
 * Services and its operating divisions. There is no single "HHS" code that
 * matches opportunities on its own (verified live, see file header) — each
 * operating division has its own code.
 */
export const HHS_FAMILY_AGENCY_CODES = [
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
 * terms, deduplicated by `externalId`.
 */
export async function searchHealthGrants(
  searchTerms: readonly string[] = DEFAULT_SEARCH_TERMS,
): Promise<GrantsGovNormalizedOpportunity[]> {
  const batches = await Promise.all(
    searchTerms.map((term) =>
      searchGrantsGovOpportunities(term, {
        agencies: [...HHS_FAMILY_AGENCY_CODES],
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
