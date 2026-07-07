"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";

import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { Filter, Pencil, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
  Select,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import {
  FUNDER_CATEGORIES,
  OPPORTUNITY_RECURRENCES,
} from "@/lib/utils/constants";
import {
  formatCurrency,
  formatRelative,
  humanizeEnum,
} from "@/lib/utils/formatters";
import { isNonEmpty } from "@/lib/utils/validators";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;
type SearchProfile = Tables<"search_profiles">;

// Behavioral Contracts §14 / Search Profile Contracts: at most 10 active search
// profiles per organization in the MVP.
const MAX_ACTIVE_PROFILES = 10;

const RECURRENCE_OPTIONS = [
  { value: "", label: "Any recurrence" },
  ...OPPORTUNITY_RECURRENCES.map((value) => ({
    value,
    label: humanizeEnum(value),
  })),
];

/**
 * Saved keyword search configurations (BLUEPRINT §4.12 / Behavioral Contracts
 * §14). Each profile defines what kinds of grants and donation programs the
 * research agents (Phase 2) should hunt for. Reads are RLS-scoped to the
 * organization, so no organization_id filter is needed client-side.
 *
 * Active profiles are capped at MAX_ACTIVE_PROFILES; activating or creating an
 * active profile beyond the cap is blocked with an explanatory message. Paused
 * profiles keep their configuration but are skipped by scheduled runs.
 */
export default function SearchProfilesPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [profiles, setProfiles] = useState<SearchProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SearchProfile | null>(null);

  const [pendingDelete, setPendingDelete] = useState<SearchProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Surfaced when an inline activation toggle hits the active-profile cap.
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("search_profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (loadError) {
      setError("Could not load search profiles.");
      setLoading(false);
      return;
    }
    setProfiles((data ?? []) as SearchProfile[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = profiles.filter((p) => p.is_active).length;

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(profileRow: SearchProfile) {
    setEditing(profileRow);
    setEditorOpen(true);
  }

  async function toggleActive(profileRow: SearchProfile) {
    setToggleError(null);
    const next = !profileRow.is_active;
    if (next && activeCount >= MAX_ACTIVE_PROFILES) {
      setToggleError(
        `You can have at most ${MAX_ACTIVE_PROFILES} active search profiles. Pause another first.`,
      );
      return;
    }

    setTogglingId(profileRow.id);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("search_profiles")
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq("id", profileRow.id);

    setTogglingId(null);
    if (updateError) {
      setToggleError(updateError.message);
      return;
    }
    await load();
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("search_profiles")
      .delete()
      .eq("id", pendingDelete.id);

    setDeleting(false);
    if (deleteError) return;
    setPendingDelete(null);
    await load();
  }

  const showEmpty = !loading && !error && profiles.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Search Profiles
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Saved keyword configurations that tell the research agents what
            funding to look for.
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push("/search-profiles/configure")}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Advanced setup
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              New profile
            </Button>
          </div>
        )}
      </div>

      {!loading && !error && profiles.length > 0 && (
        <p className="text-sm text-navy-500">
          <span className="font-medium text-navy-700">
            {activeCount} of {MAX_ACTIVE_PROFILES}
          </span>{" "}
          active profiles in use.
        </p>
      )}

      {(error || toggleError) && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error ?? toggleError}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading search profiles..." />
      ) : showEmpty ? (
        <EmptyState
          icon={Filter}
          title="No search profiles yet"
          description="Create a profile with keywords and filters to define the grants and donation programs you want discovered."
          action={
            editable ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden />
                New profile
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {profiles.map((profileRow) => (
            <Card key={profileRow.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-navy-900">
                      {profileRow.name}
                    </h3>
                    <Badge
                      color={profileRow.is_active ? "green" : "gray"}
                      withDot
                    >
                      {profileRow.is_active ? "Active" : "Paused"}
                    </Badge>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {profileRow.keywords.map((keyword) => (
                      <Badge key={keyword} color="blue">
                        {keyword}
                      </Badge>
                    ))}
                  </div>

                  {(profileRow.categories?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(profileRow.categories ?? []).map((category) => (
                        <Badge key={category} color="indigo">
                          {humanizeEnum(category)}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-400">
                    {profileRow.geographic_scope && (
                      <span>Scope: {profileRow.geographic_scope}</span>
                    )}
                    {(profileRow.min_amount != null ||
                      profileRow.max_amount != null) && (
                      <span>
                        {formatCurrency(profileRow.min_amount)} -{" "}
                        {formatCurrency(profileRow.max_amount)}
                      </span>
                    )}
                    {profileRow.recurrence_preference && (
                      <span>
                        {humanizeEnum(profileRow.recurrence_preference)}
                      </span>
                    )}
                    <span>
                      {profileRow.results_count ?? 0} found · last run{" "}
                      {profileRow.last_run_at
                        ? formatRelative(profileRow.last_run_at)
                        : "never"}
                    </span>
                  </div>
                </div>

                {editable && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void toggleActive(profileRow)}
                      isLoading={togglingId === profileRow.id}
                    >
                      {profileRow.is_active ? "Pause" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        router.push(
                          `/search-profiles/configure?id=${profileRow.id}`,
                        )
                      }
                      aria-label={`Configure ${profileRow.name}`}
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(profileRow)}
                      aria-label={`Edit ${profileRow.name}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPendingDelete(profileRow)}
                      aria-label={`Delete ${profileRow.name}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / edit */}
      <Modal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? "Edit search profile" : "New search profile"}
        size="xl"
      >
        <SearchProfileForm
          profile={editing ?? undefined}
          organizationId={profile?.organization_id ?? null}
          activeCount={activeCount}
          onCancel={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            void load();
          }}
        />
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete search profile"
        description="This cannot be undone."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={deleting}>
              Delete profile
            </Button>
          </>
        }
      >
        <p className="text-sm text-navy-600">
          Delete <span className="font-medium">{pendingDelete?.name}</span>? Any
          opportunities it already discovered are kept.
        </p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

const CATEGORY_OPTIONS = FUNDER_CATEGORIES.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

function SearchProfileForm({
  profile,
  organizationId,
  activeCount,
  onSaved,
  onCancel,
}: {
  profile?: SearchProfile;
  organizationId: string | null;
  /** Active profiles currently in use, used to enforce the activation cap. */
  activeCount: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(profile);

  const [name, setName] = useState(profile?.name ?? "");
  const [keywords, setKeywords] = useState<string[]>(profile?.keywords ?? []);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [categories, setCategories] = useState<FunderCategory[]>(
    profile?.categories ?? [],
  );
  const [geographicScope, setGeographicScope] = useState(
    profile?.geographic_scope ?? "",
  );
  const [minAmount, setMinAmount] = useState(
    profile?.min_amount != null ? String(profile.min_amount) : "",
  );
  const [maxAmount, setMaxAmount] = useState(
    profile?.max_amount != null ? String(profile.max_amount) : "",
  );
  const [recurrence, setRecurrence] = useState(
    profile?.recurrence_preference ?? "",
  );
  const [isActive, setIsActive] = useState(profile?.is_active ?? true);

  const [nameError, setNameError] = useState<string | null>(null);
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [isDirty, setIsDirty] = useState(false);
  useUnsavedChanges(isDirty);

  function addKeyword() {
    const value = keywordDraft.trim();
    if (!value) return;
    if (!keywords.includes(value)) {
      setKeywords([...keywords, value]);
      setKeywordError(null);
    }
    setKeywordDraft("");
  }

  function handleKeywordKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addKeyword();
    } else if (
      event.key === "Backspace" &&
      keywordDraft === "" &&
      keywords.length > 0
    ) {
      setKeywords(keywords.slice(0, -1));
    }
  }

  function removeKeyword(keyword: string) {
    setKeywords(keywords.filter((k) => k !== keyword));
  }

  function toggleCategory(category: FunderCategory) {
    setCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameError(null);
    setKeywordError(null);
    setFormError(null);

    // Fold a half-typed keyword into the list before validating.
    const pending = keywordDraft.trim();
    const finalKeywords =
      pending && !keywords.includes(pending)
        ? [...keywords, pending]
        : keywords;

    if (!isNonEmpty(name)) {
      setNameError("Profile name is required.");
      return;
    }
    // At least one keyword required per profile (Behavioral Contracts §14).
    if (finalKeywords.length === 0) {
      setKeywordError("Add at least one keyword.");
      return;
    }

    const min = minAmount.trim() ? Number(minAmount) : null;
    const max = maxAmount.trim() ? Number(maxAmount) : null;
    if ((min != null && Number.isNaN(min)) || (max != null && Number.isNaN(max))) {
      setFormError("Amounts must be numbers.");
      return;
    }
    if (min != null && max != null && min > max) {
      setFormError("Minimum amount cannot exceed maximum amount.");
      return;
    }

    // Enforce the active-profile cap (Behavioral Contracts §14). An already-active
    // profile being edited does not count against itself.
    const wasActive = Boolean(profile?.is_active);
    if (isActive && !wasActive && activeCount >= MAX_ACTIVE_PROFILES) {
      setFormError(
        `You already have ${MAX_ACTIVE_PROFILES} active profiles. Save this one as paused, or pause another first.`,
      );
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const payload = {
      name: name.trim(),
      keywords: finalKeywords,
      categories: categories.length > 0 ? categories : null,
      geographic_scope: geographicScope.trim() || null,
      min_amount: min,
      max_amount: max,
      recurrence_preference: recurrence || null,
      is_active: isActive,
    };

    if (isEdit && profile) {
      const { error: updateError } = await supabase
        .from("search_profiles")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", profile.id);
      setSaving(false);
      if (updateError) {
        setFormError(updateError.message);
        return;
      }
      onSaved();
      return;
    }

    // organization_id is derived from the session profile, never a form field
    // (Behavioral Contracts §2).
    if (!organizationId) {
      setSaving(false);
      setFormError("Your session could not be verified. Please sign in again.");
      return;
    }
    const { error: insertError } = await supabase
      .from("search_profiles")
      .insert({ ...payload, organization_id: organizationId });
    setSaving(false);
    if (insertError) {
      setFormError(insertError.message);
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} onChange={() => setIsDirty(true)} className="space-y-6" noValidate>
      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formError}
        </div>
      )}

      <Input
        label="Profile name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={nameError ?? undefined}
        placeholder="e.g. Rural Texas housing grants"
      />

      <div>
        <Input
          label="Keywords"
          required
          value={keywordDraft}
          onChange={(e) => setKeywordDraft(e.target.value)}
          onKeyDown={handleKeywordKeyDown}
          onBlur={addKeyword}
          error={keywordError ?? undefined}
          placeholder="Type a keyword and press Enter"
          helperText="Press Enter or comma to add each term. These drive the agent searches."
        />
        {keywords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {keywords.map((keyword) => (
              <Badge key={keyword} variant="info" className="pr-1">
                {keyword}
                <button
                  type="button"
                  onClick={() => removeKeyword(keyword)}
                  className="rounded-full p-0.5 hover:bg-black/5"
                  aria-label={`Remove ${keyword}`}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-navy-700">
          Categories to search
        </legend>
        <p className="mb-2 text-sm text-navy-500">
          Leave all unchecked to search every category.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATEGORY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2.5 rounded-lg border border-navy-200 px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={categories.includes(option.value as FunderCategory)}
                onChange={() => toggleCategory(option.value as FunderCategory)}
                className="h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-navy-700">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Geographic scope"
          value={geographicScope}
          onChange={(e) => setGeographicScope(e.target.value)}
          placeholder="e.g. Texas, or nationwide"
        />
        <Select
          label="Recurrence preference"
          options={RECURRENCE_OPTIONS}
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Minimum amount (USD)"
          type="number"
          min={0}
          step="1000"
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
          placeholder="No minimum"
        />
        <Input
          label="Maximum amount (USD)"
          type="number"
          min={0}
          step="1000"
          value={maxAmount}
          onChange={(e) => setMaxAmount(e.target.value)}
          placeholder="No maximum"
        />
      </div>

      <label className="flex items-start gap-3 rounded-lg border border-navy-200 bg-navy-50/50 px-4 py-3">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
        />
        <span className="text-sm">
          <span className="font-medium text-navy-800">Active</span>
          <span className="mt-0.5 block text-navy-500">
            Active profiles are included in scheduled agent runs. Paused profiles
            keep their settings but are skipped (max {MAX_ACTIVE_PROFILES}{" "}
            active).
          </span>
        </span>
      </label>

      <div className="flex items-center justify-end gap-3 border-t border-navy-200 pt-5">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          {isEdit ? "Save changes" : "Create profile"}
        </Button>
      </div>
    </form>
  );
}
