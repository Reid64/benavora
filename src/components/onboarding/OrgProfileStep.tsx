"use client";

import { useState, type FormEvent } from "react";

import { Button, Input, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isNonEmpty } from "@/lib/utils/validators";

/** The org fields the wizard reports back for completion + greeting. */
export type OrgProfileSummary = { name: string; ein: string; mission: string };

/** Full set of org fields this step manages, pre-filled on resume. */
export type OrgProfileInitial = OrgProfileSummary & {
  dba: string;
  taxStatus: string;
  vision: string;
  targetPopulation: string;
  serviceArea: string;
  website: string;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
};

export type OrgProfileStepProps = {
  organizationId: string;
  initial: OrgProfileInitial;
  /** Called after a successful save, with the core values so the wizard updates its snapshot. */
  onSaved: (values: OrgProfileSummary) => void;
};

/**
 * Step 2 — organization profile (BLUEPRINT onboarding Steps 1-2: basics +
 * mission). Captures legal identity, contact/address, mission and vision in one
 * pass and writes them straight to the organizations row via the session-bound
 * browser client; RLS limits the update to the user's own org, and
 * organization_id is never taken from the form (Behavioral Contracts §2).
 *
 * Name, EIN, and mission are what the AI drafting agents lean on most, so they
 * are required to mark the step complete; everything else is optional.
 */
export function OrgProfileStep({
  organizationId,
  initial,
  onSaved,
}: OrgProfileStepProps) {
  const [values, setValues] = useState<OrgProfileInitial>(initial);

  const [fieldError, setFieldError] = useState<{
    name?: string;
    ein?: string;
    mission?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof OrgProfileInitial>(
    key: K,
    value: OrgProfileInitial[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function validate(): boolean {
    const errors: typeof fieldError = {};
    if (!isNonEmpty(values.name))
      errors.name = "Organization name is required.";
    if (!isNonEmpty(values.ein)) errors.ein = "EIN is required.";
    else if (!/^\d{2}-?\d{7}$/.test(values.ein.trim()))
      errors.ein = "EIN should look like 12-3456789.";
    if (!isNonEmpty(values.mission))
      errors.mission = "A mission statement is required.";
    setFieldError(errors);
    return Object.keys(errors).length === 0;
  }

  /** Trimmed value or null for an optional column. */
  function orNull(value: string): string | null {
    return isNonEmpty(value) ? value.trim() : null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);
    if (!validate()) return;

    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase
      .from("organizations")
      .update({
        name: values.name.trim(),
        ein: values.ein.trim(),
        mission_statement: values.mission.trim(),
        dba: orNull(values.dba),
        tax_status: orNull(values.taxStatus),
        vision_statement: orNull(values.vision),
        target_population: orNull(values.targetPopulation),
        service_area: orNull(values.serviceArea),
        website: orNull(values.website),
        phone: orNull(values.phone),
        email: orNull(values.email),
        address_line1: orNull(values.addressLine1),
        city: orNull(values.city),
        state: orNull(values.state),
        zip: orNull(values.zip),
        updated_at: new Date().toISOString(),
      })
      .eq("id", organizationId);

    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setSaved(true);
    onSaved({
      name: values.name.trim(),
      ein: values.ein.trim(),
      mission: values.mission.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formError}
        </div>
      )}

      {/* Legal identity */}
      <section className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-400">
          Legal identity
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Input
            label="Legal name"
            required
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            error={fieldError.name}
            placeholder="e.g. Hope Harbor Community Services"
          />
          <Input
            label="Doing business as (DBA)"
            value={values.dba}
            onChange={(e) => set("dba", e.target.value)}
            placeholder="Optional trade name"
          />
          <Input
            label="EIN (tax ID)"
            required
            value={values.ein}
            onChange={(e) => set("ein", e.target.value)}
            error={fieldError.ein}
            placeholder="12-3456789"
            helperText="Your federal Employer Identification Number."
          />
          <Input
            label="Tax status"
            value={values.taxStatus}
            onChange={(e) => set("taxStatus", e.target.value)}
            placeholder="e.g. 501(c)(3) or 508(c)(1)(a)"
          />
        </div>
      </section>

      {/* Contact & address */}
      <section className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-400">
          Contact &amp; address
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Input
            label="Website"
            type="url"
            value={values.website}
            onChange={(e) => set("website", e.target.value)}
            placeholder="https://your-org.org"
          />
          <Input
            label="Phone"
            type="tel"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="(555) 123-4567"
          />
          <Input
            label="Public email"
            type="email"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="info@your-org.org"
          />
          <Input
            label="Street address"
            value={values.addressLine1}
            onChange={(e) => set("addressLine1", e.target.value)}
            placeholder="123 Main St"
          />
          <Input
            label="City"
            value={values.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="Austin"
          />
          <div className="grid grid-cols-2 gap-5">
            <Input
              label="State"
              value={values.state}
              onChange={(e) => set("state", e.target.value)}
              placeholder="TX"
            />
            <Input
              label="ZIP"
              value={values.zip}
              onChange={(e) => set("zip", e.target.value)}
              placeholder="78701"
            />
          </div>
        </div>
      </section>

      {/* Mission & focus */}
      <section className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-400">
          Mission &amp; focus
        </h2>
        <Textarea
          label="Mission statement"
          required
          value={values.mission}
          onChange={(e) => set("mission", e.target.value)}
          error={fieldError.mission}
          placeholder="In one or two sentences, who you serve and the change you create."
          rows={3}
        />
        <Textarea
          label="Vision statement"
          value={values.vision}
          onChange={(e) => set("vision", e.target.value)}
          placeholder="The long-term future your work is building toward."
          rows={3}
        />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Input
            label="Target population"
            value={values.targetPopulation}
            onChange={(e) => set("targetPopulation", e.target.value)}
            placeholder="e.g. Families facing housing insecurity"
          />
          <Input
            label="Service area"
            value={values.serviceArea}
            onChange={(e) => set("serviceArea", e.target.value)}
            placeholder="e.g. Rural Central Texas"
          />
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="text-sm font-medium text-teal-600">Saved ✓</span>
        )}
        <Button type="submit" isLoading={saving}>
          {saved ? "Saved" : "Save organization"}
        </Button>
      </div>
    </form>
  );
}
