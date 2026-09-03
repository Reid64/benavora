"use client";

// Google for Nonprofits hub — bundles the Google for Nonprofits application
// manager, the Business Profile setup wizard, and the Google Resources Hub
// (knowledge base) behind one page-level tab switcher, with a shared progress
// header and a page-local Assist widget.
//
// Progress percentages are a proxy, not a literal field-completion score:
// GoogleNonprofitForm and GoogleBusinessProfileWizard each own their step
// state and persist it to localStorage (DRAFT keys below) rather than
// exposing it via props, so this page polls those drafts and reports
// `current step / total steps`. Once a form actually submits or a checklist
// downloads (the `onSubmitted`/`onChecklistDownloaded` callbacks below), that
// takes over and reports 100% regardless of the stored step.

import { useEffect, useState } from "react";
import { Building2, ClipboardList, LibraryBig } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui";
import { sectionAccent } from "@/lib/design/section-accents";
import GoogleNonprofitForm from "@/components/GoogleNonprofitForm";
import GoogleBusinessProfileWizard from "@/components/GoogleBusinessProfileWizard";
import GoogleResourcesHub from "@/components/GoogleResourcesHub";
import { ChatbotAssistant } from "@/components/ChatbotAssistant";

const FOREST_GREEN = sectionAccent("/google-nonprofit");
const GOLD = "#C49A4F";

const APPLICATION_DRAFT_KEY = "google-nonprofit-application-draft";
const APPLICATION_TOTAL_STEPS = 5; // GoogleNonprofitForm's STEPS.length

const PROFILE_DRAFT_KEY = "google-business-profile-wizard-draft";
const PROFILE_TOTAL_STEPS = 4; // GoogleBusinessProfileWizard's STEPS.length

const DRAFT_POLL_INTERVAL_MS = 1000;

type SectionId = "application" | "profile" | "resources";
type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const SECTIONS: Array<{ id: SectionId; label: string; icon: IconType }> = [
  { id: "application", label: "Application Manager", icon: ClipboardList },
  { id: "profile", label: "Business Profile Setup", icon: Building2 },
  { id: "resources", label: "Resources Hub", icon: LibraryBig },
];

function readDraftStep(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { step?: unknown };
    return typeof parsed.step === "number" ? parsed.step : null;
  } catch {
    return null;
  }
}

function stepToPercent(step: number | null, totalSteps: number): number {
  if (step === null) return 0;
  const clamped = Math.min(Math.max(step, 0), totalSteps - 1);
  return Math.round((clamped / (totalSteps - 1)) * 100);
}

function ProgressBar({
  label,
  percent,
  color,
}: {
  label: string;
  percent: number;
  color: string;
}) {
  return (
    <div className="min-w-[200px] flex-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="font-semibold" style={{ color }}>
          {percent}%
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function GoogleNonprofitPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("application");

  const [applicationStep, setApplicationStep] = useState<number | null>(null);
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);

  const [profileStep, setProfileStep] = useState<number | null>(null);
  const [profileChecklistDownloaded, setProfileChecklistDownloaded] = useState(false);

  useEffect(() => {
    function poll() {
      setApplicationStep(readDraftStep(APPLICATION_DRAFT_KEY));
      setProfileStep(readDraftStep(PROFILE_DRAFT_KEY));
    }
    poll();
    const interval = window.setInterval(poll, DRAFT_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const applicationPercent = applicationSubmitted
    ? 100
    : stepToPercent(applicationStep, APPLICATION_TOTAL_STEPS);
  const profilePercent = profileChecklistDownloaded
    ? 100
    : stepToPercent(profileStep, PROFILE_TOTAL_STEPS);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-24 sm:px-6 lg:px-8">
      <PageHeader
        title="Google for Nonprofits"
        description="Apply for the Google for Nonprofits program, set up your Google Business Profile, and reference official Google resources - all in one place."
        accent={FOREST_GREEN}
      />

      <Card className="mt-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ProgressBar label="Application Manager" percent={applicationPercent} color={FOREST_GREEN} />
          <ProgressBar label="Business Profile Setup" percent={profilePercent} color={GOLD} />
        </div>
      </Card>

      <div className="mt-6 flex flex-wrap gap-2">
        {SECTIONS.map((section) => {
          const SectionIcon = section.icon;
          const isActive = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors"
              style={
                isActive
                  ? { backgroundColor: FOREST_GREEN, borderColor: FOREST_GREEN, color: "white" }
                  : { backgroundColor: "white", borderColor: "#E2E8F0", color: "#475569" }
              }
            >
              <SectionIcon className="h-4 w-4" aria-hidden />
              {section.label}
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {activeSection === "application" && (
          <GoogleNonprofitForm onSubmitted={() => setApplicationSubmitted(true)} />
        )}
        {activeSection === "profile" && (
          <GoogleBusinessProfileWizard
            onChecklistDownloaded={() => setProfileChecklistDownloaded(true)}
          />
        )}
        {activeSection === "resources" && <GoogleResourcesHub />}
      </div>

      <ChatbotAssistant pageContext="google-nonprofit" />
    </div>
  );
}
