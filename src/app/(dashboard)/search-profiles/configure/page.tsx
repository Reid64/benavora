"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Plus,
  Save,
  SlidersHorizontal,
  X,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  Input,
  LoadingSpinner,
  Select,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { RESEARCH_FAMILIES } from "@/lib/research/families";
import {
  AGENT_SCHEDULE_OPTIONS,
  DEFAULT_AGENT_INTERVAL_HOURS,
  ELIGIBILITY_PREFILTERS,
  FOCUS_WEIGHT_DEFAULT,
  FOCUS_WEIGHT_MAX,
  FOCUS_WEIGHT_MIN,
  GEOGRAPHIC_PRESETS,
  POPULATION_PRESETS,
  clampWeight,
  parseAgentSettings,
  parseEligibilityFilters,
  parseFocusAreas,
  parseSourceTypeFilters,
  type AgentSettings,
  type FocusArea,
  type SourceTypeFilter,
} from "@/lib/research/profile-config";
import {
  FUNDER_CATEGORIES,
  OPPORTUNITY_RECURRENCES,
  OPPORTUNITY_SOURCE_TYPES,
} from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import { isNonEmpty } from "@/lib/utils/validators";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;
type OpportunitySourceType = Enums<"opportunity_source_type">;
type SearchProfile = Tables<"search_profiles">;

// At most 10 active profiles per organization (Behavioral Contracts §14).
const MAX_ACTIVE_PROFILES = 10;

const RECURRENCE_OPTIONS = [
  { value: "", label: "Any recurrence" },
  ...OPPORTUNITY_RECURRENCES.map((value) => ({
    value,
    label: humanizeEnum(value),
  })),
];

/** Default schedule (hours) for an agent family, from its cron cadence. */
function familyDefaultHours(intervalMs: number): number {
  return Math.max(1, Math.round(intervalMs / (60 * 60 * 1000)));
}

/**
 * Full search-profile configuration (BLUEPRINT §4.12, migration 011). One page
 * to define everything the research agents read before a run: funding-type
 * toggles, source-category filters with priority, weighted focus areas, the
 * dollar range, geographic scope, eligibility pre-filters, populations served,
 * negative filters (excluded categories + funders), and per-agent enable +
 * schedule. Saves to the search_profiles table.
 *
 * Opens blank for a new profile, or prefilled when given `?id=<profile>`. The id
 * is read from the URL on mount (client-only) so no Suspense boundary is needed.
 * organization_id is derived from the session profile, never a form field
 * (Behavioral Contracts §2); reads/writes are RLS-scoped to the organization.
 */
export default function ConfigureSearchProfilePage() {
  const router = useRouter();
  const { profile: session } = useProfile();
  const editable = canEdit(session?.role);

  // The profile being edited, resolved from the URL on mount (null = create).
  const [profileId, setProfileId] = useState<string | null>(null);
  const [resolvedId, setResolvedId] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [keywordError, setKeywordError] = useState<string | null>(null);

  // Active-profile cap bookkeeping.
  const [activeCount, setActiveCount] = useState(0);
  const [wasActive, setWasActive] = useState(false);

  // --- form state ------------------------------------------------------------
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [categories, setCategories] = useState<FunderCategory[]>([]);
  const [sourceFilters, setSourceFilters] = useState<SourceTypeFilter[]>([]);
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [geographicScopes, setGeographicScopes] = useState<string[]>([]);
  const [eligibility, setEligibility] = useState<Record<string, boolean>>({});
  const [minOrgAge, setMinOrgAge] = useState("");
  const [populations, setPopulations] = useState<string[]>([]);
  const [excludedCategories, setExcludedCategories] = useState<FunderCategory[]>(
    [],
  );
  const [excludedFunders, setExcludedFunders] = useState<string[]>([]);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(() =>
    defaultAgentSettings(),
  );

  // Resolve the profile id from the URL once on mount (client-only).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    setProfileId(id && id.trim() !== "" ? id.trim() : null);
    setResolvedId(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();

    // Active-profile count (org-scoped via RLS), to enforce the activation cap.
    const { data: actives } = await supabase
      .from("search_profiles")
      .select("id, is_active");
    const activeRows = (actives ?? []) as Pick<
      SearchProfile,
      "id" | "is_active"
    >[];
    setActiveCount(activeRows.filter((p) => p.is_active).length);

    if (!profileId) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("search_profiles")
      .select("*")
      .eq("id", profileId)
      .maybeSingle();

    if (error || !data) {
      setLoadError("Could not load this search profile.");
      setLoading(false);
      return;
    }
    hydrate(data as SearchProfile);
    setLoading(false);
  }, [profileId]);

  function hydrate(p: SearchProfile) {
    setName(p.name ?? "");
    setIsActive(p.is_active ?? true);
    setWasActive(Boolean(p.is_active));
    setKeywords(p.keywords ?? []);
    setCategories(p.categories ?? []);
    setSourceFilters(parseSourceTypeFilters(p.source_type_filters));
    setFocusAreas(parseFocusAreas(p.focus_areas));
    setMinAmount(p.min_amount != null ? String(p.min_amount) : "");
    setMaxAmount(p.max_amount != null ? String(p.max_amount) : "");
    setRecurrence(p.recurrence_preference ?? "");
    // Prefer the multi-scope list; fall back to the legacy single scope.
    const scopes =
      p.geographic_scopes && p.geographic_scopes.length > 0
        ? p.geographic_scopes
        : p.geographic_scope
          ? [p.geographic_scope]
          : [];
    setGeographicScopes(scopes);
    const elig = parseEligibilityFilters(p.eligibility_filters);
    const toggles: Record<string, boolean> = {};
    for (const { key } of ELIGIBILITY_PREFILTERS) {
      toggles[key] = elig[key] === true;
    }
    setEligibility(toggles);
    setMinOrgAge(
      typeof elig.min_organization_age_years === "number"
        ? String(elig.min_organization_age_years)
        : "",
    );
    setPopulations(p.populations_served ?? []);
    setExcludedCategories(p.excluded_categories ?? []);
    setExcludedFunders(p.excluded_funders ?? []);
    setAgentSettings(mergeAgentSettings(parseAgentSettings(p.agent_settings)));
  }

  useEffect(() => {
    if (resolvedId) void load();
  }, [resolvedId, load]);

  function toggleCategory(category: FunderCategory) {
    setCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );
  }

  function toggleExcludedCategory(category: FunderCategory) {
    setExcludedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable) return;
    setNameError(null);
    setKeywordError(null);
    setFormError(null);

    if (!isNonEmpty(name)) {
      setNameError("Profile name is required.");
      return;
    }
    if (keywords.length === 0) {
      setKeywordError("Add at least one keyword.");
      return;
    }

    const min = minAmount.trim() ? Number(minAmount) : null;
    const max = maxAmount.trim() ? Number(maxAmount) : null;
    if ((min != null && Number.isNaN(min)) || (max != null && Number.isNaN(max))) {
      setFormError("Dollar amounts must be numbers.");
      return;
    }
    if (min != null && max != null && min > max) {
      setFormError("Minimum amount cannot exceed maximum amount.");
      return;
    }

    // Active-profile cap (Behavioral Contracts §14): an already-active profile
    // being edited does not count against itself.
    if (isActive && !wasActive && activeCount >= MAX_ACTIVE_PROFILES) {
      setFormError(
        `You already have ${MAX_ACTIVE_PROFILES} active profiles. Save this one as paused, or pause another first.`,
      );
      return;
    }

    if (!session?.organization_id) {
      setFormError("Your session could not be verified. Please sign in again.");
      return;
    }

    // Build the eligibility-filter object (only recognized toggles + min age).
    const eligibilityPayload: Record<string, boolean | number> = {};
    for (const { key } of ELIGIBILITY_PREFILTERS) {
      eligibilityPayload[key] = Boolean(eligibility[key]);
    }
    const age = minOrgAge.trim() ? Number(minOrgAge) : null;
    if (age != null && Number.isFinite(age) && age > 0) {
      eligibilityPayload.min_organization_age_years = age;
    }

    // Re-rank source filters by their current order (1 = highest priority).
    const sourceFilterPayload = sourceFilters.map((f, i) => ({
      source_type: f.source_type,
      priority: i + 1,
    }));

    const agentSettingsPayload: AgentSettings = {};
    for (const family of RESEARCH_FAMILIES) {
      const s = agentSettings[family.agentType];
      agentSettingsPayload[family.agentType] = {
        enabled: s ? s.enabled : true,
        intervalHours: s ? s.intervalHours : DEFAULT_AGENT_INTERVAL_HOURS,
      };
    }

    const payload = {
      name: name.trim(),
      keywords,
      categories: categories.length > 0 ? categories : null,
      // Mirror the first scope to the legacy single column for older readers.
      geographic_scope: geographicScopes[0] ?? null,
      geographic_scopes: geographicScopes,
      min_amount: min,
      max_amount: max,
      recurrence_preference: recurrence || null,
      is_active: isActive,
      source_type_filters: sourceFilterPayload,
      focus_areas: focusAreas,
      eligibility_filters: eligibilityPayload,
      populations_served: populations,
      excluded_categories: excludedCategories,
      excluded_funders: excludedFunders,
      agent_settings: agentSettingsPayload,
    };

    setSaving(true);
    const supabase = createClient();

    if (profileId) {
      const { error } = await supabase
        .from("search_profiles")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", profileId);
      setSaving(false);
      if (error) {
        setFormError(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("search_profiles")
        .insert({ ...payload, organization_id: session.organization_id });
      setSaving(false);
      if (error) {
        setFormError(error.message);
        return;
      }
    }
    router.push("/search-profiles");
  }

  const isEdit = profileId !== null;
  const availableSources = useMemo(
    () =>
      (OPPORTUNITY_SOURCE_TYPES as readonly OpportunitySourceType[]).filter(
        (s) => !sourceFilters.some((f) => f.source_type === s),
      ),
    [sourceFilters],
  );

  if (loading) {
    return <LoadingSpinner center label="Loading configuration…" />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-24" noValidate>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/search-profiles"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to search profiles
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-navy-900">
            <SlidersHorizontal className="h-6 w-6 text-teal-600" aria-hidden />
            {isEdit ? "Configure search profile" : "New search profile"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-navy-500">
            Everything here steers what the research agents hunt for. Settings are
            read before every run.
          </p>
        </div>
      </div>

      {loadError && (
        <Alert>{loadError}</Alert>
      )}
      {formError && <Alert>{formError}</Alert>}
      {!editable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You have view-only access. Configuration changes can be made by writers,
          admins, and owners.
        </div>
      )}

      {/* Basics */}
      <SectionCard
        title="Basics"
        description="Name this profile and the keywords that anchor every search."
      >
        <Input
          label="Profile name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError ?? undefined}
          placeholder="e.g. Rural Texas housing grants"
          disabled={!editable}
        />
        <TagInput
          label="Keywords"
          required
          placeholder="Type a keyword and press Enter"
          helper="Press Enter or comma to add each term. These drive the agent searches."
          value={keywords}
          onChange={setKeywords}
          error={keywordError ?? undefined}
          disabled={!editable}
        />
        <label className="flex items-start gap-3 rounded-lg border border-navy-200 bg-navy-50/50 px-4 py-3">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={!editable}
            className="mt-0.5 h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
          />
          <span className="text-sm">
            <span className="font-medium text-navy-800">Active</span>
            <span className="mt-0.5 block text-navy-500">
              Active profiles run on schedule (max {MAX_ACTIVE_PROFILES} active).
              Paused profiles keep their configuration but are skipped.
            </span>
          </span>
        </label>
      </SectionCard>

      {/* Funding type toggles */}
      <SectionCard
        title="Funding types"
        description="Which funding categories this profile pursues. Leave all off to search every type."
      >
        <CheckboxGrid
          options={FUNDER_CATEGORIES}
          selected={categories}
          onToggle={toggleCategory}
          disabled={!editable}
        />
      </SectionCard>

      {/* Source-category filters with priority ranking */}
      <SectionCard
        title="Source categories & priority"
        description="Bias the agents toward specific funding sources. Order sets priority - top = highest."
      >
        <SourcePriorityField
          value={sourceFilters}
          available={availableSources}
          onChange={setSourceFilters}
          disabled={!editable}
        />
      </SectionCard>

      {/* Focus areas with weights */}
      <SectionCard
        title="Focus areas"
        description="Weighted themes folded into the agents' search queries. Higher weight = searched first."
      >
        <FocusAreaField
          value={focusAreas}
          onChange={setFocusAreas}
          disabled={!editable}
        />
      </SectionCard>

      {/* Dollar range + recurrence */}
      <SectionCard
        title="Award size & recurrence"
        description="Target funding range and how often the opportunity recurs."
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Input
            label="Minimum amount (USD)"
            type="number"
            min={0}
            step="1000"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="No minimum"
            disabled={!editable}
          />
          <Input
            label="Maximum amount (USD)"
            type="number"
            min={0}
            step="1000"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="No maximum"
            disabled={!editable}
          />
        </div>
        <Select
          label="Recurrence preference"
          options={RECURRENCE_OPTIONS}
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
          disabled={!editable}
        />
      </SectionCard>

      {/* Geographic scope */}
      <SectionCard
        title="Geographic scope"
        description="Where funding should apply. Add as many regions as you need."
      >
        <TagInput
          label="Scopes"
          placeholder="e.g. Texas, or Nationwide"
          helper="Press Enter or comma to add. Quick-add common scopes below."
          value={geographicScopes}
          onChange={setGeographicScopes}
          presets={[...GEOGRAPHIC_PRESETS]}
          disabled={!editable}
        />
      </SectionCard>

      {/* Eligibility pre-filters */}
      <SectionCard
        title="Eligibility pre-filters"
        description="Constraints applied when matching and scoring opportunities."
      >
        <div className="space-y-2">
          {ELIGIBILITY_PREFILTERS.map(({ key, label, help }) => (
            <label
              key={key}
              className="flex items-start gap-3 rounded-lg border border-navy-200 px-3 py-2.5 text-sm"
            >
              <input
                type="checkbox"
                checked={Boolean(eligibility[key])}
                onChange={(e) =>
                  setEligibility((prev) => ({ ...prev, [key]: e.target.checked }))
                }
                disabled={!editable}
                className="mt-0.5 h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
              />
              <span>
                <span className="font-medium text-navy-800">{label}</span>
                <span className="mt-0.5 block text-navy-500">{help}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="max-w-xs">
          <Input
            label="Minimum organization age (years)"
            type="number"
            min={0}
            step="1"
            value={minOrgAge}
            onChange={(e) => setMinOrgAge(e.target.value)}
            placeholder="No minimum"
            helperText="Skip funders that require an older organization than this."
            disabled={!editable}
          />
        </div>
      </SectionCard>

      {/* Populations served */}
      <SectionCard
        title="Populations served"
        description="Communities your work serves. Folded into searches and used for matching."
      >
        <TagInput
          label="Populations"
          placeholder="e.g. Veterans, Low-income"
          helper="Press Enter or comma to add. Quick-add common populations below."
          value={populations}
          onChange={setPopulations}
          presets={[...POPULATION_PRESETS]}
          disabled={!editable}
        />
      </SectionCard>

      {/* Negative filters */}
      <SectionCard
        title="Negative filters"
        description="Exclude categories and funders the agents should never surface."
      >
        <div>
          <p className="mb-2 block text-sm font-medium text-navy-700">
            Excluded categories
          </p>
          <CheckboxGrid
            options={FUNDER_CATEGORIES}
            selected={excludedCategories}
            onToggle={toggleExcludedCategory}
            disabled={!editable}
            accent="red"
          />
        </div>
        <TagInput
          label="Excluded funders"
          placeholder="Funder or company name to exclude"
          helper="Opportunities from these funders are never created (matched case-insensitively)."
          value={excludedFunders}
          onChange={setExcludedFunders}
          disabled={!editable}
          chipColor="red"
        />
      </SectionCard>

      {/* Per-agent toggle + schedule */}
      <SectionCard
        title="Agents & schedule"
        description="Choose which research agents run this profile and how often."
      >
        <div className="space-y-3">
          {RESEARCH_FAMILIES.map((family) => {
            const setting =
              agentSettings[family.agentType] ?? {
                enabled: true,
                intervalHours: familyDefaultHours(family.intervalMs),
              };
            return (
              <div
                key={family.agentType}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy-200 px-4 py-3"
              >
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={setting.enabled}
                    onChange={(e) =>
                      setAgentSettings((prev) => ({
                        ...prev,
                        [family.agentType]: {
                          ...setting,
                          enabled: e.target.checked,
                        },
                      }))
                    }
                    disabled={!editable}
                    className="h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span>
                    <span className="font-medium text-navy-800">
                      {family.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-navy-400">
                      Default cadence: {family.cadence}
                    </span>
                  </span>
                </label>
                <div className="w-44">
                  <Select
                    aria-label={`${family.label} schedule`}
                    options={AGENT_SCHEDULE_OPTIONS.map((o) => ({
                      value: String(o.hours),
                      label: o.label,
                    }))}
                    value={String(setting.intervalHours)}
                    onChange={(e) =>
                      setAgentSettings((prev) => ({
                        ...prev,
                        [family.agentType]: {
                          ...setting,
                          intervalHours: Number(e.target.value),
                        },
                      }))
                    }
                    disabled={!editable || !setting.enabled}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-navy-200 bg-white/90 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3 px-6 py-3">
          <Button type="button" variant="secondary" onClick={() => router.push("/search-profiles")}>
            Cancel
          </Button>
          <Button type="submit" isLoading={saving} disabled={!editable}>
            <Save className="h-4 w-4" aria-hidden />
            {isEdit ? "Save configuration" : "Create profile"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Every research family enabled at its default cadence. */
function defaultAgentSettings(): AgentSettings {
  const out: AgentSettings = {};
  for (const family of RESEARCH_FAMILIES) {
    out[family.agentType] = {
      enabled: true,
      intervalHours: familyDefaultHours(family.intervalMs),
    };
  }
  return out;
}

/** Overlay stored settings onto the full family default set. */
function mergeAgentSettings(stored: AgentSettings): AgentSettings {
  const base = defaultAgentSettings();
  for (const [agentType, setting] of Object.entries(stored)) {
    base[agentType] = setting;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {children}
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-navy-900">{title}</h2>
        <p className="mt-0.5 text-sm text-navy-500">{description}</p>
      </div>
      <div className="space-y-5">{children}</div>
    </Card>
  );
}

function CheckboxGrid({
  options,
  selected,
  onToggle,
  disabled,
  accent = "teal",
}: {
  options: readonly FunderCategory[];
  selected: FunderCategory[];
  onToggle: (value: FunderCategory) => void;
  disabled?: boolean;
  accent?: "teal" | "red";
}) {
  const accentClass =
    accent === "red"
      ? "text-red-600 focus:ring-red-500"
      : "text-teal-600 focus:ring-teal-500";
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <label
          key={option}
          className="flex items-center gap-2.5 rounded-lg border border-navy-200 px-3 py-2 text-sm"
        >
          <input
            type="checkbox"
            checked={selected.includes(option)}
            onChange={() => onToggle(option)}
            disabled={disabled}
            className={`h-4 w-4 rounded border-navy-300 ${accentClass}`}
          />
          <span className="text-navy-700">{humanizeEnum(option)}</span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag input (plain string tags, optional presets)
// ---------------------------------------------------------------------------

function TagInput({
  label,
  required,
  placeholder,
  helper,
  error,
  value,
  onChange,
  presets,
  disabled,
  chipColor = "blue",
}: {
  label: string;
  required?: boolean;
  placeholder?: string;
  helper?: string;
  error?: string;
  value: string[];
  onChange: (next: string[]) => void;
  presets?: string[];
  disabled?: boolean;
  chipColor?: "blue" | "red";
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const v = raw.trim();
    if (v === "") return;
    if (!value.some((t) => t.toLowerCase() === v.toLowerCase())) {
      onChange([...value, v]);
    }
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  const chipClass =
    chipColor === "red"
      ? "bg-red-100 text-red-700 hover:bg-red-200"
      : "bg-blue-100 text-blue-700 hover:bg-blue-200";
  const remainingPresets = (presets ?? []).filter(
    (p) => !value.some((t) => t.toLowerCase() === p.toLowerCase()),
  );

  return (
    <div>
      <Input
        label={label}
        required={required}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => add(draft)}
        error={error}
        helperText={helper}
        placeholder={placeholder}
        disabled={disabled}
      />
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                chipColor === "red" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
              }`}
            >
              {tag}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((t) => t !== tag))}
                  className="rounded-full p-0.5"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && remainingPresets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {remainingPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => add(preset)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition ${chipClass}`}
            >
              <Plus className="h-3 w-3" aria-hidden />
              {preset}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source-category priority field
// ---------------------------------------------------------------------------

function SourcePriorityField({
  value,
  available,
  onChange,
  disabled,
}: {
  value: SourceTypeFilter[];
  available: OpportunitySourceType[];
  onChange: (next: SourceTypeFilter[]) => void;
  disabled?: boolean;
}) {
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    onChange(next);
  }

  function add(sourceType: string) {
    if (sourceType === "") return;
    onChange([
      ...value,
      {
        source_type: sourceType as OpportunitySourceType,
        priority: value.length + 1,
      },
    ]);
  }

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-navy-400">
          No source priority set - the agents weigh every source equally.
        </p>
      ) : (
        <ul className="space-y-2">
          {value.map((filter, index) => (
            <li
              key={filter.source_type}
              className="flex items-center justify-between gap-3 rounded-lg border border-navy-200 px-3 py-2"
            >
              <div className="flex items-center gap-2.5">
                <Badge color="navy">{index + 1}</Badge>
                <span className="text-sm text-navy-700">
                  {humanizeEnum(filter.source_type)}
                </span>
              </div>
              {!disabled && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Raise priority of ${humanizeEnum(filter.source_type)}`}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, 1)}
                    disabled={index === value.length - 1}
                    aria-label={`Lower priority of ${humanizeEnum(filter.source_type)}`}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onChange(value.filter((f) => f.source_type !== filter.source_type))
                    }
                    aria-label={`Remove ${humanizeEnum(filter.source_type)}`}
                  >
                    <X className="h-4 w-4 text-red-500" aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && available.length > 0 && (
        <div className="max-w-xs">
          <Select
            aria-label="Add a source category"
            placeholder="Add a source category…"
            value=""
            onChange={(e) => add(e.target.value)}
            options={available.map((s) => ({
              value: s,
              label: humanizeEnum(s),
            }))}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Focus-area field (label + weight)
// ---------------------------------------------------------------------------

function FocusAreaField({
  value,
  onChange,
  disabled,
}: {
  value: FocusArea[];
  onChange: (next: FocusArea[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const label = draft.trim();
    if (label === "") return;
    if (!value.some((f) => f.label.toLowerCase() === label.toLowerCase())) {
      onChange([...value, { label, weight: FOCUS_WEIGHT_DEFAULT }]);
    }
    setDraft("");
  }

  function setWeight(index: number, weight: number) {
    onChange(
      value.map((f, i) => (i === index ? { ...f, weight: clampWeight(weight) } : f)),
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Focus area"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="e.g. Affordable housing"
            helperText="Add a theme, then set its weight."
            disabled={disabled}
          />
        </div>
        <Button type="button" variant="secondary" onClick={add} disabled={disabled}>
          <Plus className="h-4 w-4" aria-hidden />
          Add
        </Button>
      </div>

      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((focus, index) => (
            <li
              key={focus.label}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy-200 px-3 py-2"
            >
              <span className="text-sm font-medium text-navy-700">
                {focus.label}
              </span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-navy-500">
                  Weight
                  <input
                    type="range"
                    min={FOCUS_WEIGHT_MIN}
                    max={FOCUS_WEIGHT_MAX}
                    step={1}
                    value={focus.weight}
                    onChange={(e) => setWeight(index, Number(e.target.value))}
                    disabled={disabled}
                    className="accent-teal-600"
                    aria-label={`Weight for ${focus.label}`}
                  />
                  <span className="w-4 font-medium text-navy-700">
                    {focus.weight}
                  </span>
                </label>
                {!disabled && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                    aria-label={`Remove ${focus.label}`}
                  >
                    <X className="h-4 w-4 text-red-500" aria-hidden />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
