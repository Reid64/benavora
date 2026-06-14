"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { AlertTriangle } from "lucide-react";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { recordAudit } from "@/lib/audit/client";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import { FUNDER_CATEGORIES } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import { isNonEmpty } from "@/lib/utils/validators";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

const CATEGORY_OPTIONS = FUNDER_CATEGORIES.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

const PORTAL_LOGIN_OPTIONS = [
  { value: "no_portal", label: "No portal" },
  { value: "needs_account", label: "Needs account" },
  { value: "has_account", label: "Has account" },
];

const APPLICATION_METHOD_OPTIONS = [
  { value: "online_portal", label: "Online portal" },
  { value: "email", label: "Email" },
  { value: "mail", label: "Mail" },
  { value: "phone", label: "Phone" },
  { value: "in_person", label: "In person" },
];

export type FunderFormProps = {
  /** Existing funder when editing; omit to create. */
  funder?: Tables<"funders">;
  /** Called after a successful save. Defaults to navigating to the detail page. */
  onSaved?: (funder: Tables<"funders">) => void;
  /** Called when the user cancels. */
  onCancel?: () => void;
};

/**
 * Create/edit form for a funder. Covers every BLUEPRINT §4.2 field.
 *
 * organization_id is derived from the session profile (useProfile) - never from
 * a form field (Behavioral Contracts §2). Duplicate name+category matches warn
 * but do not block (Contracts §3).
 */
export function FunderForm({ funder, onSaved, onCancel }: FunderFormProps) {
  const router = useRouter();
  const { profile, loading: profileLoading } = useProfile();
  const isEdit = Boolean(funder);

  const [name, setName] = useState(funder?.name ?? "");
  const [category, setCategory] = useState<FunderCategory | "">(
    funder?.category ?? "",
  );
  const [description, setDescription] = useState(funder?.description ?? "");
  const [website, setWebsite] = useState(funder?.website ?? "");
  const [givingPortalUrl, setGivingPortalUrl] = useState(
    funder?.giving_portal_url ?? "",
  );
  const [portalLoginStatus, setPortalLoginStatus] = useState(
    funder?.portal_login_status ?? "",
  );
  const [annualGivingBudget, setAnnualGivingBudget] = useState(
    funder?.annual_giving_budget != null
      ? String(funder.annual_giving_budget)
      : "",
  );
  const [geographicFocus, setGeographicFocus] = useState(
    funder?.geographic_focus ?? "",
  );
  const [preferredApplicationMethod, setPreferredApplicationMethod] = useState(
    funder?.preferred_application_method ?? "",
  );
  const [hasGivingPage, setHasGivingPage] = useState(
    funder?.has_giving_page ?? true,
  );
  const [notes, setNotes] = useState(funder?.notes ?? "");

  const [fieldError, setFieldError] = useState<{
    name?: string;
    category?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateAck, setDuplicateAck] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [isDirty, setIsDirty] = useState(false);
  const { markClean } = useUnsavedChanges(isDirty);

  function validate(): boolean {
    const errors: { name?: string; category?: string } = {};
    if (!isNonEmpty(name)) errors.name = "Funder name is required.";
    if (!category) errors.category = "Select a category.";
    setFieldError(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!validate()) return;
    if (!profile) {
      setFormError("Your session could not be verified. Please sign in again.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    // Duplicate detection (Contracts §3): warn, do not block. Only on create,
    // and only until the user acknowledges.
    if (!isEdit && !duplicateAck) {
      const { data: dupes } = await supabase
        .from("funders")
        .select("id")
        .ilike("name", name.trim())
        .eq("category", category as FunderCategory)
        .limit(1);

      if (dupes && dupes.length > 0) {
        setDuplicateWarning(
          `A funder named "${name.trim()}" already exists in this category. You can save anyway.`,
        );
        setDuplicateAck(true);
        setSubmitting(false);
        return;
      }
    }

    const budget = annualGivingBudget.trim()
      ? Number(annualGivingBudget)
      : null;
    if (budget != null && Number.isNaN(budget)) {
      setFormError("Annual giving budget must be a number.");
      setSubmitting(false);
      return;
    }

    // organization_id comes from the session profile, never the form.
    const payload = {
      name: name.trim(),
      category: category as FunderCategory,
      description: description.trim() || null,
      website: website.trim() || null,
      giving_portal_url: givingPortalUrl.trim() || null,
      portal_login_status: portalLoginStatus || null,
      annual_giving_budget: budget,
      geographic_focus: geographicFocus.trim() || null,
      preferred_application_method: preferredApplicationMethod || null,
      has_giving_page: hasGivingPage,
      notes: notes.trim() || null,
    };

    if (isEdit && funder) {
      const { data, error } = await supabase
        .from("funders")
        .update(payload)
        .eq("id", funder.id)
        .select()
        .single();

      setSubmitting(false);
      if (error || !data) {
        setFormError(error?.message ?? "Could not save the funder.");
        return;
      }
      void recordAudit({ action: "update", entityType: "funder", entityId: data.id as string, details: { name: data.name } });
      markClean();
      if (onSaved) onSaved(data);
      else router.push(`/funders/${data.id}`);
      router.refresh();
      return;
    }

    const { data, error } = await supabase
      .from("funders")
      .insert({ ...payload, organization_id: profile.organization_id })
      .select()
      .single();

    setSubmitting(false);
    if (error || !data) {
      setFormError(error?.message ?? "Could not create the funder.");
      return;
    }
    void recordAudit({ action: "create", entityType: "funder", entityId: data.id as string, details: { name: data.name } });
    markClean();
    if (onSaved) onSaved(data);
    else router.push(`/funders/${data.id}`);
    router.refresh();
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

      {duplicateWarning && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{duplicateWarning}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Funder name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldError.name}
          placeholder="e.g. Acme Corporation Foundation"
        />
        <Select
          label="Category"
          required
          placeholder="Select a category..."
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(e) => setCategory(e.target.value as FunderCategory)}
          error={fieldError.category}
        />
      </div>

      <Textarea
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What this funder supports, focus areas, and any context."
        rows={3}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://..."
        />
        <Input
          label="Giving portal URL"
          type="url"
          value={givingPortalUrl}
          onChange={(e) => setGivingPortalUrl(e.target.value)}
          placeholder="https://..."
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Select
          label="Portal login status"
          placeholder="Not set"
          options={PORTAL_LOGIN_OPTIONS}
          value={portalLoginStatus}
          onChange={(e) => setPortalLoginStatus(e.target.value)}
        />
        <Select
          label="Preferred application method"
          placeholder="Not set"
          options={APPLICATION_METHOD_OPTIONS}
          value={preferredApplicationMethod}
          onChange={(e) => setPreferredApplicationMethod(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Annual giving budget (USD)"
          type="number"
          min={0}
          step="1000"
          value={annualGivingBudget}
          onChange={(e) => setAnnualGivingBudget(e.target.value)}
          placeholder="If known"
          helperText="Estimated total annual giving, if known."
        />
        <Input
          label="Geographic focus"
          value={geographicFocus}
          onChange={(e) => setGeographicFocus(e.target.value)}
          placeholder="e.g. Rural Texas"
        />
      </div>

      <label className="flex items-start gap-3 rounded-lg border border-navy-200 bg-navy-50/50 px-4 py-3">
        <input
          type="checkbox"
          checked={hasGivingPage}
          onChange={(e) => setHasGivingPage(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
        />
        <span className="text-sm">
          <span className="font-medium text-navy-800">Has a giving page</span>
          <span className="mt-0.5 block text-navy-500">
            Uncheck if this funder has no online giving page - it becomes a cold
            outreach target.
          </span>
        </span>
      </label>

      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Internal notes about this funder."
        rows={3}
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
          {isEdit
            ? "Save changes"
            : duplicateAck
              ? "Save anyway"
              : "Create funder"}
        </Button>
      </div>
    </form>
  );
}
