"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { Button, Input, Select, Textarea } from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import {
  FUNDER_CATEGORIES,
  OPPORTUNITY_RECURRENCES,
  OPPORTUNITY_SOURCE_TYPES,
  OPPORTUNITY_STATUSES,
} from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import { isNonEmpty } from "@/lib/utils/validators";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;
type OpportunityStatus = Enums<"opportunity_status">;
type OpportunitySourceType = Enums<"opportunity_source_type">;

const CATEGORY_OPTIONS: SelectOption[] = FUNDER_CATEGORIES.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

const SOURCE_TYPE_OPTIONS: SelectOption[] = OPPORTUNITY_SOURCE_TYPES.map(
  (value) => ({ value, label: humanizeEnum(value) }),
);

const STATUS_OPTIONS: SelectOption[] = OPPORTUNITY_STATUSES.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

const RECURRENCE_OPTIONS: SelectOption[] = OPPORTUNITY_RECURRENCES.map(
  (value) => ({ value, label: humanizeEnum(value) }),
);

const APPLICATION_METHOD_OPTIONS: SelectOption[] = [
  { value: "online_portal", label: "Online portal" },
  { value: "email", label: "Email" },
  { value: "mail", label: "Mail" },
  { value: "phone", label: "Phone" },
  { value: "in_person", label: "In person" },
];

/** Convert a stored ISO timestamp to a date-input (YYYY-MM-DD) value. */
function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

function todayDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export type OpportunityFormProps = {
  /** Existing opportunity when editing; omit to create. */
  opportunity?: Tables<"opportunities">;
  /** Existing keyword tags when editing (from opportunity_keywords). */
  initialKeywords?: string[];
  /** Called after a successful save. Defaults to navigating to the detail page. */
  onSaved?: (opportunity: Tables<"opportunities">) => void;
  /** Called when the user cancels. */
  onCancel?: () => void;
};

/**
 * Create/edit form for an opportunity (BLUEPRINT §4.4). Covers every editable
 * field plus keyword tags, which are stored in the opportunity_keywords
 * many-to-many table - never as a column array (Behavioral Contracts §5).
 *
 * eligibility_score, recommendation, and recommendation_reasoning are set only
 * by the Eligibility Scoring Agent and are intentionally absent here
 * (Contracts §5). organization_id is derived from the session profile, never a
 * form field (Contracts §2). Source is 'manual' for user-created records.
 */
export function OpportunityForm({
  opportunity,
  initialKeywords = [],
  onSaved,
  onCancel,
}: OpportunityFormProps) {
  const router = useRouter();
  const { profile, loading: profileLoading } = useProfile();
  const isEdit = Boolean(opportunity);

  const [funders, setFunders] = useState<Pick<Tables<"funders">, "id" | "name">[]>(
    [],
  );

  const [name, setName] = useState(opportunity?.name ?? "");
  const [category, setCategory] = useState<FunderCategory | "">(
    opportunity?.category ?? "",
  );
  const [funderId, setFunderId] = useState(opportunity?.funder_id ?? "");
  const [sourceType, setSourceType] = useState<OpportunitySourceType | "">(
    opportunity?.source_type ?? "",
  );
  const [description, setDescription] = useState(opportunity?.description ?? "");
  const [amountAvailable, setAmountAvailable] = useState(
    opportunity?.amount_available != null
      ? String(opportunity.amount_available)
      : "",
  );
  const [amountMin, setAmountMin] = useState(
    opportunity?.amount_min != null ? String(opportunity.amount_min) : "",
  );
  const [amountMax, setAmountMax] = useState(
    opportunity?.amount_max != null ? String(opportunity.amount_max) : "",
  );
  const [deadline, setDeadline] = useState(toDateInput(opportunity?.deadline));
  const [url, setUrl] = useState(opportunity?.url ?? "");
  const [eligibilityRequirements, setEligibilityRequirements] = useState(
    opportunity?.eligibility_requirements ?? "",
  );
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>(
    opportunity?.required_documents ?? [],
  );
  const [applicationMethod, setApplicationMethod] = useState(
    opportunity?.application_method ?? "",
  );
  const [recurrence, setRecurrence] = useState(opportunity?.recurrence ?? "");
  const [geographicRestrictions, setGeographicRestrictions] = useState(
    opportunity?.geographic_restrictions ?? "",
  );
  const [status, setStatus] = useState<OpportunityStatus>(
    opportunity?.status ?? "open",
  );
  const [keywords, setKeywords] = useState<string[]>(initialKeywords);

  const [fieldError, setFieldError] = useState<{
    name?: string;
    category?: string;
    deadline?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Funder select options (optional link - Contracts §5).
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("funders")
        .select("id, name")
        .order("name", { ascending: true });
      if (active) setFunders(data ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

  function validate(): boolean {
    const errors: typeof fieldError = {};
    if (!isNonEmpty(name)) errors.name = "Opportunity name is required.";
    if (!category) errors.category = "Select a category.";
    // Deadline must be in the future when creating (Contracts §5). Past dates
    // are allowed on existing records for history.
    if (!isEdit && deadline && deadline < todayDay()) {
      errors.deadline = "Deadline must be in the future.";
    }
    setFieldError(errors);
    return Object.keys(errors).length === 0;
  }

  function parseAmount(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isNaN(n) ? null : n;
  }

  async function syncKeywords(
    supabase: ReturnType<typeof createClient>,
    opportunityId: string,
    organizationId: string,
  ) {
    // Replace the keyword set: clear existing rows, then insert the current
    // tags. Keywords live in opportunity_keywords (Contracts §5).
    await supabase
      .from("opportunity_keywords")
      .delete()
      .eq("opportunity_id", opportunityId);

    const unique = Array.from(
      new Set(keywords.map((k) => k.trim()).filter(Boolean)),
    );
    if (unique.length > 0) {
      await supabase.from("opportunity_keywords").insert(
        unique.map((keyword) => ({
          organization_id: organizationId,
          opportunity_id: opportunityId,
          keyword,
        })),
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    if (!profile) {
      setFormError("Your session could not be verified. Please sign in again.");
      return;
    }

    for (const [value, label] of [
      [amountAvailable, "Amount available"],
      [amountMin, "Minimum amount"],
      [amountMax, "Maximum amount"],
    ] as const) {
      if (value.trim() && Number.isNaN(Number(value))) {
        setFormError(`${label} must be a number.`);
        return;
      }
    }

    setSubmitting(true);
    const supabase = createClient();

    const payload = {
      name: name.trim(),
      category: category as FunderCategory,
      funder_id: funderId || null,
      description: description.trim() || null,
      amount_available: parseAmount(amountAvailable),
      amount_min: parseAmount(amountMin),
      amount_max: parseAmount(amountMax),
      deadline: deadline ? new Date(deadline).toISOString() : null,
      url: url.trim() || null,
      eligibility_requirements: eligibilityRequirements.trim() || null,
      required_documents: requiredDocuments.length > 0 ? requiredDocuments : null,
      application_method: applicationMethod || null,
      recurrence: recurrence || null,
      geographic_restrictions: geographicRestrictions.trim() || null,
      status,
      source_type: sourceType || null,
    };

    if (isEdit && opportunity) {
      const { data, error } = await supabase
        .from("opportunities")
        .update(payload)
        .eq("id", opportunity.id)
        .select()
        .single();

      if (error || !data) {
        setSubmitting(false);
        setFormError(error?.message ?? "Could not save the opportunity.");
        return;
      }
      await syncKeywords(supabase, data.id, profile.organization_id);
      setSubmitting(false);
      if (onSaved) onSaved(data);
      else router.push(`/opportunities/${data.id}`);
      router.refresh();
      return;
    }

    // organization_id from the session profile; source 'manual' for user entry.
    const { data, error } = await supabase
      .from("opportunities")
      .insert({
        ...payload,
        organization_id: profile.organization_id,
        source: "manual",
      })
      .select()
      .single();

    if (error || !data) {
      setSubmitting(false);
      setFormError(error?.message ?? "Could not create the opportunity.");
      return;
    }
    await syncKeywords(supabase, data.id, profile.organization_id);
    setSubmitting(false);
    if (onSaved) onSaved(data);
    else router.push(`/opportunities/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Opportunity name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldError.name}
          placeholder="e.g. Community Housing Grant 2026"
        />
        <Select
          label="Category"
          required
          placeholder="Select a category…"
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(e) => setCategory(e.target.value as FunderCategory)}
          error={fieldError.category}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Select
          label="Funder"
          placeholder="No linked funder"
          options={funders.map((f) => ({ value: f.id, label: f.name }))}
          value={funderId}
          onChange={(e) => setFunderId(e.target.value)}
          helperText="Optional - link to a funder in your CRM."
        />
        <Select
          label="Source type"
          placeholder="Not classified"
          options={SOURCE_TYPE_OPTIONS}
          value={sourceType}
          onChange={(e) =>
            setSourceType(e.target.value as OpportunitySourceType)
          }
          helperText="Where the funding comes from. Auto-set for discovered ones."
        />
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => setStatus(e.target.value as OpportunityStatus)}
        />
      </div>

      <Textarea
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What the funder is looking for, focus areas, and context."
        rows={3}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Input
          label="Amount available (USD)"
          type="number"
          min={0}
          step="1000"
          value={amountAvailable}
          onChange={(e) => setAmountAvailable(e.target.value)}
          placeholder="Total program funding"
        />
        <Input
          label="Minimum request (USD)"
          type="number"
          min={0}
          step="1000"
          value={amountMin}
          onChange={(e) => setAmountMin(e.target.value)}
          placeholder="Min"
        />
        <Input
          label="Maximum request (USD)"
          type="number"
          min={0}
          step="1000"
          value={amountMax}
          onChange={(e) => setAmountMax(e.target.value)}
          placeholder="Max"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Deadline"
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          error={fieldError.deadline}
          helperText={
            isEdit ? undefined : "Must be in the future for new opportunities."
          }
        />
        <Input
          label="Application / info URL"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Select
          label="Application method"
          placeholder="Not set"
          options={APPLICATION_METHOD_OPTIONS}
          value={applicationMethod}
          onChange={(e) => setApplicationMethod(e.target.value)}
        />
        <Select
          label="Recurrence"
          placeholder="Not set"
          options={RECURRENCE_OPTIONS}
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
        />
      </div>

      <Input
        label="Geographic restrictions"
        value={geographicRestrictions}
        onChange={(e) => setGeographicRestrictions(e.target.value)}
        placeholder="e.g. Rural Texas counties only"
      />

      <Textarea
        label="Eligibility requirements"
        value={eligibilityRequirements}
        onChange={(e) => setEligibilityRequirements(e.target.value)}
        placeholder="Who qualifies, tax-status requirements, restrictions…"
        rows={3}
      />

      <TagInput
        label="Required documents"
        values={requiredDocuments}
        onChange={setRequiredDocuments}
        placeholder="Type a document name and press Enter"
        helperText="e.g. 501(c)(3) letter, budget, board list."
      />

      <TagInput
        label="Keywords"
        values={keywords}
        onChange={setKeywords}
        placeholder="Type a keyword and press Enter"
        helperText="Tags for search and filtering. Stored separately per Contracts §5."
      />

      <div className="flex items-center justify-end gap-3 border-t border-navy-200 pt-5">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          isLoading={submitting || profileLoading}
          disabled={profileLoading}
        >
          {isEdit ? "Save changes" : "Create opportunity"}
        </Button>
      </div>
    </form>
  );
}

type TagInputProps = {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  helperText?: string;
};

/**
 * Chip-style multi-value input. Commit a tag with Enter or comma; remove with
 * the chip's × or Backspace on an empty field. Used for keywords and required
 * documents.
 */
function TagInput({
  label,
  values,
  onChange,
  placeholder,
  helperText,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    if (!values.some((v) => v.toLowerCase() === tag.toLowerCase())) {
      onChange([...values, tag]);
    }
    setDraft("");
  }

  function removeTag(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(draft);
    } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
      removeTag(values.length - 1);
    }
  }

  return (
    <div className="w-full">
      <label className="mb-1.5 block text-sm font-medium text-navy-700">
        {label}
      </label>
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-navy-300 bg-white px-2 py-1.5 shadow-sm focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((value, index) => (
          <span
            key={`${value}-${index}`}
            className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-teal-700"
          >
            {value}
            <button
              type="button"
              onClick={() => removeTag(index)}
              className="rounded-full p-0.5 text-teal-400 transition hover:bg-teal-100 hover:text-teal-700"
              aria-label={`Remove ${value}`}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addTag(draft)}
          placeholder={values.length === 0 ? placeholder : undefined}
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm text-navy-900 placeholder:text-navy-400 focus:outline-none focus:ring-0"
        />
      </div>
      {helperText && (
        <p className="mt-1.5 text-sm text-navy-500">{helperText}</p>
      )}
    </div>
  );
}
