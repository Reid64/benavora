// Research resource registry - static catalog backing the Research page's
// resource directory (BLUEPRINT.md Directive 5: pinned enterprise grid +
// searchable long tail). Pure data only, safe for client components.

export type ResourceDataFreshness = "daily" | "weekly" | "monthly" | "static";

export interface ResourceDefinition {
  id: string;
  name: string;
  category: string;
  /** Exactly two sentences describing the resource. */
  description: string;
  url: string;
  apiAvailable: boolean;
  dataFreshness: ResourceDataFreshness;
  isPinned: boolean;
  logoUrl: string | null;
}

export const RESEARCH_RESOURCES: ResourceDefinition[] = [
  // ── Pinned: top 21 (3x7 grid) ─────────────────────────────────────────
  {
    id: "grants-gov",
    name: "Grants.gov",
    category: "Federal Opportunities",
    description:
      "The federal government's central portal for discovering and applying to grant opportunities across all agencies. Aggregates funding announcements from over 1,000 federal grant-making programs.",
    url: "https://www.grants.gov",
    apiAvailable: true,
    dataFreshness: "daily",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "sam-gov",
    name: "SAM.gov",
    category: "Federal Registry",
    description:
      "The System for Award Management is the official U.S. government registry for entities seeking federal contracts and grants. Required registration source for federal assistance eligibility and entity verification.",
    url: "https://sam.gov",
    apiAvailable: true,
    dataFreshness: "daily",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "usaspending",
    name: "USASpending.gov",
    category: "Award Database",
    description:
      "The official source of comprehensive spending data for the U.S. federal government, covering contracts, grants, and loans. Reveals who actually received awards, not just who is eligible to apply.",
    url: "https://www.usaspending.gov",
    apiAvailable: true,
    dataFreshness: "daily",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "nih-reporter",
    name: "NIH RePORTER",
    category: "Health Research",
    description:
      "The National Institutes of Health's public database of funded research projects, publications, and patents. Essential for identifying health-research funding patterns and prior award recipients.",
    url: "https://reporter.nih.gov",
    apiAvailable: true,
    dataFreshness: "daily",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "nsf-award-search",
    name: "NSF Award Search",
    category: "Science & Engineering",
    description:
      "The National Science Foundation's searchable archive of every award it has funded since 1959. Covers science, engineering, and education research grants with detailed abstracts and award amounts.",
    url: "https://www.nsf.gov/awardsearch/",
    apiAvailable: true,
    dataFreshness: "weekly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "hrsa-data-warehouse",
    name: "HRSA Data Warehouse",
    category: "Health Services",
    description:
      "The Health Resources and Services Administration's public data platform covering health center funding, workforce programs, and maternal-child health grants. Provides historical award data for underserved-community health programs.",
    url: "https://data.hrsa.gov",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "hud-exchange",
    name: "HUD Exchange",
    category: "Housing & Community",
    description:
      "The U.S. Department of Housing and Urban Development's resource hub for CDBG, HOME, ESG, and Continuum of Care funding programs. Publishes Notices of Funding Opportunity and grantee performance data for housing and community-development work.",
    url: "https://www.hudexchange.info",
    apiAvailable: false,
    dataFreshness: "weekly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "samhsa",
    name: "SAMHSA",
    category: "Behavioral Health",
    description:
      "The Substance Abuse and Mental Health Services Administration funds and tracks behavioral-health, addiction-treatment, and recovery-support grant programs. Publishes funding opportunity announcements and state-level behavioral-health data.",
    url: "https://www.samhsa.gov/grants",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "doj-ojp",
    name: "DOJ OJP",
    category: "Justice Programs",
    description:
      "The Department of Justice's Office of Justice Programs funds crime-prevention, victim-services, and criminal-justice-reform initiatives nationwide. Its award database shows past recipients and grant amounts for justice-sector funding research.",
    url: "https://www.ojp.gov/funding",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "irs-tax-exempt-search",
    name: "IRS Tax-Exempt Search",
    category: "990 Lookup",
    description:
      "The Internal Revenue Service's public tool for verifying an organization's tax-exempt status and pulling its filed Form 990s. Confirms 501(c)(3) eligibility and provides direct access to a nonprofit's own filings.",
    url: "https://apps.irs.gov/app/eos/",
    apiAvailable: true,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "propublica-nonprofit-explorer",
    name: "ProPublica Nonprofit Explorer",
    category: "990 Financials",
    description:
      "A free, no-key-required database of 1.8 million nonprofit tax filings, including 990-PF Schedule I grant-making detail. The primary source for mining foundation giving history, officer compensation, and mission statements.",
    url: "https://projects.propublica.org/nonprofits/",
    apiAvailable: true,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "candid-guidestar",
    name: "Candid / GuideStar",
    category: "Foundation Profiles",
    description:
      "A premium nonprofit-intelligence platform covering 1.9 million organizations and 3 million annual grant transactions. Provides comprehensive foundation profiles, financials, and staff/board contact information.",
    url: "https://www.candid.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "foundation-directory-online",
    name: "Foundation Directory Online",
    category: "Funder Database",
    description:
      "Candid's flagship subscription funder-research database, searchable by geography, funding interest, and grant history. Widely used by grant professionals to identify well-matched private and community foundations.",
    url: "https://fconline.foundationcenter.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "grantwatch",
    name: "GrantWatch",
    category: "Aggregated Listings",
    description:
      "A subscription grant-listing service aggregating federal, state, foundation, and corporate funding opportunities into one searchable feed. Organizes listings by category, U.S. state, and country for quick browsing.",
    url: "https://www.grantwatch.com",
    apiAvailable: false,
    dataFreshness: "daily",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "opengrants",
    name: "OpenGrants",
    category: "Open Source Grant Data",
    description:
      "An open marketplace connecting grant seekers with grant writers and consultants alongside a searchable opportunity database. Emphasizes transparency around funder requirements and application support.",
    url: "https://opengrants.io",
    apiAvailable: false,
    dataFreshness: "weekly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "usafacts",
    name: "USAFacts",
    category: "Statistical Data",
    description:
      "A nonpartisan public data portal compiling government statistics on population, economy, health, and public spending. Useful for building need-statement evidence with sourced, citable government figures.",
    url: "https://usafacts.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "census-bureau",
    name: "Census Bureau Data",
    category: "Demographics",
    description:
      "The U.S. Census Bureau's American Community Survey and decennial census data on population, income, poverty, and housing at the county and tract level. The primary source for demographic need-statement evidence in grant narratives.",
    url: "https://data.census.gov",
    apiAvailable: true,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "cdc-wonder",
    name: "CDC Wonder",
    category: "Health Statistics",
    description:
      "The Centers for Disease Control's public health query system covering mortality, natality, and disease-surveillance data. Supports evidence-based health-need statements for public-health and behavioral-health grant applications.",
    url: "https://wonder.cdc.gov",
    apiAvailable: true,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "bls-data-tools",
    name: "BLS Data Tools",
    category: "Workforce Statistics",
    description:
      "The Bureau of Labor Statistics' data portal covering employment, unemployment, wages, and occupational projections by region. Used to substantiate workforce-development and economic-need grant narratives.",
    url: "https://www.bls.gov/data/",
    apiAvailable: true,
    dataFreshness: "monthly",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "data-gov",
    name: "Data.gov",
    category: "Federal Open Datasets",
    description:
      "The U.S. government's central catalog of open datasets across every federal agency, spanning health, education, environment, and more. A broad discovery point for supporting evidence not covered by a dedicated agency source.",
    url: "https://data.gov",
    apiAvailable: true,
    dataFreshness: "daily",
    isPinned: true,
    logoUrl: null,
  },
  {
    id: "usaspending-explorer",
    name: "USASpending Explorer",
    category: "Contract/Grant Explorer",
    description:
      "USASpending.gov's advanced search and visualization interface for drilling into contract and grant awards by agency, recipient, and geography. Complements the base USASpending dataset with interactive comparison and export tools.",
    url: "https://www.usaspending.gov/search",
    apiAvailable: true,
    dataFreshness: "daily",
    isPinned: true,
    logoUrl: null,
  },

  // ── Additional: state grant portals ───────────────────────────────────
  {
    id: "state-portal-ca",
    name: "California Grants Portal",
    category: "State Portal",
    description:
      "California's centralized listing of grant and loan opportunities offered by state agencies and departments. Searchable by category, department, and application deadline.",
    url: "https://www.grants.ca.gov",
    apiAvailable: false,
    dataFreshness: "weekly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "state-portal-tx",
    name: "Texas Grants Management",
    category: "State Portal",
    description:
      "Texas's grant-management resources spanning housing, health, and human-services funding administered by state agencies. Includes TDHCA and Health and Human Services Commission opportunity listings.",
    url: "https://comptroller.texas.gov/purchasing/grants/",
    apiAvailable: false,
    dataFreshness: "weekly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "state-portal-ny",
    name: "New York State Grants Gateway",
    category: "State Portal",
    description:
      "New York's unified portal for state agency grant opportunities, prequalification, and contract management. Required registration point for organizations seeking New York State funding.",
    url: "https://grantsmanagement.ny.gov",
    apiAvailable: false,
    dataFreshness: "weekly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "state-portal-fl",
    name: "Florida Grants Portal",
    category: "State Portal",
    description:
      "Florida's directory of state-administered grant programs across housing, health, and community-development agencies. Lists application windows and awarded-grantee history by fiscal year.",
    url: "https://myflorida.com",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "state-portal-il",
    name: "Illinois GATA Grants Portal",
    category: "State Portal",
    description:
      "Illinois's Grant Accountability and Transparency Act portal listing all state-funded grant opportunities and compliance requirements. Centralizes pre-qualification and internal-controls certification for grantees.",
    url: "https://grants.illinois.gov",
    apiAvailable: false,
    dataFreshness: "weekly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "state-portal-oh",
    name: "Ohio Grants Partnership",
    category: "State Portal",
    description:
      "Ohio's grants-management system listing funding opportunities from state agencies and their application timelines. Supports centralized applicant registration across multiple Ohio departments.",
    url: "https://grants.ohio.gov",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "state-portal-pa",
    name: "Pennsylvania eGrants",
    category: "State Portal",
    description:
      "Pennsylvania's Department of Community and Economic Development online grant-application and management system. Covers community-revitalization, housing, and economic-development funding programs.",
    url: "https://www.dced.pa.gov",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "state-portal-ga",
    name: "Georgia Grants Portal",
    category: "State Portal",
    description:
      "Georgia's central directory of state agency grant programs spanning human services, housing, and public-safety funding. Provides deadline and eligibility summaries for each listed opportunity.",
    url: "https://georgia.gov/topic/grants",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },

  // ── Additional: corporate foundations ─────────────────────────────────
  {
    id: "corp-walmart-foundation",
    name: "Walmart Foundation",
    category: "Corporate Foundation",
    description:
      "Walmart's philanthropic arm funding hunger relief, workforce development, and community resilience programs nationwide. Publishes local and national giving guidelines and application cycles.",
    url: "https://walmart.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "corp-bank-of-america-foundation",
    name: "Bank of America Charitable Foundation",
    category: "Corporate Foundation",
    description:
      "Bank of America's giving arm supporting workforce development, housing stability, and small-business growth in the communities it serves. Distributes funding through both local market grants and national initiatives.",
    url: "https://about.bankofamerica.com/en/making-an-impact/charitable-foundation-funding",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "corp-wells-fargo-foundation",
    name: "Wells Fargo Foundation",
    category: "Corporate Foundation",
    description:
      "Wells Fargo's corporate philanthropy program focused on housing affordability, small-business growth, and financial health. Publishes annual giving priorities and community-grant application guidance.",
    url: "https://www.wellsfargo.com/about/corporate-responsibility/community-giving/",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "corp-target-foundation",
    name: "Target Foundation",
    category: "Corporate Foundation",
    description:
      "Target's philanthropic arm investing in community safety, wellbeing, and local nonprofit partnerships near its stores and distribution centers. Prioritizes locally-driven giving over a national open-application model.",
    url: "https://corporate.target.com/sustainability-governance/target-foundation",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "corp-home-depot-foundation",
    name: "Home Depot Foundation",
    category: "Corporate Foundation",
    description:
      "The Home Depot's giving program focused on veteran housing, disaster relief, and skilled-trades workforce training. Offers both cash grants and in-kind product donations to qualifying nonprofits.",
    url: "https://corporate.homedepot.com/foundation",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "corp-state-farm-foundation",
    name: "State Farm Foundation",
    category: "Corporate Foundation",
    description:
      "State Farm's corporate foundation supporting education, community safety, and disaster-preparedness initiatives across the country. Runs recurring grant programs alongside disaster-response emergency funding.",
    url: "https://www.statefarm.com/about-us/community/state-farm-foundation",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "corp-jpmorgan-chase-foundation",
    name: "JPMorgan Chase Foundation",
    category: "Corporate Foundation",
    description:
      "JPMorgan Chase's philanthropic arm funding economic development, workforce readiness, and small-business growth initiatives globally. Directs significant funding toward underserved and historically under-invested communities.",
    url: "https://www.jpmorganchase.com/impact",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "corp-microsoft-philanthropies",
    name: "Microsoft Philanthropies",
    category: "Corporate Foundation",
    description:
      "Microsoft's corporate social-responsibility arm providing cash grants, software donations, and cloud-computing credits to eligible nonprofits. Focuses on digital skills, accessibility, and nonprofit technology capacity.",
    url: "https://www.microsoft.com/en-us/philanthropies",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },

  // ── Additional: community foundations ─────────────────────────────────
  {
    id: "cf-silicon-valley",
    name: "Silicon Valley Community Foundation",
    category: "Community Foundation",
    description:
      "One of the largest community foundations in the country, managing donor-advised funds and grantmaking for the greater Bay Area. Supports affordable housing, immigrant services, and economic-opportunity initiatives.",
    url: "https://www.siliconvalleycf.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "cf-chicago-community-trust",
    name: "Chicago Community Trust",
    category: "Community Foundation",
    description:
      "Chicago's oldest community foundation, directing grants toward closing the region's racial and ethnic wealth gap. Manages both discretionary and donor-advised funding streams.",
    url: "https://www.cct.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "cf-new-york-community-trust",
    name: "New York Community Trust",
    category: "Community Foundation",
    description:
      "A major community foundation serving New York City and its suburbs, funding education, health, housing, and human-services nonprofits. Publishes detailed program-area guidelines and rolling application deadlines.",
    url: "https://www.nyct-cfi.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "cf-cleveland-foundation",
    name: "Cleveland Foundation",
    category: "Community Foundation",
    description:
      "The nation's first community foundation, funding economic development, education, and neighborhood-revitalization work in Northeast Ohio. Operates competitive grant cycles alongside donor-advised giving.",
    url: "https://www.clevelandfoundation.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "cf-communities-foundation-texas",
    name: "Communities Foundation of Texas",
    category: "Community Foundation",
    description:
      "One of the largest community foundations in Texas, serving the North Texas region with grants in education, housing, and basic needs. Administers the annual North Texas Giving Day fundraising platform.",
    url: "https://www.cftexas.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "cf-san-francisco-foundation",
    name: "San Francisco Foundation",
    category: "Community Foundation",
    description:
      "A regional community foundation focused on closing the Bay Area's racial wealth gap through housing, economic-development, and civic-engagement grantmaking. Publishes clear equity-centered funding priorities.",
    url: "https://sff.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "cf-greater-houston-community-foundation",
    name: "Greater Houston Community Foundation",
    category: "Community Foundation",
    description:
      "Houston's largest community foundation, managing philanthropic funds and disaster-recovery grantmaking for the Gulf Coast region. Played a lead role in hurricane and flood-recovery funding coordination.",
    url: "https://ghcf.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "cf-foundation-for-the-carolinas",
    name: "Foundation For The Carolinas",
    category: "Community Foundation",
    description:
      "A large regional community foundation serving Charlotte and the greater Carolinas with grants in economic mobility, education, and housing. Manages significant donor-advised fund assets alongside direct grantmaking.",
    url: "https://fftc.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },

  // ── Additional: international funders ─────────────────────────────────
  {
    id: "intl-wellcome-trust",
    name: "Wellcome Trust",
    category: "International Funder",
    description:
      "A UK-based global charitable foundation funding health research, mental health, and infectious-disease programs worldwide. One of the largest medical-research funders outside the United States.",
    url: "https://wellcome.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "intl-gates-foundation-global",
    name: "Bill & Melinda Gates Foundation Global",
    category: "International Funder",
    description:
      "A global philanthropy funding worldwide health, poverty-reduction, and agricultural-development initiatives across the developing world. Publishes detailed strategy areas and funded-grantee databases.",
    url: "https://www.gatesfoundation.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "intl-ford-foundation",
    name: "Ford Foundation International",
    category: "International Funder",
    description:
      "A global foundation funding social-justice, human-rights, and inequality-reduction work across offices on multiple continents. Supports both U.S. domestic and international grantee organizations.",
    url: "https://www.fordfoundation.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "intl-open-society-foundations",
    name: "Open Society Foundations",
    category: "International Funder",
    description:
      "A global network of foundations funding human rights, justice reform, and democratic governance initiatives in over 120 countries. Maintains regional offices with locally tailored funding priorities.",
    url: "https://www.opensocietyfoundations.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "intl-eu-funding-tenders-portal",
    name: "European Commission Funding & Tenders Portal",
    category: "International Funder",
    description:
      "The European Union's official portal for all EU-funded grant, tender, and research-program opportunities. Includes Horizon Europe and other multi-year EU funding frameworks.",
    url: "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/home",
    apiAvailable: true,
    dataFreshness: "weekly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "intl-ukri",
    name: "UK Research and Innovation (UKRI)",
    category: "International Funder",
    description:
      "The United Kingdom's national funding agency for research and innovation across science, health, and the humanities. Publishes open funding-opportunity listings and past-award data through its Gateway to Research tool.",
    url: "https://www.ukri.org",
    apiAvailable: true,
    dataFreshness: "weekly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "intl-global-fund",
    name: "Global Fund",
    category: "International Funder",
    description:
      "An international financing organization funding programs to fight AIDS, tuberculosis, and malaria worldwide. Channels funding through country-level partners rather than direct individual-organization applications.",
    url: "https://www.theglobalfund.org",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
  {
    id: "intl-world-bank-grants",
    name: "World Bank Group Grants",
    category: "International Funder",
    description:
      "The World Bank's development-financing arm funding poverty-reduction, infrastructure, and civil-society programs globally. Publishes procurement and grant-opportunity notices through its central operations portal.",
    url: "https://www.worldbank.org/en/about/partners/civil-society/current-events/opportunities",
    apiAvailable: false,
    dataFreshness: "monthly",
    isPinned: false,
    logoUrl: null,
  },
];

export const RESOURCE_CATEGORIES: string[] = Array.from(
  new Set(RESEARCH_RESOURCES.map((r) => r.category)),
);
