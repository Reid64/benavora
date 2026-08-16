/**
 * Signature accent color per logical nav section — see
 * governance/DESIGN_SYSTEM.md "Section Accent Colors" for the full mapping,
 * rationale, and live-verification evidence. All six values are drawn from
 * the real brand palette (tailwind.config.ts `theme.extend.colors.brand`) —
 * nothing here is a new color.
 *
 * The shared sidebar/header shell never changes — it stays the deep-blue
 * gradient everywhere. Only a page's own PageHeader accent, key stat/metric
 * cards, and primary visual elements should be colored from this map.
 */
export const SECTION_ACCENTS = {
  dashboard: "#1D4ED8", // brand.deep — Dashboard/Home
  research: "#0284C7", // brand.sky — Research & Discovery
  pipeline: "#0E7490", // brand.teal — Applications & Pipeline
  intelligence: "#7C3AED", // brand.violet — Intelligence & Reports
  outreach: "#4C51C6", // brand.indigo — Donor Discovery & Outreach
  admin: "#22D3EE", // brand.highlight — Admin & Settings
} as const;

export type SectionKey = keyof typeof SECTION_ACCENTS;

/**
 * Route-prefix → section. Order matters — first match wins, so more
 * specific prefixes are listed before shorter/overlapping ones.
 */
const ROUTE_SECTIONS: Array<[prefix: string, section: SectionKey]> = [
  // Dashboard / Home
  ["/dashboard", "dashboard"],
  ["/alerts", "dashboard"],
  ["/activity", "dashboard"],

  // Research & Discovery
  ["/research", "research"],
  ["/opportunities", "research"],
  ["/foundations", "research"],
  ["/nonprofits", "research"],

  // Applications & Pipeline
  ["/applications", "pipeline"],
  ["/autoapply", "pipeline"],
  ["/draft-generator", "pipeline"],
  ["/documents", "pipeline"],
  ["/deadlines", "pipeline"],
  ["/compliance", "pipeline"],
  ["/financials", "pipeline"],
  ["/funders", "pipeline"],
  ["/contacts", "pipeline"],
  ["/renewals", "pipeline"],

  // Intelligence & Reports
  ["/intelligence", "intelligence"],
  ["/reports", "intelligence"],
  ["/outcomes", "intelligence"],
  ["/knowledge-base", "intelligence"],
  ["/intelligence-library", "intelligence"],
  ["/agents", "intelligence"],

  // Donor Discovery & Outreach
  ["/donor-discovery", "outreach"],
  ["/email", "outreach"],
  ["/outreach", "outreach"],
  ["/marketplace", "outreach"],

  // Admin & Settings
  ["/admin", "admin"],
  ["/settings", "admin"],
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
