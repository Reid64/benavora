import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/** The only four semantic pairs a badge may render — bg is the light tint,
 * text is the 700-level of the same hue (≥4.5:1 contrast), plus a neutral
 * pair for non-semantic labels. */
export type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral";

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
  success: "bg-success-bg text-success-text",
  warning: "bg-warning-bg text-warning-text",
  error: "bg-error-bg text-error-text",
  info: "bg-info-bg text-info-text",
  neutral: "bg-surface-raised text-text-muted border border-border",
};

const DOT_CLASSES: Record<BadgeVariant, string> = {
  success: "bg-success-text",
  warning: "bg-warning-text",
  error: "bg-error-text",
  info: "bg-info-text",
  neutral: "bg-text-muted",
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
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
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
