import type { Tables } from "@/types/database";

/**
 * First-login onboarding wizard (BLUEPRINT onboarding flow).
 *
 * Triggered for organizations whose `onboarding_completed` flag is still false.
 * The dashboard layout routes such orgs to /onboarding; finishing or skipping
 * the wizard sets the flag and returns the user to the dashboard.
 *
 * Progress is resumable: the wizard's actual work (org profile, programs, board
 * members, key documents, first funder, first search profile) is written
 * straight to the real tables, so completion is *derived from live data* rather
 * than a duplicated checklist. The only thing persisted separately is the
 * user's current step pointer, kept as a per-org row in platform_config under
 * ONBOARDING_STEP_KEY so a user can close the tab and resume on the same screen
 * from any device.
 */

export const ONBOARDING_STEP_KEY = "onboarding.step";

export type OnboardingStepId =
  | "welcome"
  | "profile"
  | "programs"
  | "board"
  | "documents"
  | "funder"
  | "search";

export type OnboardingStep = {
  id: OnboardingStepId;
  /** Short label shown in the step indicator. */
  title: string;
  /** One-line summary shown under the heading. */
  description: string;
  /** Whether the step can be skipped without completing it. Welcome is informational. */
  optional: boolean;
};

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome",
    description: "A quick tour of what Benavora sets up for you.",
    optional: false,
  },
  {
    id: "profile",
    title: "Organization",
    description:
      "Your legal name, EIN, mission, and contact details - the backbone of every draft.",
    optional: false,
  },
  {
    id: "programs",
    title: "Programs",
    description:
      "The initiatives you run. Funders want concrete programs with budgets and impact.",
    optional: true,
  },
  {
    id: "board",
    title: "Board",
    description: "Your governing board - many grant applications ask for it.",
    optional: true,
  },
  {
    id: "documents",
    title: "Documents",
    description: "Upload your 501(c)(3) letter and W-9 so they're ready to attach.",
    optional: true,
  },
  {
    id: "funder",
    title: "First funder",
    description: "Add a foundation, corporation, or grantmaker you're tracking.",
    optional: true,
  },
  {
    id: "search",
    title: "Grant search",
    description: "Tell the research agents what kinds of funding to hunt for.",
    optional: true,
  },
] as const;

/** Snapshot of the live data the wizard derives completion from. */
export type OnboardingSnapshot = {
  org: Pick<
    Tables<"organizations">,
    | "id"
    | "name"
    | "dba"
    | "ein"
    | "tax_status"
    | "mission_statement"
    | "vision_statement"
    | "target_population"
    | "service_area"
    | "website"
    | "phone"
    | "email"
    | "address_line1"
    | "city"
    | "state"
    | "zip"
  >;
  programCount: number;
  boardMemberCount: number;
  documentCount: number;
  funderCount: number;
  searchProfileCount: number;
  /** Persisted step pointer (index into ONBOARDING_STEPS); -1 if none saved. */
  savedStep: number;
};

/**
 * Derive which steps are complete from live data. A step is "done" when its
 * underlying record exists, so re-running the wizard always reflects reality.
 * Welcome counts as done once the user has advanced past it at least once.
 */
export function deriveCompleted(
  snapshot: OnboardingSnapshot,
): Set<OnboardingStepId> {
  const done = new Set<OnboardingStepId>();

  const profileDone =
    isFilled(snapshot.org.name) &&
    isFilled(snapshot.org.ein) &&
    isFilled(snapshot.org.mission_statement);
  if (profileDone) done.add("profile");
  if (snapshot.programCount > 0) done.add("programs");
  if (snapshot.boardMemberCount > 0) done.add("board");
  if (snapshot.documentCount > 0) done.add("documents");
  if (snapshot.funderCount > 0) done.add("funder");
  if (snapshot.searchProfileCount > 0) done.add("search");

  // Welcome is informational: complete once they've moved on, or once any
  // later step already has data (e.g. a returning user).
  if (snapshot.savedStep > 0 || done.size > 0) done.add("welcome");

  return done;
}

/** Completion percentage across all steps, rounded to a whole number. */
export function completionPercent(completed: Set<OnboardingStepId>): number {
  return Math.round((completed.size / ONBOARDING_STEPS.length) * 100);
}

function isFilled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
