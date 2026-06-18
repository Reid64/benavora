import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();
  const role = profile?.role as Enums<"user_role"> | undefined;

  let onboardingCompleted = false;
  let orgName = "";
  let orgLogoUrl: string | null = null;
  if (profile?.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name, logo_url, onboarding_completed")
      .eq("id", profile.organization_id)
      .single();
    onboardingCompleted = org?.onboarding_completed ?? false;
    orgName = org?.name ?? "";
    orgLogoUrl = org?.logo_url ?? null;
  }

  return (
    <DashboardShell
      userEmail={user.email ?? ""}
      role={role}
      onboardingCompleted={onboardingCompleted}
      orgName={orgName}
      orgLogoUrl={orgLogoUrl}
    >
      {children}
    </DashboardShell>
  );
}

