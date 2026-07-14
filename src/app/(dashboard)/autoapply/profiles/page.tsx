"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Copy,
  DollarSign,
  Home,
  Loader2,
  MapPin,
  Package,
  Plus,
  Star,
  Users,
  Users2,
  X,
} from "lucide-react";

import { Badge, Button, Card } from "@/components/ui";
import type { BadgeColor } from "@/components/ui/Badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const REQUEST_TYPES = [
  "monetary",
  "land",
  "in_kind",
  "volunteer",
  "service",
  "partnership",
  "sponsorship",
  "facility",
] as const;

type RequestType = (typeof REQUEST_TYPES)[number];

interface RequestProfile {
  id: string;
  name: string;
  request_type: string;
  priority: number;
  active: boolean;
  needs_description: string;
  specific_requirements: Record<string, unknown>;
  target_funder_categories: string[] | null;
  target_funder_types: string[] | null;
  pitch_template: string | null;
  success_criteria: string | null;
  min_value: number | null;
  max_value: number | null;
  value_unit: string;
  created_at: string;
  // enriched by GET /api/autoapply/profiles
  submission_count: number;
  success_rate: number | null;
}

interface ReadinessReport {
  ready: boolean;
  missing: string[];
  expired: string[];
  score: number;
}

// ---------------------------------------------------------------------------
// Display metadata per request type
// ---------------------------------------------------------------------------

const TYPE_META: Record<
  RequestType,
  {
    label: string;
    color: BadgeColor;
    icon: ComponentType<{ className?: string }>;
    description: string;
    defaultPitch: string;
  }
> = {
  monetary: {
    label: "Monetary",
    color: "green",
    icon: DollarSign,
    description: "Cash grants, donations, and sponsorships",
    defaultPitch:
      "We are seeking financial support to advance our mission of providing essential services to vulnerable populations in our community.",
  },
  land: {
    label: "Land",
    color: "yellow",
    icon: MapPin,
    description: "Property donations, land grants, and easements",
    defaultPitch:
      "We are seeking a land donation to develop permanently affordable housing for families in need.",
  },
  in_kind: {
    label: "In-Kind",
    color: "blue",
    icon: Package,
    description: "Physical goods, equipment, materials, and supplies",
    defaultPitch:
      "We are requesting in-kind donations of materials and supplies to support our program operations and community impact.",
  },
  volunteer: {
    label: "Volunteer",
    color: "purple",
    icon: Users,
    description: "Skilled labor, mentoring, and event support",
    defaultPitch:
      "We are seeking volunteer support from skilled professionals to expand our capacity to serve the community.",
  },
  service: {
    label: "Service",
    color: "teal",
    icon: Briefcase,
    description: "Pro bono professional services and consulting",
    defaultPitch:
      "We are requesting pro bono professional services to strengthen our organizational capacity and mission effectiveness.",
  },
  partnership: {
    label: "Partnership",
    color: "orange",
    icon: Users2,
    description: "Co-branded programs and joint ventures",
    defaultPitch:
      "We are seeking a partnership to co-develop programs that align with our shared community goals and expand collective impact.",
  },
  sponsorship: {
    label: "Sponsorship",
    color: "pink",
    icon: Star,
    description: "Event and program sponsorship with branding",
    defaultPitch:
      "We invite you to sponsor our upcoming program, which will provide valuable visibility for your brand while directly supporting our mission.",
  },
  facility: {
    label: "Facility",
    color: "gray",
    icon: Home,
    description: "Office space, warehouses, event venues, and storage",
    defaultPitch:
      "We are seeking donated or reduced-cost facility space to support our program delivery and administrative operations.",
  },
};

const FUNDER_CATEGORY_OPTIONS = [
  { value: "private_foundation", label: "Private Foundation" },
  { value: "corporate_donation", label: "Corporate Donation" },
  { value: "corporate_sponsorship", label: "Corporate Sponsorship" },
  { value: "corporate_foundation", label: "Corporate Foundation" },
  { value: "government_grant", label: "Government Grant" },
  { value: "local_community_grant", label: "Community Foundation" },
  { value: "housing_grant", label: "Housing Grant" },
  { value: "faith_compatible_grant", label: "Faith-Compatible Grant" },
  { value: "in_kind_donation", label: "In-Kind Donation" },
];

const ZONING_OPTIONS = ["residential", "mixed-use", "commercial", "agricultural", "industrial"];

const SKILL_OPTIONS = [
  "carpentry",
  "electrical",
  "plumbing",
  "masonry",
  "roofing",
  "painting",
  "landscaping",
  "legal",
  "accounting",
  "marketing",
  "IT / tech",
  "mentoring",
  "administration",
];

// ---------------------------------------------------------------------------
// Wizard state
// ---------------------------------------------------------------------------

interface InKindItem {
  name: string;
  quantity: string;
}

interface WizardState {
  step: 1 | 2 | 3 | 4 | 5;
  // Step 1
  type: RequestType | null;
  // Step 2 — shared
  name: string;
  needs_description: string;
  min_value: string;
  max_value: string;
  // Step 2 — type-specific inside specific_requirements
  minAcreage: string;
  zoning: string[];
  counties: string;
  accessRequirements: string;
  developmentPlan: string;
  inKindItems: InKindItem[];
  deliveryLocation: string;
  inKindTimeline: string;
  skillsNeeded: string[];
  hoursPerWeek: string;
  durationMonths: string;
  volunteerSchedule: string;
  serviceType: string;
  serviceScope: string;
  estimatedHours: string;
  mutualBenefits: string;
  sponsorshipType: string;
  estimatedAudience: string;
  spaceType: string;
  sizeSqft: string;
  facilityDurationMonths: string;
  // Step 3
  targetFunderCategories: string[];
  geographicScope: string;
  // Step 4
  pitchTemplate: string;
  // Step 5
  activate: boolean;
}

const initialWizard: WizardState = {
  step: 1,
  type: null,
  name: "",
  needs_description: "",
  min_value: "",
  max_value: "",
  minAcreage: "",
  zoning: [],
  counties: "",
  accessRequirements: "",
  developmentPlan: "",
  inKindItems: [{ name: "", quantity: "" }],
  deliveryLocation: "",
  inKindTimeline: "",
  skillsNeeded: [],
  hoursPerWeek: "",
  durationMonths: "",
  volunteerSchedule: "",
  serviceType: "",
  serviceScope: "",
  estimatedHours: "",
  mutualBenefits: "",
  sponsorshipType: "",
  estimatedAudience: "",
  spaceType: "",
  sizeSqft: "",
  facilityDurationMonths: "",
  targetFunderCategories: [],
  geographicScope: "",
  pitchTemplate: "",
  activate: true,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RequestProfilesPage() {
  const [profiles, setProfiles] = useState<RequestProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizard, setWizard] = useState<WizardState>(initialWizard);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    const res = await fetch("/api/autoapply/profiles");
    if (res.ok) {
      const json = (await res.json()) as { profiles: RequestProfile[] };
      setProfiles(json.profiles);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([
        loadProfiles(),
        fetch("/api/autoapply/documents/readiness")
          .then(async (r) => {
            if (!r.ok) return null;
            return (await r.json()) as ReadinessReport;
          })
          .then((data) => setReadiness(data))
          .catch(() => null),
      ]);
      setLoading(false);
    }
    void init();
  }, [loadProfiles]);

  // -------------------------------------------------------------------------
  // Wizard helpers
  // -------------------------------------------------------------------------

  function openWizard() {
    setWizard(initialWizard);
    setSaveError(null);
    setShowWizard(true);
  }

  function closeWizard() {
    setShowWizard(false);
  }

  function setWizardField<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setWizard((prev) => ({ ...prev, [key]: value }));
  }

  function selectType(t: RequestType) {
    setWizard((prev) => ({
      ...prev,
      type: t,
      pitchTemplate: TYPE_META[t].defaultPitch,
      step: 2,
    }));
  }

  function buildSpecificRequirements(w: WizardState): Record<string, unknown> {
    if (!w.type) return {};
    switch (w.type) {
      case "land":
        return {
          min_acreage: w.minAcreage ? parseFloat(w.minAcreage) : undefined,
          zoning: w.zoning.length > 0 ? w.zoning : undefined,
          counties: w.counties
            ? w.counties
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          access_requirements: w.accessRequirements || undefined,
          development_plan: w.developmentPlan || undefined,
        };
      case "in_kind":
        return {
          items: w.inKindItems.filter((i) => i.name.trim()),
          delivery_location: w.deliveryLocation || undefined,
          timeline: w.inKindTimeline || undefined,
        };
      case "volunteer":
        return {
          skills_needed: w.skillsNeeded.length > 0 ? w.skillsNeeded : undefined,
          hours_per_week: w.hoursPerWeek ? parseInt(w.hoursPerWeek, 10) : undefined,
          duration_months: w.durationMonths ? parseInt(w.durationMonths, 10) : undefined,
          schedule: w.volunteerSchedule || undefined,
        };
      case "service":
        return {
          service_type: w.serviceType || undefined,
          scope: w.serviceScope || undefined,
          estimated_hours: w.estimatedHours ? parseInt(w.estimatedHours, 10) : undefined,
        };
      case "partnership":
        return { mutual_benefits: w.mutualBenefits || undefined };
      case "sponsorship":
        return {
          sponsorship_type: w.sponsorshipType || undefined,
          estimated_audience: w.estimatedAudience ? parseInt(w.estimatedAudience, 10) : undefined,
        };
      case "facility":
        return {
          space_type: w.spaceType || undefined,
          size_sqft: w.sizeSqft ? parseInt(w.sizeSqft, 10) : undefined,
          duration_months: w.facilityDurationMonths
            ? parseInt(w.facilityDurationMonths, 10)
            : undefined,
        };
      default:
        return {};
    }
  }

  async function handleCreate() {
    if (!wizard.type) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        name: wizard.name,
        request_type: wizard.type,
        needs_description: wizard.needs_description,
        active: wizard.activate,
        priority: 100,
        specific_requirements: buildSpecificRequirements(wizard),
        target_funder_categories:
          wizard.targetFunderCategories.length > 0 ? wizard.targetFunderCategories : null,
        geographic_requirements: wizard.geographicScope
          ? {
              states: wizard.geographicScope
                .split(",")
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean),
            }
          : null,
        pitch_template: wizard.pitchTemplate || null,
        min_value:
          wizard.min_value && !isNaN(parseFloat(wizard.min_value))
            ? parseFloat(wizard.min_value)
            : null,
        max_value:
          wizard.max_value && !isNaN(parseFloat(wizard.max_value))
            ? parseFloat(wizard.max_value)
            : null,
        value_unit: "usd",
      };

      const res = await fetch("/api/autoapply/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(err.error ?? "Failed to create profile.");
        return;
      }

      await loadProfiles();
      closeWizard();
    } catch {
      setSaveError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(profile: RequestProfile) {
    const res = await fetch("/api/autoapply/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `${profile.name} (copy)`,
        request_type: profile.request_type,
        needs_description: profile.needs_description,
        active: false,
        priority: profile.priority,
        specific_requirements: profile.specific_requirements,
        target_funder_categories: profile.target_funder_categories,
        pitch_template: profile.pitch_template,
        success_criteria: profile.success_criteria,
        min_value: profile.min_value,
        max_value: profile.max_value,
        value_unit: profile.value_unit,
      }),
    });
    if (res.ok) await loadProfiles();
  }

  async function handleToggleActive(profile: RequestProfile) {
    setTogglingId(profile.id);
    await fetch(`/api/autoapply/profiles/${profile.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !profile.active }),
    });
    await loadProfiles();
    setTogglingId(null);
  }

  async function handleArchive(profile: RequestProfile) {
    if (!confirm(`Archive "${profile.name}"? It will no longer be used for new submissions.`))
      return;
    await fetch(`/api/autoapply/profiles/${profile.id}`, { method: "DELETE" });
    await loadProfiles();
  }

  // -------------------------------------------------------------------------
  // Step validation
  // -------------------------------------------------------------------------

  function canAdvanceStep2(): boolean {
    if (!wizard.name.trim() || !wizard.needs_description.trim()) return false;
    return true;
  }

  function canAdvanceStep4(): boolean {
    return wizard.pitchTemplate.trim().length > 0;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  const activeProfiles = profiles.filter((p) => p.active);
  const archivedProfiles = profiles.filter((p) => !p.active);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-navy-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading profiles…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/autoapply"
          className="flex items-center gap-1.5 text-sm text-navy-400 hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to AutoApply
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Request Profiles
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Define what your organization is seeking — cash, land, materials, volunteers, or
            services. AutoApply matches each funder to the most appropriate profile before
            submitting.
          </p>
        </div>
        <Button onClick={openWizard}>
          <Plus className="mr-1.5 h-4 w-4" />
          Create Profile
        </Button>
      </div>

      {/* Org Readiness Banner */}
      {readiness !== null && (
        <ReadinessBanner readiness={readiness} />
      )}

      {/* Active profiles */}
      {activeProfiles.length === 0 ? (
        <Card title="No active profiles">
          <div className="py-8 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-navy-300" />
            <p className="text-sm text-navy-500">
              Create your first request profile to tell AutoApply what you need.
            </p>
            <div className="mt-4">
              <Button onClick={openWizard}>
                <Plus className="mr-1.5 h-4 w-4" />
                Create Profile
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activeProfiles.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              toggling={togglingId === p.id}
              onToggle={handleToggleActive}
              onDuplicate={handleDuplicate}
              onArchive={handleArchive}
            />
          ))}
        </div>
      )}

      {/* Archived profiles */}
      {archivedProfiles.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-navy-400">Archived</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {archivedProfiles.map((p) => (
              <ProfileCard
                key={p.id}
                profile={p}
                toggling={togglingId === p.id}
                onToggle={handleToggleActive}
                onDuplicate={handleDuplicate}
                onArchive={handleArchive}
              />
            ))}
          </div>
        </div>
      )}

      {/* Wizard Modal */}
      {showWizard && (
        <WizardModal
          wizard={wizard}
          saving={saving}
          saveError={saveError}
          onClose={closeWizard}
          onSetField={setWizardField}
          onSelectType={selectType}
          onCreate={handleCreate}
          canAdvanceStep2={canAdvanceStep2}
          canAdvanceStep4={canAdvanceStep4}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Readiness Banner
// ---------------------------------------------------------------------------

function ReadinessBanner({ readiness }: { readiness: ReadinessReport }) {
  if (readiness.ready && readiness.score >= 80) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-teal-600" />
        <div className="flex-1">
          <p className="text-sm font-medium text-teal-800">
            Document vault ready — {readiness.score}% complete
          </p>
          <p className="text-xs text-teal-600">
            All required documents are present. AutoApply can include them in submissions.
          </p>
        </div>
      </div>
    );
  }

  const issues: string[] = [];
  if (readiness.missing.length > 0)
    issues.push(`Missing: ${readiness.missing.join(", ")}`);
  if (readiness.expired.length > 0)
    issues.push(`Expired: ${readiness.expired.join(", ")}`);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
      <div className="flex-1">
        <p className="text-sm font-medium text-amber-800">
          Document vault incomplete — {readiness.score}% ready
        </p>
        {issues.length > 0 && (
          <p className="mt-0.5 text-xs text-amber-700">{issues.join(" · ")}</p>
        )}
      </div>
      <Link href="/documents">
        <Button variant="secondary">Upload Docs</Button>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile Card
// ---------------------------------------------------------------------------

function ProfileCard({
  profile,
  toggling,
  onToggle,
  onDuplicate,
  onArchive,
}: {
  profile: RequestProfile;
  toggling: boolean;
  onToggle: (p: RequestProfile) => void;
  onDuplicate: (p: RequestProfile) => void;
  onArchive: (p: RequestProfile) => void;
}) {
  const rt = profile.request_type as RequestType;
  const meta = TYPE_META[rt] ?? TYPE_META.monetary;
  const Icon = meta.icon;

  return (
    <div
      className={`rounded-xl border p-4 transition-opacity ${
        profile.active
          ? "border-border bg-surface shadow-sm"
          : "border-navy-100 bg-navy-50 opacity-60"
      }`}
    >
      {/* Top row: icon + badge + active toggle */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-100">
            <Icon className="h-4 w-4 text-navy-600" />
          </span>
          <Badge color={meta.color}>{meta.label}</Badge>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={profile.active}
          onClick={() => onToggle(profile)}
          disabled={toggling}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 disabled:cursor-wait ${
            profile.active ? "bg-teal-500" : "bg-navy-200"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              profile.active ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Name */}
      <p className="mt-3 text-sm font-medium text-navy-900">{profile.name}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-navy-500">{profile.needs_description}</p>

      {/* Stats */}
      <div className="mt-3 flex items-center gap-4 border-t border-navy-100 pt-3">
        <div>
          <p className="text-xs text-navy-400">Submissions</p>
          <p className="text-sm font-medium text-navy-700">{profile.submission_count}</p>
        </div>
        {profile.success_rate !== null && (
          <div>
            <p className="text-xs text-navy-400">Success rate</p>
            <p className="text-sm font-medium text-navy-700">{profile.success_rate}%</p>
          </div>
        )}
        {(profile.min_value ?? profile.max_value) && (
          <div className="ml-auto">
            <p className="text-xs text-navy-400">Ask range</p>
            <p className="text-sm font-medium text-navy-700">
              {profile.min_value != null ? `$${profile.min_value.toLocaleString()}` : ""}
              {profile.min_value != null && profile.max_value != null ? " – " : ""}
              {profile.max_value != null ? `$${profile.max_value.toLocaleString()}` : ""}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2 border-t border-navy-100 pt-3">
        <button
          type="button"
          onClick={() => onDuplicate(profile)}
          title="Duplicate profile"
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-navy-500 hover:bg-navy-100 hover:text-navy-700"
        >
          <Copy className="h-3.5 w-3.5" />
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => onArchive(profile)}
          title="Archive profile"
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-navy-500 hover:bg-red-50 hover:text-red-600"
        >
          <X className="h-3.5 w-3.5" />
          Archive
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard Modal
// ---------------------------------------------------------------------------

function WizardModal({
  wizard,
  saving,
  saveError,
  onClose,
  onSetField,
  onSelectType,
  onCreate,
  canAdvanceStep2,
  canAdvanceStep4,
}: {
  wizard: WizardState;
  saving: boolean;
  saveError: string | null;
  onClose: () => void;
  onSetField: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
  onSelectType: (t: RequestType) => void;
  onCreate: () => void;
  canAdvanceStep2: () => boolean;
  canAdvanceStep4: () => boolean;
}) {
  const STEP_LABELS = ["Type", "Details", "Target", "Pitch", "Review"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create request profile"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded p-1 text-navy-400 hover:bg-navy-100 hover:text-navy-700"
          aria-label="Close wizard"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="border-b border-navy-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-navy-900">Create Request Profile</h2>
          {/* Step indicator */}
          <div className="mt-3 flex items-center gap-1">
            {STEP_LABELS.map((label, idx) => {
              const stepNum = (idx + 1) as 1 | 2 | 3 | 4 | 5;
              const done = wizard.step > stepNum;
              const active = wizard.step === stepNum;
              return (
                <div key={label} className="flex items-center gap-1">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                      done
                        ? "bg-teal-500 text-white"
                        : active
                          ? "bg-navy-900 text-white"
                          : "bg-navy-100 text-navy-400"
                    }`}
                  >
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : stepNum}
                  </div>
                  <span
                    className={`text-xs ${active ? "font-medium text-navy-700" : "text-navy-400"}`}
                  >
                    {label}
                  </span>
                  {idx < STEP_LABELS.length - 1 && (
                    <ChevronRight className="h-3 w-3 text-navy-300" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {wizard.step === 1 && <Step1TypeGrid onSelectType={onSelectType} />}
          {wizard.step === 2 && wizard.type && (
            <Step2Details wizard={wizard} onSetField={onSetField} />
          )}
          {wizard.step === 3 && (
            <Step3Target wizard={wizard} onSetField={onSetField} />
          )}
          {wizard.step === 4 && (
            <Step4Pitch wizard={wizard} onSetField={onSetField} />
          )}
          {wizard.step === 5 && wizard.type && (
            <Step5Review wizard={wizard} onSetField={onSetField} />
          )}

          {saveError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          )}
        </div>

        {/* Footer */}
        {wizard.step > 1 && (
          <div className="flex items-center justify-between border-t border-navy-100 px-6 py-4">
            <Button
              variant="secondary"
              onClick={() =>
                onSetField("step", (wizard.step - 1) as WizardState["step"])
              }
              disabled={saving}
            >
              Back
            </Button>
            {wizard.step < 5 ? (
              <Button
                onClick={() =>
                  onSetField("step", (wizard.step + 1) as WizardState["step"])
                }
                disabled={
                  (wizard.step === 2 && !canAdvanceStep2()) ||
                  (wizard.step === 4 && !canAdvanceStep4())
                }
              >
                Continue
              </Button>
            ) : (
              <Button onClick={onCreate} isLoading={saving} disabled={saving}>
                {wizard.activate ? "Create & Activate" : "Create (Inactive)"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Type selection grid
// ---------------------------------------------------------------------------

function Step1TypeGrid({ onSelectType }: { onSelectType: (t: RequestType) => void }) {
  return (
    <div>
      <p className="mb-4 text-sm text-navy-600">
        What is your organization seeking from funders?
      </p>
      <div className="grid grid-cols-2 gap-3">
        {REQUEST_TYPES.map((rt) => {
          const meta = TYPE_META[rt];
          const Icon = meta.icon;
          return (
            <button
              key={rt}
              type="button"
              onClick={() => onSelectType(rt)}
              className="flex items-start gap-3 rounded-lg border border-navy-200 p-4 text-left transition-colors hover:border-teal-400 hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-400"
            >
              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-navy-100">
                <Icon className="h-4 w-4 text-navy-600" />
              </span>
              <div>
                <p className="text-sm font-medium text-navy-900">{meta.label}</p>
                <p className="mt-0.5 text-xs text-navy-500">{meta.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Type-specific details
// ---------------------------------------------------------------------------

function Step2Details({
  wizard,
  onSetField,
}: {
  wizard: WizardState;
  onSetField: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
}) {
  const rt = wizard.type!;
  const meta = TYPE_META[rt];

  function toggleZoning(z: string) {
    const next = wizard.zoning.includes(z)
      ? wizard.zoning.filter((x) => x !== z)
      : [...wizard.zoning, z];
    onSetField("zoning", next);
  }

  function toggleSkill(s: string) {
    const next = wizard.skillsNeeded.includes(s)
      ? wizard.skillsNeeded.filter((x) => x !== s)
      : [...wizard.skillsNeeded, s];
    onSetField("skillsNeeded", next);
  }

  function updateInKindItem(idx: number, field: keyof InKindItem, value: string) {
    const next = wizard.inKindItems.map((item, i) =>
      i === idx ? { ...item, [field]: value } : item,
    );
    onSetField("inKindItems", next);
  }

  function addInKindItem() {
    onSetField("inKindItems", [...wizard.inKindItems, { name: "", quantity: "" }]);
  }

  function removeInKindItem(idx: number) {
    onSetField(
      "inKindItems",
      wizard.inKindItems.filter((_, i) => i !== idx),
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Badge color={meta.color}>{meta.label}</Badge>
        <span className="text-sm text-navy-500">profile details</span>
      </div>

      {/* Name — always shown */}
      <div>
        <label className="block text-sm font-medium text-navy-700">
          Profile Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={wizard.name}
          onChange={(e) => onSetField("name", e.target.value)}
          placeholder={`e.g. ${meta.label} — General Operating`}
          className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </div>

      {/* Needs description — always shown */}
      <div>
        <label className="block text-sm font-medium text-navy-700">
          What are you seeking? <span className="text-red-500">*</span>
        </label>
        <p className="mt-0.5 text-xs text-navy-400">
          One or two sentences describing what you need and why.
        </p>
        <textarea
          value={wizard.needs_description}
          onChange={(e) => onSetField("needs_description", e.target.value)}
          rows={3}
          placeholder={`e.g. ${meta.defaultPitch.slice(0, 80)}…`}
          className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </div>

      {/* Monetary / Sponsorship: value range */}
      {(rt === "monetary" || rt === "sponsorship") && (
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-navy-700">Min ask ($)</label>
            <input
              type="number"
              min={0}
              value={wizard.min_value}
              onChange={(e) => onSetField("min_value", e.target.value)}
              placeholder="e.g. 5000"
              className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-navy-700">Max ask ($)</label>
            <input
              type="number"
              min={0}
              value={wizard.max_value}
              onChange={(e) => onSetField("max_value", e.target.value)}
              placeholder="e.g. 100000"
              className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
        </div>
      )}

      {/* Land-specific */}
      {rt === "land" && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="w-40">
              <label className="block text-sm font-medium text-navy-700">Min acreage</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={wizard.minAcreage}
                onChange={(e) => onSetField("minAcreage", e.target.value)}
                placeholder="e.g. 5"
                className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-navy-700">Acceptable zoning</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ZONING_OPTIONS.map((z) => (
                <label key={z} className="flex cursor-pointer items-center gap-1.5 text-sm text-navy-700">
                  <input
                    type="checkbox"
                    checked={wizard.zoning.includes(z)}
                    onChange={() => toggleZoning(z)}
                    className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                  />
                  {z}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700">Counties (comma-separated)</label>
            <input
              type="text"
              value={wizard.counties}
              onChange={(e) => onSetField("counties", e.target.value)}
              placeholder="e.g. Travis, Williamson, Hays"
              className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700">Development plan</label>
            <input
              type="text"
              value={wizard.developmentPlan}
              onChange={(e) => onSetField("developmentPlan", e.target.value)}
              placeholder="e.g. 20-unit affordable housing community"
              className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
        </div>
      )}

      {/* In-kind */}
      {rt === "in_kind" && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-navy-700">Items needed</p>
            <div className="mt-2 space-y-2">
              {wizard.inKindItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateInKindItem(idx, "name", e.target.value)}
                    placeholder="Item name"
                    className="flex-1 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                  <input
                    type="text"
                    value={item.quantity}
                    onChange={(e) => updateInKindItem(idx, "quantity", e.target.value)}
                    placeholder="Quantity"
                    className="w-32 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                  {wizard.inKindItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeInKindItem(idx)}
                      className="text-navy-400 hover:text-red-500"
                      aria-label="Remove item"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addInKindItem}
              className="mt-2 flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700"
            >
              <Plus className="h-3.5 w-3.5" /> Add item
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700">Delivery location</label>
            <input
              type="text"
              value={wizard.deliveryLocation}
              onChange={(e) => onSetField("deliveryLocation", e.target.value)}
              placeholder="e.g. 123 Main St, Austin TX"
              className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700">Timeline needed</label>
            <input
              type="text"
              value={wizard.inKindTimeline}
              onChange={(e) => onSetField("inKindTimeline", e.target.value)}
              placeholder="e.g. Q1 2027"
              className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
        </div>
      )}

      {/* Volunteer */}
      {rt === "volunteer" && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-navy-700">Skills needed</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SKILL_OPTIONS.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-1.5 text-sm text-navy-700">
                  <input
                    type="checkbox"
                    checked={wizard.skillsNeeded.includes(s)}
                    onChange={() => toggleSkill(s)}
                    className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-4">
            <div>
              <label className="block text-sm font-medium text-navy-700">Hours/week</label>
              <input
                type="number"
                min={1}
                value={wizard.hoursPerWeek}
                onChange={(e) => onSetField("hoursPerWeek", e.target.value)}
                placeholder="e.g. 20"
                className="mt-1.5 block w-28 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700">Duration (months)</label>
              <input
                type="number"
                min={1}
                value={wizard.durationMonths}
                onChange={(e) => onSetField("durationMonths", e.target.value)}
                placeholder="e.g. 6"
                className="mt-1.5 block w-28 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700">Schedule</label>
            <input
              type="text"
              value={wizard.volunteerSchedule}
              onChange={(e) => onSetField("volunteerSchedule", e.target.value)}
              placeholder="e.g. Weekdays 8am–4pm"
              className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
        </div>
      )}

      {/* Service */}
      {rt === "service" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700">Service type</label>
            <select
              value={wizard.serviceType}
              onChange={(e) => onSetField("serviceType", e.target.value)}
              className="mt-1.5 block w-64 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            >
              <option value="">Select service type</option>
              <option value="legal">Legal</option>
              <option value="accounting">Accounting / Audit</option>
              <option value="consulting">Strategic Consulting</option>
              <option value="marketing">Marketing / PR</option>
              <option value="construction">Construction</option>
              <option value="technology">Technology / IT</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700">Scope of work</label>
            <textarea
              value={wizard.serviceScope}
              onChange={(e) => onSetField("serviceScope", e.target.value)}
              rows={2}
              placeholder="Describe what help you need"
              className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700">Estimated hours</label>
            <input
              type="number"
              min={1}
              value={wizard.estimatedHours}
              onChange={(e) => onSetField("estimatedHours", e.target.value)}
              placeholder="e.g. 40"
              className="mt-1.5 block w-28 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
        </div>
      )}

      {/* Partnership */}
      {rt === "partnership" && (
        <div>
          <label className="block text-sm font-medium text-navy-700">Mutual benefits</label>
          <p className="mt-0.5 text-xs text-navy-400">
            What does each party gain from this partnership?
          </p>
          <textarea
            value={wizard.mutualBenefits}
            onChange={(e) => onSetField("mutualBenefits", e.target.value)}
            rows={3}
            placeholder="e.g. We provide community visibility and impact reporting; you provide funding and employee engagement opportunities."
            className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
        </div>
      )}

      {/* Sponsorship */}
      {rt === "sponsorship" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700">Sponsorship type</label>
            <input
              type="text"
              value={wizard.sponsorshipType}
              onChange={(e) => onSetField("sponsorshipType", e.target.value)}
              placeholder="e.g. Annual Gala, Program Series"
              className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700">Estimated audience</label>
            <input
              type="number"
              min={0}
              value={wizard.estimatedAudience}
              onChange={(e) => onSetField("estimatedAudience", e.target.value)}
              placeholder="e.g. 500"
              className="mt-1.5 block w-40 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
        </div>
      )}

      {/* Facility */}
      {rt === "facility" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700">Space type</label>
            <select
              value={wizard.spaceType}
              onChange={(e) => onSetField("spaceType", e.target.value)}
              className="mt-1.5 block w-56 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            >
              <option value="">Select space type</option>
              <option value="office">Office space</option>
              <option value="warehouse">Warehouse / Storage</option>
              <option value="event_venue">Event venue</option>
              <option value="retail">Retail space</option>
              <option value="land">Open land</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex gap-4">
            <div>
              <label className="block text-sm font-medium text-navy-700">Size (sq ft)</label>
              <input
                type="number"
                min={0}
                value={wizard.sizeSqft}
                onChange={(e) => onSetField("sizeSqft", e.target.value)}
                placeholder="e.g. 2000"
                className="mt-1.5 block w-28 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700">Duration (months)</label>
              <input
                type="number"
                min={1}
                value={wizard.facilityDurationMonths}
                onChange={(e) => onSetField("facilityDurationMonths", e.target.value)}
                placeholder="e.g. 12"
                className="mt-1.5 block w-28 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Target criteria
// ---------------------------------------------------------------------------

function Step3Target({
  wizard,
  onSetField,
}: {
  wizard: WizardState;
  onSetField: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
}) {
  function toggleCategory(v: string) {
    const next = wizard.targetFunderCategories.includes(v)
      ? wizard.targetFunderCategories.filter((c) => c !== v)
      : [...wizard.targetFunderCategories, v];
    onSetField("targetFunderCategories", next);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-navy-700">Funder categories to target</p>
        <p className="mt-0.5 text-xs text-navy-400">
          Leave unchecked to match all categories.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {FUNDER_CATEGORY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2 text-sm text-navy-700"
            >
              <input
                type="checkbox"
                checked={wizard.targetFunderCategories.includes(opt.value)}
                onChange={() => toggleCategory(opt.value)}
                className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-navy-700">Geographic scope</label>
        <p className="mt-0.5 text-xs text-navy-400">
          State codes where this need applies, comma-separated. Leave blank for nationwide.
        </p>
        <input
          type="text"
          value={wizard.geographicScope}
          onChange={(e) => onSetField("geographicScope", e.target.value)}
          placeholder="TX, OK, NM"
          className="mt-1.5 block w-64 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Pitch template
// ---------------------------------------------------------------------------

function Step4Pitch({
  wizard,
  onSetField,
}: {
  wizard: WizardState;
  onSetField: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
}) {
  const rt = wizard.type!;
  const meta = TYPE_META[rt];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-navy-600">
          This template is personalized per funder by AutoApply before submission. Include
          placeholders for funder-specific details — the AI will adapt them.
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-navy-700">
          Pitch template <span className="text-red-500">*</span>
        </label>
        <textarea
          value={wizard.pitchTemplate}
          onChange={(e) => onSetField("pitchTemplate", e.target.value)}
          rows={8}
          placeholder={meta.defaultPitch}
          className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
        <p className="mt-1 text-xs text-navy-400">
          {wizard.pitchTemplate.length} characters
        </p>
      </div>
      <button
        type="button"
        onClick={() => onSetField("pitchTemplate", meta.defaultPitch)}
        className="text-xs text-teal-600 hover:underline"
      >
        Reset to default template
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Review
// ---------------------------------------------------------------------------

function Step5Review({
  wizard,
  onSetField,
}: {
  wizard: WizardState;
  onSetField: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
}) {
  const rt = wizard.type!;
  const meta = TYPE_META[rt];

  return (
    <div className="space-y-5">
      <p className="text-sm text-navy-600">Review your profile before creating it.</p>

      <div className="rounded-lg border border-navy-200 bg-navy-50 p-4 text-sm">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-navy-400">Name</p>
            <p className="mt-0.5 font-medium text-navy-900">{wizard.name || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-navy-400">Type</p>
            <Badge color={meta.color}>{meta.label}</Badge>
          </div>
          <div className="col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
              Need description
            </p>
            <p className="mt-0.5 text-navy-700">{wizard.needs_description || "—"}</p>
          </div>
          {(wizard.min_value || wizard.max_value) && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-navy-400">Ask range</p>
              <p className="mt-0.5 text-navy-700">
                {wizard.min_value ? `$${parseFloat(wizard.min_value).toLocaleString()}` : "any"}
                {" – "}
                {wizard.max_value ? `$${parseFloat(wizard.max_value).toLocaleString()}` : "any"}
              </p>
            </div>
          )}
          {wizard.targetFunderCategories.length > 0 && (
            <div className="col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
                Target categories
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {wizard.targetFunderCategories.map((c) => (
                  <Badge key={c} color="navy">
                    {FUNDER_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {wizard.geographicScope && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
                Geographic scope
              </p>
              <p className="mt-0.5 text-navy-700">{wizard.geographicScope}</p>
            </div>
          )}
        </div>
      </div>

      {/* Activate toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface shadow-sm p-4">
        <div>
          <p className="text-sm font-medium text-navy-900">Activate immediately</p>
          <p className="mt-0.5 text-xs text-navy-500">
            Active profiles are used by AutoApply when populating the queue.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={wizard.activate}
          onClick={() => onSetField("activate", !wizard.activate)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${
            wizard.activate ? "bg-teal-500" : "bg-navy-200"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              wizard.activate ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
