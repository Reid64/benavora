"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import { CONTACT_METHODS, CONTACT_RELATIONSHIPS } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import { isNonEmpty, isValidEmail } from "@/lib/utils/validators";
import type { Enums, Tables } from "@/types/database";

type ContactRelationship = Enums<"contact_relationship">;

const RELATIONSHIP_OPTIONS = CONTACT_RELATIONSHIPS.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

const METHOD_OPTIONS = CONTACT_METHODS.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

export type ContactFormProps = {
  /** Existing contact when editing; omit to create. */
  contact?: Tables<"contacts">;
  /** Pre-selected funder when creating (e.g. from a funder's page). */
  defaultFunderId?: string;
  /** Called after a successful save. Defaults to navigating to the detail page. */
  onSaved?: (contact: Tables<"contacts">) => void;
  /** Called when the user cancels. */
  onCancel?: () => void;
};

/**
 * Create/edit form for a contact (BLUEPRINT §4.3, Behavioral Contracts §4).
 *
 * Every contact must be linked to exactly one funder (funder_id required).
 * organization_id is derived from the session profile - never from a form field
 * (Behavioral Contracts §2). The funder dropdown is RLS-scoped, so it only ever
 * lists funders in the current organization.
 */
export function ContactForm({
  contact,
  defaultFunderId,
  onSaved,
  onCancel,
}: ContactFormProps) {
  const router = useRouter();
  const { profile, loading: profileLoading } = useProfile();
  const isEdit = Boolean(contact);

  const [funders, setFunders] = useState<Pick<Tables<"funders">, "id" | "name">[]>(
    [],
  );
  const [fundersLoading, setFundersLoading] = useState(true);

  const [funderId, setFunderId] = useState(
    contact?.funder_id ?? defaultFunderId ?? "",
  );
  const [name, setName] = useState(contact?.name ?? "");
  const [title, setTitle] = useState(contact?.title ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [preferredContactMethod, setPreferredContactMethod] = useState(
    contact?.preferred_contact_method ?? "",
  );
  const [relationship, setRelationship] = useState<ContactRelationship>(
    contact?.relationship ?? "cold",
  );
  const [lastContactedAt, setLastContactedAt] = useState(
    contact?.last_contacted_at
      ? contact.last_contacted_at.slice(0, 10)
      : "",
  );
  const [notes, setNotes] = useState(contact?.notes ?? "");

  const [fieldError, setFieldError] = useState<{
    funderId?: string;
    name?: string;
    email?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [isDirty, setIsDirty] = useState(false);
  const { markClean } = useUnsavedChanges(isDirty);

  // Load the organization's funders for the (required) funder dropdown. RLS
  // scopes this to the current org automatically.
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("funders")
        .select("id, name")
        .order("name", { ascending: true });
      if (!active) return;
      setFunders(data ?? []);
      setFundersLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  function validate(): boolean {
    const errors: { funderId?: string; name?: string; email?: string } = {};
    if (!isNonEmpty(funderId)) errors.funderId = "Select a funder.";
    if (!isNonEmpty(name)) errors.name = "Contact name is required.";
    if (isNonEmpty(email) && !isValidEmail(email)) {
      errors.email = "Enter a valid email address.";
    }
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

    // organization_id comes from the session profile, never the form.
    const payload = {
      funder_id: funderId,
      name: name.trim(),
      title: title.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      preferred_contact_method: preferredContactMethod || null,
      relationship,
      last_contacted_at: lastContactedAt
        ? new Date(lastContactedAt).toISOString()
        : null,
      notes: notes.trim() || null,
    };

    if (isEdit && contact) {
      const { data, error } = await supabase
        .from("contacts")
        .update(payload)
        .eq("id", contact.id)
        .select()
        .single();

      setSubmitting(false);
      if (error || !data) {
        setFormError(error?.message ?? "Could not save the contact.");
        return;
      }
      markClean();
      if (onSaved) onSaved(data);
      else router.push(`/contacts/${data.id}`);
      router.refresh();
      return;
    }

    const { data, error } = await supabase
      .from("contacts")
      .insert({ ...payload, organization_id: profile.organization_id })
      .select()
      .single();

    setSubmitting(false);
    if (error || !data) {
      setFormError(error?.message ?? "Could not create the contact.");
      return;
    }
    markClean();
    if (onSaved) onSaved(data);
    else router.push(`/contacts/${data.id}`);
    router.refresh();
  }

  const funderOptions = funders.map((f) => ({ value: f.id, label: f.name }));
  const noFunders = !fundersLoading && funders.length === 0;

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

      {noFunders && (
        <div
          role="alert"
          className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
        >
          You need at least one funder before adding a contact. Create a funder
          first, then link the contact to it.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Select
          label="Funder"
          required
          placeholder={fundersLoading ? "Loading funders..." : "Select a funder..."}
          options={funderOptions}
          value={funderId}
          onChange={(e) => setFunderId(e.target.value)}
          error={fieldError.funderId}
          disabled={fundersLoading || noFunders}
          helperText="Every contact must be linked to a funder."
        />
        <Input
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldError.name}
          placeholder="e.g. Jane Doe"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Director of Community Giving"
        />
        <Select
          label="Relationship"
          options={RELATIONSHIP_OPTIONS}
          value={relationship}
          onChange={(e) =>
            setRelationship(e.target.value as ContactRelationship)
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldError.email}
          placeholder="name@example.com"
        />
        <Input
          label="Phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Select
          label="Preferred contact method"
          placeholder="Not set"
          options={METHOD_OPTIONS}
          value={preferredContactMethod}
          onChange={(e) => setPreferredContactMethod(e.target.value)}
        />
        <Input
          label="Last contacted"
          type="date"
          value={lastContactedAt}
          onChange={(e) => setLastContactedAt(e.target.value)}
        />
      </div>

      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Context about this contact and your relationship."
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
          disabled={profileLoading || noFunders}
        >
          {isEdit ? "Save changes" : "Create contact"}
        </Button>
      </div>
    </form>
  );
}
