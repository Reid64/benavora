"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  LayoutDashboard,
  PartyPopper,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import {
  ONBOARDING_STEP_KEY,
  ONBOARDING_STEPS,
  completionPercent,
  deriveCompleted,
  type OnboardingSnapshot,
  type OnboardingStepId,
} from "@/lib/onboarding";

import { BoardMembersStep } from "./BoardMembersStep";
import { DocumentsStep } from "./DocumentsStep";
import { FunderStep } from "./FunderStep";
import {
  OrgProfileStep,
  type OrgProfileInitial,
} from "./OrgProfileStep";
import { ProgramsStep } from "./ProgramsStep";
import { SearchProfileStep } from "./SearchProfileStep";
import { StepIndicator } from "./StepIndicator";
import { WelcomeStep } from "./WelcomeStep";

export type OnboardingWizardProps = {
  /** Authenticated user id - recorded as documents.uploaded_by. */
  userId: string;
  snapshot: OnboardingSnapshot;
};

/** Build the OrgProfileStep's initial values from the live org snapshot. */
function orgInitial(org: OnboardingSnapshot["org"]): OrgProfileInitial {
  return {
    name: org.name ?? "",
    ein: org.ein ?? "",
    mission: org.mission_statement ?? "",
    dba: org.dba ?? "",
    taxStatus: org.tax_status ?? "",
    vision: org.vision_statement ?? "",
    targetPopulation: org.target_population ?? "",
    serviceArea: org.service_area ?? "",
    website: org.website ?? "",
    phone: org.phone ?? "",
    email: org.email ?? "",
    addressLine1: org.address_line1 ?? "",
    city: org.city ?? "",
    state: org.state ?? "",
    zip: org.zip ?? "",
  };
}

/**
 * First-login onboarding wizard orchestrator (BLUEPRINT onboarding flow).
 *
 * Drives the seven steps (welcome, organization, programs, board, documents,
 * funder, search), shows a live completion percentage and a horizontal step
 * indicator, persists the current step to platform_config so progress resumes
 * across sessions, and offers a skip-anytime exit. Finishing or skipping flips
 * organizations.onboarding_completed and returns to the dashboard.
 */
export function OnboardingWizard({ userId, snapshot }: OnboardingWizardProps) {
  const router = useRouter();
  const orgId = snapshot.org.id;

  const [completed, setCompleted] = useState<Set<OnboardingStepId>>(() =>
    deriveCompleted(snapshot),
  );
  const [orgName, setOrgName] = useState(snapshot.org.name ?? "");

  // Resume on the saved step when valid; otherwise start at the beginning.
  const [current, setCurrent] = useState(() => {
    const s = snapshot.savedStep;
    return s >= 0 && s < ONBOARDING_STEPS.length ? s : 0;
  });
  const [leaving, setLeaving] = useState(false);
  const [finished, setFinished] = useState(false);

  // `current` is always clamped to a valid index (see setters below), so the
  // first operand is defined in practice; the assertion satisfies
  // noUncheckedIndexedAccess without restructuring around the hooks.
  const step = ONBOARDING_STEPS[current] ?? ONBOARDING_STEPS[0]!;
  const isLast = current === ONBOARDING_STEPS.length - 1;
  const percent = completionPercent(completed);

  function markComplete(id: OnboardingStepId) {
    setCompleted((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  // Persist the current step pointer so the user can resume where they left off.
  // Skip the very first render to avoid an unnecessary write on load.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const supabase = createClient();
    void supabase.from("platform_config").upsert(
      {
        organization_id: orgId,
        key: ONBOARDING_STEP_KEY,
        value: String(current),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,key" },
    );
  }, [current, orgId]);

  function goNext() {
    // Welcome is informational - advancing past it counts as done.
    if (step.id === "welcome") markComplete("welcome");
    setCurrent((c) => Math.min(c + 1, ONBOARDING_STEPS.length - 1));
  }

  function goBack() {
    setCurrent((c) => Math.max(c - 1, 0));
  }

  // Flip the onboarding flag. `celebrate` shows the "Setup complete" screen
  // (footer Finish); skipping from the header goes straight to the dashboard.
  const finishOnboarding = useCallback(
    async (celebrate: boolean) => {
      setLeaving(true);
      const supabase = createClient();
      const { error } = await supabase
        .from("organizations")
        .update({
          onboarding_completed: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orgId);

      if (error) {
        setLeaving(false);
        return;
      }
      if (celebrate) {
        setFinished(true);
        setLeaving(false);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    },
    [orgId, router],
  );

  // Primary action gating: only the required "profile" step blocks advancing
  // until its record exists. Optional steps can always be skipped.
  const blocked = step.id === "profile" && !completed.has("profile");

  let primaryLabel: string;
  if (isLast) {
    primaryLabel = "Finish setup";
  } else if (step.id === "welcome") {
    primaryLabel = "Get started";
  } else if (!completed.has(step.id) && step.optional) {
    primaryLabel = "Skip for now";
  } else {
    primaryLabel = "Continue";
  }

  if (finished) {
    return (
      <div className="mx-auto w-full max-w-xl">
        <div className="rounded-2xl border border-border bg-white p-8 text-center shadow-sm sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 text-white shadow-md shadow-teal-900/30">
            <PartyPopper className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-primary">
            Setup complete!
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-navy-500">
            {orgName ? `${orgName} is` : "Your workspace is"} ready. Jump into
            your dashboard, round out your knowledge base, or start tracking an
            opportunity.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link
              href="/dashboard"
              className="flex flex-col items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-5 text-sm font-medium text-teal-800 transition hover:border-teal-300 hover:bg-teal-100"
            >
              <LayoutDashboard className="h-5 w-5" aria-hidden />
              Dashboard
            </Link>
            <Link
              href="/knowledge-base"
              className="flex flex-col items-center gap-2 rounded-xl border border-navy-200 px-4 py-5 text-sm font-medium text-navy-700 transition hover:border-navy-300 hover:bg-navy-50"
            >
              <BrainCircuit className="h-5 w-5" aria-hidden />
              Knowledge Base
            </Link>
            <Link
              href="/opportunities/new"
              className="flex flex-col items-center gap-2 rounded-xl border border-navy-200 px-4 py-5 text-sm font-medium text-navy-700 transition hover:border-navy-300 hover:bg-navy-50"
            >
              <Plus className="h-5 w-5" aria-hidden />
              Add Opportunity
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Header: brand mark, progress %, skip-anytime */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 font-bold text-white shadow-md shadow-teal-900/30">
            B
          </span>
          <span className="text-base font-semibold tracking-tight text-navy-900">
            Benavora setup
          </span>
        </div>
        <button
          type="button"
          onClick={() => finishOnboarding(false)}
          disabled={leaving}
          className="text-sm font-medium text-navy-500 transition hover:text-navy-800 disabled:opacity-60"
        >
          Skip setup &rarr;
        </button>
      </div>

      {/* Horizontal step indicator */}
      <div className="mb-6">
        <StepIndicator
          current={current}
          completed={completed}
          onSelect={setCurrent}
        />
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-navy-500">
          <span>
            Step {current + 1} of {ONBOARDING_STEPS.length} ·{" "}
            <span className="text-navy-700">{step.title}</span>
          </span>
          <span className="text-teal-600">{percent}% complete</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-navy-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-500 to-primary transition-all duration-500"
            style={{ width: `${percent}%` }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Onboarding completion"
          />
        </div>
      </div>

      {/* Step body */}
      <div className="min-w-0">
        <div className="rounded-2xl border border-border bg-white p-6 shadow-sm sm:p-8">
          {step.id !== "welcome" && (
            <div className="mb-6">
              <h1 className="text-xl font-bold tracking-tight text-primary">
                {step.title}
              </h1>
              <p className="mt-1 text-sm text-navy-500">{step.description}</p>
            </div>
          )}

          {step.id === "welcome" && <WelcomeStep orgName={orgName} />}

          {step.id === "profile" && (
            <OrgProfileStep
              organizationId={orgId}
              initial={orgInitial(snapshot.org)}
              onSaved={(values) => {
                setOrgName(values.name);
                markComplete("profile");
              }}
            />
          )}

          {step.id === "programs" && (
            <ProgramsStep
              organizationId={orgId}
              alreadyAdded={snapshot.programCount > 0}
              onSaved={() => markComplete("programs")}
            />
          )}

          {step.id === "board" && (
            <BoardMembersStep
              organizationId={orgId}
              alreadyAdded={snapshot.boardMemberCount > 0}
              onSaved={() => markComplete("board")}
            />
          )}

          {step.id === "documents" && (
            <DocumentsStep
              organizationId={orgId}
              uploadedBy={userId}
              initialCount={snapshot.documentCount}
              onUploaded={() => markComplete("documents")}
            />
          )}

          {step.id === "funder" && (
            <FunderStep
              alreadyAdded={snapshot.funderCount > 0}
              onAdded={() => markComplete("funder")}
            />
          )}

          {step.id === "search" && (
            <SearchProfileStep
              organizationId={orgId}
              alreadyCreated={snapshot.searchProfileCount > 0}
              onSaved={() => markComplete("search")}
            />
          )}
        </div>

        {/* Footer navigation */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={current === 0 || leaving}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Button>

          <Button
            type="button"
            onClick={isLast ? () => finishOnboarding(true) : goNext}
            disabled={blocked || leaving}
            isLoading={isLast && leaving}
          >
            {primaryLabel}
            {!isLast && <ArrowRight className="h-4 w-4" aria-hidden />}
          </Button>
        </div>

        {blocked && (
          <p className="mt-2 text-right text-xs text-navy-400">
            Save your organization basics to continue.
          </p>
        )}
      </div>
    </div>
  );
}
