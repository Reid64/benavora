import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/** The Elevated Slate semantic pairs a badge may render — bg is the light
 * tint, text is the high-contrast readable tone of the same hue, border is
 * the mid tint of the same hue, plus a neutral pair for non-semantic labels
 * and a solid `primary` pair for brand-emphasis badges. */
export type BadgeVariant =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "primary";

/**
 * Legacy color names — kept so the ~80 existing call sites don't need to
 * change. Each one resolves to one of the five variants above; there is no
 * per-color styling left, so no raw hue class can leak into a badge.
 */
export type BadgeColor =
  | "gray"
  | "teal"
  /** @deprecated alias of `teal`, kept for existing callers. */
  | "indigo"
  | "purple"
  | "navy"
  | "green"
  | "yellow"
  | "red"
  | "blue"
  | "sky"
  | "orange"
  | "pink";

const COLOR_TO_VARIANT: Record<BadgeColor, BadgeVariant> = {
  gray: "neutral",
  navy: "neutral",
  pink: "neutral",
  teal: "info",
  indigo: "info",
  sky: "info",
  blue: "info",
  purple: "info",
  green: "success",
  yellow: "warning",
  orange: "warning",
  red: "error",
};

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: "bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0]",
  warning: "bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A]",
  error: "bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA]",
  info: "bg-[#E0F2FE] text-[#0369A1] border border-[#BAE6FD]",
  neutral: "bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]",
  primary: "bg-[#3D6B50] text-white",
};

const DOT_CLASSES: Record<BadgeVariant, string> = {
  success: "bg-[#15803D]",
  warning: "bg-[#B45309]",
  error: "bg-[#B91C1C]",
  info: "bg-[#0369A1]",
  neutral: "bg-[#475569]",
  primary: "bg-surface",
};

export type BadgeProps = {
  /** Semantic variant — preferred for new call sites. Takes precedence over `color`. */
  variant?: BadgeVariant;
  /** Legacy color name, mapped onto a semantic variant. Defaults to "gray" (neutral). */
  color?: BadgeColor;
  /** Render a leading dot indicator in the variant color. */
  withDot?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * Small pill for statuses and labels. The ONLY badge implementation in the
 * app — always a light bg tint + 700-level text of the same hue, never a
 * raw palette hue class.
 */
export function Badge({
  variant,
  color = "gray",
  withDot = false,
  children,
  className,
}: BadgeProps) {
  const resolved = variant ?? COLOR_TO_VARIANT[color];

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold",
        withDot && "gap-1.5",
        VARIANT_CLASSES[resolved],
        className,
      )}
    >
      {withDot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[resolved])}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
