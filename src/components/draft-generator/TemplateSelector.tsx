"use client";

import { useState } from "react";
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
// One uniform neutral/accent treatment across all six cards (see selected
// state below) rather than a per-card decorative hue.
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
  const [hovered, setHovered] = useState<DraftTemplateType | null>(null);

  return (
    <div
      role="radiogroup"
      aria-label="Draft template type"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {TEMPLATE_OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = value === option.value;
        const isHovered = !selected && hovered === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onMouseEnter={() => setHovered(option.value)}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              "flex h-full flex-col items-start gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
            )}
            style={
              selected
                ? {
                    backgroundColor: "#F8F5EE",
                    border: "2px solid #C9A34E",
                    borderRadius: "12px",
                    padding: "15px",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    boxShadow: "0 4px 12px rgba(16,27,45,0.28)",
                  }
                : isHovered
                  ? {
                      backgroundColor: "#F8F5EE",
                      border: "1.5px solid #A4712C",
                      borderRadius: "12px",
                      padding: "15.5px",
                      cursor: "pointer",
                      transition: "all 0.15s",
                      boxShadow: "0 4px 10px rgba(16,27,45,0.25)",
                      transform: "translateY(-1px)",
                    }
                  : {
                      backgroundColor: "#F8F5EE",
                      border: "1.5px solid rgba(164,113,44,0.35)",
                      borderRadius: "12px",
                      padding: "15.5px",
                      cursor: "pointer",
                      transition: "all 0.15s",
                      boxShadow: "0 2px 6px rgba(16,27,45,0.18)",
                    }
            }
          >
            <Icon className="h-5 w-5" style={{ color: selected ? "#A4712C" : "#101B2D" }} aria-hidden />
            <span
              style={
                selected
                  ? { fontSize: "14px", fontWeight: 700, color: "#A4712C", marginTop: "10px" }
                  : { fontSize: "14px", fontWeight: 700, color: "#101B2D", marginTop: "10px" }
              }
            >
              {option.label}
            </span>
            <span style={{ fontSize: "12px", color: "rgba(16,27,45,0.7)", marginTop: "4px" }}>
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
