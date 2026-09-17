// AR-4.1 Step 2 — seeds (idempotently) a clearly-tagged test organization for
// scripts/audit/exercise-all-agents.ts to run every discovered agent against.
// Every row this script writes lives under an organization whose name starts
// with "EXERCISE-HARNESS-" (see AGENT_EXERCISE_REPORT.md / STATE_OF_THE_BUILD.md
// for the cleanup contract: deleting that one organizations row cascades to
// every child row below via ON DELETE CASCADE, except pil_agent_runs/
// automation_sessions rows the harness itself creates during a run, which key
// off the same organization_id and are covered by the same cascade).
//
// Idempotent by construction: every insert is preceded by a lookup keyed on
// (organization_id, a natural-key column), so running this twice reuses the
// existing rows instead of duplicating them.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createAdminClient } from "../../src/lib/supabase/admin";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ORG_NAME = "EXERCISE-HARNESS-Test Foundation";
const FIXTURE_URL = pathToFileURL(
  path.resolve(__dirname, "fixtures/fixture-application-form.html"),
).href;

export interface SeededFixture {
  orgId: string;
  knowledgeBaseId: string;
  funderId: string;
  opportunityId: string;
  requestProfileId: string;
  applicationId: string;
  automationSessionId: string;
  pilGoalId: string;
  pilResearchRunId: string;
  searchProfileId: string;
  corporateProspectId: string;
  outcomeId: string;
  givingHistoryId: string;
  fixtureUrl: string;
}

async function findOrCreate<T extends { id: string }>(
  client: ReturnType<typeof createAdminClient>,
  table: string,
  match: Record<string, string>,
  insertRow: Record<string, unknown>,
): Promise<T> {
  let query = client.from(table).select("*");
  for (const [col, val] of Object.entries(match)) {
    query = query.eq(col, val);
  }
  const { data: existing, error: selectError } = await query.maybeSingle();
  if (selectError) throw new Error(`${table} lookup failed: ${selectError.message}`);
  if (existing) return existing as T;

  const { data: inserted, error: insertError } = await client
    .from(table)
    .insert(insertRow)
    .select("*")
    .single();
  if (insertError) throw new Error(`${table} insert failed: ${insertError.message}`);
  return inserted as T;
}

export async function seedExerciseOrg(): Promise<SeededFixture> {
  const client = createAdminClient();

  const org = await findOrCreate<{ id: string }>(
    client,
    "organizations",
    { name: ORG_NAME },
    {
      name: ORG_NAME,
      dba: "Exercise Harness Test Org",
      ein: "99-9999999",
      tax_status: "501c3",
      mission_statement:
        "EXERCISE-HARNESS fixture organization for scripts/audit/exercise-all-agents.ts. Not a real nonprofit — never submit real applications for it.",
      service_area: "Rural Texas",
      target_population: "Homeless and at-risk families",
      annual_budget: 250000,
      total_staff: 5,
      total_volunteers: 20,
      website: "https://example-exercise-harness.invalid",
      phone: "555-000-0000",
      email: "harness@example-exercise-harness.invalid",
      contact_email: "harness@example-exercise-harness.invalid",
      address_line1: "100 Test Way",
      city: "Waco",
      state: "TX",
      zip: "76701",
      subscription_tier: "enterprise",
      onboarding_completed: true,
    },
  );

  const knowledgeBase = await findOrCreate<{ id: string }>(
    client,
    "knowledge_base",
    { organization_id: org.id, title: "EXERCISE-HARNESS Mission Statement" },
    {
      organization_id: org.id,
      category: "mission",
      title: "EXERCISE-HARNESS Mission Statement",
      content:
        "We provide emergency and transitional housing support for families in rural Texas.",
      is_proven: true,
      proven_count: 1,
      keywords: ["housing", "rural", "texas"],
    },
  );

  const funder = await findOrCreate<{ id: string }>(
    client,
    "funders",
    { organization_id: org.id, name: "EXERCISE-HARNESS-Fixture Foundation" },
    {
      organization_id: org.id,
      name: "EXERCISE-HARNESS-Fixture Foundation",
      category: "private_foundation",
      description: "Fixture funder for the agent exercise harness. Not real.",
      website: "https://example-exercise-harness.invalid/funder",
      giving_portal_url: FIXTURE_URL,
      geographic_focus: "TX",
      preferred_application_method: "online_portal",
      has_giving_page: true,
      automation_level: "supervised",
    },
  );

  const opportunity = await findOrCreate<{ id: string }>(
    client,
    "opportunities",
    { organization_id: org.id, name: "EXERCISE-HARNESS-Fixture Housing Grant" },
    {
      organization_id: org.id,
      funder_id: funder.id,
      name: "EXERCISE-HARNESS-Fixture Housing Grant",
      category: "housing_grant",
      description: "Fixture opportunity for the agent exercise harness. Not real.",
      amount_available: 25000,
      amount_min: 5000,
      amount_max: 25000,
      deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      url: FIXTURE_URL,
      eligibility_requirements: "501(c)(3) organizations serving rural Texas housing needs.",
      application_method: "online_portal",
      status: "open",
      source: "exercise-harness-seed",
    },
  );

  const requestProfile = await findOrCreate<{ id: string }>(
    client,
    "request_profiles",
    { organization_id: org.id, name: "EXERCISE-HARNESS-Standard Request" },
    {
      organization_id: org.id,
      name: "EXERCISE-HARNESS-Standard Request",
      request_type: "grant",
      priority: 100,
      active: true,
      needs_description: "General operating support for transitional housing programs.",
      min_value: 5000,
      max_value: 25000,
      value_unit: "usd",
    },
  );

  const application = await findOrCreate<{ id: string }>(
    client,
    "applications",
    { organization_id: org.id, opportunity_id: opportunity.id },
    {
      organization_id: org.id,
      opportunity_id: opportunity.id,
      stage: "awarded",
      requested_amount: 10000,
      awarded_amount: 8000,
      submitted_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      draft_content:
        "EXERCISE-HARNESS fixture draft narrative: our organization provides emergency and transitional housing support to families in rural Texas, and this grant would fund one year of case-management staffing.",
      notes: "EXERCISE-HARNESS seed fixture application.",
    },
  );

  // One outcomes row so outcome-dependent agents (recursive-learning,
  // outcome-analyzer-agent, roi-optimizer-agent, strategic-advisor-agent,
  // autonomous-digest-agent) have a real row to read instead of a trivial
  // no-op. outcomes.application_id is UNIQUE, so this is naturally
  // idempotent on that column alone.
  const outcome = await findOrCreate<{ id: string }>(
    client,
    "outcomes",
    { application_id: application.id },
    {
      organization_id: org.id,
      application_id: application.id,
      result: "awarded",
      awarded_amount: 8000,
      requested_amount: 10000,
      funder_feedback: "EXERCISE-HARNESS fixture feedback: strong need statement, clear budget.",
      narrative_snapshot:
        "EXERCISE-HARNESS fixture draft narrative: our organization provides emergency and transitional housing support to families in rural Texas, and this grant would fund one year of case-management staffing.",
      funder_category: "housing_grant",
      opportunity_category: "housing_grant",
      keywords_used: ["housing", "rural", "transitional"],
    },
  );

  // competitor-intel.ts requires funder_giving_history rows within the last
  // 3 fiscal years to attempt real work; without one it throws no_giving_history.
  const givingHistory = await findOrCreate<{ id: string }>(
    client,
    "funder_giving_history",
    { funder_id: funder.id, recipient_name: "EXERCISE-HARNESS-Prior Recipient" },
    {
      organization_id: org.id,
      funder_id: funder.id,
      amount: 15000,
      fiscal_year: new Date().getFullYear(),
      grant_purpose: "Transitional housing case management",
      recipient_name: "EXERCISE-HARNESS-Prior Recipient",
      source: "exercise-harness-seed",
    },
  );

  const automationSession = await findOrCreate<{ id: string }>(
    client,
    "automation_sessions",
    { organization_id: org.id, application_id: application.id },
    {
      organization_id: org.id,
      application_id: application.id,
      opportunity_id: opportunity.id,
      funder_id: funder.id,
      status: "approved",
      target_url: FIXTURE_URL,
      notes: "EXERCISE-HARNESS pre-approved session so form-filler-agent's assertSessionApproved gate can run real work against the local fixture.",
    },
  );

  // A large fraction of the "core" and "research" families early-return with
  // itemsFound: 0 unless the org has an active search_profiles row whose
  // categories match theirs (see AGENT_EXERCISE_REPORT.md). One profile
  // spanning every category family exercised gives all of them a real path
  // past that gate instead of a trivial no-op.
  const searchProfile = await findOrCreate<{ id: string }>(
    client,
    "search_profiles",
    { organization_id: org.id, name: "EXERCISE-HARNESS-All-Category Profile" },
    {
      organization_id: org.id,
      name: "EXERCISE-HARNESS-All-Category Profile",
      keywords: ["housing", "rural", "transitional", "veterans"],
      categories: [
        "housing_grant",
        "government_grant",
        "education_grant",
        "private_foundation",
        "corporate_foundation",
        "corporate_donation",
        "corporate_sponsorship",
        "local_community_grant",
        "in_kind_donation",
        "materials_donation",
      ],
      geographic_scope: "TX",
      is_active: true,
    },
  );

  // corporate_prospects is a shared, cross-org table (no organization_id
  // column) that the EA-01..EA-10 / ag22_propensity_scoring corporate
  // intelligence agents key off. Tagged via legal_name so it's identifiable
  // independently of the org row for cleanup.
  const corporateProspect = await findOrCreate<{ id: string }>(
    client,
    "corporate_prospects",
    { legal_name: "EXERCISE-HARNESS-Fixture Prospect Inc" },
    {
      legal_name: "EXERCISE-HARNESS-Fixture Prospect Inc",
      website: "https://example-exercise-harness.invalid/prospect",
      address_city: "Waco",
      address_state: "TX",
      industry_category: "Manufacturing",
    },
  );

  const pilGoal = await findOrCreate<{ id: string }>(
    client,
    "pil_research_goals",
    { organization_id: org.id, objective: "EXERCISE-HARNESS seed goal for agent exercise harness" },
    {
      organization_id: org.id,
      goal_type: "prospect_research",
      objective: "EXERCISE-HARNESS seed goal for agent exercise harness",
      state: "active",
      owner_agent_id: "BEN-SUP-01",
      priority: 50,
    },
  );

  const pilResearchRun = await findOrCreate<{ id: string }>(
    client,
    "pil_research_runs",
    { organization_id: org.id, goal_id: pilGoal.id },
    {
      organization_id: org.id,
      goal_id: pilGoal.id,
      initiating_agent_id: "BEN-SUP-01",
      natural_language_query: "EXERCISE-HARNESS seed research run for agent exercise harness",
      status: "running",
      started_at: new Date().toISOString(),
    },
  );

  return {
    orgId: org.id,
    knowledgeBaseId: knowledgeBase.id,
    funderId: funder.id,
    opportunityId: opportunity.id,
    requestProfileId: requestProfile.id,
    applicationId: application.id,
    automationSessionId: automationSession.id,
    pilGoalId: pilGoal.id,
    pilResearchRunId: pilResearchRun.id,
    searchProfileId: searchProfile.id,
    corporateProspectId: corporateProspect.id,
    outcomeId: outcome.id,
    givingHistoryId: givingHistory.id,
    fixtureUrl: FIXTURE_URL,
  };
}

async function main() {
  const fixture = await seedExerciseOrg();
  console.log(JSON.stringify(fixture, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
