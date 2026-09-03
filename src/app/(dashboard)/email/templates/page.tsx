"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wand2,
} from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

// Outreach & Communication section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Rust. Secondary accent: Bronze. Template-variable chip styling
// (the `<code>` pills) is preserved as-is, only its literal-white background
// swapped for the section's ivory token.
const FRAME_RUST = "#B85C3C";
const CARD_BG = "#F8F5EE";

type Template = Tables<"email_templates">;

const TEMPLATE_VARIABLES = [
  "{company_name}",
  "{contact_name}",
  "{foundation_name}",
  "{mission_snippet}",
  "{program_name}",
  "{impact_stat}",
] as const;

const PREVIEW_SAMPLE: Record<string, string> = {
  company_name: "Acme Corporation",
  contact_name: "Jordan Lee",
  foundation_name: "Your Foundation",
  mission_snippet: "providing emergency and transitional housing in rural Texas",
  program_name: "Emergency Housing Initiative",
  impact_stat: "served 150 families last year",
};

function renderPreview(text: string): string {
  return text.replace(
    /\{([a-z_]+)\}/gi,
    (_match, name: string) => PREVIEW_SAMPLE[name] ?? `{${name}}`,
  );
}

const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "warm", label: "Warm & personal" },
  { value: "concise", label: "Concise & direct" },
  { value: "grateful", label: "Grateful & humble" },
  { value: "compelling", label: "Compelling & urgent" },
];

/**
 * Email template management. Lists all reusable templates, supports
 * create/edit via modal form, AI generation, soft-delete, and variable
 * insertion toolbar. Templates are referenced by email_sequence_steps.
 */
export default function EmailTemplatesPage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/email/templates");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { templates: Template[] };
      setTemplates(data.templates ?? []);
    } catch {
      setError("Could not load templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(id: string) {
    setDeleting(id);
    await fetch("/api/email/templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDeleting(null);
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
            Email Templates
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Reusable templates with variable placeholders for campaign steps.
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

      {/* Variable reference */}
      <div className="rounded-lg border border-navy-200 bg-navy-50 px-4 py-3">
        <p className="mb-2 text-xs font-medium text-navy-600">
          Available template variables:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <code
              key={v}
              className="rounded px-2 py-0.5 text-xs text-navy-700 ring-1 ring-navy-200"
              style={{ backgroundColor: CARD_BG }}
            >
              {v}
            </code>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={Wand2}
          title="No templates yet"
          description="Create reusable email templates to use in campaign steps."
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
        <div className="space-y-3">
          {templates.map((t) => {
            const vars = Array.isArray(t.variables) ? t.variables : [];
            return (
              <div
                key={t.id}
                style={{ backgroundColor: FRAME_RUST, borderRadius: "14px", boxShadow: "0 4px 20px rgba(163,73,47,0.22)", padding: "3px" }}
              >
              <div className="rounded-[11px] p-5" style={{ backgroundColor: CARD_BG }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-navy-900">{t.name}</p>
                      {t.template_type && (
                        <Badge color="indigo">{t.template_type}</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-navy-600">{t.subject}</p>
                    {vars.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(vars as string[]).map((v) => (
                          <code
                            key={v}
                            className="rounded bg-navy-50 px-1.5 py-0.5 text-xs text-navy-600 ring-1 ring-navy-200"
                          >
                            {`{${v}}`}
                          </code>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-navy-400">
                      Created {formatRelative(t.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewId((prev) =>
                          prev === t.id ? null : t.id,
                        )
                      }
                      className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-navy-600 ring-1 ring-navy-200 transition hover:bg-navy-50"
                      aria-label={
                        previewId === t.id ? "Hide preview" : "Show preview"
                      }
                    >
                      {previewId === t.id ? (
                        <EyeOff className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Preview
                    </button>
                    {editable && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing(t)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-navy-600 ring-1 ring-navy-200 transition hover:bg-navy-50"
                          aria-label={`Edit ${t.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(t.id)}
                          disabled={deleting === t.id}
                          className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-50"
                          aria-label={`Delete ${t.name}`}
                        >
                          {deleting === t.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Inline preview */}
                {previewId === t.id && (
                  <div
                    className="mt-3 rounded-lg px-4 py-3"
                    style={{ backgroundColor: "rgba(163,73,47,0.05)", boxShadow: "inset 0 0 0 1px rgba(163,73,47,0.2)" }}
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wide text-navy-400">
                      Preview (sample data)
                    </p>
                    <p className="mt-1.5 font-medium text-navy-800">
                      {renderPreview(t.subject)}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-navy-600">
                      {renderPreview(t.body)}
                    </p>
                  </div>
                )}
              </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal
        isOpen={creating}
        onClose={() => setCreating(false)}
        title="New Template"
        size="xl"
      >
        <TemplateForm
          onCancel={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      </Modal>

      {/* Edit modal */}
      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit Template"
        size="xl"
      >
        {editing && (
          <TemplateForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

// ── Template form (create + edit) ─────────────────────────────────────────

function TemplateForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: Template;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [templateType, setTemplateType] = useState(
    initial?.template_type ?? "",
  );
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAI, setShowAI] = useState(false);

  const activeField = useRef<"subject" | "body" | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function insertVariable(token: string) {
    const field = activeField.current;
    if (!field) {
      setError(
        "Click into the subject or body field first, then insert a variable.",
      );
      return;
    }
    setError(null);
    if (field === "subject") {
      const el = subjectRef.current;
      if (el) {
        const pos = el.selectionStart ?? subject.length;
        const sep = pos > 0 && subject[pos - 1] !== " " ? " " : "";
        const next =
          subject.slice(0, pos) + sep + token + subject.slice(pos);
        setSubject(next);
      } else {
        setSubject((s) =>
          s === "" ? token : s.endsWith(" ") ? s + token : `${s} ${token}`,
        );
      }
    } else {
      const el = bodyRef.current;
      if (el) {
        const pos = el.selectionStart ?? body.length;
        const sep = pos > 0 && body[pos - 1] !== " " ? " " : "";
        const next = body.slice(0, pos) + sep + token + body.slice(pos);
        setBody(next);
      } else {
        setBody((b) =>
          b === "" ? token : b.endsWith(" ") ? b + token : `${b} ${token}`,
        );
      }
    }
  }

  async function save() {
    if (name.trim() === "") {
      setError("Name is required.");
      return;
    }
    if (subject.trim() === "") {
      setError("Subject is required.");
      return;
    }
    if (body.trim() === "") {
      setError("Body is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const method = initial ? "PATCH" : "POST";
    const payload = initial
      ? {
          id: initial.id,
          name: name.trim(),
          template_type: templateType.trim() || null,
          subject: subject.trim(),
          body: body.trim(),
        }
      : {
          name: name.trim(),
          template_type: templateType.trim() || null,
          subject: subject.trim(),
          body: body.trim(),
        };

    const res = await fetch("/api/email/templates", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(data?.error ?? "Could not save the template.");
      setSaving(false);
      return;
    }

    setSaving(false);
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Welcome email"
          required
        />
        <Input
          label="Type (optional)"
          value={templateType}
          onChange={(e) => setTemplateType(e.target.value)}
          placeholder="intro, follow-up, thank-you…"
        />
      </div>

      {/* Variable insertion toolbar */}
      <div className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-2.5">
        <p className="mb-2 text-xs font-medium text-navy-600">
          Click into subject or body, then insert a variable:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVariable(v)}
              className="rounded bg-surface px-2 py-1 text-xs text-navy-700 ring-1 ring-navy-200 transition hover:bg-navy-100"
            >
              <code>{v}</code>
            </button>
          ))}
        </div>
      </div>

      <Input
        label="Subject"
        ref={subjectRef}
        value={subject}
        onFocus={() => {
          activeField.current = "subject";
        }}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Hi {contact_name}, introducing {foundation_name}"
        required
      />

      <Textarea
        label="Body"
        ref={bodyRef}
        value={body}
        onFocus={() => {
          activeField.current = "body";
        }}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        placeholder={"Hi {contact_name},\n\nI lead {foundation_name}, focused on {mission_snippet}…"}
      />

      {/* Live preview */}
      {(subject.trim() || body.trim()) && (
        <div className="rounded-lg border border-border bg-surface shadow-sm px-4 py-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-navy-400">
            Preview (sample data)
          </p>
          <p className="font-medium text-navy-800">
            {renderPreview(subject) || "—"}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-navy-600">
            {renderPreview(body)}
          </p>
        </div>
      )}

      {/* Generate with AI */}
      <div>
        <button
          type="button"
          onClick={() => setShowAI((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm text-teal-700 transition hover:text-teal-900"
        >
          <Wand2 className="h-4 w-4" aria-hidden />
          Generate with AI
        </button>
        {showAI && (
          <div className="mt-3">
            <AIGenerateForm
              onGenerated={(result) => {
                setSubject(result.subject);
                setBody(result.body);
                setShowAI(false);
              }}
            />
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-navy-200 pt-4">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void save()} isLoading={saving}>
          {initial ? "Save changes" : "Create template"}
        </Button>
      </div>
    </div>
  );
}

// ── AI generation sub-form ─────────────────────────────────────────────────

function AIGenerateForm({
  onGenerated,
}: {
  onGenerated: (result: { subject: string; body: string }) => void;
}) {
  const [funderName, setFunderName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [tone, setTone] = useState("professional");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  async function generate() {
    if (!funderName.trim()) {
      setGenError("Funder name is required.");
      return;
    }
    if (!purpose.trim()) {
      setGenError("Purpose is required.");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/email/templates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funder_name: funderName.trim(),
          purpose: purpose.trim(),
          tone,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setGenError(data?.error ?? "AI generation failed.");
        return;
      }
      const data = (await res.json()) as {
        template: { subject: string; body: string };
      };
      onGenerated(data.template);
    } catch {
      setGenError("AI generation failed. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-teal-200 bg-teal-50 px-4 py-4">
      <p className="text-sm font-medium text-teal-800">
        Generate a template with AI
      </p>
      {genError && (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700"
        >
          {genError}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Funder / company name"
          value={funderName}
          onChange={(e) => setFunderName(e.target.value)}
          placeholder="Acme Foundation"
          required
        />
        <Select
          label="Tone"
          value={tone}
          options={TONE_OPTIONS}
          onChange={(e) => setTone(e.target.value)}
        />
      </div>
      <Textarea
        label="Purpose of this email"
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        rows={2}
        placeholder="Introduce our housing program and request a donation or meeting"
        required
      />
      <Button
        variant="secondary"
        onClick={() => void generate()}
        isLoading={generating}
      >
        {generating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Generating…
          </>
        ) : (
          <>
            <Wand2 className="h-4 w-4" aria-hidden />
            Generate
          </>
        )}
      </Button>
    </div>
  );
}
