import { redirect } from "next/navigation";

import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { createClient } from "@/lib/supabase/server";
import { ONBOARDING_STEP_KEY, type OnboardingSnapshot } from "@/lib/onboarding";

export const metadata = {
  title: "Set up your workspace — Benavora",
};

/**
 * First-login onboarding (BLUEPRINT onboarding flow).
 *
 * Triggered for organizations whose onboarding_completed flag is still false —
 * the dashboard layout routes them here. Loads the live snapshot the wizard
 * derives completion from (org basics + record counts) plus the saved step
 * pointer, then renders the client wizard. Already-onboarded orgs are bounced
 * to the dashboard so this route is never shown twice.
 *
 * All reads are RLS-scoped to the user's organization via the session-bound
 * server client; organization_id is taken from the session profile, never a
 * request body (Behavioral Contracts §2).
 */
export default async function OnboardingPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // No profile means registration never completed; restart auth.
    redirect("/login");
  }

  const { data: org } = await supabase
    .from("organizations")
    .select(
      "id, name, dba, ein, tax_status, mission_statement, vision_statement, target_population, service_area, website, phone, email, address_line1, city, state, zip, onboarding_completed",
    )
    .eq("id", profile.organization_id)
    .single();

  if (!org) {
    redirect("/login");
  }
  if (org.onboarding_completed) {
    redirect("/dashboard");
  }

  // Live counts (RLS-scoped); head:true avoids transferring rows.
  const [programs, boardMembers, documents, funders, searchProfiles, stepRow] =
    await Promise.all([
      supabase.from("programs").select("id", { count: "exact", head: true }),
      supabase
        .from("board_members")
        .select("id", { count: "exact", head: true }),
      supabase.from("documents").select("id", { count: "exact", head: true }),
      supabase.from("funders").select("id", { count: "exact", head: true }),
      supabase
        .from("search_profiles")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("platform_config")
        .select("value")
        .eq("organization_id", profile.organization_id)
        .eq("key", ONBOARDING_STEP_KEY)
        .maybeSingle(),
    ]);

  const savedStep = stepRow.data?.value ? Number(stepRow.data.value) : -1;

  const snapshot: OnboardingSnapshot = {
    org: {
      id: org.id,
      name: org.name,
      dba: org.dba,
      ein: org.ein,
      tax_status: org.tax_status,
      mission_statement: org.mission_statement,
      vision_statement: org.vision_statement,
      target_population: org.target_population,
      service_area: org.service_area,
      website: org.website,
      phone: org.phone,
      email: org.email,
      address_line1: org.address_line1,
      city: org.city,
      state: org.state,
      zip: org.zip,
    },
    programCount: programs.count ?? 0,
    boardMemberCount: boardMembers.count ?? 0,
    documentCount: documents.count ?? 0,
    funderCount: funders.count ?? 0,
    searchProfileCount: searchProfiles.count ?? 0,
    savedStep: Number.isFinite(savedStep) ? savedStep : -1,
  };

  return (
    <main className="min-h-screen bg-surface px-4 py-10 sm:px-6 lg:px-8">
      <OnboardingWizard userId={user.id} snapshot={snapshot} />
    </main>
  );
}
