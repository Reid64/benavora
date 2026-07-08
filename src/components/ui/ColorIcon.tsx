import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * One hue per function, used consistently across the app: opportunities/search
 * = cyan, money/funding = emerald, documents/drafts = blue, deadlines/time =
 * amber, analytics = violet, applications = indigo, alerts = rose. These are
 * categorical (nominal) colors for scanning icon chips at a glance — not
 * brand accents, so this is the one place raw Tailwind hue classes for
 * violet/rose/etc. are intentional.
 */
export type IconHue =
  | "cyan"
  | "emerald"
  | "blue"
  | "amber"
  | "violet"
  | "indigo"
  | "rose";

export const ICON_HUE_CLASSES: Record<IconHue, string> = {
  cyan: "bg-cyan-100 text-cyan-700",
  emerald: "bg-emerald-100 text-emerald-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  violet: "bg-violet-100 text-violet-700",
  indigo: "bg-indigo-100 text-indigo-700",
  rose: "bg-rose-100 text-rose-700",
};

/** Matching `border-l-4` accent for cards/tiles keyed to the same hue. */
export const ICON_HUE_BORDER_CLASSES: Record<IconHue, string> = {
  cyan: "border-l-cyan-500",
  emerald: "border-l-emerald-500",
  blue: "border-l-blue-500",
  amber: "border-l-amber-500",
  violet: "border-l-violet-500",
  indigo: "border-l-indigo-500",
  rose: "border-l-rose-500",
};

export type ColorIconProps = {
  icon: LucideIcon;
  hue: IconHue;
  /** Chip size. Defaults to "md" (h-10 w-10). */
  size?: "sm" | "md";
  className?: string;
  iconClassName?: string;
};

const SIZE_CLASSES = {
  sm: "h-9 w-9",
  md: "h-10 w-10",
} as const;

/**
 * Icon inside a rounded, tinted container — the one icon-chip pattern used
 * app-wide (stat cards, template cards, source cards). Pick `hue` by
 * function, not by taste, so the same category always reads the same color.
 */
export function ColorIcon({
  icon: Icon,
  hue,
  size = "md",
  className,
  iconClassName,
}: ColorIconProps) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        SIZE_CLASSES[size],
        ICON_HUE_CLASSES[hue],
        className,
      )}
    >
      <Icon className={cn("h-5 w-5", iconClassName)} aria-hidden />
    </span>
  );
}
