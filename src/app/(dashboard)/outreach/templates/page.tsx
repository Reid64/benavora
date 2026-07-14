"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Linkedin, Mail, Phone, Plus } from "lucide-react";

import { Badge, Button, Card, EmptyState, Input, Modal, Select, Textarea } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils/cn";
import type { Tables } from "@/types/database";

type Template = Tables<"outreach_templates">;
type Channel = "email" | "linkedin" | "phone_script" | "physical_mail";
type ChannelFilter = Channel | "all";

const CHANNELS: Channel[] = ["email", "linkedin", "phone_script", "physical_mail"];

const CHANNEL_META: Record<Channel, { label: string; icon: typeof Mail; badge: BadgeColor }> = {
  email: { label: "Email", icon: Mail, badge: "blue" },
  linkedin: { label: "LinkedIn", icon: Linkedin, badge: "indigo" },
  phone_script: { label: "Phone Script", icon: Phone, badge: "green" },
  physical_mail: { label: "Physical Mail", icon: FileText, badge: "yellow" },
};

const CHANNEL_OPTIONS = CHANNELS.map((c) => ({ value: c, label: CHANNEL_META[c].label }));

/**
 * Outreach template library. Reusable templates per channel (email, LinkedIn,
 * phone script, physical mail) used across cold outreach and campaigns.
 */
export default function OutreachTemplatesPage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<ChannelFilter>("all");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/outreach/templates");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { templates: Template[] };
      setTemplates(data.templates ?? []);
    } catch {
      setError("Could not load outreach templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<Channel, number> = {
      email: 0,
      linkedin: 0,
      phone_script: 0,
      physical_mail: 0,
    };
    for (const t of templates) {
      if (t.channel in c) c[t.channel as Channel] += 1;
    }
    return c;
  }, [templates]);

  const visible = useMemo(
    () =>
      activeChannel === "all"
        ? templates
        : templates.filter((t) => t.channel === activeChannel),
    [templates, activeChannel],
  );

  const showEmpty = !loading && !error && visible.length === 0;

  return (
    <div className="space-y-6">
      <Link
        href="/outreach"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to outreach
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Outreach Templates
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Reusable templates for email, LinkedIn, phone scripts, and physical mail.
          </p>
        </div>
        {editable && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New Template
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

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter templates by channel">
        <TabButton
          label="All"
          count={templates.length}
          active={activeChannel === "all"}
          onClick={() => setActiveChannel("all")}
        />
        {CHANNELS.map((c) => (
          <TabButton
            key={c}
            label={CHANNEL_META[c].label}
            count={counts[c]}
            active={activeChannel === c}
            onClick={() => setActiveChannel(c)}
          />
        ))}
      </div>

      {showEmpty ? (
        <EmptyState
          icon={Mail}
          title="No templates yet"
          description="Create a reusable template for one of your outreach channels."
          action={
            editable ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                New Template
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((t) => {
            const meta = CHANNEL_META[t.channel as Channel] ?? CHANNEL_META.email;
            const Icon = meta.icon;
            return (
              <Card key={t.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-navy-900">{t.name}</p>
                      <Badge color={meta.badge} withDot>
                        <Icon className="h-3 w-3" aria-hidden />
                        <span className="ml-1">{meta.label}</span>
                      </Badge>
                    </div>
                    {t.subject && (
                      <p className="mt-1 text-sm text-navy-600">{t.subject}</p>
                    )}
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-navy-500">
                      {t.body}
                    </p>
                    <p className="mt-2 text-xs text-navy-400">
                      Created {formatRelative(t.created_at)}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={creating}
        onClose={() => setCreating(false)}
        title="New Template"
        size="lg"
      >
        <TemplateForm
          onCancel={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      </Modal>
    </div>
  );
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition",
        active
          ? "bg-[#0077B6] font-semibold text-white"
          : "border border-slate-200 bg-white font-medium text-slate-600 hover:border-[#0077B6] hover:text-[#0077B6]",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-xs tabular-nums",
          active ? "bg-white/20 text-white" : "bg-navy-100 text-navy-500",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function TemplateForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "") {
      setError("Name is required.");
      return;
    }
    if (body.trim() === "") {
      setError("Body is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await fetch("/api/outreach/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        channel,
        subject: subject.trim() || null,
        body: body.trim(),
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not save the template.");
      setSaving(false);
      return;
    }

    setSaving(false);
    await onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Intro outreach"
          required
        />
        <Select
          label="Channel"
          value={channel}
          options={CHANNEL_OPTIONS}
          onChange={(e) => setChannel(e.target.value as Channel)}
          required
        />
      </div>

      <Input
        label="Subject (optional)"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Introducing our housing program"
        helperText="Used for email and LinkedIn messages; optional for scripts and mail."
      />

      <Textarea
        label="Body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        placeholder="Hi {contact_name}, I lead..."
        required
      />

      <div className="flex justify-end gap-2 border-t border-navy-200 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          Create template
        </Button>
      </div>
    </form>
  );
}
