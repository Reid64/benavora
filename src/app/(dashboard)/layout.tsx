import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import type { OnboardingProgressSummary } from "@/components/layout/OnboardingBanner";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

const ONBOARDING_TOTAL_STEPS = 7;

function deriveOnboardingProgress(org: {
  onboarding_completed: boolean;
  onboarding_step: number | null;
  onboarding_progress: unknown;
}): OnboardingProgressSummary | null {
  if (org.onboarding_completed) return null;

  const raw = org.onboarding_progress;
  const progress =
    raw && typeof raw === "object" ? (raw as { completed_steps?: unknown; last_step?: unknown }) : null;

  const completedSteps =
    progress && Array.isArray(progress.completed_steps)
      ? progress.completed_steps.length
      : Math.max(0, (org.onboarding_step ?? 1) - 1);

  const lastStep =
    progress && typeof progress.last_step === "string" && progress.last_step
      ? Number(progress.last_step)
      : Math.min(Math.max(org.onboarding_step ?? 1, 1), ONBOARDING_TOTAL_STEPS);

  return { completedSteps, totalSteps: ONBOARDING_TOTAL_STEPS, lastStep };
}

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
  let onboardingProgress: OnboardingProgressSummary | null = null;
  let orgName = "";
  let orgLogoUrl: string | null = null;
  if (profile?.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name, logo_url, onboarding_completed, onboarding_step, onboarding_progress")
      .eq("id", profile.organization_id)
      .single();
    onboardingCompleted = org?.onboarding_completed ?? false;
    orgName = org?.name ?? "";
    orgLogoUrl = org?.logo_url ?? null;
    if (org) {
      onboardingProgress = deriveOnboardingProgress({
        onboarding_completed: onboardingCompleted,
        onboarding_step: org.onboarding_step,
        onboarding_progress: org.onboarding_progress,
      });
    }
  }

  return (
    <DashboardShell
      userEmail={user.email ?? ""}
      role={role}
      onboardingCompleted={onboardingCompleted}
      onboardingProgress={onboardingProgress}
      orgName={orgName}
      orgLogoUrl={orgLogoUrl}
    >
      {children}
    </DashboardShell>
  );
}

