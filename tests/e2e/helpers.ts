import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

// Node 20 (the version this Playwright runner targets) has no native
// WebSocket global, which @supabase/realtime-js requires to construct any
// client even though these tests never subscribe to a realtime channel.
// Polyfill it once so every createClient() call in this file works.
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
}

/**
 * Shared E2E helpers: environment loading, the dedicated test account, and a
 * minimal real-data seed for the test organization.
 *
 * These tests run against the real Supabase project (no mocks — Iron Law #8),
 * scoped to a dedicated owner account and organization. The seed inserts a
 * small, representative dataset so data-dependent UI (opportunity filters, the
 * pipeline board, the draft template chooser, the calendar) actually renders.
 */

export type E2EEnv = {
  url: string;
  anonKey: string;
  serviceKey: string;
};

/**
 * Load Supabase credentials from .env.local. The Playwright runner process does
 * not get Next.js's automatic .env loading, so we parse the file directly.
 * process.env still wins when already set (e.g. in CI).
 */
export function loadEnv(): E2EEnv {
  const fromProcess: Partial<E2EEnv> = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  if (fromProcess.url && fromProcess.anonKey && fromProcess.serviceKey) {
    return fromProcess as E2EEnv;
  }

  const parsed: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      parsed[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    // Fall through to the validation below with whatever we have.
  }

  const env: E2EEnv = {
    url: fromProcess.url ?? parsed.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: fromProcess.anonKey ?? parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    serviceKey:
      fromProcess.serviceKey ?? parsed.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };

  if (!env.url || !env.anonKey || !env.serviceKey) {
    throw new Error(
      "Missing Supabase env. Need NEXT_PUBLIC_SUPABASE_URL, " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in " +
        ".env.local or the environment.",
    );
  }
  return env;
}

/** The dedicated owner account used by all authenticated specs. */
export const TEST_USER = {
  email: "owner.e2e@benavora-test.dev",
  password: "Benavora!E2E-Test-1",
  organizationName: "Benavora E2E Test Org",
  fullName: "E2E Owner",
} as const;

/** Where the authenticated storage state is written by auth.setup.ts. */
export const STORAGE_STATE = "tests/e2e/.auth/owner.json";

/**
 * A second, isolated account whose organization is still mid-onboarding
 * (onboarding_completed = false). The owner org above is fully onboarded so the
 * dashboard specs never get bounced to the wizard; this dedicated account exists
 * solely so the onboarding-wizard spec has a session that DOES land on
 * /onboarding. Its own org means it never interferes with the owner's data.
 */
export const ONBOARDING_USER = {
  email: "onboarding.e2e@benavora-test.dev",
  password: "Benavora!E2E-Onboard-1",
  organizationName: "Benavora Onboarding E2E Org",
  fullName: "E2E Onboarding Owner",
} as const;

/** Storage state for the mid-onboarding account (written by auth.setup.ts). */
export const ONBOARDING_STORAGE_STATE = "tests/e2e/.auth/onboarding.json";

/** A service-role client. Bypasses RLS — used only for setup/seed/cleanup. */
export function adminClient(env: E2EEnv): SupabaseClient {
  return createClient(env.url, env.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Ensure the test owner exists (confirmed) and their organization is
 * bootstrapped. Returns the user id and organization id. Idempotent.
 */
export async function ensureTestAccount(
  env: E2EEnv,
): Promise<{ userId: string; organizationId: string }> {
  const admin = adminClient(env);

  // Create the confirmed user. If it already exists, ignore and continue.
  const { error: createError } = await admin.auth.admin.createUser({
    email: TEST_USER.email,
    password: TEST_USER.password,
    email_confirm: true,
    user_metadata: {
      organization_name: TEST_USER.organizationName,
      full_name: TEST_USER.fullName,
    },
  });
  if (
    createError &&
    !/already.*registered|already.*exists|been registered/i.test(
      createError.message,
    )
  ) {
    throw new Error(`Could not create test user: ${createError.message}`);
  }

  // Sign in as the user (anon client) so register_organization() runs with the
  // user's JWT — it reads auth.uid() and is idempotent.
  const anon = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInError } =
    await anon.auth.signInWithPassword({
      email: TEST_USER.email,
      password: TEST_USER.password,
    });
  if (signInError || !signIn.user) {
    throw new Error(
      `Could not sign in test user: ${signInError?.message ?? "no user"}`,
    );
  }

  const { data: orgId, error: rpcError } = await anon.rpc(
    "register_organization",
  );
  if (rpcError || !orgId) {
    throw new Error(
      `register_organization failed: ${rpcError?.message ?? "no org id"}`,
    );
  }

  return { userId: signIn.user.id, organizationId: orgId as string };
}

/**
 * Seed a minimal, representative dataset for the test organization if it is
 * empty: one funder, one opportunity, one application (in the pipeline), and one
 * deadline. Idempotent — skips if a seeded funder already exists. Uses the
 * service-role client with an explicit organization_id (real rows, real tables).
 */
export async function seedOrganization(
  env: E2EEnv,
  organizationId: string,
): Promise<void> {
  const admin = adminClient(env);
  const SEED_FUNDER = "Lone Star Community Foundation (E2E Seed)";

  const { data: existing } = await admin
    .from("funders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", SEED_FUNDER)
    .limit(1);

  if (existing && existing.length > 0) return;

  const { data: funder, error: funderError } = await admin
    .from("funders")
    .insert({
      organization_id: organizationId,
      name: SEED_FUNDER,
      category: "private_foundation",
      description: "Seeded funder for end-to-end tests.",
    })
    .select("id")
    .single();
  if (funderError || !funder) {
    throw new Error(`Seed funder failed: ${funderError?.message}`);
  }

  // A deadline ~10 days out so it lands inside (or near) the current month grid.
  const due = new Date();
  due.setDate(due.getDate() + 10);
  const dueDate = due.toISOString().slice(0, 10);

  const { data: opportunity, error: oppError } = await admin
    .from("opportunities")
    .insert({
      organization_id: organizationId,
      funder_id: funder.id,
      name: "Rural Housing Stability Grant (E2E Seed)",
      category: "housing_grant",
      description:
        "Seeded opportunity supporting emergency and transitional housing.",
      amount_min: 10000,
      amount_max: 50000,
      deadline: due.toISOString(),
      status: "open",
      source: "manual",
    })
    .select("id")
    .single();
  if (oppError || !opportunity) {
    throw new Error(`Seed opportunity failed: ${oppError?.message}`);
  }

  const { error: appError } = await admin.from("applications").insert({
    organization_id: organizationId,
    opportunity_id: opportunity.id,
    stage: "drafting",
    requested_amount: 35000,
    draft_content: "Seeded working draft for end-to-end tests.",
  });
  if (appError) {
    throw new Error(`Seed application failed: ${appError.message}`);
  }

  const { error: deadlineError } = await admin.from("deadlines").insert({
    organization_id: organizationId,
    opportunity_id: opportunity.id,
    deadline_type: "application_deadline",
    due_date: dueDate,
    title: "Rural Housing Stability Grant — application due",
  });
  if (deadlineError) {
    throw new Error(`Seed deadline failed: ${deadlineError.message}`);
  }
}

/** Sentinel name used to make the Phase 2-5 seed idempotent. */
const SEED_SEARCH_PROFILE = "Corporate Giving Sweep (E2E Seed)";
/** A research-discovered opportunity (source = a search profile, not manual). */
export const SEED_DISCOVERY = "Acme Corp Community Giving (E2E Seed)";
/** Seeded campaign whose detail view drives the campaign specs. */
export const SEED_CAMPAIGN = "Spring Construction Outreach (E2E Seed)";
/** Seeded outreach contact enrolled in the campaign. */
export const SEED_OUTREACH_CONTACT = "Bluebonnet Builders (E2E Seed)";

/**
 * Seed the Phase 2-5 surfaces (research, automation, email campaigns) with a
 * minimal real dataset so the Phase 2-5 specs render against live rows (no
 * mocks — Iron Law #8). Idempotent: keyed off the seeded search profile, so it
 * runs its inserts exactly once for the test organization.
 *
 * Requires the Phase 1 seed (seedOrganization) to have run first — it reuses
 * the seeded funder, opportunity, and application.
 */
export async function seedPhase2to5(
  env: E2EEnv,
  organizationId: string,
  ownerUserId: string,
): Promise<void> {
  const admin = adminClient(env);

  const { data: existingProfile } = await admin
    .from("search_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", SEED_SEARCH_PROFILE)
    .limit(1);
  if (existingProfile && existingProfile.length > 0) return;

  // Reuse the Phase 1 seed's funder / opportunity / application.
  const { data: funder } = await admin
    .from("funders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", "Lone Star Community Foundation (E2E Seed)")
    .single();
  const { data: opportunity } = await admin
    .from("opportunities")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", "Rural Housing Stability Grant (E2E Seed)")
    .single();
  const { data: application } = await admin
    .from("applications")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("opportunity_id", opportunity?.id ?? "")
    .limit(1)
    .single();

  if (!funder || !opportunity || !application) {
    throw new Error("Phase 2-5 seed requires the Phase 1 seed to run first.");
  }

  const now = new Date().toISOString();

  // --- Research: a search profile, recent agent runs, and a discovery ---------
  const { error: profileError } = await admin.from("search_profiles").insert({
    organization_id: organizationId,
    name: SEED_SEARCH_PROFILE,
    keywords: ["emergency housing", "community grant", "rural texas"],
    categories: ["corporate_donation"],
    is_active: true,
    results_count: 3,
  });
  if (profileError) throw new Error(`Seed search profile: ${profileError.message}`);

  const { error: runsError } = await admin.from("agent_runs").insert([
    {
      organization_id: organizationId,
      agent_type: "corporate_research",
      status: "completed",
      output_summary: "Discovered 3 corporate giving opportunities.",
      items_found: 3,
      started_at: now,
      completed_at: now,
    },
    {
      organization_id: organizationId,
      agent_type: "foundation_research",
      status: "failed",
      error_message: "Search provider timed out.",
      started_at: now,
    },
  ]);
  if (runsError) throw new Error(`Seed agent runs: ${runsError.message}`);

  const { error: discoveryError } = await admin.from("opportunities").insert({
    organization_id: organizationId,
    funder_id: funder.id,
    name: SEED_DISCOVERY,
    category: "corporate_donation",
    description: "Discovered by the research agents from a search profile.",
    amount_min: 5000,
    amount_max: 25000,
    status: "open",
    source: SEED_SEARCH_PROFILE,
    discovered_at: now,
  });
  if (discoveryError) throw new Error(`Seed discovery: ${discoveryError.message}`);

  // --- Automation: a session awaiting approval, with steps + a screenshot ------
  const { data: session, error: sessionError } = await admin
    .from("automation_sessions")
    .insert({
      organization_id: organizationId,
      application_id: application.id,
      opportunity_id: opportunity.id,
      funder_id: funder.id,
      status: "awaiting_approval",
      target_url: "https://giving.example.org/apply",
      mapped_fields: [
        {
          field: {
            fieldType: "text",
            fieldName: "org_name",
            fieldLabel: "Organization Name",
            selector: "#org_name",
            required: true,
          },
          value: TEST_USER.organizationName,
          source: "organization.name",
        },
      ],
      unmapped_fields: [
        {
          fieldType: "text",
          fieldName: "project_title",
          fieldLabel: "Project Title",
          selector: "#project_title",
          required: true,
        },
        {
          fieldType: "textarea",
          fieldName: "additional_notes",
          fieldLabel: "Additional Notes",
          selector: "#additional_notes",
          required: false,
        },
      ],
      started_by: ownerUserId,
      started_at: now,
    })
    .select("id")
    .single();
  if (sessionError || !session) {
    throw new Error(`Seed automation session: ${sessionError?.message}`);
  }

  const { error: stepsError } = await admin.from("automation_steps").insert([
    {
      session_id: session.id,
      step_number: 1,
      action: "navigate",
      description: "Opened the funder's giving portal.",
      status: "completed",
      duration_ms: 850,
    },
    {
      session_id: session.id,
      step_number: 2,
      action: "detect_form",
      description: "Detected the donation request form.",
      status: "completed",
      duration_ms: 420,
    },
    {
      session_id: session.id,
      step_number: 3,
      action: "fill_field",
      description: "Filled the organization name from your profile.",
      status: "completed",
      duration_ms: 130,
    },
  ]);
  if (stepsError) throw new Error(`Seed automation steps: ${stepsError.message}`);

  const { error: shotError } = await admin
    .from("automation_screenshots")
    .insert({
      session_id: session.id,
      storage_path: `automation/${session.id}/landing.png`,
      description: "Landing page",
      page_url: "https://giving.example.org/apply",
    });
  if (shotError) throw new Error(`Seed screenshot: ${shotError.message}`);

  // --- Email campaign: an active campaign with steps, a contact, and a send ----
  const { data: campaign, error: campaignError } = await admin
    .from("email_campaigns")
    .insert({
      organization_id: organizationId,
      name: SEED_CAMPAIGN,
      status: "active",
      total_steps: 2,
      total_contacts: 1,
      created_by: ownerUserId,
    })
    .select("id")
    .single();
  if (campaignError || !campaign) {
    throw new Error(`Seed campaign: ${campaignError?.message}`);
  }

  const { data: steps, error: campStepsError } = await admin
    .from("campaign_steps")
    .insert([
      {
        campaign_id: campaign.id,
        step_number: 1,
        subject_template: "Partnering with {company_name} on housing",
        body_template: "Hi {contact_name}, I lead {foundation_name}…",
        delay_days: 0,
      },
      {
        campaign_id: campaign.id,
        step_number: 2,
        subject_template: "Following up on {company_name}",
        body_template: "Just circling back, {contact_name}.",
        delay_days: 3,
      },
    ])
    .select("id, step_number");
  if (campStepsError || !steps) {
    throw new Error(`Seed campaign steps: ${campStepsError?.message}`);
  }
  const firstStep = steps.find((s) => s.step_number === 1) ?? steps[0];

  const { data: contact, error: contactError } = await admin
    .from("outreach_contacts")
    .insert({
      organization_id: organizationId,
      company_name: SEED_OUTREACH_CONTACT,
      contact_name: "Pat Rivera",
      email: "pat@bluebonnet.example",
      status: "contacted",
      giving_likelihood: "high",
      campaign_id: campaign.id,
    })
    .select("id")
    .single();
  if (contactError || !contact) {
    throw new Error(`Seed outreach contact: ${contactError?.message}`);
  }

  const { error: sendError } = await admin.from("campaign_sends").insert({
    campaign_step_id: firstStep.id,
    outreach_contact_id: contact.id,
    status: "sent",
    sent_at: now,
  });
  if (sendError) throw new Error(`Seed campaign send: ${sendError.message}`);
}

/**
 * Ensure the dedicated mid-onboarding account exists in its own organization and
 * that organization's onboarding is INCOMPLETE. Returns the user and org ids.
 * Idempotent. Used only by the onboarding-wizard spec — kept separate from the
 * owner org so the dashboard specs are never redirected to the wizard.
 */
export async function ensureOnboardingAccount(
  env: E2EEnv,
): Promise<{ userId: string; organizationId: string }> {
  const admin = adminClient(env);

  const { error: createError } = await admin.auth.admin.createUser({
    email: ONBOARDING_USER.email,
    password: ONBOARDING_USER.password,
    email_confirm: true,
    user_metadata: {
      organization_name: ONBOARDING_USER.organizationName,
      full_name: ONBOARDING_USER.fullName,
    },
  });
  if (
    createError &&
    !/already.*registered|already.*exists|been registered/i.test(
      createError.message,
    )
  ) {
    throw new Error(`Could not create onboarding user: ${createError.message}`);
  }

  const anon = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInError } =
    await anon.auth.signInWithPassword({
      email: ONBOARDING_USER.email,
      password: ONBOARDING_USER.password,
    });
  if (signInError || !signIn.user) {
    throw new Error(
      `Could not sign in onboarding user: ${signInError?.message ?? "no user"}`,
    );
  }

  const { data: orgId, error: rpcError } = await anon.rpc(
    "register_organization",
  );
  if (rpcError || !orgId) {
    throw new Error(
      `register_organization failed (onboarding): ${rpcError?.message ?? "no org id"}`,
    );
  }

  // Force the org back into the incomplete state so the wizard always renders,
  // even if a prior run advanced it. The seeded owner org stays untouched.
  const { error: resetError } = await admin
    .from("organizations")
    .update({ onboarding_completed: false })
    .eq("id", orgId as string);
  if (resetError) {
    throw new Error(`Could not reset onboarding flag: ${resetError.message}`);
  }

  return { userId: signIn.user.id, organizationId: orgId as string };
}
