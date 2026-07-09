"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Building2,
  CreditCard,
  FileText,
  FolderOpen,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Badge, Button, Card, LoadingSpinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const TOTAL_STEPS = 7;

const STEP_INFO: { id: number; title: string; icon: LucideIcon }[] = [
  { id: 1, title: "Organization Profile", icon: Building2 },
  { id: 2, title: "Programs", icon: FolderOpen },
  { id: 3, title: "Knowledge Base", icon: BookOpen },
  { id: 4, title: "Board Members", icon: Users },
  { id: 5, title: "Documents", icon: FileText },
  { id: 6, title: "Search Profile", icon: Search },
  { id: 7, title: "Plan Selection", icon: CreditCard },
];

type OnboardingProgress = { completed_steps?: unknown; last_step?: unknown };

type SetupState = {
  completed: boolean;
  completedSteps: Set<number>;
  nextStep: number;
};

function deriveSetupState(org: {
  onboarding_completed: boolean;
  onboarding_step: number | null;
  onboarding_progress: unknown;
}): SetupState {
  const progress =
    org.onboarding_progress && typeof org.onboarding_progress === "object"
      ? (org.onboarding_progress as OnboardingProgress)
      : null;

  const fromProgress =
    progress && Array.isArray(progress.completed_steps)
      ? progress.completed_steps.filter((s): s is string => typeof s === "string").map(Number)
      : null;

  const completedSteps = new Set<number>(
    fromProgress ?? Array.from({ length: Math.max(0, (org.onboarding_step ?? 1) - 1) }, (_, i) => i + 1),
  );
  if (org.onboarding_completed) {
    for (let i = 1; i <= TOTAL_STEPS; i++) completedSteps.add(i);
  }

  const nextStep =
    progress && typeof progress.last_step === "string" && progress.last_step
      ? Number(progress.last_step)
      : Math.min(Math.max(org.onboarding_step ?? 1, 1), TOTAL_STEPS);

  return { completed: org.onboarding_completed, completedSteps, nextStep };
}

export default function OrganizationSetupPage() {
  const router = useRouter();
  const [state, setState] = useState<SetupState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data: org, error } = await supabase
      .from("organizations")
      .select("onboarding_completed, onboarding_step, onboarding_progress")
      .limit(1)
      .single();

    if (error || !org) {
      setLoadError("Could not load your organization's setup progress.");
      setLoading(false);
      return;
    }

    setState(deriveSetupState(org));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) {
    return <LoadingSpinner center label="Loading setup progress..." />;
  }

  if (loadError || !state) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {loadError ?? "Could not load setup progress."}
      </div>
    );
  }

  const completedCount = state.completedSteps.size;
  const pct = Math.round((completedCount / TOTAL_STEPS) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Organization Setup
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Track progress through the 7-step setup wizard, or jump back in to finish
          any remaining step.
        </p>
      </div>

      <Card>
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-navy-700">
                {completedCount} of {TOTAL_STEPS} steps complete
              </span>
              <span className="text-sm text-navy-500">{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-navy-100">
              <div
                className="h-full rounded-full bg-teal-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {!state.completed && (
            <div className="flex justify-end">
              <Button onClick={() => router.push(`/onboarding?step=${state.nextStep}`)}>
                Resume setup
              </Button>
            </div>
          )}

          <ul className="divide-y divide-border">
            {STEP_INFO.map(({ id, title, icon: Icon }) => {
              const done = state.completedSteps.has(id);
              const isNext = !state.completed && !done && id === state.nextStep;
              return (
                <li key={id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0 text-navy-400" aria-hidden />
                    <span className="text-sm font-medium text-navy-900">{title}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {done ? (
                      <Badge variant="success">Complete</Badge>
                    ) : isNext ? (
                      <Badge variant="warning">Next up</Badge>
                    ) : (
                      <Badge variant="neutral">Not started</Badge>
                    )}
                    {(state.completed || done) && (
                      <Link
                        href={`/onboarding?step=${id}`}
                        className="text-sm font-medium text-primary underline underline-offset-2 hover:no-underline"
                      >
                        Review
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>
    </div>
  );
}
