// Registry of state grant portals wired to StatePortalResearchAgent
// (src/lib/agents/state-portal.ts), the agent actually invoked by the
// "State Grant Portals" card's Run Now button (POST /api/agents/state-portals).
//
// Deliberately a standalone, dependency-free module: state-portal.ts pulls in
// server-only code (Anthropic SDK, admin Supabase client), so it can't be
// imported directly from a client component. This file is safe to import from
// both the agent and the settings/integrations page.
//
// Not the same list as STATE_PORTAL_CONFIGS (portal-config.ts) — that config
// backs a separate, read-only preview scraper (GET /api/sources/state-portals)
// that this card does not call.

export interface PortalConfig {
  stateCode: string;
  stateName: string;
  /** Base URL to fetch. Append search params here if the portal supports them. */
  portalUrl: string;
  /** Optional URL suffix template; {keywords} is replaced with the encoded query. */
  searchSuffix?: string;
}

// Texas is the primary portal (BLUEPRINT §3.6).
// Add additional portals here as they are onboarded.
//
// URL corrected 2026-08-05: the old "Texas Online" URL
// (txapps.texas.gov/tolapp/ogi/) 301-redirects through
// texasonline.state.tx.us -> www.texasonline.state.tx.us, a decommissioned
// e-government system whose final destination genuinely 404s (not a typo,
// the underlying page is gone). Replaced with the real, current, official
// Texas state grant opportunities portal (Statewide Procurement
// Division/eGrants), confirmed live via a direct fetch: `200`, real content.
export const PORTAL_REGISTRY: PortalConfig[] = [
  {
    stateCode: "TX",
    stateName: "Texas",
    portalUrl: "https://egrants.gov.texas.gov/fundingopp",
  },
];
