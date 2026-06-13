"use client";

import { Eye, GripVertical, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button, Card, Input, Textarea } from "@/components/ui";
import { MIN_CAMPAIGN_STEP_GAP_DAYS } from "@/lib/utils/constants";

// All 6 supported template variables (Contracts §13).
export const SEQUENCE_TEMPLATE_VARIABLES = [
  "{company_name}",
  "{contact_name}",
  "{foundation_name}",
  "{mission_snippet}",
  "{program_name}",
  "{impact_stat}",
] as const;

export type SequenceTemplateVariable =
  (typeof SEQUENCE_TEMPLATE_VARIABLES)[number];

export type SequenceStep = {
  key: string;
  subject: string;
  body: string;
  delayDays: number;
};

/** Resolved variable values used to render the live preview. */
export type ResolvedVariables = {
  company_name?: string;
  contact_name?: string;
  foundation_name?: string;
  mission_snippet?: string;
  program_name?: string;
  impact_stat?: string;
};

const PREVIEW_FALLBACK: ResolvedVariables = {
  company_name: "Acme Construction",
  contact_name: "Jordan Lee",
  foundation_name: "Your Foundation",
  mission_snippet: "providing transitional housing in rural Texas",
  program_name: "Emergency Housing Initiative",
  impact_stat: "served 150 families last year",
};

function renderPreview(template: string, vars: ResolvedVariables): string {
  const merged = { ...PREVIEW_FALLBACK, ...vars };
  return template.replace(
    /\{([a-z_]+)\}/gi,
    (match, key: string) =>
      (merged as Record<string, string | undefined>)[key] ?? match,
  );
}

function unknownVariables(template: string): string[] {
  const allowed = new Set(
    SEQUENCE_TEMPLATE_VARIABLES.map((v) => v.slice(1, -1)),
  );
  const found = new Set<string>();
  for (const m of template.matchAll(/\{([a-z_]+)\}/gi)) {
    const name = m[1] ?? "";
    if (!allowed.has(name)) found.add(name);
  }
  return [...found];
}

let keySeq = 0;
function newStep(delayDays: number): SequenceStep {
  keySeq += 1;
  return { key: `sq-${keySeq}`, subject: "", body: "", delayDays };
}

type ActiveField = { key: string; field: "subject" | "body" } | null;

export type SequenceBuilderProps = {
  steps: SequenceStep[];
  onChange: (steps: SequenceStep[]) => void;
  /** Live resolved variables for the preview (omit fields to use fallback). */
  resolvedVars?: ResolvedVariables;
  disabled?: boolean;
};

/**
 * Visual drip-sequence step editor with live preview using resolved variable
 * values (Contracts §13). Supports all 6 template variables; previews render
 * with real org/contact data when resolvedVars is supplied.
 */
export function SequenceBuilder({
  steps,
  onChange,
  resolvedVars,
  disabled,
}: SequenceBuilderProps) {
  const [showPreview, setShowPreview] = useState<Record<string, boolean>>({});
  const activeField = useRef<ActiveField>(null);

  function update(key: string, patch: Partial<SequenceStep>) {
    onChange(steps.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function addStep() {
    onChange([...steps, newStep(MIN_CAMPAIGN_STEP_GAP_DAYS)]);
  }

  function removeStep(key: string) {
    onChange(steps.filter((s) => s.key !== key));
  }

  function insertVariable(token: string) {
    const target = activeField.current;
    if (!target) return;
    const step = steps.find((s) => s.key === target.key);
    if (!step) return;
    const field = target.field;
    const cur = step[field];
    const next = cur === "" ? token : /\s$/.test(cur) ? cur + token : `${cur} ${token}`;
    update(target.key, { [field]: next });
  }

  function togglePreview(key: string) {
    setShowPreview((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-4">
      {/* Variable picker */}
      <div className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-2.5">
        <p className="mb-2 text-xs font-medium text-navy-600">
          Click a variable to insert it at the cursor:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SEQUENCE_TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              disabled={disabled}
              onClick={() => insertVariable(v)}
              className="rounded bg-white px-2 py-1 text-xs text-navy-700 ring-1 ring-navy-200 transition hover:bg-navy-100 disabled:opacity-50"
            >
              <code>{v}</code>
            </button>
          ))}
        </div>
      </div>

      {/* Steps */}
      {steps.map((step, index) => {
        const allUnknown = [
          ...unknownVariables(step.subject),
          ...unknownVariables(step.body),
        ];
        const hasContent = step.subject.trim() !== "" || step.body.trim() !== "";
        const previewing = showPreview[step.key] ?? false;
        return (
          <Card key={step.key}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-navy-700">
                <GripVertical className="h-4 w-4 text-navy-400" aria-hidden />
                Step {index + 1}
                {index === 0 && (
                  <span className="text-xs font-normal text-navy-400">
                    (sends immediately)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {hasContent && (
                  <button
                    type="button"
                    onClick={() => togglePreview(step.key)}
                    className="inline-flex items-center gap-1 text-xs text-teal-600 transition hover:text-teal-700"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                    {previewing ? "Edit" : "Preview"}
                  </button>
                )}
                {steps.length > 1 && !disabled && (
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
            </div>

            {allUnknown.length > 0 && (
              <div
                role="alert"
                className="mb-3 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700"
              >
                Unsupported variable(s):{" "}
                {allUnknown.map((v) => <code key={v}>{`{${v}}`}</code>)}
              </div>
            )}

            {previewing ? (
              <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-teal-500">
                  Preview - resolved variables
                </p>
                <p className="mt-1 font-medium text-navy-900">
                  {renderPreview(step.subject, resolvedVars ?? {}) || "(no subject)"}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-navy-700">
                  {renderPreview(step.body, resolvedVars ?? {})}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  label="Subject"
                  value={step.subject}
                  disabled={disabled}
                  onFocus={() => {
                    activeField.current = { key: step.key, field: "subject" };
                  }}
                  onChange={(e) => update(step.key, { subject: e.target.value })}
                  placeholder="Partnering with {company_name} on {program_name}"
                />
                <Textarea
                  label="Body"
                  value={step.body}
                  disabled={disabled}
                  onFocus={() => {
                    activeField.current = { key: step.key, field: "body" };
                  }}
                  onChange={(e) => update(step.key, { body: e.target.value })}
                  rows={5}
                  placeholder="Hi {contact_name}, I lead {foundation_name}…"
                />
                {index > 0 && (
                  <Input
                    label="Days after previous step"
                    type="number"
                    min={MIN_CAMPAIGN_STEP_GAP_DAYS}
                    disabled={disabled}
                    value={String(step.delayDays)}
                    onChange={(e) =>
                      update(step.key, {
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
            )}
          </Card>
        );
      })}

      {!disabled && (
        <Button type="button" variant="secondary" onClick={addStep}>
          <Plus className="h-4 w-4" aria-hidden />
          Add step
        </Button>
      )}
    </div>
  );
}

/** Factory: create a fresh step key-sequence for external consumers. */
export function createSequenceStep(delayDays: number): SequenceStep {
  return newStep(delayDays);
}
