import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/layout/DashboardShell";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

/**
 * Authenticated dashboard shell. The session is the source of truth for the
 * user's identity — never the request body. Middleware already gates these
 * routes; this is the second barrier and supplies the email to the UI.
 * If the user cannot be resolved, redirect to /login. No role defaults.
 *
 * New organizations are routed to the first-login onboarding wizard until their
 * onboarding_completed flag is set (see /onboarding). organization_id is read
 * from the session profile, never a request body (Behavioral Contracts §2).
 */
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

  // Gate the dashboard behind onboarding for brand-new organizations. The join
  // through profiles → organizations is RLS-scoped to this user.
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role, organizations(onboarding_completed)")
    .eq("id", user.id)
    .single();

  const org = profile?.organizations as
    | { onboarding_completed: boolean }
    | { onboarding_completed: boolean }[]
    | null
    | undefined;
  const onboardingCompleted = Array.isArray(org)
    ? org[0]?.onboarding_completed
    : org?.onboarding_completed;

  // Only redirect when we positively know onboarding is incomplete. If the
  // profile/org can't be read, fall through — never trap the user in a loop.
  if (profile && onboardingCompleted === false) {
    redirect("/onboarding");
  }

  const role = profile?.role as Enums<"user_role"> | undefined;

  return (
    <DashboardShell userEmail={user.email ?? ""} role={role}>
      {children}
    </DashboardShell>
  );
}
