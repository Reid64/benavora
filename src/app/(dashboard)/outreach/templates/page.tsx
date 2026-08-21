"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Linkedin, Mail, Phone, Plus } from "lucide-react";

import { Badge, Button, EmptyState, Input, Modal, Select, Textarea } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils/cn";
import type { Tables } from "@/types/database";

// Outreach & Communication section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Rust. Secondary accent: Bronze.
const FRAME_RUST = "#A3492F";
const ACCENT_BRONZE = "#A4712C";
const CARD_BG = "#F8F5EE";

type Template = Tables<"outreach_templates">;
type TemplateVariant = Tables<"outreach_template_variants">;
type TemplateWithVariants = Template & { variants: TemplateVariant[] };
type Channel = "email" | "linkedin" | "phone_script" | "physical_mail";
type ChannelFilter = Channel | "all";

const MAX_VARIANTS = 3;

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

  const [templates, setTemplates] = useState<TemplateWithVariants[]>([]);
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
      const data = (await res.json()) as { templates: TemplateWithVariants[] };
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
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: FRAME_RUST }}>
            Outreach Templates
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Reusable templates for email, LinkedIn, phone scripts, and physical mail.
          </p>
        </div>
        {editable && (
          <Button
            variant="secondary"
            onClick={() => setCreating(true)}
            style={{ backgroundColor: FRAME_RUST, color: CARD_BG, border: "none" }}
          >
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
              <Button
                variant="secondary"
                onClick={() => setCreating(true)}
                style={{ backgroundColor: FRAME_RUST, color: CARD_BG, border: "none" }}
              >
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
              <div
                key={t.id}
                style={{ backgroundColor: FRAME_RUST, borderRadius: "14px", boxShadow: "0 4px 20px rgba(163,73,47,0.22)", padding: "3px" }}
              >
              <div className="rounded-[11px] p-5" style={{ backgroundColor: CARD_BG }}>
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
                    <VariantPanel
                      template={t}
                      editable={editable}
                      onChanged={load}
                    />
                  </div>
                </div>
              </div>
              </div>
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
      style={
        active
          ? { backgroundColor: FRAME_RUST, color: CARD_BG }
          : { border: "1px solid rgba(16,27,45,0.18)", backgroundColor: CARD_BG, color: "#475569" }
      }
      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition"
    >
      {label}
      <span
        style={
          active
            ? { backgroundColor: "rgba(248,245,238,0.25)", color: CARD_BG }
            : undefined
        }
        className={cn(
          "rounded-full px-1.5 text-xs tabular-nums",
          active ? "" : "bg-navy-100 text-navy-500",
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

/**
 * Donor Personalization Engine MVP (row #221), scoped down per the queue-37 preflight: no real
 * visitor-type detection signal exists anywhere in this repo, so this is an org-configurable
 * content-variant toggle — an admin defines up to 3 named variants for a template and picks
 * which one is active — not ML-driven visitor personalization. This IS the "settings UI control
 * to switch between variants," styled with inline hex per the One UI Rule (Directive 4).
 */
function VariantPanel({
  template,
  editable,
  onChanged,
}: {
  template: TemplateWithVariants;
  editable: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const variants = template.variants ?? [];
  const activeVariant = variants.find((v) => v.is_active) ?? null;

  async function activate(variantId: string | null) {
    setPanelError(null);
    // Switching to "Base" deactivates whichever variant is currently active.
    // Switching to a named variant activates it (the route deactivates any others).
    const targetId = variantId ?? activeVariant?.id ?? null;
    if (!targetId) return;

    setBusyId(targetId);
    try {
      const res = await fetch(
        `/api/outreach/templates/${template.id}/variants/${targetId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activate: variantId !== null }),
        },
      );
      if (!res.ok) throw new Error("activate failed");
      await onChanged();
    } catch {
      setPanelError("Could not switch content variant.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(variantId: string) {
    setPanelError(null);
    setBusyId(variantId);
    try {
      const res = await fetch(
        `/api/outreach/templates/${template.id}/variants/${variantId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("delete failed");
      await onChanged();
    } catch {
      setPanelError("Could not remove content variant.");
    } finally {
      setBusyId(null);
    }
  }

  const pillBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 9999,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    border: "1px solid rgba(16,27,45,0.18)",
    background: CARD_BG,
    color: "#475569",
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
  };

  const pillActive: React.CSSProperties = {
    ...pillBase,
    background: FRAME_RUST,
    borderColor: FRAME_RUST,
    color: CARD_BG,
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "#94A3B8",
          marginBottom: 6,
        }}
      >
        Content Variant
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          disabled={!editable || busyId !== null}
          onClick={() => activate(null)}
          style={activeVariant === null ? pillActive : pillBase}
        >
          Base
        </button>
        {variants.map((v) => (
          <span key={v.id} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
            <button
              type="button"
              disabled={!editable || busyId !== null}
              onClick={() => activate(v.id)}
              style={v.is_active ? pillActive : pillBase}
              title={v.subject_override ?? undefined}
            >
              {v.variant_name}
            </button>
            {editable && (
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => remove(v.id)}
                aria-label={`Remove variant ${v.variant_name}`}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#94A3B8",
                  fontSize: 14,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: "0 2px",
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {editable && variants.length < MAX_VARIANTS && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            style={{
              ...pillBase,
              borderStyle: "dashed",
              color: ACCENT_BRONZE,
              borderColor: ACCENT_BRONZE,
            }}
          >
            + Add variant
          </button>
        )}
      </div>
      {panelError && (
        <p style={{ marginTop: 6, fontSize: 12, color: "#DC2626" }}>{panelError}</p>
      )}

      <Modal
        isOpen={adding}
        onClose={() => setAdding(false)}
        title={`New variant — ${template.name}`}
        size="lg"
      >
        <VariantForm
          templateId={template.id}
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await onChanged();
          }}
        />
      </Modal>
    </div>
  );
}

function VariantForm({
  templateId,
  onCancel,
  onSaved,
}: {
  templateId: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [variantName, setVariantName] = useState("");
  const [subjectOverride, setSubjectOverride] = useState("");
  const [bodyOverride, setBodyOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (variantName.trim() === "") {
      setError("Variant name is required.");
      return;
    }
    if (bodyOverride.trim() === "") {
      setError("Body is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await fetch(`/api/outreach/templates/${templateId}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant_name: variantName.trim(),
        subject_override: subjectOverride.trim() || null,
        body_override: bodyOverride.trim(),
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not save the variant.");
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

      <Input
        label="Variant name"
        value={variantName}
        onChange={(e) => setVariantName(e.target.value)}
        placeholder="Warm"
        required
      />

      <Input
        label="Subject override (optional)"
        value={subjectOverride}
        onChange={(e) => setSubjectOverride(e.target.value)}
        placeholder="Leave blank to keep the base template's subject"
      />

      <Textarea
        label="Body"
        value={bodyOverride}
        onChange={(e) => setBodyOverride(e.target.value)}
        rows={8}
        placeholder="Hi {contact_name}, I lead..."
        required
      />

      <div className="flex justify-end gap-2 border-t border-navy-200 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          Add variant
        </Button>
      </div>
    </form>
  );
}
