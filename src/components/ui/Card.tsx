import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type CardProps = {
  /** Optional header title. Rendered with `description` and `actions`. */
  title?: ReactNode;
  /** Optional sub-text under the title. */
  description?: ReactNode;
  /** Optional content aligned to the right of the header (e.g. a button). */
  actions?: ReactNode;
  /** Remove the default body padding (useful when embedding a table). */
  noPadding?: boolean;
  children?: ReactNode;
  className?: string;
};

/**
 * A bordered surface with an optional header (title, description, actions).
 */
export function Card({
  title,
  description,
  actions,
  noPadding = false,
  children,
  className,
}: CardProps) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <div
      className={cn(
        "glow-border rounded-xl bg-ink-700/60 shadow-card backdrop-blur-md transition-shadow hover:shadow-card-hover",
        className,
      )}
    >
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 border-b border-navy-100 px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h3 className="truncate text-base font-semibold text-navy-900">
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-navy-500">{description}</p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn(!noPadding && "p-5")}>{children}</div>
    </div>
  );
}
