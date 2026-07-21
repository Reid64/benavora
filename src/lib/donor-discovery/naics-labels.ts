// Plain-English NAICS labels + category grouping for the Donor Discovery
// "Discover" flow (src/app/(dashboard)/donor-discovery/discover/page.tsx).
//
// Distinct from `donor_discovery_taxonomy` (migration 067, seeded from the
// full 2022 Census 6-digit NAICS list via `scripts/seed-dd-taxonomy.ts`) —
// this is a small, hand-curated consumer-facing subset (mixing 3-digit
// subsector codes like "524" Insurance with 6-digit codes like "562991"
// Septic System Installation) meant to read well on a category-card picker,
// not to be exhaustive or to replace the taxonomy table. `discover/route.ts`
// uses these labels directly as Google Places `textQuery` search terms.

/** NAICS code -> plain-English name shown on category chips and search results. */
export const NAICS_FRIENDLY_LABELS: Record<string, string> = {
  "238910": "Site Preparation & Grading",
  "562991": "Septic System Installation",
  "237110": "Water Well Drilling",
  "238220": "Plumbing Contractors",
  "444180": "Building Material Dealers",
  "336111": "Auto Manufacturers",
  "524": "Insurance Companies",
  "522": "Banks & Credit Unions",
  "311": "Food Manufacturers",
  "423": "Industrial Distributors",
  "531": "Real Estate Companies",
  "541": "Professional Services Firms",
  "561": "Business Support Services",
  "562": "Waste Management Companies",
  "811": "Auto Repair Shops",
  "812": "Personal Care Services",

  // Corporate prospect acquisition (scripts/acquire-corporate-prospects.ts)
  // — additional codes needed so acquireFromGooglePlaces's internal
  // `naicsLabel(naicsCode)` query text is meaningful for these categories.
  "236220": "Construction Companies",
  "238160": "Roofing Contractors",
  "238210": "Electrical Contractors",
  "441110": "Auto Dealers",
  "442110": "Furniture Dealers",
  "443142": "Computer Retailers",
  "423450": "Medical Equipment Suppliers",
  "424410": "Grocery Distributors",
  "561320": "Staffing Agencies",
  "488510": "Logistics Companies",
  "622110": "Healthcare Systems",
  "541511": "Technology Companies",
};

export interface NaicsCategory {
  label: string;
  codes: string[];
}

/** Groups the codes above into consumer-facing categories for the Step 1
 * category-card picker. Every code in `NAICS_FRIENDLY_LABELS` appears in
 * exactly one category.
 *
 * Expanded from an original 7 categories to 13 (2026-07-20 Donor Discovery
 * rebuild) purely by regrouping the codes already present in
 * NAICS_FRIENDLY_LABELS above — no new NAICS codes were invented. "Retail &
 * Distribution" was split into Automotive / Healthcare / Technology /
 * Staffing / Logistics / Personal Care so the category-card grid reads as a
 * richer picker without fabricating industries that have no backing code. */
export const NAICS_CATEGORIES: Record<string, NaicsCategory> = {
  construction: {
    label: "Construction & Trades",
    codes: ["238910", "237110", "238220", "236220", "238160", "238210"],
  },
  waste_environmental: {
    label: "Waste & Environmental Services",
    codes: ["562991", "562"],
  },
  automotive: {
    label: "Automotive",
    codes: ["336111", "441110", "811"],
  },
  financial: {
    label: "Financial Services",
    codes: ["524", "522"],
  },
  food: {
    label: "Food & Agriculture",
    codes: ["311", "424410"],
  },
  real_estate: {
    label: "Real Estate",
    codes: ["531"],
  },
  professional: {
    label: "Professional Services",
    codes: ["541", "561"],
  },
  staffing: {
    label: "Staffing & Recruiting",
    codes: ["561320"],
  },
  retail: {
    label: "Retail & Distribution",
    codes: ["444180", "423", "442110", "443142"],
  },
  healthcare: {
    label: "Healthcare",
    codes: ["622110", "423450"],
  },
  technology: {
    label: "Technology",
    codes: ["541511"],
  },
  personal_care: {
    label: "Personal Care Services",
    codes: ["812"],
  },
  logistics: {
    label: "Logistics & Transportation",
    codes: ["488510"],
  },
};

export function naicsLabel(code: string): string {
  return NAICS_FRIENDLY_LABELS[code] ?? code;
}
