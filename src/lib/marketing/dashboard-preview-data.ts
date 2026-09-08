// Entirely hardcoded, fictional demo content for the marketing "Interactive
// Preview" widget (src/components/marketing/DashboardPreview.tsx). Every
// value below is a literal defined in this file — nothing here is fetched,
// queried, or derived from a database row, API response, or session.
//
// Do NOT import a Supabase client, `fetch`, or the generated `Tables<...>`
// database types into this module. Types are intentionally re-declared
// locally (not imported from "@/types/database") so this file can never be
// refactored into reading a live `opportunities` row by accident — it has no
// structural connection to the real schema, only a visual one.
//
// A prior incident let a real internal test organization's name leak into a
// public marketing screenshot. This dataset exists so the interactive
// preview can never repeat that: every name, funder, and figure here is
// fictional and was authored for this preview only.

export type DemoSourceBucket = "federal" | "foundation" | "corporate" | "state";

export interface DemoProbabilityFactor {
  name: string;
  label: string;
  weight: number;
  value: number;
}

export interface DemoProbability {
  recommendation: "apply" | "consider" | "skip";
  confidence: "high" | "medium" | "low";
  estimatedRoi: string;
  timeToComplete: string;
  factors: DemoProbabilityFactor[];
  keyRisks: string[];
  keyStrengths: string[];
}

export interface DemoOpportunity {
  id: string;
  name: string;
  funderName: string;
  sourceBucket: DemoSourceBucket;
  amount: number;
  deadlineInDays: number;
  matchPercentage: number;
  probability: DemoProbability;
}

/** Fictional demo organization name — deliberately generic, not a real client. */
export const DEMO_ORG_NAME = "Riverbend Youth Alliance";

export const DEMO_DISCLAIMER =
  "Interactive demo — every organization, funder, and figure below is fictional sample data seeded for this preview. No real client account or data is shown.";

export const SOURCE_BUCKET_LABEL: Record<DemoSourceBucket, string> = {
  federal: "Federal",
  foundation: "Foundation",
  corporate: "Corporate",
  state: "State/Local",
};

export const SOURCE_BUCKET_ACCENT: Record<DemoSourceBucket, string> = {
  federal: "#3D6B50",
  foundation: "#B85C3C",
  corporate: "#0EA5E9",
  state: "#10B981",
};

export const DEMO_OPPORTUNITIES: DemoOpportunity[] = [
  {
    id: "demo-1",
    name: "Youth Mentorship Capacity Grant",
    funderName: "Meridian Family Foundation (sample funder)",
    sourceBucket: "foundation",
    amount: 75000,
    deadlineInDays: 18,
    matchPercentage: 88,
    probability: {
      recommendation: "apply",
      confidence: "high",
      estimatedRoi: "18.5x",
      timeToComplete: "4-6 hrs",
      factors: [
        { name: "eligibility_score", label: "Eligibility Fit", weight: 0.35, value: 0.94 },
        { name: "category_win_rate", label: "Category Win Rate", weight: 0.25, value: 0.7 },
        { name: "deadline_proximity", label: "Deadline Proximity", weight: 0.2, value: 0.55 },
        { name: "twin_completeness", label: "Organization Profile Completeness", weight: 0.2, value: 0.91 },
      ],
      keyRisks: ["Funder favors multi-year track record over first-time applicants."],
      keyStrengths: ["Mission alignment is a near-exact match.", "Prior similar awards in this category."],
    },
  },
  {
    id: "demo-2",
    name: "National Youth Opportunity Grant (sample program)",
    funderName: "Sample Federal Youth Services Program",
    sourceBucket: "federal",
    amount: 150000,
    deadlineInDays: 45,
    matchPercentage: 61,
    probability: {
      recommendation: "consider",
      confidence: "medium",
      estimatedRoi: "9.2x",
      timeToComplete: "10-14 hrs",
      factors: [
        { name: "eligibility_score", label: "Eligibility Fit", weight: 0.35, value: 0.68 },
        { name: "category_win_rate", label: "Category Win Rate", weight: 0.25, value: 0.42 },
        { name: "deadline_proximity", label: "Deadline Proximity", weight: 0.2, value: 0.8 },
        { name: "twin_completeness", label: "Organization Profile Completeness", weight: 0.2, value: 0.91 },
      ],
      keyRisks: ["Federal category has heavy competition.", "Requires a detailed logic model attachment."],
      keyStrengths: ["Ample time before deadline to prepare a strong application."],
    },
  },
  {
    id: "demo-3",
    name: "Community Impact Sponsorship (sample)",
    funderName: "Cascade Corporate Giving Initiative (sample funder)",
    sourceBucket: "corporate",
    amount: 25000,
    deadlineInDays: 5,
    matchPercentage: 74,
    probability: {
      recommendation: "apply",
      confidence: "high",
      estimatedRoi: "22.1x",
      timeToComplete: "2-3 hrs",
      factors: [
        { name: "eligibility_score", label: "Eligibility Fit", weight: 0.35, value: 0.82 },
        { name: "category_win_rate", label: "Category Win Rate", weight: 0.25, value: 0.65 },
        { name: "deadline_proximity", label: "Deadline Proximity", weight: 0.2, value: 0.2 },
        { name: "twin_completeness", label: "Organization Profile Completeness", weight: 0.2, value: 0.91 },
      ],
      keyRisks: ["Closes in 5 days — fast turnaround required."],
      keyStrengths: ["Short, lightweight application.", "Local funder with existing relationship."],
    },
  },
  {
    id: "demo-4",
    name: "Community Foundation General Operating Grant (sample)",
    funderName: "Pacific Sample Community Foundation",
    sourceBucket: "foundation",
    amount: 40000,
    deadlineInDays: 30,
    matchPercentage: 55,
    probability: {
      recommendation: "consider",
      confidence: "medium",
      estimatedRoi: "11.4x",
      timeToComplete: "5-7 hrs",
      factors: [
        { name: "eligibility_score", label: "Eligibility Fit", weight: 0.35, value: 0.6 },
        { name: "category_win_rate", label: "Category Win Rate", weight: 0.25, value: 0.5 },
        { name: "deadline_proximity", label: "Deadline Proximity", weight: 0.2, value: 0.6 },
        { name: "twin_completeness", label: "Organization Profile Completeness", weight: 0.2, value: 0.91 },
      ],
      keyRisks: ["General operating funds are more competitive than program-specific asks."],
      keyStrengths: ["Geographic service area matches funder's giving region."],
    },
  },
  {
    id: "demo-5",
    name: "Arts & Culture Access Grant (sample)",
    funderName: "Willow Sample State Arts Council",
    sourceBucket: "state",
    amount: 18500,
    deadlineInDays: 60,
    matchPercentage: 39,
    probability: {
      recommendation: "skip",
      confidence: "low",
      estimatedRoi: "3.1x",
      timeToComplete: "6-8 hrs",
      factors: [
        { name: "eligibility_score", label: "Eligibility Fit", weight: 0.35, value: 0.3 },
        { name: "category_win_rate", label: "Category Win Rate", weight: 0.25, value: 0.35 },
        { name: "deadline_proximity", label: "Deadline Proximity", weight: 0.2, value: 0.9 },
        { name: "twin_completeness", label: "Organization Profile Completeness", weight: 0.2, value: 0.91 },
      ],
      keyRisks: ["Arts-focused funder; weak fit with youth-services mission."],
      keyStrengths: ["Plenty of runway before the deadline."],
    },
  },
];
