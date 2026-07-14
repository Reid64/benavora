// Static configuration for state grant portal scraping.
//
// titleSelector/deadlineSelector are plain substrings the scraper looks for
// near candidate result blocks (portal-scraper.ts does basic string search,
// not real HTML parsing) — they are search anchors, not CSS selectors.

export interface PortalConfig {
  state: string;
  portalName: string;
  searchUrl: string;
  titleSelector: string;
  deadlineSelector: string;
}

export const STATE_PORTAL_CONFIGS: PortalConfig[] = [
  {
    state: "TX",
    portalName: "Texas Grants (eGrants)",
    searchUrl: "https://www.txgrants.com/",
    titleSelector: "grant-title",
    deadlineSelector: "deadline",
  },
  {
    state: "FL",
    portalName: "Florida Grants Portal",
    searchUrl: "https://www.floridagrants.gov/",
    titleSelector: "opportunity-title",
    deadlineSelector: "closing-date",
  },
  {
    state: "IL",
    portalName: "Illinois GATA Grantee Portal",
    searchUrl: "https://gata.illinois.gov/portal/",
    titleSelector: "grant-title",
    deadlineSelector: "application-deadline",
  },
  {
    state: "CA",
    portalName: "California Grants Portal",
    searchUrl: "https://www.grants.ca.gov/grants/",
    titleSelector: "grant-title",
    deadlineSelector: "application-deadline",
  },
  {
    state: "NY",
    portalName: "New York Grants Gateway",
    searchUrl: "https://grantsgateway.ny.gov/",
    titleSelector: "opportunity-title",
    deadlineSelector: "due-date",
  },
];
