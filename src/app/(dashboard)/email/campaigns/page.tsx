"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  GripVertical,
  Mail,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

// Outreach & Communication section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Rust. Secondary accent: Bronze. Applied to this page's own sequence
// list; the creation wizard's modal-internal Cards are left as the shared
// component's default treatment (transient dialog content, not the page surface).
const FRAME_RUST = "#A3492F";
const ACCENT_BRONZE = "#A4712C";
const CARD_BG = "#F8F5EE";

type Sequence = Tables<"email_campaign_sequences">;
type Template = Tables<"email_templates">;
type OutreachContact = Tables<"outreach_contacts">;

const STATUS_COLOR: Record<string, BadgeColor> = {
  draft: "gray",
  active: "green",
  paused: "yellow",
  completed: "blue",
};

const CONDITION_OPTIONS = [
  { value: "always", label: "Always send" },
  { value: "if_no_reply", label: "If no reply to previous step" },
  { value: "if_opened", label: "If previous step was opened" },
];

type StepDraft = {
  key: string;
  templateId: string;
  subjectOverride: string;
  bodyOverride: string;
  delayDays: number;
  delayHours: number;
  conditionType: string;
};

let stepSeq = 0;
function makeStep(isFirst: boolean): StepDraft {
  stepSeq += 1;
  return {
    key: `s-${stepSeq}`,
    templateId: "",
    subjectOverride: "",
    bodyOverride: "",
    delayDays: isFirst ? 0 : 3,
    delayHours: 0,
    conditionType: "always",
  };
}

type WizardPane = 1 | 2 | 3 | 4;

/**
 * Email campaigns list for the email_campaign_sequences system.
 * Sequences use email_templates for per-step content and enroll contacts
 * from the outreach_contacts CRM or a pasted email list.
 */
export default function EmailCampaignsPage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/email/sequences");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { sequences: Sequence[] };
      setSequences(data.sequences ?? []);
    } catch {
      setError("Could not load campaigns.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: string) {
    await fetch(`/api/email/sequences/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
  }

  return (
    <div className="space-y-6">
      <Link
        href="/email"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to email
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: FRAME_RUST }}>
            Email Campaigns
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Multi-step drip sequences using email templates.
          </p>
        </div>
        {editable && (
          <Button
            variant="secondary"
            onClick={() => setBuilding(true)}
            style={{ backgroundColor: FRAME_RUST, color: CARD_BG, border: "none" }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            New Campaign
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : sequences.length === 0 ? (
        <EmptyState
          icon={Send}
          title="No campaigns yet"
          description="Build a multi-step email sequence to nurture contacts with template-driven steps."
          action={
            editable ? (
              <Button
                variant="secondary"
                onClick={() => setBuilding(true)}
                style={{ backgroundColor: FRAME_RUST, color: CARD_BG, border: "none" }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                New Campaign
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {sequences.map((seq) => {
            const status = seq.status ?? "draft";
            const replyRate =
              (seq.total_enrolled ?? 0) > 0
                ? Math.round(((seq.total_replied ?? 0) / (seq.total_enrolled ?? 1)) * 100)
                : 0;
            return (
              <div
                key={seq.id}
                style={{ backgroundColor: FRAME_RUST, borderRadius: "14px", boxShadow: "0 4px 20px rgba(163,73,47,0.22)", padding: "3px" }}
              >
              <div className="rounded-[11px] p-5" style={{ backgroundColor: CARD_BG }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/email/campaigns/${seq.id}`}
                      className="group flex flex-wrap items-center gap-2"
                    >
                      <p className="font-medium text-navy-900 transition group-hover:text-teal-700">
                        {seq.name}
                      </p>
                      <Badge color={STATUS_COLOR[status] ?? "gray"}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Badge>
                      <ChevronRight
                        className="h-4 w-4 text-navy-300 transition group-hover:text-teal-600"
                        aria-hidden
                      />
                    </Link>
                    {seq.description && (
                      <p className="mt-0.5 truncate text-xs text-navy-500">
                        {seq.description}
                      </p>
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-navy-500">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" aria-hidden />
                        {seq.total_enrolled ?? 0} enrolled
                      </span>
                      <span>·</span>
                      <span>{replyRate}% reply rate</span>
                      <span>·</span>
                      <span>Created {formatRelative(seq.created_at)}</span>
                    </p>
                  </div>
                  {editable && (
                    <div className="flex shrink-0 items-center gap-2">
                      {(status === "draft" || status === "paused") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void setStatus(seq.id, "active")}
                          style={{
                            border: `1.5px solid ${ACCENT_BRONZE}`,
                            backgroundColor: "rgba(164,113,44,0.08)",
                            color: ACCENT_BRONZE,
                          }}
                        >
                          <Play className="h-4 w-4" aria-hidden />
                          {status === "paused" ? "Resume" : "Activate"}
                        </Button>
                      )}
                      {status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void setStatus(seq.id, "paused")}
                          style={{
                            border: `1.5px solid ${ACCENT_BRONZE}`,
                            backgroundColor: "rgba(164,113,44,0.08)",
                            color: ACCENT_BRONZE,
                          }}
                        >
                          <Pause className="h-4 w-4" aria-hidden />
                          Pause
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={building}
        onClose={() => setBuilding(false)}
        title="New Email Campaign"
        size="xl"
      >
        <CampaignWizard
          organizationId={profile?.organization_id ?? null}
          onCancel={() => setBuilding(false)}
          onSaved={async () => {
            setBuilding(false);
            await load();
          }}
        />
      </Modal>
    </div>
  );
}

// ── 4-step creation wizard ─────────────────────────────────────────────────

const WIZARD_LABELS = ["Details", "Steps", "Enrollment", "Review"] as const;

function CampaignWizard({
  organizationId,
  onCancel,
  onSaved,
}: {
  organizationId: string | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [pane, setPane] = useState<WizardPane>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>(() => [makeStep(true)]);
  const [emailText, setEmailText] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(
    new Set(),
  );
  const [contacts, setContacts] = useState<OutreachContact[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const templatesLoaded = useRef(false);
  const contactsLoaded = useRef(false);

  useEffect(() => {
    if (pane === 2 && !templatesLoaded.current) {
      templatesLoaded.current = true;
      void (async () => {
        setTemplatesLoading(true);
        try {
          const res = await fetch("/api/email/templates");
          if (res.ok) {
            const data = (await res.json()) as { templates: Template[] };
            setTemplates(data.templates ?? []);
          }
        } finally {
          setTemplatesLoading(false);
        }
      })();
    }
  }, [pane]);

  useEffect(() => {
    if (pane === 3 && !contactsLoaded.current) {
      contactsLoaded.current = true;
      void (async () => {
        setContactsLoading(true);
        const supabase = createClient();
        const { data } = await supabase
          .from("outreach_contacts")
          .select("*")
          .neq("status", "converted")
          .order("created_at", { ascending: false });
        setContacts(data ?? []);
        setContactsLoading(false);
      })();
    }
  }, [pane]);

  function updateStep(key: string, patch: Partial<StepDraft>) {
    setSteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );
  }

  function addStep() {
    setSteps((prev) => [...prev, makeStep(false)]);
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key));
  }

  function toggleContact(id: string) {
    setSelectedContacts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function parsedEmails(): string[] {
    return emailText
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));
  }

  function validate(at: WizardPane): string | null {
    if (at === 1) {
      if (name.trim() === "") return "Give the campaign a name.";
    }
    if (at === 2) {
      if (steps.length === 0) return "Add at least one step.";
      for (const [i, s] of steps.entries()) {
        if (!s.templateId && s.subjectOverride.trim() === "") {
          return `Step ${i + 1}: select a template or enter a subject override.`;
        }
      }
    }
    if (at === 3) {
      const total = parsedEmails().length + selectedContacts.size;
      if (total === 0)
        return "Add at least one email address or select a contact to enroll.";
    }
    return null;
  }

  function goNext() {
    const err = validate(pane);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setPane((p) => (p < 4 ? ((p + 1) as WizardPane) : p));
  }

  function goBack() {
    setError(null);
    setPane((p) => (p > 1 ? ((p - 1) as WizardPane) : p));
  }

  async function save() {
    if (!organizationId) {
      setError("Your session could not be verified. Please reload.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/email/sequences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        steps: steps.map((s, i) => ({
          template_id: s.templateId || undefined,
          subject_override: s.subjectOverride.trim() || undefined,
          body_override: s.bodyOverride.trim() || undefined,
          delay_days: i === 0 ? 0 : s.delayDays,
          delay_hours: s.delayHours,
          condition_type: s.conditionType,
        })),
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(body?.error ?? "Could not create the campaign.");
      setSubmitting(false);
      return;
    }

    const { id: seqId } = (await res.json()) as { id: string };

    // Build enrollment list
    const emailContacts = parsedEmails().map((addr) => ({
      email: addr,
      variables: {},
    }));
    const crmContacts = contacts
      .filter((c) => selectedContacts.has(c.id) && c.email)
      .map((c) => ({
        email: c.email as string,
        contact_id: c.id,
        variables: {},
      }));
    const allContacts = [...emailContacts, ...crmContacts];

    if (allContacts.length > 0) {
      await fetch(`/api/email/sequences/${seqId}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: allContacts }),
      });
    }

    setSubmitting(false);
    await onSaved();
  }

  const reviewEmailCount = parsedEmails().length + selectedContacts.size;

  return (
    <div className="space-y-5">
      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {WIZARD_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n < pane;
          const active = n === pane;
          return (
            <div key={label} className="flex items-center gap-1">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition ${
                  done
                    ? "bg-teal-600 text-white"
                    : active
                      ? "bg-teal-100 text-teal-700 ring-1 ring-teal-400"
                      : "bg-navy-100 text-navy-400"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </div>
              <span
                className={`text-xs ${active ? "font-medium text-navy-700" : "text-navy-400"}`}
              >
                {label}
              </span>
              {i < WIZARD_LABELS.length - 1 && (
                <ArrowRight className="h-3 w-3 text-navy-300" aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Pane 1: Name + description */}
      {pane === 1 && (
        <div className="space-y-4">
          <Input
            label="Campaign name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Welcome sequence"
            required
          />
          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe what this campaign is for…"
          />
        </div>
      )}

      {/* Pane 2: Step builder */}
      {pane === 2 && (
        <div className="space-y-4">
          <p className="text-xs text-navy-500">
            Each step sends one email. Select a saved template or enter a
            subject/body override. Step 1 sends immediately; subsequent steps
            wait the configured delay.
          </p>
          {templatesLoading ? (
            <div className="flex justify-center py-6">
              <LoadingSpinner />
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {steps.map((s, idx) => (
                  <Card key={s.key}>
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium text-navy-700">
                        <GripVertical
                          className="h-4 w-4 text-navy-400"
                          aria-hidden
                        />
                        Step {idx + 1}
                      </div>
                      {steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStep(s.key)}
                          className="inline-flex items-center gap-1 text-xs text-red-600 transition hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          Remove
                        </button>
                      )}
                    </div>

                    <Select
                      label="Template"
                      value={s.templateId}
                      onChange={(e) =>
                        updateStep(s.key, { templateId: e.target.value })
                      }
                      placeholder="— No template (enter override below) —"
                    >
                      <option value="">— No template —</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.template_type ? ` (${t.template_type})` : ""}
                        </option>
                      ))}
                    </Select>

                    {!s.templateId && (
                      <div className="mt-3 space-y-3">
                        <Input
                          label="Subject"
                          value={s.subjectOverride}
                          onChange={(e) =>
                            updateStep(s.key, {
                              subjectOverride: e.target.value,
                            })
                          }
                          placeholder="Hi {contact_name}, …"
                        />
                        <Textarea
                          label="Body"
                          value={s.bodyOverride}
                          onChange={(e) =>
                            updateStep(s.key, { bodyOverride: e.target.value })
                          }
                          rows={4}
                          placeholder="Email body with {variable} placeholders…"
                        />
                      </div>
                    )}

                    {idx > 0 && (
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Input
                          label="Delay (days)"
                          type="number"
                          min={0}
                          value={String(s.delayDays)}
                          onChange={(e) =>
                            updateStep(s.key, {
                              delayDays: Math.max(
                                0,
                                Number(e.target.value) || 0,
                              ),
                            })
                          }
                        />
                        <Input
                          label="Delay (hours)"
                          type="number"
                          min={0}
                          max={23}
                          value={String(s.delayHours)}
                          onChange={(e) =>
                            updateStep(s.key, {
                              delayHours: Math.min(
                                23,
                                Math.max(0, Number(e.target.value) || 0),
                              ),
                            })
                          }
                        />
                        <Select
                          label="Condition"
                          value={s.conditionType}
                          options={CONDITION_OPTIONS}
                          onChange={(e) =>
                            updateStep(s.key, {
                              conditionType: e.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                  </Card>
                ))}
              </div>
              <Button type="button" variant="secondary" onClick={addStep}>
                <Plus className="h-4 w-4" aria-hidden />
                Add step
              </Button>
            </>
          )}
        </div>
      )}

      {/* Pane 3: Enrollment */}
      {pane === 3 && (
        <div className="space-y-4">
          <Textarea
            label="Paste email addresses (one per line, or comma/semicolon-separated)"
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            rows={4}
            placeholder={"alice@example.com\nbob@example.com"}
          />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-medium text-navy-700">
                <Users className="h-4 w-4 text-navy-400" aria-hidden />
                Or select from CRM contacts
              </p>
              <span className="text-xs text-navy-500">
                {selectedContacts.size} selected
              </span>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-navy-200">
              {contactsLoading ? (
                <p className="px-3 py-4 text-sm text-navy-500">Loading...</p>
              ) : contacts.length === 0 ? (
                <p className="px-3 py-4 text-sm text-navy-500">
                  No outreach contacts found.
                </p>
              ) : (
                <ul className="divide-y divide-navy-100">
                  {contacts.map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 transition hover:bg-navy-50">
                        <input
                          type="checkbox"
                          checked={selectedContacts.has(c.id)}
                          onChange={() => toggleContact(c.id)}
                          disabled={!c.email}
                          className="h-4 w-4 rounded border-navy-300 text-navy-600"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-navy-800">
                            {c.company_name}
                            {c.contact_name ? ` · ${c.contact_name}` : ""}
                          </span>
                          <span className="block truncate text-xs text-navy-500">
                            {c.email ?? "No email — cannot enroll"}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pane 4: Review */}
      {pane === 4 && (
        <div className="space-y-4">
          <Card>
            <h3 className="text-sm font-semibold text-navy-800">{name}</h3>
            {description && (
              <p className="mt-1 text-sm text-navy-600">{description}</p>
            )}
            <p className="mt-2 text-xs text-navy-500">
              {steps.length} step{steps.length === 1 ? "" : "s"}
            </p>
          </Card>
          <Card>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-navy-400" aria-hidden />
              <p className="text-sm text-navy-700">
                <strong>{reviewEmailCount}</strong> contact
                {reviewEmailCount === 1 ? "" : "s"} will be enrolled
              </p>
            </div>
          </Card>
          <p className="text-xs text-navy-500">
            The campaign will be created in{" "}
            <strong className="text-navy-700">draft</strong> status. Activate
            it from the campaigns list to start sending.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-navy-200 pt-4">
        <div>
          {pane > 1 && (
            <Button
              variant="secondary"
              onClick={goBack}
              disabled={submitting}
            >
              Back
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          {pane < 4 ? (
            <Button onClick={goNext}>
              Next
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button onClick={() => void save()} isLoading={submitting}>
              <Mail className="h-4 w-4" aria-hidden />
              Create Campaign
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
