"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  FolderOpen,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";

import { Badge, Button, Card, Input, LoadingSpinner, Select, Textarea } from "@/components/ui";
import { PlanCard } from "@/components/billing/PlanCard";
import { createClient } from "@/lib/supabase/client";
import { FUNDER_CATEGORIES, SUBSCRIPTION_TIERS, type SubscriptionTier } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OrgState = {
  id: string;
  name: string;
  ein: string;
  tax_status: string;
  mission_statement: string;
  service_area: string;
  target_population: string;
  subscription_tier: SubscriptionTier;
};

type ProgramRow = {
  key: string;
  name: string;
  description: string;
  budget: string;
  beneficiaries_served: string;
};

type BoardMemberRow = {
  key: string;
  name: string;
  title: string;
  bio: string;
  email: string;
};

type DocSlot = {
  key: string;
  label: string;
  category: Enums<"document_category">;
  file: File | null;
  uploaded: boolean;
  storagePath: string;
};

type NarrativeDraft = {
  category: string;
  title: string;
  content: string;
};

type NarrativesState = {
  drafts: NarrativeDraft[];
  keywords: string[];
  generating: boolean;
  generated: boolean;
  genError: string | null;
};

type SearchProfileState = {
  name: string;
  keywordInput: string;
  keywords: string[];
  categories: Enums<"funder_category">[];
  geographic_scope: string;
  min_amount: string;
  max_amount: string;
};

type OnboardingData = {
  step: number;
  completed: boolean;
  org: Omit<OrgState, "subscription_tier"> & { subscription_tier: string };
  programs: { name: string; description: string; budget: number | null; beneficiaries_served: number | null }[];
  knowledge_base: { category: string; title: string; content: string; keywords: string[] | null }[];
  board_members: { name: string; title: string | null; bio: string | null; email: string | null }[];
  search_profiles: { name: string; keywords: string[] }[];
  documents: { id: string; file_name: string; category: string }[];
};

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS = [
  { id: 1, title: "Organization Profile", icon: Building2 },
  { id: 2, title: "Programs", icon: FolderOpen },
  { id: 3, title: "Knowledge Base", icon: BookOpen },
  { id: 4, title: "Board Members", icon: Users },
  { id: 5, title: "Documents", icon: FileText },
  { id: 6, title: "Search Profile", icon: Search },
  { id: 7, title: "Plan Selection", icon: CreditCard },
] as const;

const TOTAL_STEPS = STEPS.length;

const TAX_STATUS_OPTIONS = [
  { value: "501c3_public", label: "501(c)(3) Public Charity" },
  { value: "501c3_private", label: "501(c)(3) Private Foundation" },
  { value: "508c1a", label: "508(c)(1)(A) Church" },
  { value: "association_churches", label: "Association of Churches" },
  { value: "community_foundation", label: "Community Foundation" },
  { value: "509a3", label: "509(a)(3) Supporting Organization" },
  { value: "501c4", label: "501(c)(4) Social Welfare Organization" },
  { value: "501c6", label: "501(c)(6) Business League / Chamber" },
  { value: "501c7", label: "501(c)(7) Social Club" },
  { value: "other", label: "Other" },
];

const STORAGE_BUCKET = "documents";

function makeKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ step }: { step: number }) {
  const pct = Math.round(((step - 1) / (TOTAL_STEPS - 1)) * 100);
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-navy-600">
          Step {step} of {TOTAL_STEPS}
        </span>
        <span className="text-sm text-navy-500">{pct}% complete</span>
      </div>
      <div className="w-full h-2 bg-navy-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-teal-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="hidden sm:flex items-center justify-between mt-3">
        {STEPS.map((s) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <div key={s.id} className="flex flex-col items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  done
                    ? "bg-teal-500 text-white"
                    : active
                      ? "bg-navy-900 text-white"
                      : "bg-navy-100 text-navy-400"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : s.id}
              </div>
              <span
                className={`text-[10px] font-medium hidden lg:block ${
                  active ? "text-navy-900" : done ? "text-teal-600" : "text-navy-400"
                }`}
              >
                {s.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 - Organization Profile
// ---------------------------------------------------------------------------

function Step1({
  org,
  onChange,
}: {
  org: OrgState;
  onChange: (field: keyof OrgState, value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-navy-900">Organization Profile</h2>
        <p className="mt-1 text-sm text-navy-500">
          This information appears on grant applications. Funders use it to verify your
          eligibility and understand your organization.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-navy-700 mb-1">
            Legal Organization Name <span className="text-red-500">*</span>
          </label>
          <Input
            value={org.name}
            onChange={(e) => onChange("name", e.target.value)}
            placeholder="Full legal name as registered"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">EIN</label>
          <Input
            value={org.ein}
            onChange={(e) => onChange("ein", e.target.value)}
            placeholder="XX-XXXXXXX"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">Tax Status</label>
          <Select
            value={org.tax_status}
            onChange={(e) => onChange("tax_status", e.target.value)}
            options={[{ value: "", label: "Select tax status..." }, ...TAX_STATUS_OPTIONS]}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-navy-700 mb-1">
            Mission Statement
          </label>
          <Textarea
            value={org.mission_statement}
            onChange={(e) => onChange("mission_statement", e.target.value)}
            placeholder="Describe your organization's purpose in 1-3 sentences"
            rows={3}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">
            Service Area
          </label>
          <Input
            value={org.service_area}
            onChange={(e) => onChange("service_area", e.target.value)}
            placeholder="e.g. Greater Phoenix, AZ or Statewide"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">
            Target Population
          </label>
          <Input
            value={org.target_population}
            onChange={(e) => onChange("target_population", e.target.value)}
            placeholder="e.g. Low-income families, youth ages 12-18"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 - Programs
// ---------------------------------------------------------------------------

function Step2({
  programs,
  onChange,
}: {
  programs: ProgramRow[];
  onChange: (programs: ProgramRow[]) => void;
}) {
  function add() {
    onChange([
      ...programs,
      { key: makeKey(), name: "", description: "", budget: "", beneficiaries_served: "" },
    ]);
  }

  function remove(key: string) {
    onChange(programs.filter((p) => p.key !== key));
  }

  function update(key: string, field: keyof Omit<ProgramRow, "key">, value: string) {
    onChange(programs.map((p) => (p.key === key ? { ...p, [field]: value } : p)));
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-navy-900">Programs</h2>
        <p className="mt-1 text-sm text-navy-500">
          Add the programs your organization runs. Funders often restrict grants to specific
          program types, so detailed descriptions help the AI match you to the right
          opportunities.
        </p>
      </div>

      {programs.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-navy-200 p-8 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-navy-300 mb-3" />
          <p className="text-sm text-navy-500">No programs added yet.</p>
          <p className="text-xs text-navy-400 mt-1">
            Add at least one program to continue.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {programs.map((p, idx) => (
          <div key={p.key} className="rounded-lg border border-navy-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-navy-700">Program {idx + 1}</span>
              <button
                type="button"
                onClick={() => remove(p.key)}
                className="text-navy-400 hover:text-red-500 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-navy-600 mb-1">
                  Program Name <span className="text-red-500">*</span>
                </label>
                <Input
                  value={p.name}
                  onChange={(e) => update(p.key, "name", e.target.value)}
                  placeholder="e.g. Youth Mentorship Initiative"
                  className="text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-navy-600 mb-1">
                  Description
                </label>
                <Textarea
                  value={p.description}
                  onChange={(e) => update(p.key, "description", e.target.value)}
                  placeholder="What does this program do? Who does it serve?"
                  rows={2}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-600 mb-1">
                  Annual Budget ($)
                </label>
                <Input
                  type="number"
                  value={p.budget}
                  onChange={(e) => update(p.key, "budget", e.target.value)}
                  placeholder="0"
                  className="text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-600 mb-1">
                  Beneficiaries Served / Year
                </label>
                <Input
                  type="number"
                  value={p.beneficiaries_served}
                  onChange={(e) => update(p.key, "beneficiaries_served", e.target.value)}
                  placeholder="0"
                  className="text-sm"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={add}>
        <Plus className="h-4 w-4" />
        Add Program
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 - Knowledge Base AI Draft
// ---------------------------------------------------------------------------

function Step3({
  state,
  onUpdateDraft,
  onRemoveKeyword,
  onRetry,
}: {
  state: NarrativesState;
  onUpdateDraft: (index: number, content: string) => void;
  onRemoveKeyword: (kw: string) => void;
  onRetry: () => void;
}) {
  if (state.generating) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-navy-900">Knowledge Base — AI Draft</h2>
          <p className="mt-1 text-sm text-navy-500">
            Generating 7 grant-ready narrative drafts from your organization profile…
          </p>
        </div>
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <LoadingSpinner />
          <p className="text-sm text-navy-500">This takes about 10–15 seconds…</p>
        </div>
      </div>
    );
  }

  if (!state.generated && state.genError) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-navy-900">Knowledge Base — AI Draft</h2>
          <p className="mt-1 text-sm text-navy-500">
            We&apos;ll generate grant-ready narrative drafts from your profile data.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">{state.genError}</p>
          <p className="text-xs text-amber-600 mt-1">
            You can retry, or skip this step and add narratives manually from the Knowledge Base page.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={onRetry}>
          Retry Generation
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-navy-900">Knowledge Base — AI Draft</h2>
        <p className="mt-1 text-sm text-navy-500">
          Review and edit these AI-generated narratives. They will be saved to your Knowledge
          Base and used to draft future grant applications. Replace any{" "}
          <span className="font-mono text-xs bg-navy-100 px-1 py-0.5 rounded">[PLACEHOLDER]</span>{" "}
          markers with your real data before submitting applications.
        </p>
      </div>

      <div className="space-y-4">
        {state.drafts.map((draft, idx) => (
          <div key={draft.category} className="rounded-lg border border-navy-200 p-4">
            <label className="block text-sm font-semibold text-navy-800 mb-2">
              {draft.title}
            </label>
            <Textarea
              value={draft.content}
              onChange={(e) => onUpdateDraft(idx, e.target.value)}
              rows={5}
              className="text-sm"
            />
          </div>
        ))}
      </div>

      {state.keywords.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-navy-800 mb-1">Suggested Keywords</p>
          <p className="text-xs text-navy-400 mb-2">
            These tags will be attached to your narratives to improve AI grant matching. Click × to
            remove any that don&apos;t apply.
          </p>
          <div className="flex flex-wrap gap-2">
            {state.keywords.map((kw) => (
              <Badge key={kw} variant="info">
                {kw}
                <button
                  type="button"
                  onClick={() => onRemoveKeyword(kw)}
                  className="hover:text-info-text/70 ml-0.5"
                  aria-label={`Remove keyword ${kw}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 - Board Members
// ---------------------------------------------------------------------------

function Step4({
  members,
  onChange,
}: {
  members: BoardMemberRow[];
  onChange: (members: BoardMemberRow[]) => void;
}) {
  function add() {
    onChange([...members, { key: makeKey(), name: "", title: "", bio: "", email: "" }]);
  }

  function remove(key: string) {
    onChange(members.filter((m) => m.key !== key));
  }

  function update(key: string, field: keyof Omit<BoardMemberRow, "key">, value: string) {
    onChange(members.map((m) => (m.key === key ? { ...m, [field]: value } : m)));
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-navy-900">Board Members</h2>
        <p className="mt-1 text-sm text-navy-500">
          Many grant applications require board member information. Add at least one
          board member to strengthen your applications. You can add more from the
          Settings page later.
        </p>
      </div>

      {members.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-navy-200 p-8 text-center">
          <Users className="mx-auto h-8 w-8 text-navy-300 mb-3" />
          <p className="text-sm text-navy-500">No board members added yet.</p>
          <p className="text-xs text-navy-400 mt-1">Add at least one to continue.</p>
        </div>
      )}

      <div className="space-y-4">
        {members.map((m, idx) => (
          <div key={m.key} className="rounded-lg border border-navy-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-navy-700">
                Board Member {idx + 1}
              </span>
              <button
                type="button"
                onClick={() => remove(m.key)}
                className="text-navy-400 hover:text-red-500 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-navy-600 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <Input
                  value={m.name}
                  onChange={(e) => update(m.key, "name", e.target.value)}
                  placeholder="Jane Smith"
                  className="text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-600 mb-1">
                  Board Title
                </label>
                <Input
                  value={m.title}
                  onChange={(e) => update(m.key, "title", e.target.value)}
                  placeholder="Chair, Secretary, Treasurer..."
                  className="text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-600 mb-1">
                  Email
                </label>
                <Input
                  type="email"
                  value={m.email}
                  onChange={(e) => update(m.key, "email", e.target.value)}
                  placeholder="jane@example.org"
                  className="text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-600 mb-1">
                  Short Bio
                </label>
                <Input
                  value={m.bio}
                  onChange={(e) => update(m.key, "bio", e.target.value)}
                  placeholder="Background, expertise..."
                  className="text-sm"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={add}>
        <Plus className="h-4 w-4" />
        Add Board Member
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 - Document Upload
// ---------------------------------------------------------------------------

function Step5({
  slots,
  onChange,
}: {
  slots: DocSlot[];
  onChange: (slots: DocSlot[]) => void;
}) {
  function handleFile(key: string, file: File | null) {
    onChange(slots.map((s) => (s.key === key ? { ...s, file, uploaded: false } : s)));
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-navy-900">Document Upload</h2>
        <p className="mt-1 text-sm text-navy-500">
          Upload your key organizational documents. These are frequently requested in grant
          applications and stored securely in your document library. You can skip individual
          documents and upload them later from the Documents page.
        </p>
      </div>

      <div className="space-y-4">
        {slots.map((slot) => (
          <div key={slot.key} className="rounded-lg border border-navy-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-navy-800">{slot.label}</p>
                <p className="text-xs text-navy-500 mt-0.5">
                  Category:{" "}
                  <span className="font-medium">{humanizeEnum(slot.category)}</span>
                </p>
              </div>
              {slot.uploaded && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-600">
                  <Check className="h-3.5 w-3.5" />
                  Uploaded
                </span>
              )}
            </div>

            {slot.file ? (
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-navy-700 truncate">{slot.file.name}</p>
                  <p className="text-xs text-navy-400">
                    {(slot.file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleFile(slot.key, null)}
                  className="text-navy-400 hover:text-red-500 transition-colors flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="mt-3 flex items-center gap-2 cursor-pointer">
                <input
                  type="file"
                  className="sr-only"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    handleFile(slot.key, e.target.files?.[0] ?? null)
                  }
                />
                <span className="inline-flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 font-medium">
                  <Upload className="h-4 w-4" />
                  Choose file
                </span>
                <span className="text-xs text-navy-400">PDF, Word, Excel - max 10 MB</span>
              </label>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-navy-400">
        All three documents are optional at this stage. You can upload them later from
        the Documents section.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6 - First Search Profile
// ---------------------------------------------------------------------------

function Step6({
  profile,
  onChange,
}: {
  profile: SearchProfileState;
  onChange: (profile: SearchProfileState) => void;
}) {
  function addKeyword() {
    const kw = profile.keywordInput.trim();
    if (!kw || profile.keywords.includes(kw)) return;
    onChange({ ...profile, keywords: [...profile.keywords, kw], keywordInput: "" });
  }

  function removeKeyword(kw: string) {
    onChange({ ...profile, keywords: profile.keywords.filter((k) => k !== kw) });
  }

  function toggleCategory(cat: Enums<"funder_category">) {
    const has = profile.categories.includes(cat);
    onChange({
      ...profile,
      categories: has
        ? profile.categories.filter((c) => c !== cat)
        : [...profile.categories, cat],
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-navy-900">First Search Profile</h2>
        <p className="mt-1 text-sm text-navy-500">
          Search profiles tell the AI what types of funding to look for. Set up your
          primary profile here - you can create more and fine-tune them from Search
          Profiles later.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">
            Profile Name
          </label>
          <Input
            value={profile.name}
            onChange={(e) => onChange({ ...profile, name: e.target.value })}
            placeholder="e.g. Primary Grant Search"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">
            Keywords <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-navy-400 mb-2">
            Enter words that describe the work you do and the funding you need.
          </p>
          <div className="flex gap-2">
            <Input
              value={profile.keywordInput}
              onChange={(e) => onChange({ ...profile, keywordInput: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              placeholder="youth, workforce, housing..."
            />
            <Button type="button" variant="secondary" onClick={addKeyword}>
              Add
            </Button>
          </div>
          {profile.keywords.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {profile.keywords.map((kw) => (
                <Badge key={kw} variant="info">
                  {kw}
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw)}
                    className="hover:text-info-text/70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-2">
            Funding Categories
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {FUNDER_CATEGORIES.map((cat) => {
              const selected = profile.categories.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors border ${
                    selected
                      ? "bg-teal-50 border-teal-400 text-teal-700"
                      : "bg-white border-navy-200 text-navy-600 hover:border-teal-300"
                  }`}
                >
                  {humanizeEnum(cat)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">
            Geographic Scope
          </label>
          <Input
            value={profile.geographic_scope}
            onChange={(e) => onChange({ ...profile, geographic_scope: e.target.value })}
            placeholder="e.g. Arizona, National, or leave blank for any"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">
              Minimum Grant Amount ($)
            </label>
            <Input
              type="number"
              value={profile.min_amount}
              onChange={(e) => onChange({ ...profile, min_amount: e.target.value })}
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">
              Maximum Grant Amount ($)
            </label>
            <Input
              type="number"
              value={profile.max_amount}
              onChange={(e) => onChange({ ...profile, max_amount: e.target.value })}
              placeholder="Leave blank for any"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 7 - Plan Selection
// ---------------------------------------------------------------------------

function Step7({
  currentTier,
  onChoose,
  onSkip,
  onBack,
  busy,
}: {
  currentTier: SubscriptionTier;
  onChoose: (tier: SubscriptionTier) => void;
  onSkip: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-navy-900">Choose Your Plan</h2>
        <p className="mt-1 text-sm text-navy-500">
          Start with a free trial or choose a plan that matches your needs. You can
          upgrade or downgrade at any time from the Billing page.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {SUBSCRIPTION_TIERS.map((tier) => (
          <PlanCard
            key={tier}
            tier={tier}
            currentTier={currentTier}
            onSelect={onChoose}
            busy={busy}
          />
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-navy-100 mt-6">
        <Button
          type="button"
          variant="secondary"
          onClick={onBack}
          disabled={busy}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="text-sm text-navy-500 hover:text-navy-700 underline underline-offset-2 disabled:opacity-50"
        >
          Skip for now - continue with Free plan
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

const DEFAULT_DOC_SLOTS: Omit<DocSlot, "key">[] = [
  { label: "501(c)(3) Determination Letter", category: "legal_documents", file: null, uploaded: false, storagePath: "" },
  { label: "Most Recent Form 990", category: "tax_documents", file: null, uploaded: false, storagePath: "" },
  { label: "Organizational Budget", category: "financial_documents", file: null, uploaded: false, storagePath: "" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Step state
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1
  const [org, setOrg] = useState<OrgState>({
    id: "",
    name: "",
    ein: "",
    tax_status: "",
    mission_statement: "",
    service_area: "",
    target_population: "",
    subscription_tier: "free" as SubscriptionTier,
  });

  // Step 2
  const [programs, setPrograms] = useState<ProgramRow[]>([
    { key: makeKey(), name: "", description: "", budget: "", beneficiaries_served: "" },
  ]);

  // Step 3
  const [narrativesState, setNarrativesState] = useState<NarrativesState>({
    drafts: [],
    keywords: [],
    generating: false,
    generated: false,
    genError: null,
  });

  // Step 4
  const [members, setMembers] = useState<BoardMemberRow[]>([
    { key: makeKey(), name: "", title: "", bio: "", email: "" },
  ]);

  // Step 5
  const [docSlots, setDocSlots] = useState<DocSlot[]>(
    DEFAULT_DOC_SLOTS.map((s) => ({ ...s, key: makeKey() })),
  );
  const uploadedDocsRef = useRef<{ file_name: string; storage_path: string; category: string; file_size: number; mime_type: string }[]>([]);

  // Step 6
  const [searchProfile, setSearchProfile] = useState<SearchProfileState>({
    name: "Primary Grant Search",
    keywordInput: "",
    keywords: [],
    categories: [],
    geographic_scope: "",
    min_amount: "",
    max_amount: "",
  });

  // Load existing state
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/onboarding");
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setLoadError(json?.error ?? "Could not load onboarding data.");
        return;
      }
      const data = (await res.json()) as OnboardingData;

      // Pre-fill org (cast subscription_tier to the enum type)
      setOrg({
        ...data.org,
        subscription_tier: (data.org.subscription_tier as SubscriptionTier) ?? "free",
      });

      // Resume to saved step. `data.step` is already the next step to execute
      // (e.g. after step 1 saves, data.step = 2). When completed = true, start
      // at step 1 so users can review and update their information.
      if (data.completed) {
        setCurrentStep(1);
      } else if (data.step > 0) {
        setCurrentStep(Math.min(data.step, TOTAL_STEPS));
      }

      // Pre-fill programs if any already saved
      if (data.programs.length > 0) {
        setPrograms(
          data.programs.map((p) => ({
            key: makeKey(),
            name: p.name,
            description: p.description ?? "",
            budget: p.budget != null ? String(p.budget) : "",
            beneficiaries_served: p.beneficiaries_served != null ? String(p.beneficiaries_served) : "",
          })),
        );
      }

      // Pre-fill KB narratives from existing entries (marks as generated to skip re-generation)
      if (data.knowledge_base.length > 0) {
        const TITLE_MAP: Record<string, string> = {
          mission: "Mission Statement",
          need_statement: "Need Statement",
          program_description: "Program Description",
          capacity: "Organizational Capacity",
          sustainability: "Sustainability Plan",
          partnerships: "Partnerships & Collaborations",
          organizational_history: "Organizational History",
          impact: "Impact Statement",
        };
        const prefillDrafts: NarrativeDraft[] = data.knowledge_base
          .filter((e) => e.content.trim())
          .map((e) => ({
            category: e.category,
            title: e.title || (TITLE_MAP[e.category] ?? e.category),
            content: e.content,
          }));
        const prefillKeywords = data.knowledge_base[0]?.keywords ?? [];
        setNarrativesState({
          drafts: prefillDrafts,
          keywords: prefillKeywords ?? [],
          generating: false,
          generated: true,
          genError: null,
        });
      }

      // Pre-fill board members if any
      if (data.board_members.length > 0) {
        setMembers(
          data.board_members.map((m) => ({
            key: makeKey(),
            name: m.name,
            title: m.title ?? "",
            bio: m.bio ?? "",
            email: m.email ?? "",
          })),
        );
      }

      // Pre-fill search profile
      if (data.search_profiles.length > 0) {
        const sp = data.search_profiles[0]!;
        setSearchProfile((prev) => ({
          ...prev,
          name: sp.name,
          keywords: sp.keywords,
        }));
      }

      // Mark any already-uploaded documents
      if (data.documents.length > 0) {
        setDocSlots((prev) =>
          prev.map((slot) => {
            const match = data.documents.find((d) => d.category === slot.category);
            return match ? { ...slot, uploaded: true } : slot;
          }),
        );
      }
    } catch {
      setLoadError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generateNarratives = useCallback(async () => {
    setNarrativesState((s) => ({ ...s, generating: true, genError: null }));
    try {
      const res = await fetch("/api/onboarding/generate-narratives", { method: "POST" });
      const json = (await res.json()) as {
        narratives?: NarrativeDraft[];
        keywords?: string[];
        error?: string;
      };
      if (Array.isArray(json.narratives) && Array.isArray(json.keywords)) {
        setNarrativesState((s) => ({
          ...s,
          drafts: json.narratives as NarrativeDraft[],
          keywords: json.keywords as string[],
          generating: false,
          generated: true,
        }));
      } else {
        setNarrativesState((s) => ({
          ...s,
          generating: false,
          genError: json.error ?? "Generation failed. You can skip and add narratives manually.",
        }));
      }
    } catch {
      setNarrativesState((s) => ({
        ...s,
        generating: false,
        genError: "Could not reach the AI service. You can skip and add narratives manually.",
      }));
    }
  }, []);

  useEffect(() => {
    if (currentStep === 3 && !narrativesState.generated && !narrativesState.generating) {
      void generateNarratives();
    }
  }, [currentStep, narrativesState.generated, narrativesState.generating, generateNarratives]);

  // Upload a single file to Supabase Storage and return its path
  async function uploadFile(slot: DocSlot): Promise<string | null> {
    if (!slot.file) return null;
    const path = `${org.id}/${slot.category}/${Date.now()}-${slot.file.name.replace(/\s+/g, "_")}`;
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, slot.file, { contentType: slot.file.type, upsert: false });
    if (error) throw new Error(error.message);
    return path;
  }

  async function saveStep(step: number, data: Record<string, unknown>, complete = false) {
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, data, complete }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(json?.error ?? "Save failed. Please try again.");
    }
  }

  async function handleNext(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaving(true);

    // advanceStep is only set true after the save succeeds. Any throw (validation
    // or network/DB error) leaves it false and the user stays on the current step.
    let advanceStep = false;

    try {
      switch (currentStep) {
        case 1:
          if (!org.name.trim()) throw new Error("Organization name is required.");
          await saveStep(1, {
            name: org.name,
            ein: org.ein,
            tax_status: org.tax_status,
            mission_statement: org.mission_statement,
            service_area: org.service_area,
            target_population: org.target_population,
          });
          advanceStep = true;
          break;

        case 2: {
          const validPrograms = programs.filter((p) => p.name.trim());
          if (validPrograms.length === 0) throw new Error("Add at least one program.");
          await saveStep(2, {
            programs: validPrograms.map((p) => ({
              name: p.name,
              description: p.description,
              budget: p.budget ? Number(p.budget) : null,
              beneficiaries_served: p.beneficiaries_served ? Number(p.beneficiaries_served) : null,
            })),
          });
          advanceStep = true;
          break;
        }

        case 3: {
          const validDrafts = narrativesState.drafts.filter((d) => d.content.trim());
          await saveStep(3, {
            narratives: validDrafts.map((d) => ({
              category: d.category,
              title: d.title,
              content: d.content,
            })),
            keywords: narrativesState.keywords,
          });
          advanceStep = true;
          break;
        }

        case 4: {
          const validMembers = members.filter((m) => m.name.trim());
          if (validMembers.length === 0) throw new Error("Add at least one board member.");
          await saveStep(4, {
            board_members: validMembers.map((m) => ({
              name: m.name,
              title: m.title,
              bio: m.bio,
              email: m.email,
            })),
          });
          advanceStep = true;
          break;
        }

        case 5: {
          // Upload any selected files to Storage first
          const newDocs: { file_name: string; storage_path: string; category: string; file_size: number; mime_type: string }[] = [];
          const updatedSlots = [...docSlots];

          for (let i = 0; i < updatedSlots.length; i++) {
            const slot = updatedSlots[i]!;
            if (slot.file && !slot.uploaded) {
              const path = await uploadFile(slot);
              if (path) {
                updatedSlots[i] = { ...slot, uploaded: true, storagePath: path };
                newDocs.push({
                  file_name: slot.file.name,
                  storage_path: path,
                  category: slot.category,
                  file_size: slot.file.size,
                  mime_type: slot.file.type || "application/octet-stream",
                });
              }
            }
          }

          setDocSlots(updatedSlots);
          uploadedDocsRef.current = [...uploadedDocsRef.current, ...newDocs];

          await saveStep(5, { documents: uploadedDocsRef.current });
          advanceStep = true;
          break;
        }

        case 6:
          if (searchProfile.keywords.length === 0) {
            throw new Error("Add at least one keyword.");
          }
          await saveStep(6, {
            name: searchProfile.name,
            keywords: searchProfile.keywords,
            categories: searchProfile.categories,
            geographic_scope: searchProfile.geographic_scope,
            min_amount: searchProfile.min_amount ? Number(searchProfile.min_amount) : null,
            max_amount: searchProfile.max_amount ? Number(searchProfile.max_amount) : null,
          });
          advanceStep = true;
          break;

        default:
          break;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "An error occurred. Please try again.");
    } finally {
      setSaving(false);
    }

    // Only advance after a confirmed save — never on error.
    if (advanceStep && currentStep < TOTAL_STEPS) {
      setCurrentStep((s) => s + 1);
    }
  }

  async function handleChoosePlan(tier: SubscriptionTier) {
    setSaving(true);
    setSaveError(null);
    try {
      // Complete onboarding, then go to billing to handle Stripe checkout
      await saveStep(7, {}, true);
      if (tier === "free") {
        router.push("/dashboard");
      } else {
        router.push(`/billing?checkout=${tier}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveStep(7, {}, true);
      router.push("/dashboard");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (currentStep > 1) setCurrentStep((s) => s - 1);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner center label="Loading your setup wizard..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center">
        <p className="text-red-600 mb-4">{loadError}</p>
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-navy-900">Welcome to Benavora</h1>
        <p className="mt-2 text-navy-500">
          Complete these steps to set up your account and start finding funding
          opportunities.
        </p>
      </div>

      <ProgressBar step={currentStep} />

      <form onSubmit={(e) => void handleNext(e)}>
        <Card>
          {currentStep === 1 && (
            <Step1 org={org} onChange={(f, v) => setOrg((o) => ({ ...o, [f]: v }))} />
          )}
          {currentStep === 2 && (
            <Step2 programs={programs} onChange={setPrograms} />
          )}
          {currentStep === 3 && (
            <Step3
              state={narrativesState}
              onUpdateDraft={(idx, content) =>
                setNarrativesState((s) => ({
                  ...s,
                  drafts: s.drafts.map((d, i) => (i === idx ? { ...d, content } : d)),
                }))
              }
              onRemoveKeyword={(kw) =>
                setNarrativesState((s) => ({
                  ...s,
                  keywords: s.keywords.filter((k) => k !== kw),
                }))
              }
              onRetry={() =>
                setNarrativesState((s) => ({ ...s, generated: false, genError: null }))
              }
            />
          )}
          {currentStep === 4 && (
            <Step4 members={members} onChange={setMembers} />
          )}
          {currentStep === 5 && (
            <Step5 slots={docSlots} onChange={setDocSlots} />
          )}
          {currentStep === 6 && (
            <Step6 profile={searchProfile} onChange={setSearchProfile} />
          )}
          {currentStep === 7 && (
            <Step7
              currentTier={org.subscription_tier}
              onChoose={(t) => void handleChoosePlan(t)}
              onSkip={() => void handleSkip()}
              onBack={handleBack}
              busy={saving}
            />
          )}

          {saveError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {saveError}
            </div>
          )}

          {currentStep < TOTAL_STEPS && (
            <div className="flex items-center justify-between mt-6 pt-5 border-t border-navy-100">
              <Button
                type="button"
                variant="secondary"
                onClick={handleBack}
                disabled={currentStep === 1 || saving}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>

              <Button type="submit" isLoading={saving} disabled={saving}>
                Save &amp; Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </Card>
      </form>
    </div>
  );
}





