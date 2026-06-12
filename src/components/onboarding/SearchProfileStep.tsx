"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { Button, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { FUNDER_CATEGORIES } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import { isNonEmpty } from "@/lib/utils/validators";
import type { Enums } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

const CATEGORY_OPTIONS = FUNDER_CATEGORIES.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

export type SearchProfileStepProps = {
  organizationId: string;
  /** Whether a search profile already exists (returning user). */
  alreadyCreated: boolean;
  onSaved: () => void;
};

/**
 * Step 5 — first keyword search profile. A streamlined version of the full
 * Search Profiles form (BLUEPRINT §4.12): just enough to seed the research
 * agents — a name, at least one keyword, and optional category focus. The new
 * profile is created active so it's picked up by scheduled runs. organization_id
 * is derived from the session, never the form (Behavioral Contracts §2).
 */
export function SearchProfileStep({
  organizationId,
  alreadyCreated,
  onSaved,
}: SearchProfileStepProps) {
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [categories, setCategories] = useState<FunderCategory[]>([]);
  const [geographicScope, setGeographicScope] = useState("");

  const [nameError, setNameError] = useState<string | null>(null);
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(alreadyCreated);

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

    const pending = keywordDraft.trim();
    const finalKeywords =
      pending && !keywords.includes(pending) ? [...keywords, pending] : keywords;

    if (!isNonEmpty(name)) {
      setNameError("Give this profile a name.");
      return;
    }
    if (finalKeywords.length === 0) {
      setKeywordError("Add at least one keyword.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("search_profiles").insert({
      organization_id: organizationId,
      name: name.trim(),
      keywords: finalKeywords,
      categories: categories.length > 0 ? categories : null,
      geographic_scope: geographicScope.trim() || null,
      is_active: true,
    });

    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setDone(true);
    onSaved();
  }

  if (done) {
    return (
      <div className="rounded-xl border border-teal-200 bg-teal-50 px-5 py-6 text-center">
        <p className="font-medium text-teal-800">Your grant radar is on.</p>
        <p className="mt-1 text-sm text-teal-700">
          The research agents will use this profile to surface matching funding.
          You can add more or fine-tune them anytime under Search Profiles.
        </p>
      </div>
    );
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

      <Input
        label="Profile name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={nameError ?? undefined}
        placeholder="e.g. Housing & family stability grants"
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
              <span
                key={keyword}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
              >
                {keyword}
                <button
                  type="button"
                  onClick={() => setKeywords(keywords.filter((k) => k !== keyword))}
                  className="rounded-full p-0.5 hover:bg-blue-200"
                  aria-label={`Remove ${keyword}`}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-navy-700">
          Categories to focus on
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

      <Input
        label="Geographic scope"
        value={geographicScope}
        onChange={(e) => setGeographicScope(e.target.value)}
        placeholder="e.g. California, or nationwide"
      />

      <div className="flex justify-end">
        <Button type="submit" isLoading={saving}>
          Create search profile
        </Button>
      </div>
    </form>
  );
}
