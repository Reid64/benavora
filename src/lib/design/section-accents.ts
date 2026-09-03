/**
 * Signature accent color per logical nav section — see
 * governance/DESIGN_SYSTEM.md "Section Accent Colors" for the full mapping,
 * rationale, and live-verification evidence. All seven values are drawn from
 * the warm nonprofit brand palette (forest green / gold / terracotta / warm
 * neutrals) that superseded the prior blue-logo palette on 2026-09-02.
 *
 * The shared sidebar/header shell never changes — it stays the dark-forest
 * (#2C4E3B) rail everywhere. Only a page's own PageHeader accent, key
 * stat/metric cards, and primary visual elements should be colored from this
 * map.
 *
 * Keys/routes match the 6 top-level NAV_ITEMS sections in nav-items.ts
 * (Dashboard, Prospects & Analysis, Opportunities, Applications, Engagement,
 * Resources) plus Settings/Platform admin as a 7th group.
 */
export const SECTION_ACCENTS = {
  dashboard: "#3D6B50", // forest green — Dashboard / Home
  prospects: "#C49A4F", // gold — Prospects & Analysis
  opportunities: "#B85C3C", // terracotta — Opportunities
  applications: "#7A8B5C", // sage/olive — Applications
  engagement: "#8B5E3C", // warm umber — Engagement
  resources: "#2C4E3B", // deep forest — Resources
  admin: "#A4712C", // bronze — Admin & Settings
} as const;

export type SectionKey = keyof typeof SECTION_ACCENTS;

/**
 * Route-prefix → section. Order matters — first match wins, so more
 * specific prefixes are listed before shorter/overlapping ones. Mirrors the
 * grouping in nav-items.ts's NAV_ITEMS/SETTINGS_NAV_ITEM/PLATFORM_NAV_ITEMS.
 */
const ROUTE_SECTIONS: Array<[prefix: string, section: SectionKey]> = [
  // Dashboard / Home
  ["/dashboard", "dashboard"],
  ["/activity", "dashboard"],
  ["/intelligence/strategic-advisor", "dashboard"],

  // Prospects & Analysis
  ["/intelligence/pil", "prospects"],
  ["/intelligence/donor-intent", "prospects"],
  ["/intelligence/community-need", "prospects"],
  ["/intelligence/disaster", "prospects"],

  // Opportunities
  ["/opportunities", "opportunities"],
  ["/intelligence/match-feed", "opportunities"],
  ["/intelligence/matches", "opportunities"],
  ["/intelligence/competitors", "opportunities"],
  ["/foundations", "opportunities"],
  ["/funders", "opportunities"],

  // Applications
  ["/draft-generator", "applications"],
  ["/autoapply", "applications"],
  ["/applications", "applications"],
  ["/intelligence/gap-analysis", "applications"],
  ["/documents", "applications"],
  ["/deadlines", "applications"],

  // Engagement
  ["/email", "engagement"],
  ["/outreach", "engagement"],
  ["/contacts", "engagement"],
  ["/intelligence/recommendations", "engagement"],
  ["/intelligence/reputation", "engagement"],
  ["/intelligence/relationship-graph", "engagement"],
  ["/marketplace", "engagement"],

  // Resources
  ["/knowledge-base", "resources"],
  ["/intelligence/twin", "resources"],
  ["/intelligence/knowledge", "resources"],
  ["/nonprofits", "resources"],

  // Admin & Settings
  ["/settings", "admin"],
  ["/compliance", "admin"],
  ["/financials", "admin"],
  ["/reports", "admin"],
  ["/outcomes", "admin"],
  ["/alerts", "admin"],
  ["/admin", "admin"],
  ["/command-center", "admin"],
  ["/import", "admin"],
];

/** Resolves a pathname to its logical section, defaulting to Dashboard/Home. */
export function sectionForPath(pathname: string): SectionKey {
  const match = ROUTE_SECTIONS.find(([prefix]) => pathname.startsWith(prefix));
  return match ? match[1] : "dashboard";
}

/** Resolves a pathname directly to its section's signature accent hex. */
export function sectionAccent(pathname: string): string {
  return SECTION_ACCENTS[sectionForPath(pathname)];
}
