import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

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

export type BadgeProps = {
  /** Color variant. Defaults to "gray". */
  color?: BadgeColor;
  /** Render a leading dot indicator in the badge color. */
  withDot?: boolean;
  children: ReactNode;
  className?: string;
};

const COLOR_CLASSES: Record<BadgeColor, string> = {
  gray: "bg-white/8 text-navy-200 ring-1 ring-inset ring-white/10",
  teal: "bg-teal-400/15 text-teal-200 ring-1 ring-inset ring-teal-400/25",
  indigo: "bg-teal-400/15 text-teal-200 ring-1 ring-inset ring-teal-400/25",
  purple: "bg-plum-400/15 text-plum-200 ring-1 ring-inset ring-plum-400/30",
  navy: "bg-blue-400/15 text-blue-200 ring-1 ring-inset ring-blue-400/25",
  green: "bg-green-400/15 text-green-200 ring-1 ring-inset ring-green-400/25",
  yellow: "bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-400/25",
  red: "bg-red-400/15 text-red-200 ring-1 ring-inset ring-red-400/25",
  blue: "bg-blue-400/15 text-blue-200 ring-1 ring-inset ring-blue-400/25",
  sky: "bg-sky-400/15 text-sky-200 ring-1 ring-inset ring-sky-400/25",
  orange: "bg-orange-400/15 text-orange-200 ring-1 ring-inset ring-orange-400/25",
  pink: "bg-pink-400/15 text-pink-200 ring-1 ring-inset ring-pink-400/25",
};

const DOT_CLASSES: Record<BadgeColor, string> = {
  gray: "bg-navy-400",
  teal: "bg-teal-500",
  indigo: "bg-teal-500",
  purple: "bg-plum-500",
  navy: "bg-navy-600",
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  sky: "bg-sky-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
};

/**
 * Small pill for statuses and labels, in one of the semantic color variants.
 */
export function Badge({
  color = "gray",
  withDot = false,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        COLOR_CLASSES[color],
        className,
      )}
    >
      {withDot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[color])}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
