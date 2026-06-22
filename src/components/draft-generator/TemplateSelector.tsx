"use client";

import {
  Calculator,
  FileText,
  Mail,
  PenLine,
  ScrollText,
  Target,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import type { DraftTemplateType } from "@/types/ai";

type TemplateOption = {
  value: DraftTemplateType;
  label: string;
  description: string;
  icon: LucideIcon;
};

// Mirrors the draft_template_type enum (SCHEMA_REGISTRY) and BLUEPRINT §4.8.
const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    value: "grant_narrative",
    label: "Grant narrative",
    description: "Structured proposal: need, program, capacity, impact.",
    icon: FileText,
  },
  {
    value: "donation_request_letter",
    label: "Donation request letter",
    description: "Warm corporate appeal with a concise, specific ask.",
    icon: Mail,
  },
  {
    value: "budget_narrative",
    label: "Budget narrative",
    description: "Line-item justification tied to program activities.",
    icon: Calculator,
  },
  {
    value: "impact_statement",
    label: "Impact statement",
    description: "Quantified outcomes this funding makes possible.",
    icon: Target,
  },
  {
    value: "letter_of_inquiry",
    label: "Letter of inquiry",
    description: "Brief intro to gauge a funder's interest first.",
    icon: PenLine,
  },
  {
    value: "full_proposal",
    label: "Full proposal",
    description: "All standard sections, summary through evaluation.",
    icon: ScrollText,
  },
];

export type TemplateSelectorProps = {
  /** Currently selected template type, or null if none chosen. */
  value: DraftTemplateType | null;
  /** Called when a template is chosen. */
  onChange: (value: DraftTemplateType) => void;
  /** Disable selection (e.g. while generating). */
  disabled?: boolean;
};

/**
 * Template type chooser (BLUEPRINT §4.8 step 2). A grid of selectable cards,
 * one per draft_template_type. Keyboard- and screen-reader-friendly via a
 * radiogroup of buttons.
 */
export function TemplateSelector({
  value,
  onChange,
  disabled = false,
}: TemplateSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Draft template type"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
    >
      {TEMPLATE_OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500"
                : "border-navy-200 bg-white hover:border-navy-300 hover:bg-navy-50",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                selected
                  ? "bg-teal-600 text-white"
                  : "bg-navy-100 text-navy-500",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-sm font-semibold text-navy-900">
              {option.label}
            </span>
            <span className="text-xs text-navy-500">{option.description}</span>
          </button>
        );
      })}
    </div>
  );
}
