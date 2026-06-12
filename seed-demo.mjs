// ============================================================================
// BENAVORA — Demo data seed
//
// Provisions a single, self-contained, CLEARLY-FAKE demo organization
// ("Hope Harbor Community Services") with realistic funding-pipeline data so
// the app can be demoed end-to-end without touching real tenant data.
//
// Seeds: organization, funders + contacts, opportunities (+ keywords),
// applications across pipeline stages (+ pipeline_history + deadlines),
// knowledge_base entries, 3 outcomes (2 awarded, 1 denied), proven_narratives,
// board_members, programs, and 5 document metadata rows.
//
// Idempotent: every run first wipes the demo org's rows (FK-safe order) and the
// org itself, then re-inserts from scratch. The fixed DEMO_ORG_ID makes this
// safe to re-run; it never touches any other organization's data.
//
// Uses the Supabase SERVICE-ROLE client (bypasses RLS) — this is a one-off
// developer/ops script run from the CLI, NOT user-facing code. Mirrors the
// env-loading style of probe.mjs.
//
//   pnpm seed-demo
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ----------------------------------------------------------------------------
// Env (manual .env.local parse — same approach as probe.mjs)
// ----------------------------------------------------------------------------
const raw = readFileSync(".env.local", "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const db = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
const DEMO_ORG_ID = "d3300000-0000-4000-a000-000000000001"; // fixed → idempotent

const DAY = 86_400_000;
const now = new Date();
/** ISO timestamp `n` days from today (negative = past). */
const ts = (n) => new Date(now.getTime() + n * DAY).toISOString();
/** YYYY-MM-DD date `n` days from today. */
const day = (n) => ts(n).slice(0, 10);

let stepNo = 0;
async function insert(table, rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const { error } = await db.from(table).insert(list);
  if (error) {
    console.error(`\n  ✗ insert ${table} failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`  ${String(++stepNo).padStart(2, "0")}. ${table.padEnd(20)} +${list.length}`);
}

// ----------------------------------------------------------------------------
// 1. Wipe any prior demo data (children → parents), then the org itself.
//    Scoped strictly to DEMO_ORG_ID so real tenants are never affected.
// ----------------------------------------------------------------------------
async function wipe() {
  console.log(`Wiping prior demo data for org ${DEMO_ORG_ID} ...`);

  // Tables that reference applications/outcomes/opportunities and do NOT all
  // cascade — delete explicitly in dependency order, scoped by org.
  const orgScoped = [
    "proven_narratives", // → outcomes, knowledge_base
    "outcomes", // → applications (no cascade)
    "pipeline_history", // → applications (cascades, but explicit is fine)
    "deadlines", // → applications / opportunities
    "notes", // → funders / opportunities / applications
    "applications", // → opportunities
    "opportunity_keywords", // → opportunities
    "opportunities", // → funders
    "contacts", // → funders
    "documents",
    "knowledge_base",
    "board_members",
    "programs",
    "funders",
    "platform_config", // seeded by trigger on org insert
  ];
  for (const t of orgScoped) {
    const { error } = await db.from(t).delete().eq("organization_id", DEMO_ORG_ID);
    if (error) {
      console.error(`  ✗ wipe ${t} failed: ${error.message}`);
      process.exit(1);
    }
  }

  // application_documents has no organization_id; it cascades when its parent
  // application/document is deleted above, so nothing more to do here.

  const { error } = await db.from("organizations").delete().eq("id", DEMO_ORG_ID);
  if (error) {
    console.error(`  ✗ wipe organizations failed: ${error.message}`);
    process.exit(1);
  }
  console.log("  done.\n");
}

// ----------------------------------------------------------------------------
// 2. Seed
// ----------------------------------------------------------------------------
async function seed() {
  console.log("Seeding demo data ...");

  // --- organization (insert fires trg_seed_platform_config) ---------------
  await insert("organizations", {
    id: DEMO_ORG_ID,
    name: "Hope Harbor Community Services",
    dba: "Hope Harbor",
    ein: "88-1234567",
    tax_status: "501(c)(3)",
    mission_statement:
      "Hope Harbor Community Services helps families in the Riverside Valley move from housing instability to lasting self-sufficiency through emergency assistance, financial coaching, and affordable-housing navigation. [DEMO DATA]",
    vision_statement:
      "A Riverside Valley where every family has a safe, stable, and affordable place to call home.",
    founding_date: "2012-03-15",
    founder_name: "Maria Delgado",
    founder_bio:
      "Maria Delgado founded Hope Harbor after a decade as a housing case manager, determined to close the gap between crisis aid and long-term stability.",
    service_area: "Riverside Valley (Riverside, Eastgate, and Millbrook counties)",
    target_population:
      "Low- and moderate-income families with children at risk of housing instability",
    annual_budget: 1_850_000,
    total_staff: 14,
    total_volunteers: 86,
    website: "https://www.hopeharbor.example.org",
    phone: "(555) 213-7700",
    email: "info@hopeharbor.example.org",
    address_line1: "240 Harborview Avenue",
    address_line2: "Suite 105",
    city: "Riverside",
    state: "CA",
    zip: "92501",
    subscription_tier: "free",
  });

  // --- funders -------------------------------------------------------------
  const funders = {
    brightwater: randomUUID(),
    cornerstone: randomUUID(),
    stateHousing: randomUUID(),
    unitedWay: randomUUID(),
    faithAlliance: randomUUID(),
  };
  await insert("funders", [
    {
      id: funders.brightwater,
      organization_id: DEMO_ORG_ID,
      name: "The Brightwater Foundation",
      category: "private_foundation",
      description:
        "Regional private foundation funding housing stability and family economic mobility across Southern California. [DEMO]",
      website: "https://www.brightwaterfdn.example.org",
      giving_portal_url: "https://grants.brightwaterfdn.example.org",
      portal_login_status: "active",
      annual_giving_budget: 12_000_000,
      geographic_focus: "Southern California",
      preferred_application_method: "online_portal",
      has_giving_page: true,
      notes: "Strong fit for our housing navigation program. Prefers LOI first.",
      last_contacted_at: ts(-21),
    },
    {
      id: funders.cornerstone,
      organization_id: DEMO_ORG_ID,
      name: "Cornerstone Bank Community Fund",
      category: "corporate_foundation",
      description:
        "Corporate giving arm of Cornerstone Bank, focused on financial literacy and affordable housing. [DEMO]",
      website: "https://www.cornerstonebank.example.com/community",
      giving_portal_url: "https://cornerstonebank.example.com/community/apply",
      portal_login_status: "registered",
      annual_giving_budget: 4_500_000,
      geographic_focus: "Bank service footprint (CA, NV, AZ)",
      preferred_application_method: "online_portal",
      has_giving_page: true,
      notes: "CRA-driven giving. Quarterly review cycle.",
      last_contacted_at: ts(-9),
    },
    {
      id: funders.stateHousing,
      organization_id: DEMO_ORG_ID,
      name: "State Office of Housing & Community Development",
      category: "government_grant",
      description:
        "State agency administering homelessness-prevention and rapid-rehousing block grants. [DEMO]",
      website: "https://hcd.example.gov",
      giving_portal_url: "https://grants.hcd.example.gov",
      portal_login_status: "active",
      annual_giving_budget: 85_000_000,
      geographic_focus: "Statewide",
      preferred_application_method: "state_grant_portal",
      has_giving_page: true,
      notes: "Heavy compliance/reporting. Annual NOFA each spring.",
      last_contacted_at: ts(-40),
    },
    {
      id: funders.unitedWay,
      organization_id: DEMO_ORG_ID,
      name: "Riverside United Way",
      category: "local_community_grant",
      description:
        "Local United Way chapter funding basic-needs and self-sufficiency programs in the Riverside Valley. [DEMO]",
      website: "https://www.riversideunitedway.example.org",
      giving_portal_url: "https://riversideunitedway.example.org/community-grants",
      portal_login_status: "active",
      annual_giving_budget: 2_200_000,
      geographic_focus: "Riverside Valley",
      preferred_application_method: "online_portal",
      has_giving_page: true,
      notes: "Long-standing community partner. Site visit usually required.",
      last_contacted_at: ts(-5),
    },
    {
      id: funders.faithAlliance,
      organization_id: DEMO_ORG_ID,
      name: "Evergreen Faith Alliance",
      category: "faith_compatible_grant",
      description:
        "Interfaith coalition making small mission-aligned grants for emergency family assistance. [DEMO]",
      website: "https://www.evergreenfaith.example.org",
      portal_login_status: "none",
      annual_giving_budget: 600_000,
      geographic_focus: "Riverside & Eastgate counties",
      preferred_application_method: "email",
      has_giving_page: false,
      notes: "Relationship-based. Apply via program officer email.",
      last_contacted_at: ts(-60),
    },
  ]);

  // --- contacts (one per funder) ------------------------------------------
  await insert("contacts", [
    {
      organization_id: DEMO_ORG_ID,
      funder_id: funders.brightwater,
      name: "Dr. Alicia Romero",
      title: "Senior Program Officer, Housing",
      email: "aromero@brightwaterfdn.example.org",
      phone: "(555) 401-2210",
      preferred_contact_method: "email",
      relationship: "warm",
      last_contacted_at: ts(-21),
      notes: "Met at the regional housing summit. Receptive to a full proposal.",
    },
    {
      organization_id: DEMO_ORG_ID,
      funder_id: funders.cornerstone,
      name: "James Whitfield",
      title: "VP, Community Reinvestment",
      email: "jwhitfield@cornerstonebank.example.com",
      phone: "(555) 778-9043",
      preferred_contact_method: "email",
      relationship: "active",
      last_contacted_at: ts(-9),
      notes: "Champion for our financial coaching curriculum.",
    },
    {
      organization_id: DEMO_ORG_ID,
      funder_id: funders.stateHousing,
      name: "Priya Nair",
      title: "Grants Administrator",
      email: "pnair@hcd.example.gov",
      phone: "(555) 990-1180",
      preferred_contact_method: "phone",
      relationship: "cold",
      last_contacted_at: ts(-40),
      notes: "Best reached re: NOFA compliance questions.",
    },
    {
      organization_id: DEMO_ORG_ID,
      funder_id: funders.unitedWay,
      name: "Tina Brooks",
      title: "Director of Community Impact",
      email: "tbrooks@riversideunitedway.example.org",
      phone: "(555) 332-6671",
      preferred_contact_method: "email",
      relationship: "champion",
      last_contacted_at: ts(-5),
      notes: "Our strongest advocate. Sits on the allocations committee.",
    },
    {
      organization_id: DEMO_ORG_ID,
      funder_id: funders.faithAlliance,
      name: "Rev. Daniel Cho",
      title: "Grants Committee Chair",
      email: "dcho@evergreenfaith.example.org",
      preferred_contact_method: "email",
      relationship: "warm",
      last_contacted_at: ts(-60),
      notes: "Appreciates a brief, mission-forward narrative.",
    },
  ]);

  // --- opportunities -------------------------------------------------------
  const opps = {
    brightwaterHousing: randomUUID(),
    cornerstoneCoaching: randomUUID(),
    stateRapidRehouse: randomUUID(),
    unitedWayBasicNeeds: randomUUID(),
    faithEmergency: randomUUID(),
    brightwaterCapacity: randomUUID(),
  };
  await insert("opportunities", [
    {
      id: opps.brightwaterHousing,
      organization_id: DEMO_ORG_ID,
      funder_id: funders.brightwater,
      name: "Brightwater Housing Stability Initiative 2026",
      category: "private_foundation",
      description:
        "Multi-year grants for organizations preventing family homelessness through navigation and flexible assistance. [DEMO]",
      amount_available: 250_000,
      amount_min: 75_000,
      amount_max: 250_000,
      deadline: ts(45),
      url: "https://grants.brightwaterfdn.example.org/housing-2026",
      eligibility_requirements:
        "501(c)(3); 3+ years operating; serving low-income families in Southern California.",
      required_documents: [
        "IRS determination letter",
        "Audited financials (most recent)",
        "Board roster",
        "Program logic model",
      ],
      application_method: "online_portal",
      recurrence: "annual",
      geographic_restrictions: "Southern California",
      eligibility_score: 92,
      recommendation: "strong_fit",
      recommendation_reasoning:
        "Direct alignment with our housing navigation program; award range matches our ask.",
      status: "applied",
      source: "foundation_research_agent",
      discovered_at: ts(-30),
    },
    {
      id: opps.cornerstoneCoaching,
      organization_id: DEMO_ORG_ID,
      funder_id: funders.cornerstone,
      name: "Cornerstone Financial Empowerment Grant — Q2",
      category: "corporate_foundation",
      description:
        "Grants supporting financial-literacy and coaching programs for underserved households. [DEMO]",
      amount_available: 60_000,
      amount_min: 15_000,
      amount_max: 60_000,
      deadline: ts(20),
      url: "https://cornerstonebank.example.com/community/apply/q2",
      eligibility_requirements:
        "Programs delivering measurable financial-capability outcomes within the bank's footprint.",
      required_documents: [
        "Program budget",
        "Outcomes/impact report",
        "W-9",
      ],
      application_method: "online_portal",
      recurrence: "quarterly",
      geographic_restrictions: "CA, NV, AZ",
      eligibility_score: 88,
      recommendation: "strong_fit",
      recommendation_reasoning:
        "Our financial coaching program maps cleanly to the funder's capability metrics.",
      status: "applied",
      source: "corporate_research_agent",
      discovered_at: ts(-25),
    },
    {
      id: opps.stateRapidRehouse,
      organization_id: DEMO_ORG_ID,
      funder_id: funders.stateHousing,
      name: "State Rapid Re-Housing Block Grant (NOFA 26-04)",
      category: "government_grant",
      description:
        "Formula and competitive funds for rapid re-housing and homelessness prevention. [DEMO]",
      amount_available: 500_000,
      amount_min: 100_000,
      amount_max: 500_000,
      deadline: ts(8),
      url: "https://grants.hcd.example.gov/nofa-26-04",
      eligibility_requirements:
        "Registered state grantee; HMIS participation; match requirement 25%.",
      required_documents: [
        "SAM.gov registration",
        "HMIS data plan",
        "Match commitment letters",
        "Audited financials",
        "Indirect cost rate agreement",
      ],
      application_method: "state_grant_portal",
      recurrence: "annual",
      geographic_restrictions: "Statewide",
      eligibility_score: 74,
      recommendation: "moderate_fit",
      recommendation_reasoning:
        "Strong programmatic fit but heavy compliance burden and a 25% match to secure.",
      status: "open",
      source: "government_research_agent",
      discovered_at: ts(-18),
    },
    {
      id: opps.unitedWayBasicNeeds,
      organization_id: DEMO_ORG_ID,
      funder_id: funders.unitedWay,
      name: "Riverside United Way Basic Needs Grant 2026",
      category: "local_community_grant",
      description:
        "Operating support for emergency assistance and basic-needs programs in the Riverside Valley. [DEMO]",
      amount_available: 40_000,
      amount_min: 10_000,
      amount_max: 40_000,
      deadline: ts(-3),
      url: "https://riversideunitedway.example.org/community-grants/2026",
      eligibility_requirements:
        "Riverside Valley-based nonprofit; member agency preferred.",
      required_documents: ["Program summary", "Budget", "Most recent 990"],
      application_method: "online_portal",
      recurrence: "annual",
      geographic_restrictions: "Riverside Valley",
      eligibility_score: 95,
      recommendation: "strong_fit",
      recommendation_reasoning:
        "Long-standing member agency; near-certain renewal of basic-needs support.",
      status: "applied",
      source: "manual_entry",
      discovered_at: ts(-50),
    },
    {
      id: opps.faithEmergency,
      organization_id: DEMO_ORG_ID,
      funder_id: funders.faithAlliance,
      name: "Evergreen Family Emergency Fund — Spring Cycle",
      category: "faith_compatible_grant",
      description:
        "Small mission-aligned grants for emergency rent and utility assistance. [DEMO]",
      amount_available: 15_000,
      amount_min: 2_500,
      amount_max: 15_000,
      deadline: ts(35),
      url: "https://www.evergreenfaith.example.org/grants",
      eligibility_requirements:
        "Mission-compatible nonprofit serving Riverside or Eastgate counties.",
      required_documents: ["One-page program summary", "Budget"],
      application_method: "email",
      recurrence: "biannual",
      geographic_restrictions: "Riverside & Eastgate counties",
      eligibility_score: 81,
      recommendation: "good_fit",
      recommendation_reasoning:
        "Modest award, simple application, and strong mission alignment.",
      status: "open",
      source: "local_sponsorship_agent",
      discovered_at: ts(-12),
    },
    {
      id: opps.brightwaterCapacity,
      organization_id: DEMO_ORG_ID,
      funder_id: funders.brightwater,
      name: "Brightwater Capacity-Building Mini-Grant",
      category: "private_foundation",
      description:
        "One-time mini-grants for staff training and data-systems improvements. [DEMO]",
      amount_available: 25_000,
      amount_min: 5_000,
      amount_max: 25_000,
      deadline: ts(70),
      url: "https://grants.brightwaterfdn.example.org/capacity",
      eligibility_requirements: "Current or prior Brightwater grantees.",
      required_documents: ["Project plan", "Budget"],
      application_method: "online_portal",
      recurrence: "one_time",
      geographic_restrictions: "Southern California",
      eligibility_score: 69,
      recommendation: "moderate_fit",
      recommendation_reasoning:
        "Useful for our HMIS upgrade, but lower priority than program funding.",
      status: "open",
      source: "foundation_research_agent",
      discovered_at: ts(-6),
    },
  ]);

  // --- opportunity keywords -----------------------------------------------
  await insert("opportunity_keywords", [
    { organization_id: DEMO_ORG_ID, opportunity_id: opps.brightwaterHousing, keyword: "housing stability" },
    { organization_id: DEMO_ORG_ID, opportunity_id: opps.brightwaterHousing, keyword: "homelessness prevention" },
    { organization_id: DEMO_ORG_ID, opportunity_id: opps.cornerstoneCoaching, keyword: "financial literacy" },
    { organization_id: DEMO_ORG_ID, opportunity_id: opps.cornerstoneCoaching, keyword: "economic mobility" },
    { organization_id: DEMO_ORG_ID, opportunity_id: opps.stateRapidRehouse, keyword: "rapid re-housing" },
    { organization_id: DEMO_ORG_ID, opportunity_id: opps.unitedWayBasicNeeds, keyword: "basic needs" },
    { organization_id: DEMO_ORG_ID, opportunity_id: opps.faithEmergency, keyword: "emergency assistance" },
  ]);

  // --- applications (spanning the pipeline) --------------------------------
  // Stages used: drafting, submitted, awarded, denied, reporting_required.
  const apps = {
    brightwaterHousing: randomUUID(), // awarded → outcome
    cornerstoneCoaching: randomUUID(), // reporting_required → outcome (awarded)
    stateRapidRehouse: randomUUID(), // drafting
    unitedWayBasicNeeds: randomUUID(), // denied → outcome
    faithEmergency: randomUUID(), // submitted
  };
  await insert("applications", [
    {
      id: apps.brightwaterHousing,
      organization_id: DEMO_ORG_ID,
      opportunity_id: opps.brightwaterHousing,
      stage: "awarded",
      requested_amount: 200_000,
      submitted_at: ts(-28),
      awarded_amount: 175_000,
      draft_template_type: "full_proposal",
      draft_confidence_score: 86,
      notes: "Awarded at 87.5% of ask. Two-year commitment; year-2 contingent on report.",
    },
    {
      id: apps.cornerstoneCoaching,
      organization_id: DEMO_ORG_ID,
      opportunity_id: opps.cornerstoneCoaching,
      stage: "reporting_required",
      requested_amount: 50_000,
      submitted_at: ts(-90),
      awarded_amount: 50_000,
      draft_template_type: "grant_narrative",
      draft_confidence_score: 90,
      notes: "Funded in full. Q2 impact report due to Cornerstone.",
    },
    {
      id: apps.stateRapidRehouse,
      organization_id: DEMO_ORG_ID,
      opportunity_id: opps.stateRapidRehouse,
      stage: "drafting",
      requested_amount: 350_000,
      draft_template_type: "full_proposal",
      draft_confidence_score: 71,
      draft_content:
        "DRAFT — Hope Harbor requests $350,000 over 18 months to expand rapid re-housing capacity… [DEMO draft excerpt]",
      notes: "Working on match commitment letters before submission.",
    },
    {
      id: apps.unitedWayBasicNeeds,
      organization_id: DEMO_ORG_ID,
      opportunity_id: opps.unitedWayBasicNeeds,
      stage: "denied",
      requested_amount: 35_000,
      submitted_at: ts(-45),
      draft_template_type: "grant_narrative",
      draft_confidence_score: 78,
      notes: "Declined this cycle; encouraged to reapply in fall with refreshed outcomes.",
    },
    {
      id: apps.faithEmergency,
      organization_id: DEMO_ORG_ID,
      opportunity_id: opps.faithEmergency,
      stage: "submitted",
      requested_amount: 12_000,
      submitted_at: ts(-2),
      draft_template_type: "letter_of_inquiry",
      draft_confidence_score: 83,
      notes: "Submitted via program officer email; decision expected within 30 days.",
    },
  ]);

  // --- pipeline history (a few representative transitions) -----------------
  await insert("pipeline_history", [
    { organization_id: DEMO_ORG_ID, application_id: apps.brightwaterHousing, from_stage: "ready_for_review", to_stage: "submitted", notes: "Final assembly approved by ED.", created_at: ts(-28) },
    { organization_id: DEMO_ORG_ID, application_id: apps.brightwaterHousing, from_stage: "submitted", to_stage: "follow_up_due", notes: "Confirmation received from portal.", created_at: ts(-20) },
    { organization_id: DEMO_ORG_ID, application_id: apps.brightwaterHousing, from_stage: "follow_up_due", to_stage: "awarded", notes: "Award letter received: $175,000.", created_at: ts(-7) },
    { organization_id: DEMO_ORG_ID, application_id: apps.cornerstoneCoaching, from_stage: "submitted", to_stage: "awarded", notes: "Funded in full.", created_at: ts(-75) },
    { organization_id: DEMO_ORG_ID, application_id: apps.cornerstoneCoaching, from_stage: "awarded", to_stage: "reporting_required", notes: "Reporting period opened.", created_at: ts(-30) },
    { organization_id: DEMO_ORG_ID, application_id: apps.unitedWayBasicNeeds, from_stage: "submitted", to_stage: "denied", notes: "Declined; reapply in fall cycle.", created_at: ts(-15) },
    { organization_id: DEMO_ORG_ID, application_id: apps.stateRapidRehouse, from_stage: "qualified", to_stage: "drafting", notes: "Assigned to grants team.", created_at: ts(-10) },
  ]);

  // --- deadlines -----------------------------------------------------------
  await insert("deadlines", [
    { organization_id: DEMO_ORG_ID, opportunity_id: opps.stateRapidRehouse, application_id: apps.stateRapidRehouse, deadline_type: "application_deadline", due_date: day(8), title: "State Rapid Re-Housing NOFA submission", description: "Submit via state grant portal; ensure match letters attached." },
    { organization_id: DEMO_ORG_ID, application_id: apps.cornerstoneCoaching, deadline_type: "reporting_deadline", due_date: day(14), title: "Cornerstone Q2 impact report", description: "Outcomes report for the Financial Empowerment Grant." },
    { organization_id: DEMO_ORG_ID, application_id: apps.brightwaterHousing, deadline_type: "reporting_deadline", due_date: day(120), title: "Brightwater year-1 progress report", description: "Required to release year-2 funds." },
    { organization_id: DEMO_ORG_ID, opportunity_id: opps.faithEmergency, deadline_type: "follow_up_date", due_date: day(28), title: "Follow up with Evergreen Faith Alliance", description: "Check decision status if no reply." },
  ]);

  // --- knowledge base ------------------------------------------------------
  const kb = {
    mission: randomUUID(),
    need: randomUUID(),
    impact: randomUUID(),
    capacity: randomUUID(),
    sustainability: randomUUID(),
  };
  await insert("knowledge_base", [
    {
      id: kb.mission,
      organization_id: DEMO_ORG_ID,
      category: "mission",
      title: "Core mission statement",
      content:
        "Hope Harbor Community Services helps Riverside Valley families move from housing instability to lasting self-sufficiency through emergency assistance, financial coaching, and affordable-housing navigation.",
      is_proven: true,
      proven_count: 4,
      funder_categories: ["private_foundation", "local_community_grant", "faith_compatible_grant"],
      keywords: ["mission", "housing stability", "self-sufficiency"],
      version: 2,
    },
    {
      id: kb.need,
      organization_id: DEMO_ORG_ID,
      category: "need_statement",
      title: "Housing instability in the Riverside Valley",
      content:
        "1 in 6 Riverside Valley families with children spends more than half its income on rent, leaving them one emergency away from eviction. Local shelters turn away families weekly for lack of capacity.",
      is_proven: true,
      proven_count: 3,
      funder_categories: ["private_foundation", "government_grant"],
      keywords: ["need", "rent burden", "eviction", "homelessness prevention"],
      version: 1,
    },
    {
      id: kb.impact,
      organization_id: DEMO_ORG_ID,
      category: "impact",
      title: "Housing stability outcomes",
      content:
        "Of families completing our housing navigation program, 84% remained stably housed 12 months later and 71% increased their monthly income through coaching and benefits enrollment.",
      is_proven: true,
      proven_count: 5,
      funder_categories: ["private_foundation", "corporate_foundation", "government_grant"],
      keywords: ["impact", "outcomes", "retention", "income"],
      version: 3,
    },
    {
      id: kb.capacity,
      organization_id: DEMO_ORG_ID,
      category: "capacity",
      title: "Organizational capacity & staffing",
      content:
        "A 14-person staff including 6 credentialed case managers and 2 financial coaches, supported by 86 trained volunteers and an HMIS-integrated case-management system.",
      is_proven: false,
      proven_count: 0,
      funder_categories: ["government_grant", "private_foundation"],
      keywords: ["capacity", "staffing", "HMIS"],
      version: 1,
    },
    {
      id: kb.sustainability,
      organization_id: DEMO_ORG_ID,
      category: "sustainability",
      title: "Diversified funding & sustainability",
      content:
        "Revenue is diversified across government contracts (38%), foundations (29%), corporate giving (18%), and individual donors and events (15%), reducing reliance on any single source.",
      is_proven: false,
      proven_count: 0,
      funder_categories: ["private_foundation", "corporate_foundation"],
      keywords: ["sustainability", "diversified funding"],
      version: 1,
    },
  ]);

  // --- outcomes (2 awarded, 1 denied) -------------------------------------
  const outcomes = {
    brightwater: randomUUID(),
    cornerstone: randomUUID(),
    unitedWay: randomUUID(),
  };
  await insert("outcomes", [
    {
      id: outcomes.brightwater,
      organization_id: DEMO_ORG_ID,
      application_id: apps.brightwaterHousing,
      result: "awarded",
      awarded_amount: 175_000,
      requested_amount: 200_000,
      funder_feedback:
        "Compelling outcomes data and a clear logic model. The review committee was impressed by the 84% housing-retention figure.",
      narrative_snapshot:
        "Of families completing our housing navigation program, 84% remained stably housed 12 months later… (full proposal narrative excerpt) [DEMO]",
      funder_category: "private_foundation",
      opportunity_category: "private_foundation",
      keywords_used: ["housing stability", "homelessness prevention", "outcomes"],
      recorded_at: ts(-7),
    },
    {
      id: outcomes.cornerstone,
      organization_id: DEMO_ORG_ID,
      application_id: apps.cornerstoneCoaching,
      result: "awarded",
      awarded_amount: 50_000,
      requested_amount: 50_000,
      funder_feedback:
        "Full funding approved. Strong alignment with our financial-capability priorities; clean budget.",
      narrative_snapshot:
        "Our financial coaching program pairs every participating family with a certified coach… (grant narrative excerpt) [DEMO]",
      funder_category: "corporate_foundation",
      opportunity_category: "corporate_foundation",
      keywords_used: ["financial literacy", "economic mobility", "coaching"],
      recorded_at: ts(-75),
    },
    {
      id: outcomes.unitedWay,
      organization_id: DEMO_ORG_ID,
      application_id: apps.unitedWayBasicNeeds,
      result: "denied",
      awarded_amount: 0,
      requested_amount: 35_000,
      funder_feedback:
        "A very strong application in a highly competitive cycle. We encourage you to reapply in the fall.",
      denial_reason:
        "Funds fully committed this cycle; request exceeded the average award size for the basic-needs category.",
      narrative_snapshot:
        "Hope Harbor's emergency assistance program prevented 312 evictions last year… (grant narrative excerpt) [DEMO]",
      funder_category: "local_community_grant",
      opportunity_category: "local_community_grant",
      keywords_used: ["basic needs", "emergency assistance", "eviction prevention"],
      recorded_at: ts(-15),
    },
  ]);

  // --- proven narratives (extracted from the two awarded outcomes) ---------
  await insert("proven_narratives", [
    {
      organization_id: DEMO_ORG_ID,
      outcome_id: outcomes.brightwater,
      knowledge_base_id: kb.impact,
      narrative_text:
        "Of families completing our housing navigation program, 84% remained stably housed 12 months later and 71% increased their monthly income.",
      section_type: "impact",
      funder_category: "private_foundation",
      success_count: 3,
      effectiveness_score: 91.5,
      last_used_at: ts(-7),
    },
    {
      organization_id: DEMO_ORG_ID,
      outcome_id: outcomes.cornerstone,
      knowledge_base_id: kb.mission,
      narrative_text:
        "Our financial coaching program pairs every participating family with a certified coach and a personalized capability plan, producing measurable gains in savings and credit.",
      section_type: "program_description",
      funder_category: "corporate_foundation",
      success_count: 2,
      effectiveness_score: 88.0,
      last_used_at: ts(-75),
    },
  ]);

  // --- board members -------------------------------------------------------
  await insert("board_members", [
    { organization_id: DEMO_ORG_ID, name: "Gloria Hayes", title: "Board Chair", bio: "Retired affordable-housing developer with 30 years in community development.", email: "ghayes@example.org", phone: "(555) 200-3010", start_date: "2018-01-01", is_active: true },
    { organization_id: DEMO_ORG_ID, name: "Marcus Lin", title: "Treasurer", bio: "CPA and partner at a regional accounting firm; chairs the finance committee.", email: "mlin@example.org", phone: "(555) 200-3011", start_date: "2019-06-01", is_active: true },
    { organization_id: DEMO_ORG_ID, name: "Sandra Okafor", title: "Secretary", bio: "Public-health nurse and longtime Riverside Valley resident.", email: "sokafor@example.org", start_date: "2020-09-01", is_active: true },
    { organization_id: DEMO_ORG_ID, name: "David Reyes", title: "Member", bio: "Local small-business owner and former program participant.", email: "dreyes@example.org", start_date: "2021-03-01", is_active: true },
    { organization_id: DEMO_ORG_ID, name: "Helen Castellano", title: "Member (emeritus)", bio: "Founding board member; stepped back to advisory role in 2023.", email: "hcastellano@example.org", start_date: "2012-03-15", is_active: false },
  ]);

  // --- programs ------------------------------------------------------------
  await insert("programs", [
    {
      organization_id: DEMO_ORG_ID,
      name: "Housing Navigation Program",
      description:
        "One-on-one case management guiding families from housing crisis to stable, affordable housing.",
      budget: 720_000,
      beneficiaries_served: 410,
      start_date: "2013-01-01",
      status: "active",
      impact_metrics: { housing_retention_12mo: 0.84, families_rehoused: 168, avg_days_to_housing: 47 },
    },
    {
      organization_id: DEMO_ORG_ID,
      name: "Financial Coaching & Empowerment",
      description:
        "Certified coaches help families build savings, repair credit, and access benefits.",
      budget: 310_000,
      beneficiaries_served: 265,
      start_date: "2016-04-01",
      status: "active",
      impact_metrics: { avg_credit_score_gain: 58, families_with_new_savings: 0.71, benefits_enrolled: 190 },
    },
    {
      organization_id: DEMO_ORG_ID,
      name: "Emergency Family Assistance Fund",
      description:
        "Flexible one-time grants for rent, utilities, and deposits to prevent eviction.",
      budget: 240_000,
      beneficiaries_served: 312,
      start_date: "2014-07-01",
      status: "active",
      impact_metrics: { evictions_prevented: 312, avg_assistance_amount: 640 },
    },
  ]);

  // --- documents (5 metadata rows; storage_path is illustrative) -----------
  await insert("documents", [
    { organization_id: DEMO_ORG_ID, file_name: "IRS-501c3-determination-letter.pdf", storage_path: `org/${DEMO_ORG_ID}/legal/irs-determination-letter.pdf`, file_size: 248_000, mime_type: "application/pdf", category: "tax_documents", description: "IRS 501(c)(3) determination letter.", expiration_date: null },
    { organization_id: DEMO_ORG_ID, file_name: "FY2025-audited-financials.pdf", storage_path: `org/${DEMO_ORG_ID}/financial/fy2025-audit.pdf`, file_size: 1_640_000, mime_type: "application/pdf", category: "financial_documents", description: "Independent audited financial statements, FY2025." },
    { organization_id: DEMO_ORG_ID, file_name: "board-roster-2026.pdf", storage_path: `org/${DEMO_ORG_ID}/legal/board-roster-2026.pdf`, file_size: 96_000, mime_type: "application/pdf", category: "legal_documents", description: "Current board of directors roster with affiliations." },
    { organization_id: DEMO_ORG_ID, file_name: "housing-navigation-logic-model.pdf", storage_path: `org/${DEMO_ORG_ID}/program/housing-navigation-logic-model.pdf`, file_size: 420_000, mime_type: "application/pdf", category: "program_documents", description: "Logic model for the Housing Navigation Program." },
    { organization_id: DEMO_ORG_ID, file_name: "letter-of-support-riverside-mayor.pdf", storage_path: `org/${DEMO_ORG_ID}/support/lor-riverside-mayor.pdf`, file_size: 132_000, mime_type: "application/pdf", category: "letters_of_support", description: "Letter of support from the Riverside mayor's office.", expiration_date: day(300) },
  ]);

  console.log("\n✓ Demo seed complete.");
  console.log(`  Organization: Hope Harbor Community Services (${DEMO_ORG_ID})`);
  console.log("  All rows tagged [DEMO]; re-run `pnpm seed-demo` to reset.");
}

// ----------------------------------------------------------------------------
await wipe();
await seed();
