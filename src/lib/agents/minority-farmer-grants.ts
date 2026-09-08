// Thin Grants.gov agent scoped to USDA-NIFA and the real "Section 2501"
// program family — Outreach and Assistance for Socially Disadvantaged and
// Veteran Farmers and Ranchers. Reuses the shared `grantsgov-client.ts`
// search2 client, same pattern as the sibling `health-grants.ts` /
// `education-training-grants.ts` / `environmental-climate-grants.ts` agents:
// this module owns only the USDA-NIFA/2501 filter policy and cross-term
// dedup; persistence stays with callers.
//
// This exists because a follow-up re-check of the prior BLOCKED finding for
// women/minority-owned-*business* grants (RESEARCH_AGENTS_TRUTH.md §7a —
// WBENC, NMSDC, MBDA.gov, Grants.gov's own category/agency taxonomy, none of
// which expose a public grants feed) was extended to four more real
// candidates, live-checked this session:
//
// - Hello Alice (helloalice.com / app.helloalice.com / support.helloalice.com)
//   — every path tested returns a bot-challenge wall (HTTP 429 with
//   `X-Vercel-Mitigated: challenge` on the main app domain, HTTP 403 with
//   `Cf-Mitigated: challenge` on the Zendesk support domain), even for
//   `robots.txt`. A web search turned up no developer/API documentation.
//   `app.helloalice.com/grants` is a logged-in application-matching portal,
//   not a public dataset — same category as WBENC's WBENCLink2.0 login
//   portal. **No public structured source.**
// - IFundWomen (ifundwomen.com) — `/grants` redirects to
//   `/grants/apply-for-grants`, which returns HTTP 403 with
//   `Cf-Mitigated: challenge` (Cloudflare bot wall). Their own marketing
//   describes a "Universal Grant Application Database" as an *internal*
//   matching system (apply once, IFundWomen matches you against partner
//   grant criteria and notifies you) — an application funnel, not a public,
//   queryable list of open opportunities or past winners. **No public
//   structured source.**
// - SBA 8(a) Business Development / HUBZone — live-fetched
//   sba.gov/federal-contracting/.../8a-business-development-program and
//   sba.gov/certifications/#hubzone: both are certification/contracting-
//   eligibility program pages. The only structured-data tool linked from
//   either is the Procurement Data Hub (datahub.certify.sba.gov), which
//   shows aggregate contracting-trend charts, not individual opportunities.
//   Root cause (not just absence): 8(a) and HUBZone confer eligibility for
//   sole-source/set-aside *contracts* tracked through SAM.gov procurement —
//   they do not themselves disburse grants, so there is no grant feed to
//   find. Confirmed independently against Grants.gov: `{agencies:"SBA"}`
//   returns exactly one live posted opportunity ("SBA WBC Modernization
//   Initiative FY26", CFDA 59.043 — a Women's Business Center program,
//   unrelated to 8(a)/HUBZone). **Categorical mismatch, not a missed
//   source.**
// - USDA minority/socially-disadvantaged farmer & rancher grants — **a
//   genuinely new real option**, found the same way as the environmental/
//   climate case: not a new database, but Grants.gov's own search2 API,
//   scoped to the one real sub-agency that administers this program family.
//   nifa.usda.gov's own funding-opportunities filter UI lists the real
//   program name "Outreach and Assistance for Socially Disadvantaged and
//   Veteran Farmers and Ranchers (2501) Program" (no JSON/API backs that
//   page itself — confirmed server-rendered Drupal HTML). Live-querying
//   `api.grants.gov/v1/api/search2` with `{agencies:"USDA-NIFA"}` surfaces a
//   currently-posted NOFO for the veteran half of that same program family:
//   "Outreach and Assistance for Veteran Farmers and Ranchers Program"
//   (id 363816, opportunityNumber USDA-NIFA-ICGP-012261, assistance listing
//   10.443, posted 2026-09-04, closes 2026-09-10). Generic multi-word
//   keyword combinations here are noisy in the same way the prior finding's
//   "minority owned business" search was (`{keyword:"veteran farmers
//   ranchers"}` restricted to USDA-NIFA returns 15 of NIFA's 20 total
//   postings — unrelated programs like citrus-disease research and tribal
//   college scholarships also contain those generic words, likely via
//   templated eligibility boilerplate). But narrow, distinctive phrases are
//   precise: `{keyword:"socially disadvantaged", agencies:"USDA-NIFA"}` and
//   `{keyword:"2501", agencies:"USDA-NIFA"}` each return exactly the one
//   on-topic hit above, and nothing else — live-verified 2026-09-07. These
//   are the two default search terms used below. The socially-disadvantaged
//   half of the 2501 program isn't independently posted this NOFO cycle
//   (`{keyword:"minority", agencies:"USDA-NIFA"}` -> 0 hits today), but the
//   same live, agency-scoped mechanism will surface it the moment USDA posts
//   it, exactly as it already does for the veteran half.

import {
  searchGrantsGovOpportunities,
  type GrantsGovNormalizedOpportunity,
} from "@/lib/sources/grantsgov-client";

/**
 * Grants.gov sub-agency code for USDA's National Institute of Food and
 * Agriculture — the real administrator of the "Section 2501" (Outreach and
 * Assistance for Socially Disadvantaged and Veteran Farmers and Ranchers)
 * program family. Verified live 2026-09-07: `{agencies:"USDA-NIFA"}` alone
 * matches (15 live postings), so it is used directly rather than requiring
 * further sub-agency discovery.
 */
export const MINORITY_FARMER_AGENCY_CODES = ["USDA-NIFA"] as const;

/**
 * Search terms live-verified 2026-09-07 to precisely match the 2501 program
 * family (and nothing else) when restricted to
 * {@link MINORITY_FARMER_AGENCY_CODES} — unlike generic multi-word phrases
 * (e.g. "veteran farmers ranchers", "minority farmers"), which return most of
 * NIFA's unrelated live postings and are deliberately NOT used here.
 */
const DEFAULT_SEARCH_TERMS = ["socially disadvantaged", "2501"] as const;

/**
 * Searches Grants.gov for opportunities from USDA-NIFA matching the
 * socially-disadvantaged/veteran farmer-and-rancher ("2501 program") search
 * terms, deduplicated by `externalId`.
 */
export async function searchMinorityFarmerGrants(
  searchTerms: readonly string[] = DEFAULT_SEARCH_TERMS,
): Promise<GrantsGovNormalizedOpportunity[]> {
  const batches = await Promise.all(
    searchTerms.map((term) =>
      searchGrantsGovOpportunities(term, {
        agencies: [...MINORITY_FARMER_AGENCY_CODES],
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
