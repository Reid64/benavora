// State funding source registry — state-level housing finance agencies,
// housing/health/human-services departments, and community action agencies
// for all 50 states, plus the 11 Federal Home Loan Banks and the HUD
// Continuum of Care program (PLATFORM_VISION_ARCHITECTURE.md Pillar 2/18,
// STANDING_DIRECTIVES.md housing-focused source expansion). Complements
// funding-source-registry.ts (federal agencies/corporate/faith-based/
// research sources) rather than replacing it.
//
// Deviations from the task-given spec, per this project's established
// practice of checking real state before applying a literal spec (see
// funding-source-registry.ts's and migrations 093-097's header comments for
// prior instances of this pattern):
//   - Housing finance agencies for the 45 states beyond the 5 the task fully
//     specified (TX/CA/NY/FL/IL) use each state's real, well-known HFA name
//     and website instead of the task's literal "https://[state
//     abbreviation]hfa.com" fallback pattern, which is not a real URL for
//     almost any state (Ohio's HFA is ohiohome.org, Pennsylvania's is
//     phfa.org, etc). "NEVER use mocks or placeholder data" (CLAUDE.md Iron
//     Law #8) takes precedence over a literal fallback instruction, and the
//     task's own "or similar" wording allows this.
//   - community_action_agency for the 45 non-fully-specified states points
//     to the national Community Action Partnership's member directory
//     rather than a guessed per-state domain: every state has its own CAA
//     network, but their actual domains aren't reliably derivable from a
//     naming pattern, and a fabricated URL is worse than a real directory
//     one level up. The 5 fully-specified states get their real state CAA
//     association site.
//   - dept_of_housing is genuinely absent in most states (housing falls
//     under the HFA or a combined agency) — populated only where a distinct
//     department exists, per the task's own "if exists" qualifier.
//   - funding_sources (migration 097) has no columns matching this file's
//     nested per-state shape (housing_finance_agency, dept_of_housing,
//     etc) — it's a flat, generic source-catalog table. seedStateSources()
//     flattens each state entry into one row per populated agency
//     (geographic_scope = state_code, category = 'state_agency',
//     subcategory = agency type), the same row-per-source shape
//     funding-source-registry.ts already uses via /api/sources/registry.

export interface StateAgencyRef {
  name: string;
  website: string;
}

export interface StateFundingSources {
  state_code: string;
  housing_finance_agency: StateAgencyRef;
  dept_of_housing?: StateAgencyRef;
  dept_of_health: StateAgencyRef;
  dept_of_human_services: StateAgencyRef;
  community_action_agency: StateAgencyRef;
}

const NATIONAL_CAP_DIRECTORY: StateAgencyRef = {
  name: "Community Action Partnership — Find a CAA",
  website: "https://communityactionpartnership.com/find-a-cap/",
};

export const STATE_FUNDING_SOURCES: StateFundingSources[] = [
  {
    state_code: "AL",
    housing_finance_agency: { name: "Alabama Housing Finance Authority", website: "https://www.ahfa.com" },
    dept_of_health: { name: "Alabama Department of Public Health", website: "https://www.alabamapublichealth.gov" },
    dept_of_human_services: { name: "Alabama Department of Human Resources", website: "https://dhr.alabama.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "AK",
    housing_finance_agency: { name: "Alaska Housing Finance Corporation", website: "https://www.ahfc.us" },
    dept_of_health: { name: "Alaska Department of Health", website: "https://health.alaska.gov" },
    dept_of_human_services: { name: "Alaska Department of Family and Community Services", website: "https://dfcs.alaska.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "AZ",
    housing_finance_agency: { name: "Arizona Department of Housing", website: "https://housing.az.gov" },
    dept_of_health: { name: "Arizona Department of Health Services", website: "https://azdhs.gov" },
    dept_of_human_services: { name: "Arizona Department of Economic Security", website: "https://des.az.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "AR",
    housing_finance_agency: { name: "Arkansas Development Finance Authority", website: "https://www.arkansas.gov/adfa" },
    dept_of_health: { name: "Arkansas Department of Health", website: "https://www.healthy.arkansas.gov" },
    dept_of_human_services: { name: "Arkansas Department of Human Services", website: "https://humanservices.arkansas.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "CA",
    housing_finance_agency: { name: "California Housing Finance Agency (CalHFA)", website: "https://www.calhfa.ca.gov" },
    dept_of_housing: { name: "California Department of Housing and Community Development", website: "https://www.hcd.ca.gov" },
    dept_of_health: { name: "California Department of Public Health", website: "https://www.cdph.ca.gov" },
    dept_of_human_services: { name: "California Department of Social Services", website: "https://www.cdss.ca.gov" },
    community_action_agency: { name: "California Community Action Partnership Association", website: "https://www.calcapa.org" },
  },
  {
    state_code: "CO",
    housing_finance_agency: { name: "Colorado Housing and Finance Authority", website: "https://www.chfainfo.com" },
    dept_of_health: { name: "Colorado Department of Public Health and Environment", website: "https://cdphe.colorado.gov" },
    dept_of_human_services: { name: "Colorado Department of Human Services", website: "https://cdhs.colorado.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "CT",
    housing_finance_agency: { name: "Connecticut Housing Finance Authority", website: "https://www.chfa.org" },
    dept_of_housing: { name: "Connecticut Department of Housing", website: "https://portal.ct.gov/DOH" },
    dept_of_health: { name: "Connecticut Department of Public Health", website: "https://portal.ct.gov/DPH" },
    dept_of_human_services: { name: "Connecticut Department of Social Services", website: "https://portal.ct.gov/DSS" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "DE",
    housing_finance_agency: { name: "Delaware State Housing Authority", website: "https://www.destatehousing.com" },
    dept_of_health: { name: "Delaware Division of Public Health", website: "https://dhss.delaware.gov/dhss/dph/" },
    dept_of_human_services: { name: "Delaware Department of Health and Social Services", website: "https://dhss.delaware.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "FL",
    housing_finance_agency: { name: "Florida Housing Finance Corporation", website: "https://floridahousing.org" },
    dept_of_health: { name: "Florida Department of Health", website: "https://www.floridahealth.gov" },
    dept_of_human_services: { name: "Florida Department of Children and Families", website: "https://www.myflfamilies.com" },
    community_action_agency: { name: "Florida Association for Community Action", website: "https://facaflorida.org" },
  },
  {
    state_code: "GA",
    housing_finance_agency: { name: "Georgia Department of Community Affairs (Housing Finance Division)", website: "https://www.dca.ga.gov" },
    dept_of_health: { name: "Georgia Department of Public Health", website: "https://dph.georgia.gov" },
    dept_of_human_services: { name: "Georgia Department of Human Services", website: "https://dhs.georgia.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "HI",
    housing_finance_agency: { name: "Hawaii Housing Finance and Development Corporation", website: "https://dbedt.hawaii.gov/hhfdc/" },
    dept_of_health: { name: "Hawaii Department of Health", website: "https://health.hawaii.gov" },
    dept_of_human_services: { name: "Hawaii Department of Human Services", website: "https://humanservices.hawaii.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "ID",
    housing_finance_agency: { name: "Idaho Housing and Finance Association", website: "https://www.idahohousing.com" },
    dept_of_health: { name: "Idaho Department of Health and Welfare", website: "https://healthandwelfare.idaho.gov" },
    dept_of_human_services: { name: "Idaho Department of Health and Welfare", website: "https://healthandwelfare.idaho.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "IL",
    housing_finance_agency: { name: "Illinois Housing Development Authority", website: "https://www.ihda.org" },
    dept_of_health: { name: "Illinois Department of Public Health", website: "https://dph.illinois.gov" },
    dept_of_human_services: { name: "Illinois Department of Human Services", website: "https://www.dhs.state.il.us" },
    community_action_agency: { name: "Illinois Association of Community Action Agencies", website: "https://ilcaa.org" },
  },
  {
    state_code: "IN",
    housing_finance_agency: { name: "Indiana Housing and Community Development Authority", website: "https://www.in.gov/ihcda/" },
    dept_of_health: { name: "Indiana Department of Health", website: "https://www.in.gov/health/" },
    dept_of_human_services: { name: "Indiana Family and Social Services Administration", website: "https://www.in.gov/fssa/" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "IA",
    housing_finance_agency: { name: "Iowa Finance Authority", website: "https://www.iowafinance.com" },
    dept_of_health: { name: "Iowa Department of Health and Human Services", website: "https://hhs.iowa.gov" },
    dept_of_human_services: { name: "Iowa Department of Health and Human Services", website: "https://hhs.iowa.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "KS",
    housing_finance_agency: { name: "Kansas Housing Resources Corporation", website: "https://www.kshousingcorp.org" },
    dept_of_health: { name: "Kansas Department of Health and Environment", website: "https://www.kdhe.ks.gov" },
    dept_of_human_services: { name: "Kansas Department for Children and Families", website: "https://www.dcf.ks.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "KY",
    housing_finance_agency: { name: "Kentucky Housing Corporation", website: "https://www.kyhousing.org" },
    dept_of_health: { name: "Kentucky Cabinet for Health and Family Services", website: "https://chfs.ky.gov" },
    dept_of_human_services: { name: "Kentucky Cabinet for Health and Family Services", website: "https://chfs.ky.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "LA",
    housing_finance_agency: { name: "Louisiana Housing Corporation", website: "https://www.lhc.la.gov" },
    dept_of_health: { name: "Louisiana Department of Health", website: "https://ldh.la.gov" },
    dept_of_human_services: { name: "Louisiana Department of Children and Family Services", website: "https://www.dcfs.louisiana.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "ME",
    housing_finance_agency: { name: "MaineHousing", website: "https://www.mainehousing.org" },
    dept_of_health: { name: "Maine Department of Health and Human Services", website: "https://www.maine.gov/dhhs" },
    dept_of_human_services: { name: "Maine Department of Health and Human Services", website: "https://www.maine.gov/dhhs" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "MD",
    housing_finance_agency: { name: "Maryland Department of Housing and Community Development", website: "https://dhcd.maryland.gov" },
    dept_of_health: { name: "Maryland Department of Health", website: "https://health.maryland.gov" },
    dept_of_human_services: { name: "Maryland Department of Human Services", website: "https://dhs.maryland.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "MA",
    housing_finance_agency: { name: "MassHousing", website: "https://www.masshousing.com" },
    dept_of_housing: { name: "Massachusetts Executive Office of Housing and Livable Communities", website: "https://www.mass.gov/orgs/executive-office-of-housing-and-livable-communities" },
    dept_of_health: { name: "Massachusetts Department of Public Health", website: "https://www.mass.gov/orgs/massachusetts-department-of-public-health" },
    dept_of_human_services: { name: "Massachusetts Executive Office of Health and Human Services", website: "https://www.mass.gov/orgs/executive-office-of-health-and-human-services" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "MI",
    housing_finance_agency: { name: "Michigan State Housing Development Authority", website: "https://www.michigan.gov/mshda" },
    dept_of_health: { name: "Michigan Department of Health and Human Services", website: "https://www.michigan.gov/mdhhs" },
    dept_of_human_services: { name: "Michigan Department of Health and Human Services", website: "https://www.michigan.gov/mdhhs" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "MN",
    housing_finance_agency: { name: "Minnesota Housing Finance Agency", website: "https://www.mnhousing.gov" },
    dept_of_health: { name: "Minnesota Department of Health", website: "https://www.health.state.mn.us" },
    dept_of_human_services: { name: "Minnesota Department of Human Services", website: "https://mn.gov/dhs/" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "MS",
    housing_finance_agency: { name: "Mississippi Home Corporation", website: "https://www.mshomecorp.com" },
    dept_of_health: { name: "Mississippi State Department of Health", website: "https://msdh.ms.gov" },
    dept_of_human_services: { name: "Mississippi Department of Human Services", website: "https://www.mdhs.ms.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "MO",
    housing_finance_agency: { name: "Missouri Housing Development Commission", website: "https://www.mhdc.com" },
    dept_of_health: { name: "Missouri Department of Health and Senior Services", website: "https://health.mo.gov" },
    dept_of_human_services: { name: "Missouri Department of Social Services", website: "https://mydss.mo.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "MT",
    housing_finance_agency: { name: "Montana Housing", website: "https://housing.mt.gov" },
    dept_of_health: { name: "Montana Department of Public Health and Human Services", website: "https://dphhs.mt.gov" },
    dept_of_human_services: { name: "Montana Department of Public Health and Human Services", website: "https://dphhs.mt.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "NE",
    housing_finance_agency: { name: "Nebraska Investment Finance Authority", website: "https://www.nifa.org" },
    dept_of_health: { name: "Nebraska Department of Health and Human Services", website: "https://dhhs.ne.gov" },
    dept_of_human_services: { name: "Nebraska Department of Health and Human Services", website: "https://dhhs.ne.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "NV",
    housing_finance_agency: { name: "Nevada Housing Division", website: "https://housing.nv.gov" },
    dept_of_health: { name: "Nevada Division of Public and Behavioral Health", website: "https://dpbh.nv.gov" },
    dept_of_human_services: { name: "Nevada Department of Health and Human Services", website: "https://dhhs.nv.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "NH",
    housing_finance_agency: { name: "New Hampshire Housing Finance Authority", website: "https://www.nhhfa.org" },
    dept_of_health: { name: "New Hampshire Department of Health and Human Services", website: "https://www.dhhs.nh.gov" },
    dept_of_human_services: { name: "New Hampshire Department of Health and Human Services", website: "https://www.dhhs.nh.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "NJ",
    housing_finance_agency: { name: "New Jersey Housing and Mortgage Finance Agency", website: "https://www.nj.gov/dca/hmfa/" },
    dept_of_housing: { name: "New Jersey Department of Community Affairs", website: "https://www.nj.gov/dca/" },
    dept_of_health: { name: "New Jersey Department of Health", website: "https://www.nj.gov/health/" },
    dept_of_human_services: { name: "New Jersey Department of Human Services", website: "https://www.nj.gov/humanservices/" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "NM",
    housing_finance_agency: { name: "New Mexico Mortgage Finance Authority", website: "https://housingnm.org" },
    dept_of_health: { name: "New Mexico Department of Health", website: "https://www.nmhealth.org" },
    dept_of_human_services: { name: "New Mexico Human Services Department", website: "https://www.hsd.state.nm.us" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "NY",
    housing_finance_agency: { name: "New York State Homes and Community Renewal", website: "https://hcr.ny.gov" },
    dept_of_health: { name: "New York State Department of Health", website: "https://www.health.ny.gov" },
    dept_of_human_services: { name: "New York State Office of Temporary and Disability Assistance", website: "https://otda.ny.gov" },
    community_action_agency: { name: "New York State Community Action Association", website: "https://www.nyscommunityaction.org" },
  },
  {
    state_code: "NC",
    housing_finance_agency: { name: "North Carolina Housing Finance Agency", website: "https://www.nchfa.com" },
    dept_of_health: { name: "North Carolina Department of Health and Human Services", website: "https://www.ncdhhs.gov" },
    dept_of_human_services: { name: "North Carolina Department of Health and Human Services", website: "https://www.ncdhhs.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "ND",
    housing_finance_agency: { name: "North Dakota Housing Finance Agency", website: "https://www.ndhfa.org" },
    dept_of_health: { name: "North Dakota Department of Health and Human Services", website: "https://www.hhs.nd.gov" },
    dept_of_human_services: { name: "North Dakota Department of Health and Human Services", website: "https://www.hhs.nd.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "OH",
    housing_finance_agency: { name: "Ohio Housing Finance Agency", website: "https://ohiohome.org" },
    dept_of_health: { name: "Ohio Department of Health", website: "https://odh.ohio.gov" },
    dept_of_human_services: { name: "Ohio Department of Job and Family Services", website: "https://jfs.ohio.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "OK",
    housing_finance_agency: { name: "Oklahoma Housing Finance Agency", website: "https://www.ohfa.org" },
    dept_of_health: { name: "Oklahoma State Department of Health", website: "https://oklahoma.gov/health.html" },
    dept_of_human_services: { name: "Oklahoma Department of Human Services", website: "https://oklahoma.gov/okdhs.html" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "OR",
    housing_finance_agency: { name: "Oregon Housing and Community Services", website: "https://www.oregon.gov/ohcs" },
    dept_of_health: { name: "Oregon Health Authority", website: "https://www.oregon.gov/oha" },
    dept_of_human_services: { name: "Oregon Department of Human Services", website: "https://www.oregon.gov/odhs" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "PA",
    housing_finance_agency: { name: "Pennsylvania Housing Finance Agency", website: "https://www.phfa.org" },
    dept_of_housing: { name: "Pennsylvania Department of Community and Economic Development", website: "https://dced.pa.gov" },
    dept_of_health: { name: "Pennsylvania Department of Health", website: "https://www.health.pa.gov" },
    dept_of_human_services: { name: "Pennsylvania Department of Human Services", website: "https://www.dhs.pa.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "RI",
    housing_finance_agency: { name: "RIHousing", website: "https://www.rihousing.com" },
    dept_of_health: { name: "Rhode Island Department of Health", website: "https://health.ri.gov" },
    dept_of_human_services: { name: "Rhode Island Department of Human Services", website: "https://dhs.ri.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "SC",
    housing_finance_agency: { name: "SC Housing (South Carolina State Housing Finance and Development Authority)", website: "https://www.schousing.com" },
    dept_of_health: { name: "South Carolina Department of Public Health", website: "https://dph.sc.gov" },
    dept_of_human_services: { name: "South Carolina Department of Social Services", website: "https://dss.sc.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "SD",
    housing_finance_agency: { name: "South Dakota Housing Development Authority", website: "https://www.sdhda.org" },
    dept_of_health: { name: "South Dakota Department of Health", website: "https://doh.sd.gov" },
    dept_of_human_services: { name: "South Dakota Department of Social Services", website: "https://dss.sd.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "TN",
    housing_finance_agency: { name: "Tennessee Housing Development Agency", website: "https://thda.org" },
    dept_of_health: { name: "Tennessee Department of Health", website: "https://www.tn.gov/health.html" },
    dept_of_human_services: { name: "Tennessee Department of Human Services", website: "https://www.tn.gov/humanservices.html" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "TX",
    housing_finance_agency: { name: "Texas Department of Housing and Community Affairs", website: "https://www.tdhca.state.tx.us" },
    dept_of_health: { name: "Texas Health and Human Services", website: "https://www.hhs.texas.gov" },
    dept_of_human_services: { name: "Texas Health and Human Services", website: "https://www.hhs.texas.gov" },
    community_action_agency: { name: "Texas Association of Community Action Agencies", website: "https://www.tacaa.org" },
  },
  {
    state_code: "UT",
    housing_finance_agency: { name: "Utah Housing Corporation", website: "https://www.utahhousingcorp.org" },
    dept_of_health: { name: "Utah Department of Health and Human Services", website: "https://dhhs.utah.gov" },
    dept_of_human_services: { name: "Utah Department of Health and Human Services", website: "https://dhhs.utah.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "VT",
    housing_finance_agency: { name: "Vermont Housing Finance Agency", website: "https://www.vhfa.org" },
    dept_of_health: { name: "Vermont Department of Health", website: "https://www.healthvermont.gov" },
    dept_of_human_services: { name: "Vermont Department for Children and Families", website: "https://dcf.vermont.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "VA",
    housing_finance_agency: { name: "Virginia Housing", website: "https://www.virginiahousing.com" },
    dept_of_housing: { name: "Virginia Department of Housing and Community Development", website: "https://www.dhcd.virginia.gov" },
    dept_of_health: { name: "Virginia Department of Health", website: "https://www.vdh.virginia.gov" },
    dept_of_human_services: { name: "Virginia Department of Social Services", website: "https://www.dss.virginia.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "WA",
    housing_finance_agency: { name: "Washington State Housing Finance Commission", website: "https://www.wshfc.org" },
    dept_of_housing: { name: "Washington State Department of Commerce — Housing Division", website: "https://www.commerce.wa.gov/serving-communities/housing/" },
    dept_of_health: { name: "Washington State Department of Health", website: "https://doh.wa.gov" },
    dept_of_human_services: { name: "Washington State Department of Social and Health Services", website: "https://www.dshs.wa.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "WV",
    housing_finance_agency: { name: "West Virginia Housing Development Fund", website: "https://www.wvhdf.com" },
    dept_of_health: { name: "West Virginia Department of Health", website: "https://dh.wv.gov" },
    dept_of_human_services: { name: "West Virginia Department of Human Services", website: "https://dohs.wv.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "WI",
    housing_finance_agency: { name: "Wisconsin Housing and Economic Development Authority", website: "https://www.wheda.com" },
    dept_of_health: { name: "Wisconsin Department of Health Services", website: "https://www.dhs.wisconsin.gov" },
    dept_of_human_services: { name: "Wisconsin Department of Children and Families", website: "https://dcf.wisconsin.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
  {
    state_code: "WY",
    housing_finance_agency: { name: "Wyoming Community Development Authority", website: "https://www.wyomingcda.com" },
    dept_of_health: { name: "Wyoming Department of Health", website: "https://health.wyo.gov" },
    dept_of_human_services: { name: "Wyoming Department of Family Services", website: "https://dfs.wyo.gov" },
    community_action_agency: NATIONAL_CAP_DIRECTORY,
  },
];

export interface FederalHomeLoanBank {
  name: string;
  website: string;
}

export const FEDERAL_HOME_LOAN_BANKS: FederalHomeLoanBank[] = [
  { name: "FHLB Atlanta", website: "https://www.fhlbatl.com/community-investment/grants" },
  { name: "FHLB Boston", website: "https://www.fhlbboston.com" },
  { name: "FHLB Chicago", website: "https://www.fhlbc.com" },
  { name: "FHLB Cincinnati", website: "https://www.fhlbcin.com" },
  { name: "FHLB Dallas", website: "https://www.fhlb.com" },
  { name: "FHLB Des Moines", website: "https://www.fhlbdm.com" },
  { name: "FHLB Indianapolis", website: "https://www.fhlbi.com" },
  { name: "FHLB New York", website: "https://www.fhlbny.com" },
  { name: "FHLB Pittsburgh", website: "https://www.fhlb-pgh.com" },
  { name: "FHLB San Francisco", website: "https://www.fhlbsf.com" },
  { name: "FHLB Seattle", website: "https://www.fhlbsea.com" },
];

export const CONTINUUM_OF_CARE: StateAgencyRef = {
  name: "HUD Continuum of Care (CoC) Program",
  website: "https://www.hud.gov/program_offices/comm_planning/coc",
};

interface FundingSourceRow {
  name: string;
  category: string;
  subcategory?: string;
  source_type: string;
  website_url: string;
  adapter_type: string;
  geographic_scope: string;
}

function buildStateSourceRows(): FundingSourceRow[] {
  const rows: FundingSourceRow[] = [];

  for (const state of STATE_FUNDING_SOURCES) {
    const agencies: [string, StateAgencyRef | undefined][] = [
      ["housing_finance", state.housing_finance_agency],
      ["housing", state.dept_of_housing],
      ["health", state.dept_of_health],
      ["human_services", state.dept_of_human_services],
      ["community_action", state.community_action_agency],
    ];

    for (const [subcategory, agency] of agencies) {
      if (!agency) continue;
      rows.push({
        name: agency.name,
        category: "state_agency",
        subcategory,
        source_type: "state",
        website_url: agency.website,
        adapter_type: "web",
        geographic_scope: state.state_code,
      });
    }
  }

  for (const bank of FEDERAL_HOME_LOAN_BANKS) {
    rows.push({
      name: bank.name,
      category: "federal_home_loan_bank",
      source_type: "federal",
      website_url: bank.website,
      adapter_type: "web",
      geographic_scope: "national",
    });
  }

  rows.push({
    name: CONTINUUM_OF_CARE.name,
    category: "federal_agency",
    subcategory: "continuum_of_care",
    source_type: "federal",
    website_url: CONTINUUM_OF_CARE.website,
    adapter_type: "web",
    geographic_scope: "national",
  });

  return rows;
}

// Seeds the shared, non-org-scoped `funding_sources` table (migration 097)
// with every state agency, FHLB, and CoC row above. Dedupes against
// existing rows by name so re-running this (e.g. on every registry route
// hit, same idempotent-seed pattern as funding-source-registry.ts) never
// creates duplicates — the table itself has no unique constraint on name.
export async function seedStateSources(supabase: any): Promise<number> {
  const rows = buildStateSourceRows();

  const { data: existing, error: existingError } = await supabase
    .from("funding_sources")
    .select("name");

  if (existingError) {
    throw new Error(`Could not load existing funding sources: ${existingError.message}`);
  }

  const existingNames = new Set(
    ((existing ?? []) as { name: string }[]).map((row) => row.name),
  );
  const toInsert = rows.filter((row) => !existingNames.has(row.name));

  if (toInsert.length === 0) return 0;

  const { error: insertError } = await supabase
    .from("funding_sources")
    .insert(toInsert);

  if (insertError) {
    throw new Error(`Could not insert state funding sources: ${insertError.message}`);
  }

  return toInsert.length;
}
