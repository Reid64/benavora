"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, GripVertical, Linkedin, Mail, Phone, Plus, Trash2, Users } from "lucide-react";

import { Button, Card, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { MIN_CAMPAIGN_STEP_GAP_DAYS } from "@/lib/utils/constants";
import type { Tables } from "@/types/database";

/** Template variables the drip sequence supports (Contracts §13). */
export const CAMPAIGN_TEMPLATE_VARIABLES = [
  "{company_name}",
  "{contact_name}",
  "{foundation_name}",
  "{mission_snippet}",
  "{program_name}",
  "{impact_stat}",
] as const;

/** Sample values used to render the live preview (illustrative only). */
const PREVIEW_SAMPLE: Record<string, string> = {
  company_name: "Acme Construction",
  contact_name: "Jordan Lee",
  foundation_name: "Your Foundation",
  mission_snippet: "providing emergency and transitional housing in rural Texas",
  program_name: "Emergency Housing Initiative",
  impact_stat: "served 150 families last year",
};

/** Pre-built 3-step intro sequence (Contracts §13). */
const INTRO_SEQUENCE: Array<{ subject: string; body: string; delayDays: number }> = [
  {
    delayDays: 0,
    subject: "Introducing {foundation_name} - a potential partnership with {company_name}",
    body: `Hi {contact_name},

I lead {foundation_name}, a nonprofit focused on {mission_snippet}.

I'm reaching out because {company_name}'s work aligns closely with our {program_name}. We've made real progress - {impact_stat} - and we're looking for community partners who share our commitment.

Would you be open to a brief conversation?

Warm regards,
{foundation_name}`,
  },
  {
    delayDays: 5,
    subject: "Following up - {foundation_name} × {company_name}",
    body: `Hi {contact_name},

I wanted to follow up on my note from last week. I know your inbox is busy, so I'll keep this short.

{foundation_name} is seeking partners for {program_name}. Our work has {impact_stat}, and we believe {company_name} could play a meaningful role.

I'd love 15 minutes to share more. Does anything on your calendar this week work?

Best,
{foundation_name}`,
  },
  {
    delayDays: 5,
    subject: "One quick question, {contact_name}",
    body: `Hi {contact_name},

I've reached out a couple of times about a potential partnership between {foundation_name} and {company_name}.

I want to be direct: we're looking for a {program_name} partner who shares our values. {impact_stat}.

If that resonates, I'd love 20 minutes together. If not, no worries - I appreciate your time either way.

Thank you,
{foundation_name}`,
  },
];

type OutreachChannel = "email" | "phone" | "mail" | "linkedin";

const CHANNEL_OPTIONS: OutreachChannel[] = ["email", "phone", "mail", "linkedin"];

const CHANNEL_CONFIG: Record<
  OutreachChannel,
  { label: string; Icon: typeof Mail; subjectLabel: string; bodyLabel: string }
> = {
  email: { label: "Email", Icon: Mail, subjectLabel: "Subject", bodyLabel: "Body" },
  phone: { label: "Phone", Icon: Phone, subjectLabel: "Call Title", bodyLabel: "Script" },
  mail: { label: "Physical Mail", Icon: FileText, subjectLabel: "Letter Title", bodyLabel: "Letter Body" },
  linkedin: { label: "LinkedIn", Icon: Linkedin, subjectLabel: "Message Title", bodyLabel: "Message" },
};

type StepDraft = {
  /** Stable key for React list rendering only; not persisted. */
  key: string;
  subject: string;
  body: string;
  delayDays: number;
  channel: OutreachChannel;
};

/** Which field last held focus, so the variable picker can target it. */
type ActiveField = { key: string; field: "subject" | "body" } | null;

let stepKeySeq = 0;
function newStep(delayDays: number): StepDraft {
  stepKeySeq += 1;
  return { key: `step-${stepKeySeq}`, subject: "", body: "", delayDays, channel: "email" };
}

/** Substitute {variable} tokens with sample data for the preview. */
function renderPreview(template: string): string {
  return template.replace(
    /\{([a-z_]+)\}/gi,
    (match, name: string) => PREVIEW_SAMPLE[name] ?? match,
  );
}

/** All {tokens} in a template that are NOT one of the supported variables. */
function unknownVariables(template: string): string[] {
  const allowed = new Set(
    CAMPAIGN_TEMPLATE_VARIABLES.map((v) => v.slice(1, -1)),
  );
  const found = new Set<string>();
  for (const m of template.matchAll(/\{([a-z_]+)\}/gi)) {
    const name = m[1] ?? "";
    if (!allowed.has(name)) found.add(name);
  }
  return [...found];
}

export type CampaignBuilderProps = {
  /** Tenant scope, derived from the session profile (Behavioral Contracts §2). */
  organizationId: string | null;
  /** Profile id recorded as created_by. */
  createdBy: string | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
};

/**
 * Drip campaign step-sequence editor (BLUEPRINT §4.11). Builds an
 * email_campaigns row, its ordered campaign_steps, and enrolls the chosen
 * outreach_contacts. Enforces the contract rules (Behavioral Contracts §13/§21):
 * at least one step and one contact, a minimum 1-day gap between steps, and only
 * the supported template variables. New campaigns save as 'draft' - activation
 * happens from the manager or the detail page.
 */
export function CampaignBuilder({
  organizationId,
  createdBy,
  onCancel,
  onSaved,
}: CampaignBuilderProps) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([newStep(0)]);
  const [contacts, setContacts] = useState<Tables<"outreach_contacts">[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [contactsLoading, setContactsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [humanizing, setHumanizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeField = useRef<ActiveField>(null);

  const loadContacts = useCallback(async () => {
    setContactsLoading(true);
    const supabase = createClient();
    // Eligible contacts: not already enrolled, not converted (RLS-scoped).
    const { data } = await supabase
      .from("outreach_contacts")
      .select("*")
      .is("campaign_id", null)
      .neq("status", "converted")
      .order("created_at", { ascending: false });
    setContacts(data ?? []);
    setContactsLoading(false);
  }, []);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  function updateStep(key: string, patch: Partial<StepDraft>) {
    setSteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );
  }

  function addStep() {
    setSteps((prev) => [...prev, newStep(MIN_CAMPAIGN_STEP_GAP_DAYS)]);
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key));
  }

  /** Insert a variable token into whichever field last had focus. */
  function insertVariable(token: string) {
    const target = activeField.current;
    if (!target) {
      setError("Click into a subject or body field first, then add a variable.");
      return;
    }
    setError(null);
    const step = steps.find((s) => s.key === target.key);
    if (!step) return;
    if (target.field === "subject") {
      updateStep(target.key, { subject: appendToken(step.subject, token) });
    } else {
      updateStep(target.key, { body: appendToken(step.body, token) });
    }
  }

  function toggleContact(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Load whether the org has KB entries to resolve program_name / impact_stat. */
  async function resolveKbVariables(): Promise<{
    hasProgramName: boolean;
    hasImpactStat: boolean;
  }> {
    const supabase = createClient();
    const [programRes, impactRes] = await Promise.all([
      supabase
        .from("knowledge_base")
        .select("id", { count: "exact", head: true })
        .eq("category", "program_description")
        .limit(1),
      supabase
        .from("knowledge_base")
        .select("id", { count: "exact", head: true })
        .eq("category", "impact_statement")
        .limit(1),
    ]);
    return {
      hasProgramName: (programRes.count ?? 0) > 0,
      hasImpactStat: (impactRes.count ?? 0) > 0,
    };
  }

  function validate(): string | null {
    if (name.trim() === "") return "Give the campaign a name.";
    if (steps.length === 0) return "Add at least one step.";
    for (const [i, step] of steps.entries()) {
      if (step.subject.trim() === "" || step.body.trim() === "") {
        const ch = CHANNEL_CONFIG[step.channel];
        return `Step ${i + 1} needs both a ${ch.subjectLabel.toLowerCase()} and a ${ch.bodyLabel.toLowerCase()}.`;
      }
      const unknown = [
        ...unknownVariables(step.subject),
        ...unknownVariables(step.body),
      ];
      if (unknown.length > 0) {
        return `Step ${i + 1} uses unsupported variable(s): ${unknown
          .map((v) => `{${v}}`)
          .join(", ")}.`;
      }
      if (i > 0 && step.delayDays < MIN_CAMPAIGN_STEP_GAP_DAYS) {
        return `Step ${i + 1} must wait at least ${MIN_CAMPAIGN_STEP_GAP_DAYS} day after the previous step.`;
      }
    }
    if (selected.size === 0) return "Select at least one contact to enroll.";
    return null;
  }

  /** Humanize a single step body via the API. Returns original on failure. */
  async function humanizeBody(body: string): Promise<string> {
    try {
      const res = await fetch("/api/outreach/humanize-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) return body;
      const json = (await res.json()) as { content?: string };
      return json.content?.trim() || body;
    } catch {
      return body;
    }
  }

  async function handleSave() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!organizationId) {
      setError("Your session could not be verified.");
      return;
    }

    // Validate that all variables used in steps can be resolved (Contracts §13).
    const allText = steps.map((s) => `${s.subject} ${s.body}`).join(" ");
    const usesProgramName = /\{program_name\}/i.test(allText);
    const usesImpactStat = /\{impact_stat\}/i.test(allText);
    if (usesProgramName || usesImpactStat) {
      const kb = await resolveKbVariables();
      if (usesProgramName && !kb.hasProgramName) {
        setError(
          "Template uses {program_name} but your Knowledge Base has no program description. Add one under Knowledge Base → Program Description before saving.",
        );
        return;
      }
      if (usesImpactStat && !kb.hasImpactStat) {
        setError(
          "Template uses {impact_stat} but your Knowledge Base has no impact statement. Add one under Knowledge Base → Impact Statement before saving.",
        );
        return;
      }
    }

    setSubmitting(true);
    setError(null);

    // Run each step body through the AI Humanizer before saving (Contracts §13).
    setHumanizing(true);
    const humanizedSteps = await Promise.all(
      steps.map(async (step) => ({
        ...step,
        body: await humanizeBody(step.body),
      })),
    );
    setHumanizing(false);

    const supabase = createClient();

    const contactIds = [...selected];

    const { data: campaign, error: campaignError } = await supabase
      .from("email_campaigns")
      .insert({
        organization_id: organizationId,
        name: name.trim(),
        status: "draft",
        total_steps: steps.length,
        total_contacts: contactIds.length,
        created_by: createdBy,
      })
      .select("id")
      .single();

    if (campaignError || !campaign) {
      setError(campaignError?.message ?? "Could not create the campaign.");
      setSubmitting(false);
      return;
    }

    const stepRows = humanizedSteps.map((step, index) => ({
      campaign_id: campaign.id,
      step_number: index + 1,
      subject_template: `[${step.channel}] ${step.subject.trim()}`,
      body_template: step.body.trim(),
      delay_days: index === 0 ? 0 : step.delayDays,
    }));

    const { error: stepsError } = await supabase
      .from("campaign_steps")
      .insert(stepRows);

    if (stepsError) {
      // Roll back the orphaned campaign so a failed step insert leaves no
      // half-built record behind.
      await supabase.from("email_campaigns").delete().eq("id", campaign.id);
      setError(stepsError.message);
      setSubmitting(false);
      return;
    }

    // Enroll the selected contacts.
    const { error: enrollError } = await supabase
      .from("outreach_contacts")
      .update({ campaign_id: campaign.id, updated_at: new Date().toISOString() })
      .in("id", contactIds);

    if (enrollError) {
      await supabase
        .from("campaign_steps")
        .delete()
        .eq("campaign_id", campaign.id);
      await supabase.from("email_campaigns").delete().eq("id", campaign.id);
      setError(enrollError.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    await onSaved();
  }

  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Pre-built template picker (Contracts §13). */}
      <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5">
        <p className="mb-1.5 text-xs font-medium text-teal-700">
          Quick start with a pre-built sequence
        </p>
        <button
          type="button"
          onClick={() => {
            setSteps(
              INTRO_SEQUENCE.map((t, i) => ({
                ...newStep(t.delayDays),
                subject: t.subject,
                body: t.body,
                delayDays: i === 0 ? 0 : t.delayDays,
              })),
            );
          }}
          className="rounded bg-white px-3 py-1.5 text-xs font-medium text-teal-700 ring-1 ring-teal-300 transition hover:bg-teal-100"
        >
          Use 3-step intro sequence (intro → 5-day follow-up → meeting request)
        </button>
      </div>

      <Input
        label="Campaign name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Q3 local construction outreach"
        required
      />

      <div className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-2.5">
        <p className="mb-2 text-xs font-medium text-navy-600">
          Insert a variable into the focused field:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {CAMPAIGN_TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVariable(v)}
              className="rounded bg-white px-2 py-1 text-xs text-navy-700 ring-1 ring-navy-200 transition hover:bg-navy-100"
            >
              <code>{v}</code>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {steps.map((step, index) => {
          const { Icon: ChIcon, label: chLabel, subjectLabel, bodyLabel } =
            CHANNEL_CONFIG[step.channel];
          return (
            <Card key={step.key} className="relative">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-navy-700">
                  <GripVertical className="h-4 w-4 text-navy-400" aria-hidden />
                  Step {index + 1}
                  <ChIcon className="h-3.5 w-3.5 text-navy-500" aria-hidden />
                  <span className="text-xs font-normal text-navy-400">{chLabel}</span>
                </div>
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStep(step.key)}
                    className="inline-flex items-center gap-1 text-xs text-red-600 transition hover:text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Remove
                  </button>
                )}
              </div>

              {/* Channel selector */}
              <div className="mb-3 flex flex-wrap gap-1">
                {CHANNEL_OPTIONS.map((ch) => {
                  const cfg = CHANNEL_CONFIG[ch];
                  const CfgIcon = cfg.Icon;
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => updateStep(step.key, { channel: ch })}
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition",
                        step.channel === ch
                          ? "bg-teal-600 text-white"
                          : "bg-navy-100 text-navy-600 hover:bg-navy-200",
                      )}
                    >
                      <CfgIcon className="h-3 w-3" aria-hidden />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3">
                <Input
                  label={subjectLabel}
                  value={step.subject}
                  onFocus={() => {
                    activeField.current = { key: step.key, field: "subject" };
                  }}
                  onChange={(e) =>
                    updateStep(step.key, { subject: e.target.value })
                  }
                  placeholder="Partnering with {company_name} on housing"
                />
                <Textarea
                  label={bodyLabel}
                  value={step.body}
                  onFocus={() => {
                    activeField.current = { key: step.key, field: "body" };
                  }}
                  onChange={(e) => updateStep(step.key, { body: e.target.value })}
                  rows={4}
                  placeholder="Hi {contact_name}, I lead {foundation_name}..."
                />
                {index === 0 ? (
                  <p className="text-xs text-navy-500">
                    Step 1 executes immediately when the campaign starts.
                  </p>
                ) : (
                  <Input
                    label="Send this many days after the previous step"
                    type="number"
                    min={MIN_CAMPAIGN_STEP_GAP_DAYS}
                    value={String(step.delayDays)}
                    onChange={(e) =>
                      updateStep(step.key, {
                        delayDays: Math.max(
                          MIN_CAMPAIGN_STEP_GAP_DAYS,
                          Number(e.target.value) || MIN_CAMPAIGN_STEP_GAP_DAYS,
                        ),
                      })
                    }
                    className="sm:max-w-xs"
                  />
                )}

                {(step.subject.trim() !== "" || step.body.trim() !== "") && (
                  <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-sm">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-navy-400">
                      Preview · {chLabel} (sample data)
                    </p>
                    <p className="mt-1 text-sm font-medium text-navy-800">
                      {renderPreview(step.subject) || "-"}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-navy-600">
                      {renderPreview(step.body)}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Button type="button" variant="secondary" onClick={addStep}>
        <Plus className="h-4 w-4" aria-hidden />
        Add step
      </Button>

      {/* Contact selector (Behavioral Contracts §13: at least one contact). */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-medium text-navy-700">
            <Users className="h-4 w-4 text-navy-400" aria-hidden />
            Enroll contacts
          </p>
          <span className="text-xs text-navy-500">{selected.size} selected</span>
        </div>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-navy-200">
          {contactsLoading ? (
            <p className="px-3 py-4 text-sm text-navy-500">Loading contacts...</p>
          ) : contacts.length === 0 ? (
            <p className="px-3 py-4 text-sm text-navy-500">
              No unassigned outreach contacts. Scan a company or free up
              contacts from other campaigns first.
            </p>
          ) : (
            <ul className="divide-y divide-navy-100">
              {contacts.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 transition hover:bg-navy-50">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleContact(c.id)}
                      className="h-4 w-4 rounded border-navy-300 text-navy-600"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-navy-800">
                        {c.company_name}
                        {c.contact_name ? ` · ${c.contact_name}` : ""}
                      </span>
                      <span className="block truncate text-xs text-navy-500">
                        {c.email ?? "No email - cannot be sent to"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-navy-200 pt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} isLoading={submitting}>
          {humanizing ? "Humanizing..." : "Save campaign"}
        </Button>
      </div>
    </div>
  );
}

/** Append a token to a field value, inserting a single separating space. */
function appendToken(current: string, token: string): string {
  if (current === "") return token;
  return /\s$/.test(current) ? current + token : `${current} ${token}`;
}
