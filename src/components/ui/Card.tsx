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
        "bg-white rounded-xl shadow-sm border border-border transition-shadow hover:shadow-md",
        className,
      )}
      style={{
        backgroundColor: "#FFFFFF",
        boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
        border: "1px solid #B8C9D9",
        borderRadius: "12px",
      }}
    >
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 rounded-t-xl border-b border-border bg-white-sunken px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h3 className="truncate text-base font-semibold text-text">
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-text-muted">{description}</p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn("flex-1", !noPadding && "p-5")}>{children}</div>
    </div>
  );
}
