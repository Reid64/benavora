// Shared NAICS category list + org-location resolution for corporate
// prospect acquisition (SCHEMA_REGISTRY_v2.md #36) — used by both the CLI
// runner (scripts/acquire-corporate-prospects.ts, all onboarded orgs) and the
// on-demand API trigger (src/app/api/prospects/acquire/route.ts, single org).
//
// Kept out of both call sites so the category list has one source of truth
// rather than drifting between a nightly script and an API route.

export interface TargetSearch {
  naicsCode: string;
  friendlyName: string;
  searchTerms: string[];
}

export const TARGET_SEARCHES: TargetSearch[] = [
  {
    naicsCode: "236220",
    friendlyName: "Construction Companies",
    searchTerms: ["construction company", "general contractor", "commercial builder"],
  },
  {
    naicsCode: "444180",
    friendlyName: "Building Material Suppliers",
    searchTerms: ["building material supplier", "lumber yard", "building supply store"],
  },
  {
    naicsCode: "238160",
    friendlyName: "Roofing Contractors",
    searchTerms: ["roofing contractor", "roofing company"],
  },
  {
    naicsCode: "238220",
    friendlyName: "Plumbing Contractors",
    searchTerms: ["plumbing contractor", "plumbing company"],
  },
  {
    naicsCode: "238210",
    friendlyName: "Electrical Contractors",
    searchTerms: ["electrical contractor", "electrician company"],
  },
  {
    naicsCode: "441110",
    friendlyName: "Auto Dealers",
    searchTerms: ["car dealership", "auto dealer"],
  },
  {
    naicsCode: "442110",
    friendlyName: "Furniture Dealers",
    searchTerms: ["furniture store", "furniture dealer"],
  },
  {
    naicsCode: "443142",
    friendlyName: "Computer Retailers",
    searchTerms: ["computer store", "electronics retailer"],
  },
  {
    naicsCode: "423450",
    friendlyName: "Medical Equipment Suppliers",
    searchTerms: ["medical equipment supplier", "medical supply company"],
  },
  {
    naicsCode: "311",
    friendlyName: "Food Manufacturers",
    searchTerms: ["food manufacturer", "food production company"],
  },
  {
    naicsCode: "424410",
    friendlyName: "Grocery Distributors",
    searchTerms: ["grocery distributor", "food wholesaler"],
  },
  {
    naicsCode: "522",
    friendlyName: "Banks",
    searchTerms: ["bank", "community bank", "credit union"],
  },
  {
    naicsCode: "524",
    friendlyName: "Insurance Companies",
    searchTerms: ["insurance company", "insurance agency"],
  },
  {
    naicsCode: "531",
    friendlyName: "Real Estate Companies",
    searchTerms: ["real estate company", "real estate brokerage"],
  },
  {
    naicsCode: "561320",
    friendlyName: "Staffing Agencies",
    searchTerms: ["staffing agency", "employment agency"],
  },
  {
    naicsCode: "562",
    friendlyName: "Waste Management Companies",
    searchTerms: ["waste management company", "trash removal service"],
  },
  {
    naicsCode: "488510",
    friendlyName: "Logistics Companies",
    searchTerms: ["logistics company", "freight company"],
  },
  {
    naicsCode: "622110",
    friendlyName: "Healthcare Systems",
    searchTerms: ["hospital system", "healthcare system"],
  },
  {
    naicsCode: "541511",
    friendlyName: "Technology Companies",
    searchTerms: ["technology company", "software company"],
  },
  {
    naicsCode: "541",
    friendlyName: "Professional Services Firms",
    searchTerms: ["professional services firm", "consulting firm"],
  },
];

export const ACQUISITION_RADIUS_METERS = 50_000;
const FALLBACK_LOCATION = "United States";

export interface OrgLocationFields {
  service_area: string | null;
  city: string | null;
  state: string | null;
}

/** Resolves the location text passed to Google Places for a given org: its
 * service_area, falling back to city+state, falling back to "United States". */
export function locationForOrg(org: OrgLocationFields): string {
  if (org.service_area?.trim()) return org.service_area.trim();
  if (org.city?.trim() && org.state?.trim()) return `${org.city.trim()}, ${org.state.trim()}`;
  return FALLBACK_LOCATION;
}
