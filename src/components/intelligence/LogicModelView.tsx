"use client";

import { BarChart, ChevronDown, ChevronRight, Cog, Package, Star, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export interface LogicModelData {
  inputs: string[];
  activities: string[];
  outputs: string[];
  outcomes: string[];
  impact: string[];
}

export interface LogicModelViewProps {
  model: LogicModelData;
  title?: string;
  className?: string;
}

interface StageConfig {
  key: keyof LogicModelData;
  label: string;
  Icon: LucideIcon;
  headerColor: string;
  bgColor: string;
  borderColor: string;
  chipColor: string;
  iconColor: string;
}

const STAGES: StageConfig[] = [
  {
    key: "inputs",
    label: "Inputs",
    Icon: Package,
    headerColor: "text-slate-200",
    bgColor: "bg-white/5",
    borderColor: "border-white/10",
    chipColor: "bg-white/8 text-slate-300 ring-1 ring-inset ring-white/10",
    iconColor: "text-slate-400",
  },
  {
    key: "activities",
    label: "Activities",
    Icon: Cog,
    headerColor: "text-blue-200",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/15",
    chipColor: "bg-blue-400/10 text-blue-200 ring-1 ring-inset ring-blue-400/20",
    iconColor: "text-blue-400",
  },
  {
    key: "outputs",
    label: "Outputs",
    Icon: BarChart,
    headerColor: "text-teal-200",
    bgColor: "bg-teal-500/10",
    borderColor: "border-teal-500/15",
    chipColor: "bg-teal-400/10 text-teal-200 ring-1 ring-inset ring-teal-400/20",
    iconColor: "text-teal-400",
  },
  {
    key: "outcomes",
    label: "Outcomes",
    Icon: Target,
    headerColor: "text-violet-200",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/15",
    chipColor: "bg-violet-400/10 text-violet-200 ring-1 ring-inset ring-violet-400/20",
    iconColor: "text-violet-400",
  },
  {
    key: "impact",
    label: "Impact",
    Icon: Star,
    headerColor: "text-amber-200",
    bgColor: "bg-amber-500/12",
    borderColor: "border-amber-500/20",
    chipColor: "bg-amber-400/12 text-amber-200 ring-1 ring-inset ring-amber-400/25",
    iconColor: "text-amber-400",
  },
];

function StageColumn({
  stage,
  items,
}: {
  stage: StageConfig;
  items: string[];
}) {
  const { label, Icon, headerColor, bgColor, borderColor, chipColor, iconColor } = stage;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col rounded-xl border p-4",
        bgColor,
        borderColor,
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", iconColor)} aria-hidden />
        <h3 className={cn("text-sm font-semibold", headerColor)}>{label}</h3>
        <span className="ml-auto text-xs text-white/30">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <p className="text-xs italic text-white/25">None specified</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item, idx) => (
            <li
              key={idx}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs leading-snug",
                chipColor,
              )}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Renders a logic model as a five-stage horizontal flow diagram.
 * Stacks vertically on mobile.
 */
export function LogicModelView({ model, title, className }: LogicModelViewProps) {
  return (
    <div className={cn("w-full", className)}>
      {title && (
        <h2 className="mb-4 text-base font-semibold text-navy-900">{title}</h2>
      )}

      {/* Desktop: horizontal row with chevron connectors */}
      <div className="hidden items-start gap-0 md:flex">
        {STAGES.map((stage, idx) => (
          <div key={stage.key} className="flex min-w-0 flex-1 items-start">
            <StageColumn stage={stage} items={model[stage.key]} />

            {idx < STAGES.length - 1 && (
              <div className="mx-2 mt-6 shrink-0" aria-hidden>
                <ChevronRight className="h-5 w-5 text-white/20" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Mobile: vertical stack with chevron connectors */}
      <div className="flex flex-col gap-0 md:hidden">
        {STAGES.map((stage, idx) => (
          <div key={stage.key} className="flex flex-col items-center">
            <StageColumn stage={stage} items={model[stage.key]} />

            {idx < STAGES.length - 1 && (
              <div className="py-1.5" aria-hidden>
                <ChevronDown className="h-5 w-5 text-white/20" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Compact single-row summary showing stage names and item counts.
 * Suitable for tables, cards, and tight layouts.
 */
export function LogicModelCompact({
  model,
  className,
}: {
  model: LogicModelData;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1 text-xs", className)}>
      {STAGES.map((stage, idx) => {
        const count = model[stage.key].length;
        return (
          <div key={stage.key} className="flex items-center gap-1">
            <span className={cn("font-medium", stage.iconColor)}>{stage.label}</span>
            <span className="text-white/40">({count})</span>
            {idx < STAGES.length - 1 && (
              <ChevronRight className="h-3 w-3 shrink-0 text-white/20" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}
