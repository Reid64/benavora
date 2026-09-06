// Funding Potential Scan intake form (/scan). Shared between the client
// form (ScanClient.tsx) and the submission route (api/public/scan) so the
// two never drift on what a valid `state` or `fundingPriority` value is.

export const SCAN_US_STATES = [
  { abbr: "AL", name: "Alabama" },
  { abbr: "AK", name: "Alaska" },
  { abbr: "AZ", name: "Arizona" },
  { abbr: "AR", name: "Arkansas" },
  { abbr: "CA", name: "California" },
  { abbr: "CO", name: "Colorado" },
  { abbr: "CT", name: "Connecticut" },
  { abbr: "DE", name: "Delaware" },
  { abbr: "DC", name: "District of Columbia" },
  { abbr: "FL", name: "Florida" },
  { abbr: "GA", name: "Georgia" },
  { abbr: "HI", name: "Hawaii" },
  { abbr: "ID", name: "Idaho" },
  { abbr: "IL", name: "Illinois" },
  { abbr: "IN", name: "Indiana" },
  { abbr: "IA", name: "Iowa" },
  { abbr: "KS", name: "Kansas" },
  { abbr: "KY", name: "Kentucky" },
  { abbr: "LA", name: "Louisiana" },
  { abbr: "ME", name: "Maine" },
  { abbr: "MD", name: "Maryland" },
  { abbr: "MA", name: "Massachusetts" },
  { abbr: "MI", name: "Michigan" },
  { abbr: "MN", name: "Minnesota" },
  { abbr: "MS", name: "Mississippi" },
  { abbr: "MO", name: "Missouri" },
  { abbr: "MT", name: "Montana" },
  { abbr: "NE", name: "Nebraska" },
  { abbr: "NV", name: "Nevada" },
  { abbr: "NH", name: "New Hampshire" },
  { abbr: "NJ", name: "New Jersey" },
  { abbr: "NM", name: "New Mexico" },
  { abbr: "NY", name: "New York" },
  { abbr: "NC", name: "North Carolina" },
  { abbr: "ND", name: "North Dakota" },
  { abbr: "OH", name: "Ohio" },
  { abbr: "OK", name: "Oklahoma" },
  { abbr: "OR", name: "Oregon" },
  { abbr: "PA", name: "Pennsylvania" },
  { abbr: "RI", name: "Rhode Island" },
  { abbr: "SC", name: "South Carolina" },
  { abbr: "SD", name: "South Dakota" },
  { abbr: "TN", name: "Tennessee" },
  { abbr: "TX", name: "Texas" },
  { abbr: "UT", name: "Utah" },
  { abbr: "VT", name: "Vermont" },
  { abbr: "VA", name: "Virginia" },
  { abbr: "WA", name: "Washington" },
  { abbr: "WV", name: "West Virginia" },
  { abbr: "WI", name: "Wisconsin" },
  { abbr: "WY", name: "Wyoming" },
] as const;

export type ScanStateAbbr = (typeof SCAN_US_STATES)[number]["abbr"];

export const SCAN_STATE_ABBREVIATIONS: readonly string[] = SCAN_US_STATES.map((s) => s.abbr);

// Deliberately independent of FUNDER_CATEGORIES (src/lib/utils/constants.ts),
// which classifies funder/opportunity types, not what a nonprofit visitor is
// currently trying to fund. Kept small per the intake form's minimal-friction
// requirement; not tied to any scoring logic (a later sub-prompt).
export const SCAN_FUNDING_PRIORITIES = [
  { value: "general_operating", label: "General operating support" },
  { value: "program_or_project", label: "A specific program or project" },
  { value: "capital_campaign", label: "Capital campaign / facilities" },
  { value: "emergency_response", label: "Emergency or disaster response" },
  { value: "capacity_building", label: "Capacity building / staffing" },
  { value: "other", label: "Other" },
] as const;

export type ScanFundingPriority = (typeof SCAN_FUNDING_PRIORITIES)[number]["value"];

export const SCAN_FUNDING_PRIORITY_VALUES: readonly string[] = SCAN_FUNDING_PRIORITIES.map(
  (p) => p.value,
);

// Post-report email capture (ScanEmailCapture.tsx / api/public/scan/capture).
// Shared between client and server so the two never drift on a valid `action`
// value. "strategist_review" is deliberately excluded here - it's a plain
// link to /demo, not a captured action with a stored row (see
// ScanEmailCapture.tsx for why no email is required for that option).
export const SCAN_REPORT_ACTIONS = [
  { value: "email_report", label: "Email me the complete report" },
  { value: "save_profile", label: "Save my funding profile" },
  { value: "share_board", label: "Share it with my board" },
] as const;

export type ScanReportAction = (typeof SCAN_REPORT_ACTIONS)[number]["value"];

export const SCAN_REPORT_ACTION_VALUES: readonly string[] = SCAN_REPORT_ACTIONS.map(
  (a) => a.value,
);

// Type-only import - erased at compile time, so this does not create a
// runtime circular dependency with scoring-engine.ts (which imports real
// values from this file). Kept here, not in ScanReport.tsx, so the capture
// API route can build report-recap email copy without importing a .tsx
// component file into a server route.
import type { FundingPotentialTier } from "@/lib/scan/scoring-engine";

export const SCAN_TIER_COPY: Record<FundingPotentialTier, { label: string; blurb: string; color: string }> = {
  strong: {
    label: "Strong",
    blurb: "Your mission lines up with a well-populated slice of tracked funding opportunities.",
    color: "#1F3A2E",
  },
  moderate: {
    label: "Moderate",
    blurb: "There's a real, if narrower, base of tracked opportunities that match your profile.",
    color: "#8FA68E",
  },
  emerging: {
    label: "Emerging",
    blurb: "Early signal exists, but there isn't yet enough tracked data to call this a confident match.",
    color: "#B85A2E",
  },
  early_stage: {
    label: "Early Stage",
    blurb: "We don't have enough tracked, relevant opportunities yet to score this with confidence.",
    color: "#6F6F69",
  },
};
