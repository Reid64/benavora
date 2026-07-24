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
import type { IconHue } from "@/components/ui/ColorIcon";
import type { DraftTemplateType } from "@/types/ai";

type TemplateOption = {
  value: DraftTemplateType;
  label: string;
  description: string;
  icon: LucideIcon;
  hue: IconHue;
};

// Mirrors the draft_template_type enum (SCHEMA_REGISTRY) and BLUEPRINT §4.8.
// Each template gets its own hue so the grid scans at a glance.
const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    value: "grant_narrative",
    label: "Grant narrative",
    description: "Structured proposal: need, program, capacity, impact.",
    icon: FileText,
    hue: "blue",
  },
  {
    value: "donation_request_letter",
    label: "Donation request letter",
    description: "Warm corporate appeal with a concise, specific ask.",
    icon: Mail,
    hue: "emerald",
  },
  {
    value: "budget_narrative",
    label: "Budget narrative",
    description: "Line-item justification tied to program activities.",
    icon: Calculator,
    hue: "amber",
  },
  {
    value: "impact_statement",
    label: "Impact statement",
    description: "Quantified outcomes this funding makes possible.",
    icon: Target,
    hue: "violet",
  },
  {
    value: "letter_of_inquiry",
    label: "Letter of inquiry",
    description: "Brief intro to gauge a funder's interest first.",
    icon: PenLine,
    hue: "cyan",
  },
  {
    value: "full_proposal",
    label: "Full proposal",
    description: "All standard sections, summary through evaluation.",
    icon: ScrollText,
    hue: "indigo",
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
                    background: "linear-gradient(135deg,rgba(124,58,237,0.4),rgba(109,40,217,0.3))",
                    border: "2px solid #A855F7",
                    borderRadius: "12px",
                    padding: "16px",
                    cursor: "pointer",
                    boxShadow: "0 0 0 3px rgba(168,85,247,0.2)",
                    transition: "all 0.15s",
                  }
                : isHovered
                  ? {
                      backgroundColor: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(168,85,247,0.4)",
                      borderRadius: "12px",
                      padding: "16px",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }
                  : {
                      backgroundColor: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "12px",
                      padding: "16px",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }
            }
          >
            <Icon className="h-5 w-5" style={{ color: "#A78BFA" }} aria-hidden />
            <span
              style={
                selected
                  ? { fontSize: "14px", fontWeight: 700, color: "#E9D5FF", marginTop: "10px" }
                  : { fontSize: "14px", fontWeight: 700, color: "rgba(248,250,252,0.8)", marginTop: "10px" }
              }
            >
              {option.label}
            </span>
            <span style={{ fontSize: "12px", color: "rgba(248,250,252,0.4)", marginTop: "4px" }}>
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
