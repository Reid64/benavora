"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Layers,
  Mail,
  Pause,
  Pencil,
  Play,
  Send,
  UserPlus,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  Input,
  LoadingSpinner,
  Modal,
  Textarea,
} from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import { MIN_CAMPAIGN_STEP_GAP_DAYS } from "@/lib/utils/constants";
import type { Enums, Tables } from "@/types/database";

type CampaignStatus = Enums<"campaign_status">;
type StepRow = Tables<"campaign_steps">;
type SendRow = Tables<"campaign_sends">;

interface ContactStatus {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  status: string;
  converted: boolean;
  sends_count: number;
  last_state: "pending" | "sent" | "opened" | "replied" | "bounced";
}

interface CampaignDetail {
  campaign: Tables<"email_campaigns">;
  steps: StepRow[];
  contacts: ContactStatus[];
  sends: SendRow[];
  stats: {
    totalContacts: number;
    totalSent: number;
    totalOpened: number;
    totalReplied: number;
    totalBounced: number;
    converted: number;
    openRate: number;
    replyRate: number;
    conversionRate: number;
  };
}

const STATUS_COLOR: Record<CampaignStatus, BadgeColor> = {
  draft: "gray",
  active: "green",
  paused: "yellow",
  completed: "blue",
};

const SEND_STATE_COLOR: Record<ContactStatus["last_state"], BadgeColor> = {
  pending: "gray",
  sent: "blue",
  opened: "teal",
  replied: "green",
  bounced: "red",
};

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingContacts, setAddingContacts] = useState(false);
  const [editingSteps, setEditingSteps] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/agents/campaigns/${campaignId}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(body?.error ?? "Could not load the campaign.");
      setLoading(false);
      return;
    }
    setDetail((await res.json()) as CampaignDetail);
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(status: CampaignStatus) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/agents/campaigns/${campaignId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(body?.error ?? "Could not update the campaign.");
    } else {
      await load();
    }
    setBusy(false);
  }

  async function runNow() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/agents/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignIds: [campaignId] }),
    });
    const body = (await res.json().catch(() => null)) as
      | { error?: string; emailsSent?: number; replies?: number; bounces?: number }
      | null;
    if (!res.ok) {
      setError(body?.error ?? "Campaign run failed.");
    } else {
      setNotice(
        `Run complete: ${body?.emailsSent ?? 0} sent, ${body?.replies ?? 0} replies, ${body?.bounces ?? 0} bounced.`,
      );
      await load();
    }
    setBusy(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const { campaign, steps, contacts, sends, stats } = detail;
  const status = (campaign.status ?? "draft") as CampaignStatus;
  const canActivate = status === "draft" || status === "paused";
  const canPause = status === "active";
  const canComplete = status === "active" || status === "paused";

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const stepNumberById = new Map(steps.map((s) => [s.id, s.step_number]));

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
              {campaign.name}
            </h1>
            <Badge color={STATUS_COLOR[status]}>{humanizeEnum(status)}</Badge>
          </div>
          <p className="mt-1 text-sm text-navy-500">
            {steps.length} step{steps.length === 1 ? "" : "s"} ·{" "}
            {stats.totalContacts} contacts · created{" "}
            {formatRelative(campaign.created_at)}
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {canActivate && (
              <Button
                size="sm"
                isLoading={busy}
                onClick={() => changeStatus("active")}
              >
                <Play className="h-4 w-4" aria-hidden />
                {status === "paused" ? "Resume" : "Activate"}
              </Button>
            )}
            {canPause && (
              <Button
                size="sm"
                variant="secondary"
                isLoading={busy}
                onClick={() => changeStatus("paused")}
              >
                <Pause className="h-4 w-4" aria-hidden />
                Pause
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              isLoading={busy}
              onClick={runNow}
              title="Send any due emails now"
            >
              <Send className="h-4 w-4" aria-hidden />
              Run sends now
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAddingContacts(true)}
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              Add contacts
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditingSteps(true)}
            >
              <Pencil className="h-4 w-4" aria-hidden />
              Edit steps
            </Button>
            {canComplete && (
              <Button
                size="sm"
                variant="ghost"
                isLoading={busy}
                onClick={() => changeStatus("completed")}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Complete
              </Button>
            )}
          </div>
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
      {notice && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          {notice}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sent" value={String(stats.totalSent)} />
        <Stat label="Open rate" value={`${stats.openRate}%`} />
        <Stat label="Reply rate" value={`${stats.replyRate}%`} />
        <Stat label="Conversion" value={`${stats.conversionRate}%`} />
      </div>

      {/* Steps */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-navy-900">
          <Layers className="h-5 w-5 text-navy-400" aria-hidden />
          Sequence
        </h2>
        <div className="space-y-3">
          {steps.map((step) => (
            <Card key={step.id}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-navy-700">
                  Step {step.step_number}
                </p>
                <span className="text-xs text-navy-500">
                  {step.step_number === 1
                    ? "Sends immediately"
                    : `+${step.delay_days} day${step.delay_days === 1 ? "" : "s"}`}
                </span>
              </div>
              <p className="mt-2 text-sm font-medium text-navy-800">
                {step.subject_template}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-navy-600">
                {step.body_template}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* Contacts */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-navy-900">Contacts</h2>
        {contacts.length === 0 ? (
          <Card>
            <p className="text-sm text-navy-500">
              No contacts enrolled yet. Use “Add contacts” to enroll outreach
              contacts.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-navy-100">
              {contacts.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-800">
                      {c.company_name}
                      {c.contact_name ? ` · ${c.contact_name}` : ""}
                    </p>
                    <p className="truncate text-xs text-navy-500">
                      {c.email ?? "No email"} · {c.sends_count} sent
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color="gray">{humanizeEnum(c.status)}</Badge>
                    <Badge color={SEND_STATE_COLOR[c.last_state]}>
                      {humanizeEnum(c.last_state)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* Timeline */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-navy-900">
          <Mail className="h-5 w-5 text-navy-400" aria-hidden />
          Send timeline
        </h2>
        {sends.length === 0 ? (
          <Card>
            <p className="text-sm text-navy-500">No emails sent yet.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-navy-100">
              {sends.map((send) => {
                const contact = contactById.get(send.outreach_contact_id);
                const stepNo = stepNumberById.get(send.campaign_step_id);
                const state = (send.status ?? "pending") as
                  | "pending"
                  | "sent"
                  | "opened"
                  | "replied"
                  | "bounced";
                return (
                  <li
                    key={send.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="min-w-0 text-sm text-navy-700">
                      <span className="font-medium">
                        {contact?.company_name ?? "Contact"}
                      </span>
                      {stepNo ? (
                        <span className="text-navy-400"> · step {stepNo}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color={SEND_STATE_COLOR[state] ?? "gray"}>
                        {humanizeEnum(send.status ?? "pending")}
                      </Badge>
                      <span className="text-xs text-navy-400">
                        {formatRelative(send.sent_at ?? send.created_at)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      <Modal
        isOpen={addingContacts}
        onClose={() => setAddingContacts(false)}
        title="Add contacts"
        size="lg"
      >
        <AddContactsForm
          campaignId={campaignId}
          enrolledCount={stats.totalContacts}
          onCancel={() => setAddingContacts(false)}
          onSaved={async () => {
            setAddingContacts(false);
            await load();
          }}
        />
      </Modal>

      <Modal
        isOpen={editingSteps}
        onClose={() => setEditingSteps(false)}
        title="Edit steps"
        size="xl"
      >
        <EditStepsForm
          steps={steps}
          onCancel={() => setEditingSteps(false)}
          onSaved={async () => {
            setEditingSteps(false);
            await load();
          }}
        />
      </Modal>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/outreach/campaigns"
      className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to campaigns
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-navy-900">
        {value}
      </p>
    </Card>
  );
}

/** Enroll additional unassigned outreach contacts into the campaign. */
function AddContactsForm({
  campaignId,
  enrolledCount,
  onCancel,
  onSaved,
}: {
  campaignId: string;
  enrolledCount: number;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [contacts, setContacts] = useState<Tables<"outreach_contacts">[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("outreach_contacts")
        .select("*")
        .is("campaign_id", null)
        .neq("status", "converted")
        .order("created_at", { ascending: false });
      setContacts(data ?? []);
      setLoading(false);
    })();
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (selected.size === 0) {
      setError("Select at least one contact.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const ids = [...selected];
    const { error: enrollError } = await supabase
      .from("outreach_contacts")
      .update({ campaign_id: campaignId, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (enrollError) {
      setError(enrollError.message);
      setSaving(false);
      return;
    }
    await supabase
      .from("email_campaigns")
      .update({
        total_contacts: enrolledCount + ids.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
    setSaving(false);
    await onSaved();
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      <div className="max-h-72 overflow-y-auto rounded-lg border border-navy-200">
        {loading ? (
          <p className="px-3 py-4 text-sm text-navy-500">Loading...</p>
        ) : contacts.length === 0 ? (
          <p className="px-3 py-4 text-sm text-navy-500">
            No unassigned outreach contacts available.
          </p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {contacts.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 transition hover:bg-navy-50">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
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
      <div className="flex justify-end gap-2 border-t border-navy-200 pt-4">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} isLoading={saving}>
          Enroll {selected.size > 0 ? `(${selected.size})` : ""}
        </Button>
      </div>
    </div>
  );
}

/** Inline editor for the campaign's existing step templates. */
function EditStepsForm({
  steps,
  onCancel,
  onSaved,
}: {
  steps: StepRow[];
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [drafts, setDrafts] = useState(() =>
    steps.map((s) => ({
      id: s.id,
      step_number: s.step_number,
      subject: s.subject_template,
      body: s.body_template,
      delayDays: s.delay_days,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(id: string, patch: Partial<(typeof drafts)[number]>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function save() {
    for (const [i, d] of drafts.entries()) {
      if (d.subject.trim() === "" || d.body.trim() === "") {
        setError(`Step ${i + 1} needs both a subject and a body.`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    for (const d of drafts) {
      const { error: updateError } = await supabase
        .from("campaign_steps")
        .update({
          subject_template: d.subject.trim(),
          body_template: d.body.trim(),
          delay_days: d.step_number === 1 ? 0 : Math.max(MIN_CAMPAIGN_STEP_GAP_DAYS, d.delayDays),
        })
        .eq("id", d.id);
      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    await onSaved();
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      <div className="space-y-4">
        {drafts.map((d, index) => (
          <Card key={d.id}>
            <p className="mb-2 text-sm font-medium text-navy-700">
              Step {index + 1}
            </p>
            <div className="space-y-3">
              <Input
                label="Subject"
                value={d.subject}
                onChange={(e) => update(d.id, { subject: e.target.value })}
              />
              <Textarea
                label="Body"
                rows={4}
                value={d.body}
                onChange={(e) => update(d.id, { body: e.target.value })}
              />
              {index > 0 && (
                <Input
                  label="Send this many days after the previous step"
                  type="number"
                  min={MIN_CAMPAIGN_STEP_GAP_DAYS}
                  value={String(d.delayDays)}
                  onChange={(e) =>
                    update(d.id, {
                      delayDays: Math.max(
                        MIN_CAMPAIGN_STEP_GAP_DAYS,
                        Number(e.target.value) || MIN_CAMPAIGN_STEP_GAP_DAYS,
                      ),
                    })
                  }
                  className="sm:max-w-xs"
                />
              )}
            </div>
          </Card>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-navy-200 pt-4">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} isLoading={saving}>
          Save steps
        </Button>
      </div>
    </div>
  );
}
