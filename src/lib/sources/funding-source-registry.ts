// Funding source registry — seed catalog of federal agencies, housing
// intermediaries, corporate funders, faith-based foundations, and research
// databases that Benavora's discovery agents poll or point researchers to
// (PLATFORM_VISION_ARCHITECTURE.md Pillar 2/18). Persisted to the shared,
// non-org-scoped `funding_sources` table (migration 097) by
// /api/sources/registry on first call.

export type FundingSourceCategory =
  | "federal_agency"
  | "housing"
  | "corporate"
  | "faith_based"
  | "research_database";

// Mirrors funding_sources.source_type (migration 097) — a distinct concept
// from opportunities.source_type and the grants API's category alias of the
// same name (see benavora-two-source-type-concepts memory). Describes the
// kind of entity behind the source, not the opportunity category.
export type FundingSourceType =
  | "federal"
  | "nonprofit_intermediary"
  | "corporate"
  | "foundation"
  | "directory";

export type FundingSourceAdapterType =
  | "rss"
  | "grants_gov"
  | "api"
  | "web"
  | "directory";

export interface FundingSource {
  name: string;
  category: FundingSourceCategory;
  source_type: FundingSourceType;
  website_url?: string;
  api_url?: string;
  adapter_type: FundingSourceAdapterType;
}

export const FUNDING_SOURCES: FundingSource[] = [
  // Federal agencies
  {
    name: "USDA Rural Development",
    category: "federal_agency",
    source_type: "federal",
    api_url: "https://www.rd.usda.gov/rss.xml",
    adapter_type: "rss",
  },
  {
    name: "HHS",
    category: "federal_agency",
    source_type: "federal",
    api_url: "https://www.grants.gov/grantsws/rest/opportunities/search/",
    adapter_type: "grants_gov",
  },
  {
    name: "HRSA",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://www.hrsa.gov/grants",
    adapter_type: "grants_gov",
  },
  {
    name: "Administration for Children and Families (ACF)",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://www.acf.hhs.gov/grants",
    adapter_type: "grants_gov",
  },
  {
    name: "Department of Veterans Affairs (VA)",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://www.va.gov/ogc/apps/accreditation/index.asp",
    adapter_type: "grants_gov",
  },
  {
    name: "Department of Labor (DOL)",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://www.dol.gov/general/grants",
    adapter_type: "grants_gov",
  },
  {
    name: "Department of Education (ED)",
    category: "federal_agency",
    source_type: "federal",
    api_url: "https://www.ed.gov/grant-programs",
    adapter_type: "grants_gov",
  },
  {
    name: "Department of Justice (DOJ)",
    category: "federal_agency",
    source_type: "federal",
    api_url: "https://bja.ojp.gov/funding/opportunities",
    adapter_type: "grants_gov",
  },
  {
    name: "Bureau of Justice Assistance (BJA)",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://bja.ojp.gov/funding",
    adapter_type: "grants_gov",
  },
  {
    name: "FEMA",
    category: "federal_agency",
    source_type: "federal",
    api_url: "https://www.fema.gov/grants",
    adapter_type: "api",
  },
  {
    name: "EPA",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://www.epa.gov/grants",
    adapter_type: "grants_gov",
  },
  {
    name: "Economic Development Administration (EDA)",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://www.eda.gov/funding-opportunities",
    adapter_type: "grants_gov",
  },
  {
    name: "AmeriCorps",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://americorps.gov/partner/funding-opportunities",
    adapter_type: "grants_gov",
  },
  {
    name: "National Endowment for the Humanities (NEH)",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://www.neh.gov/grants",
    adapter_type: "grants_gov",
  },
  {
    name: "National Endowment for the Arts (NEA)",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://www.arts.gov/grants",
    adapter_type: "grants_gov",
  },
  {
    name: "National Science Foundation (NSF)",
    category: "federal_agency",
    source_type: "federal",
    api_url: "https://api.nsf.gov/services/v1/awards.json",
    adapter_type: "api",
  },
  {
    name: "Department of Energy (DOE)",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://www.energy.gov/em/listings/grant-opportunities",
    adapter_type: "grants_gov",
  },
  {
    name: "Treasury CDFI Fund",
    category: "federal_agency",
    source_type: "federal",
    website_url: "https://www.cdfifund.gov/programs-training/Programs",
    adapter_type: "grants_gov",
  },
  {
    name: "SAM.gov",
    category: "federal_agency",
    source_type: "federal",
    api_url: "https://api.sam.gov/opportunities/v2/search",
    adapter_type: "api",
  },
  {
    name: "Grants.gov",
    category: "federal_agency",
    source_type: "federal",
    api_url: "https://www.grants.gov/grantsws/rest/opportunities/search/",
    adapter_type: "grants_gov",
  },

  // Housing specific
  {
    name: "Enterprise Community Partners",
    category: "housing",
    source_type: "nonprofit_intermediary",
    website_url:
      "https://www.enterprisecommunity.org/financing-and-development/grants",
    adapter_type: "web",
  },
  {
    name: "LISC",
    category: "housing",
    source_type: "nonprofit_intermediary",
    website_url: "https://www.lisc.org/our-resources/resource/grant-opportunities",
    adapter_type: "web",
  },
  {
    name: "NeighborWorks America",
    category: "housing",
    source_type: "nonprofit_intermediary",
    website_url: "https://www.neighborworks.org/grants",
    adapter_type: "web",
  },
  {
    name: "Habitat for Humanity",
    category: "housing",
    source_type: "nonprofit_intermediary",
    website_url: "https://www.habitat.org/about/grants",
    adapter_type: "web",
  },

  // Corporate
  {
    name: "Walmart Foundation",
    category: "corporate",
    source_type: "corporate",
    website_url: "https://walmart.org/how-we-give/walmart-foundation",
    adapter_type: "web",
  },
  {
    name: "Home Depot Foundation",
    category: "corporate",
    source_type: "corporate",
    website_url: "https://corporate.homedepot.com/socialgov/foundation",
    adapter_type: "web",
  },
  {
    name: "Lowe's Foundation",
    category: "corporate",
    source_type: "corporate",
    website_url:
      "https://corporate.lowes.com/our-responsibilities/lowes-in-the-community/education",
    adapter_type: "web",
  },
  {
    name: "Google.org",
    category: "corporate",
    source_type: "corporate",
    website_url: "https://www.google.org/our-work",
    adapter_type: "web",
  },
  {
    name: "Microsoft Philanthropies",
    category: "corporate",
    source_type: "corporate",
    website_url:
      "https://www.microsoft.com/en-us/corporate-responsibility/philanthropies",
    adapter_type: "web",
  },
  {
    name: "Bank of America Foundation",
    category: "corporate",
    source_type: "corporate",
    website_url:
      "https://about.bankofamerica.com/en/making-an-impact/charitable-foundation-funding",
    adapter_type: "web",
  },
  {
    name: "JPMorgan Chase Foundation",
    category: "corporate",
    source_type: "corporate",
    website_url:
      "https://www.jpmorganchase.com/impact/our-approach/global-philanthropy",
    adapter_type: "web",
  },

  // Faith-based
  {
    name: "Lilly Endowment",
    category: "faith_based",
    source_type: "foundation",
    website_url: "https://lillyendowment.org/grant-seekers",
    adapter_type: "web",
  },
  {
    name: "Mustard Seed Foundation",
    category: "faith_based",
    source_type: "foundation",
    website_url: "https://msfdn.org/harvey-fellows",
    adapter_type: "web",
  },

  // Research databases
  {
    name: "Candid Foundation Directory",
    category: "research_database",
    source_type: "directory",
    website_url: "https://candid.org",
    adapter_type: "directory",
  },
  {
    name: "GrantWatch",
    category: "research_database",
    source_type: "directory",
    website_url: "https://www.grantwatch.com",
    adapter_type: "directory",
  },
  {
    name: "GrantStation",
    category: "research_database",
    source_type: "directory",
    website_url: "https://grantstation.com",
    adapter_type: "directory",
  },
];
