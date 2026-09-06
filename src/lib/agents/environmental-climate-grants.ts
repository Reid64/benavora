// Thin Grants.gov agent scoped to environment/climate/natural-resources
// agencies and funding categories. Reuses the shared `grantsgov-client.ts`
// search2 client (extended with `agencies`/`fundingCategories` filters)
// rather than a second, separate API client — this module owns only the
// environmental/climate filter policy and cross-term dedup; persistence
// stays with callers, same as `searchGrantsGovOpportunities` itself and the
// sibling `health-grants.ts` / `education-training-grants.ts` agents.
//
// This exists because a live re-check (RESEARCH_AGENTS_TRUTH.md, 2026-09-06
// re-verification) found no free structured database of women/minority- or
// environmental/climate-focused grants exists (WBENC WBENCLink2.0 is a
// login-only supplier-certification portal with zero public API or grants
// data; NMSDC is the same kind of certification body, not a grants source;
// MBDA.gov blocks automated access behind a Cloudflare bot challenge and has
// no Grants.gov agency code of its own — `{agencies:"MBDA"}` and
// `{agencies:"DOC-MBDA"}` both return 0 live hits). But Grants.gov's own
// search2 `fundingCategories` facet — added in a sibling task to
// `grantsgov-client.ts` — DOES carry real, agency-assigned "Environment"
// (ENV), "Natural Resources" (NR), and "Energy" (EN) category tags. This is
// a genuinely new, real, structured option for the *environmental/climate*
// half of that re-check (not the demographic half — there is no
// women/minority-ownership category or eligibility code anywhere in
// Grants.gov's taxonomy; a bare keyword search like "minority owned
// business" returns 483 noisy hits dominated by unrelated NASA/Navy/State
// Dept programs, which is exactly the false-positive pattern this module
// deliberately does NOT build on).
//
// Agency codes verified live against api.grants.gov/v1/api/search2
// 2026-09-06 by requesting `{fundingCategories:"ENV|NR|EN", oppStatuses:
// "posted"}` and inspecting the response's real `agencies` facet
// (hitCount 116 total). `HHS-NIH11` accounted for 44 of those 116 hits but
// is deliberately EXCLUDED here: those are NIH environmental-*health*
// research grants (e.g. PAR-25-144, CFDA 93.113 "Biological Response to
// Environmental Health Hazards") — a biomedical-research vertical already
// covered by the sibling `health-grants.ts` agent, not core
// environmental/climate grantmaking. Also excluded: `AC` (AmeriCorps),
// `DOD-WHS`, `HUD`, `DOS-AUS`, `DOT-FAA` — each matched exactly once in the
// same facet check, incidental rather than core environment/climate
// agencies. `USDA-RBCS` IS included: its live matches
// ("Renewable Energy Systems and Energy Efficiency Improvements Program")
// are genuinely energy/climate-relevant.

import {
  searchGrantsGovOpportunities,
  type GrantsGovNormalizedOpportunity,
} from "@/lib/sources/grantsgov-client";

/**
 * Grants.gov sub-agency codes for environment/climate/natural-resources
 * grantmaking bodies. Unlike HHS (see `health-grants.ts`), the parent `EPA`
 * code alone DOES match live opportunities on its own (verified live: 4
 * hits) — it is included directly rather than only as sub-codes.
 */
export const ENVIRONMENTAL_CLIMATE_AGENCY_CODES = [
  "EPA",
  "DOI-BLM",
  "DOI-BOR",
  "DOI-FWS",
  "DOI-USGS1",
  "DOI-NPS",
  "USDA-FS",
  "USDA-NRCS",
  "USDA-RBCS",
  "DOC-DOCNOAAERA",
  "DOE-01",
  "DOE-GFO",
  "DOE-ID",
  "DOE-NETL",
] as const;

/**
 * Grants.gov funding category codes covering Environment, Natural
 * Resources, and Energy.
 */
export const ENVIRONMENTAL_CLIMATE_FUNDING_CATEGORIES = ["ENV", "NR", "EN"] as const;

const DEFAULT_SEARCH_TERMS = ["environment", "climate"] as const;

/**
 * Searches Grants.gov for opportunities from environment/climate/natural-
 * resources agencies and/or tagged with the Environment, Natural Resources,
 * or Energy funding categories, across one or more keyword terms,
 * deduplicated by `externalId`.
 */
export async function searchEnvironmentalClimateGrants(
  searchTerms: readonly string[] = DEFAULT_SEARCH_TERMS,
): Promise<GrantsGovNormalizedOpportunity[]> {
  const batches = await Promise.all(
    searchTerms.map((term) =>
      searchGrantsGovOpportunities(term, {
        agencies: [...ENVIRONMENTAL_CLIMATE_AGENCY_CODES],
        fundingCategories: [...ENVIRONMENTAL_CLIMATE_FUNDING_CATEGORIES],
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
