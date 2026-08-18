"use client";

import { Check, CircleAlert, CircleHelp, Save } from "lucide-react";

import { Badge, Button, Input } from "@/components/ui";
import { humanizeEnum } from "@/lib/utils/formatters";
import {
  FIELD_STATUS_COLOR,
  FIELD_STATUS_LABEL,
  type FieldReportRow,
  type FieldReportStatus,
} from "@/components/automation/automation";

export type FieldReportProps = {
  rows: FieldReportRow[];
  /** Whether unmapped fields can be edited (awaiting approval + can edit). */
  editable: boolean;
  /** Current human-entered values, keyed by field selector. */
  manualValues: Record<string, string>;
  /** Called when a manual value changes. */
  onManualValueChange: (selector: string, value: string) => void;
  /** Save entered values to the session (PUT update_fields). */
  onSave?: () => void;
  saving?: boolean;
  saveError?: string | null;
};

const STATUS_ICON: Record<FieldReportStatus, typeof Check> = {
  filled: Check,
  needs_input: CircleHelp,
  required_missing: CircleAlert,
};

/**
 * Form-field report (BLUEPRINT §Phase 3 components - FieldReport). One row per
 * detected field showing label, detected type, the auto-filled value (or an
 * editable input for fields needing human input), and a colour-coded status:
 * green = auto-filled, yellow = needs input, red = required and unfilled.
 *
 * Editing is enabled only while the session is awaiting approval; entered values
 * are saved to the session and typed in during the approved submission replay
 * (BEHAVIORAL_CONTRACTS §18).
 */
export function FieldReport({
  rows,
  editable,
  manualValues,
  onManualValueChange,
  onSave,
  saving = false,
  saveError = null,
}: FieldReportProps) {
  const unmappedCount = rows.filter((r) => r.status !== "filled").length;
  const requiredMissing = rows.filter(
    (r) => r.status === "required_missing",
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-navy-500">
        <Badge color="green" withDot>
          {rows.filter((r) => r.status === "filled").length} auto-filled
        </Badge>
        <Badge color="yellow" withDot>
          {rows.filter((r) => r.status === "needs_input").length} need input
        </Badge>
        <Badge color="red" withDot>
          {requiredMissing} required missing
        </Badge>
      </div>

      <div className="overflow-x-auto rounded-xl border border-navy-200">
        <table className="min-w-full divide-y divide-navy-200">
          <thead className="bg-sidebar">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white">
                Field
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white">
                Detected type
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white">
                Mapped value
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white">
                Source
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white">
                Confidence
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-200 bg-surface">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm text-navy-500"
                >
                  No form fields were detected for this session.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const Icon = STATUS_ICON[row.status];
                const isLowConfidence =
                  row.confidence !== undefined && row.confidence < 0.7;
                return (
                  <tr
                    key={row.selector}
                    className={isLowConfidence ? "bg-amber-50" : undefined}
                  >
                    <td className="px-4 py-3 align-top text-sm">
                      <span className="font-medium text-navy-900">
                        {row.fieldLabel}
                        {row.required && (
                          <span
                            className="ml-1 text-red-500"
                            aria-label="required"
                          >
                            *
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-navy-400">
                        {row.fieldName || row.selector}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-navy-600">
                      {humanizeEnum(row.fieldType)}
                    </td>
                    <td className="px-4 py-3 align-top text-sm">
                      {row.status === "filled" ? (
                        <span className="text-navy-800">
                          {row.value || (
                            <span className="text-navy-400">(empty value)</span>
                          )}
                        </span>
                      ) : editable ? (
                        <Input
                          value={manualValues[row.selector] ?? ""}
                          onChange={(e) =>
                            onManualValueChange(row.selector, e.target.value)
                          }
                          placeholder={
                            row.options && row.options.length > 0
                              ? `e.g. ${row.options[0]}`
                              : "Enter value..."
                          }
                          aria-label={`Value for ${row.fieldLabel}`}
                        />
                      ) : (
                        <span className="text-navy-400">
                          Awaiting human input
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-navy-500">
                      {row.source ? (
                        <span className="font-mono text-[11px]">{row.source}</span>
                      ) : (
                        <span className="text-navy-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-sm">
                      {row.confidence !== undefined ? (
                        <span
                          className={
                            row.confidence < 0.7
                              ? "font-medium text-amber-700"
                              : "text-navy-700"
                          }
                        >
                          {Math.round(row.confidence * 100)}%
                        </span>
                      ) : (
                        <span className="text-navy-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge color={FIELD_STATUS_COLOR[row.status]} withDot>
                        <Icon className="h-3 w-3" aria-hidden />
                        {FIELD_STATUS_LABEL[row.status]}
                      </Badge>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {saveError && (
        <p role="alert" className="text-sm text-red-600">
          {saveError}
        </p>
      )}

      {editable && unmappedCount > 0 && onSave && (
        <div className="flex items-center justify-end">
          <Button variant="secondary" onClick={onSave} isLoading={saving}>
            <Save className="h-4 w-4" aria-hidden />
            Save entered values
          </Button>
        </div>
      )}
    </div>
  );
}
