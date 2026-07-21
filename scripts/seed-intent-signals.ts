// Seeds corporate_intent_signals (migration 093_donor_intent_engine.sql) with
// 15 realistic test signals for Faith Foundation so the Corporate Intent
// Signals page (/donor-discovery/intent-signals) has real data to render
// immediately, without waiting on DonorIntentMonitorAgent's live web-search
// pipeline (which additionally needs corporate_prospects - a table that does
// not exist in production as of 2026-07-20, see donor-intent-monitor-agent.ts
// loadProspects()).
//
// FF_ORG_ID is the live "FAITH Foundation" organization actually used by
// reid@repvg.com / reid@benavora.com (both profiles point here). A second,
// unrelated "FAITH Foundation" row exists (info@faithfoundationsf.com,
// org b1ab7402-dfc2-4712-869f-70ea3566cc1d, the id hardcoded in
// BLUEPRINT_v2.md section 1) - confirmed via direct query 2026-07-20 that
// b1ab7402 is not the org Reid's own login is attached to. Seeding there
// would populate an org nobody actually views.
//
// signal_url is left null for every row: these are illustrative examples,
// not real search results, and inventing a plausible-looking source URL for
// a synthetic signal would misrepresent it as verified evidence.

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { addDays, subDays } from "date-fns";

dotenv.config({ path: ".env.local" });

const FF_ORG_ID = "bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";

type SignalType =
  | "press_release"
  | "esg_report"
  | "sec_filing"
  | "hiring_trend"
  | "facility_expansion"
  | "disaster_declaration"
  | "foundation_appointment"
  | "csr_announcement"
  | "executive_interview";

interface SeedSignal {
  company_name: string;
  signal_type: SignalType;
  signal_summary: string;
  intent_score: number;
  geographic_relevance: number;
  mission_alignment: number;
  recommended_action: string;
  deadlineDays: number;
  signalDaysAgo: number;
}

const SIGNALS: SeedSignal[] = [
  {
    company_name: "Bank of America",
    signal_type: "press_release",
    signal_summary:
      "Bank of America announces $1B Community Homeownership Commitment -- press release signal.",
    intent_score: 85,
    geographic_relevance: 88,
    mission_alignment: 90,
    recommended_action:
      "Reference the $1B Community Homeownership Commitment directly and request a down-payment-assistance partnership meeting for Faith Foundation's transitional-housing program.",
    deadlineDays: 21,
    signalDaysAgo: 9,
  },
  {
    company_name: "Wells Fargo",
    signal_type: "csr_announcement",
    signal_summary: "Wells Fargo Foundation expands Neighborhood LIFT program to Bay Area.",
    intent_score: 88,
    geographic_relevance: 90,
    mission_alignment: 88,
    recommended_action:
      "Submit a Neighborhood LIFT partnership inquiry citing Faith Foundation's down-payment-assistance and homeownership programs.",
    deadlineDays: 18,
    signalDaysAgo: 6,
  },
  {
    company_name: "Google.org",
    signal_type: "csr_announcement",
    signal_summary: "Google.org $50M commitment to housing and homelessness solutions.",
    intent_score: 82,
    geographic_relevance: 85,
    mission_alignment: 85,
    recommended_action:
      "Respond to the $50M housing/homelessness commitment with an aligned funding request for emergency and transitional housing services.",
    deadlineDays: 30,
    signalDaysAgo: 12,
  },
  {
    company_name: "Walmart Foundation",
    signal_type: "csr_announcement",
    signal_summary: "Walmart Foundation new Community grant cycle opens for housing nonprofits.",
    intent_score: 79,
    geographic_relevance: 86,
    mission_alignment: 80,
    recommended_action:
      "Apply within the new Community grant cycle window, highlighting housing-nonprofit eligibility criteria.",
    deadlineDays: 35,
    signalDaysAgo: 5,
  },
  {
    company_name: "Home Depot Foundation",
    signal_type: "csr_announcement",
    signal_summary: "Home Depot Foundation 2024 Community Impact Grants accepting applications.",
    intent_score: 90,
    geographic_relevance: 87,
    mission_alignment: 82,
    recommended_action:
      "Submit a Community Impact Grants application referencing transitional-housing facility needs before the acceptance window closes.",
    deadlineDays: 14,
    signalDaysAgo: 3,
  },
  {
    company_name: "JPMorgan Chase",
    signal_type: "press_release",
    signal_summary:
      "JPMorgan Chase announces $30B Racial Equity Commitment including housing.",
    intent_score: 83,
    geographic_relevance: 84,
    mission_alignment: 87,
    recommended_action:
      "Cite the housing component of the $30B Racial Equity Commitment directly in an outreach request tied to affordable-homeownership outcomes.",
    deadlineDays: 28,
    signalDaysAgo: 15,
  },
  {
    company_name: "Salesforce",
    signal_type: "csr_announcement",
    signal_summary: "Salesforce Gives Back -- new nonprofit grant program for Bay Area.",
    intent_score: 76,
    geographic_relevance: 91,
    mission_alignment: 73,
    recommended_action:
      "Apply to the new Bay Area nonprofit grant program, emphasizing measurable housing-stability outcomes.",
    deadlineDays: 40,
    signalDaysAgo: 7,
  },
  {
    company_name: "Chevron",
    signal_type: "csr_announcement",
    signal_summary: "Chevron Humankind announces community investment grants in California.",
    intent_score: 71,
    geographic_relevance: 80,
    mission_alignment: 70,
    recommended_action:
      "Submit a Chevron Humankind community investment application scoped to local service-area housing needs.",
    deadlineDays: 42,
    signalDaysAgo: 18,
  },
  {
    company_name: "Kaiser Permanente",
    signal_type: "csr_announcement",
    signal_summary: "Kaiser Foundation announces social determinants of health grants.",
    intent_score: 78,
    geographic_relevance: 85,
    mission_alignment: 84,
    recommended_action:
      "Position stable housing as a social determinant of health in a grant inquiry to the Kaiser Foundation program.",
    deadlineDays: 25,
    signalDaysAgo: 10,
  },
  {
    company_name: "Pacific Gas & Electric",
    signal_type: "csr_announcement",
    signal_summary: "PG&E Foundation community grants for Bay Area nonprofits.",
    intent_score: 72,
    geographic_relevance: 89,
    mission_alignment: 71,
    recommended_action:
      "Apply for PG&E Foundation community grant funding, noting facility utility-cost relief for transitional-housing residents.",
    deadlineDays: 33,
    signalDaysAgo: 14,
  },
  {
    company_name: "Comcast NBCUniversal",
    signal_type: "csr_announcement",
    signal_summary: "Comcast Foundation community impact grants open.",
    intent_score: 68,
    geographic_relevance: 82,
    mission_alignment: 72,
    recommended_action:
      "Submit a community impact grant application referencing digital-access needs of housing program participants.",
    deadlineDays: 38,
    signalDaysAgo: 20,
  },
  {
    company_name: "Levi Strauss Foundation",
    signal_type: "csr_announcement",
    signal_summary: "Levi Strauss Foundation announces workforce development grants.",
    intent_score: 74,
    geographic_relevance: 83,
    mission_alignment: 76,
    recommended_action:
      "Apply for workforce-development grant funding tied to job-readiness services for housing program participants.",
    deadlineDays: 27,
    signalDaysAgo: 8,
  },
  {
    company_name: "Gap Inc",
    signal_type: "csr_announcement",
    signal_summary: "Gap Foundation community investment program SF Bay Area.",
    intent_score: 70,
    geographic_relevance: 88,
    mission_alignment: 70,
    recommended_action:
      "Submit a Gap Foundation community investment inquiry scoped to Bay Area service areas.",
    deadlineDays: 44,
    signalDaysAgo: 22,
  },
  {
    company_name: "Salesforce.org",
    signal_type: "csr_announcement",
    signal_summary: "Salesforce.org Power of Us Hub grants for nonprofits.",
    intent_score: 77,
    geographic_relevance: 90,
    mission_alignment: 75,
    recommended_action:
      "Apply through the Power of Us Hub for nonprofit technology/grant funding to support case-management capacity.",
    deadlineDays: 31,
    signalDaysAgo: 11,
  },
  {
    company_name: "Charles Schwab Foundation",
    signal_type: "csr_announcement",
    signal_summary: "Charles Schwab Foundation financial empowerment grants 2024.",
    intent_score: 73,
    geographic_relevance: 81,
    mission_alignment: 79,
    recommended_action:
      "Apply for financial-empowerment grant funding tied to down-payment-assistance and financial-literacy programming.",
    deadlineDays: 36,
    signalDaysAgo: 16,
  },
];

const HIGH_INTENT_THRESHOLD = 80;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).");
  }
  const supabase = createClient(url, key);

  const now = new Date();
  const rows = SIGNALS.map((s) => ({
    org_id: FF_ORG_ID,
    company_name: s.company_name,
    signal_type: s.signal_type,
    signal_summary: s.signal_summary,
    signal_url: null,
    signal_date: subDays(now, s.signalDaysAgo).toISOString().slice(0, 10),
    intent_score: s.intent_score,
    geographic_relevance: s.geographic_relevance,
    mission_alignment: s.mission_alignment,
    recommended_action: s.recommended_action,
    recommended_deadline: addDays(now, s.deadlineDays).toISOString().slice(0, 10),
  }));

  const { data, error } = await supabase
    .from("corporate_intent_signals")
    .insert(rows)
    .select("id, company_name, intent_score");

  if (error) {
    console.error("Seed insert failed:", error.message);
    process.exit(1);
  }

  const inserted = data ?? [];
  const highIntent = inserted.filter(
    (r) => (r as { intent_score: number }).intent_score >= HIGH_INTENT_THRESHOLD,
  );
  console.log(`Inserted ${inserted.length} intent signals for org ${FF_ORG_ID}.`);
  console.log(`High-intent (>=${HIGH_INTENT_THRESHOLD}): ${highIntent.length}`);
  for (const row of inserted) {
    const r = row as { id: string; company_name: string; intent_score: number };
    console.log(`  ${r.intent_score.toString().padStart(3)}  ${r.company_name}  (${r.id})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
